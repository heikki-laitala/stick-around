use tauri::Manager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use signal_hook::consts::SIGINT;

/// Get the bounds of a window by matching its title within an app process.
fn get_window_bounds_by_title(app: &str, title: &str) -> Option<(i32, i32, u32, u32)> {
    let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                repeat with w in windows
                    if name of w is "{}" then
                        set p to position of w
                        set s to size of w
                        return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
                    end if
                end repeat
            end tell
        end tell"#,
        app, escaped_title
    );
    parse_bounds_output(&script)
}

/// Get the bounds of the front window of an app process.
fn get_front_window_bounds(app: &str) -> Option<(i32, i32, u32, u32)> {
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                if (count of windows) > 0 then
                    set w to front window
                    set p to position of w
                    set s to size of w
                    return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
                end if
            end tell
        end tell"#,
        app
    );
    parse_bounds_output(&script)
}

/// Get the title of the front window of an app process.
fn get_front_window_title(app: &str) -> Option<String> {
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                if (count of windows) > 0 then
                    return name of front window
                end if
            end tell
        end tell"#,
        app
    );
    if let Ok(output) = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !s.is_empty() {
            return Some(s);
        }
    }
    None
}

fn parse_bounds_output(script: &str) -> Option<(i32, i32, u32, u32)> {
    if let Ok(output) = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
    {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<i32> = s.split(',').filter_map(|p| p.trim().parse().ok()).collect();
        if parts.len() == 4 {
            return Some((parts[0], parts[1], parts[2] as u32, parts[3] as u32));
        }
    }
    None
}

fn get_frontmost_app() -> Option<String> {
    let script = r#"tell application "System Events" to get name of first process whose frontmost is true"#;
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn activate_app(app_name: &str) {
    let script = format!(
        r#"tell application "System Events" to set frontmost of process "{}" to true"#,
        app_name
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();
}

/// Tracks a specific window by app name + window title.
struct WindowTarget {
    app_name: String,
    window_title: String,
}

impl WindowTarget {
    fn detect(explicit_app: Option<String>) -> Option<Self> {
        let app = explicit_app.or_else(|| {
            let script = r#"tell application "System Events" to get name of first process whose frontmost is true"#;
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
        })?;

        let title = get_front_window_title(&app)?;
        Some(Self { app_name: app, window_title: title })
    }

    fn get_bounds(&self) -> Option<(i32, i32, u32, u32)> {
        get_window_bounds_by_title(&self.app_name, &self.window_title)
            .or_else(|| get_front_window_bounds(&self.app_name))
    }
}

fn apply_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    let _ = window.set_position(tauri::Position::Logical(
        tauri::LogicalPosition::new(x as f64, y as f64),
    ));
    let _ = window.set_size(tauri::Size::Logical(
        tauri::LogicalSize::new(w as f64, h as f64),
    ));
}

#[tauri::command]
fn focus_terminal(app_name: String) {
    activate_app(&app_name);
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

const PID_FILE: &str = "/tmp/stick-around.pid";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(terminal_app: Option<String>) {
    std::fs::write(PID_FILE, std::process::id().to_string()).ok();

    tauri::Builder::default()
        .setup(move |app| {
            let window = app.get_webview_window("overlay").unwrap();

            // Detect which window launched us
            let target = WindowTarget::detect(terminal_app);

            // Inject terminal app name into JS directly (with small delay for webview init)
            if let Some(ref t) = target {
                let name = t.app_name.clone();
                let win = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = win.eval(&format!("window.TERMINAL_APP = '{}'", name));
                });

                if let Some((x, y, w, h)) = t.get_bounds() {
                    apply_bounds(&window, x, y, w, h);
                }
            }

            // Poll window position and visibility
            let win_track = window.clone();
            std::thread::spawn(move || {
                let mut last = (0i32, 0i32, 0u32, 0u32);
                let mut was_visible = true;
                loop {
                    // Only show overlay when the terminal or the overlay itself is frontmost
                    let should_show = get_frontmost_app()
                        .map(|front| {
                            target.as_ref().map_or(false, |t| front == t.app_name)
                                || front == "stick-around"
                        })
                        .unwrap_or(false);

                    if should_show && !was_visible {
                        let _ = win_track.show();
                        was_visible = true;
                    } else if !should_show && was_visible {
                        let _ = win_track.hide();
                        was_visible = false;
                    }

                    if should_show {
                        let bounds = target.as_ref().and_then(|t| t.get_bounds());
                        if let Some(b) = bounds {
                            if b != last {
                                apply_bounds(&win_track, b.0, b.1, b.2, b.3);
                                last = b;
                            }
                        }
                    }

                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            });

            // Handle SIGINT and SIGTERM for clean shutdown
            let app_handle = app.handle().clone();
            let shutdown_flag = Arc::new(AtomicBool::new(false));
            signal_hook::flag::register(SIGINT, shutdown_flag.clone())?;
            signal_hook::flag::register(signal_hook::consts::SIGTERM, shutdown_flag.clone())?;
            std::thread::spawn(move || {
                while !shutdown_flag.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                app_handle.exit(0);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![focus_terminal, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    std::fs::remove_file(PID_FILE).ok();
}
