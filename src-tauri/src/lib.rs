use tauri::Manager;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use signal_hook::consts::SIGINT;

fn rdev_key_to_code(key: rdev::Key) -> Option<&'static str> {
    match key {
        rdev::Key::KeyA => Some("KeyA"),
        rdev::Key::KeyD => Some("KeyD"),
        rdev::Key::KeyW => Some("KeyW"),
        rdev::Key::UpArrow => Some("ArrowUp"),
        rdev::Key::DownArrow => Some("ArrowDown"),
        rdev::Key::LeftArrow => Some("ArrowLeft"),
        rdev::Key::RightArrow => Some("ArrowRight"),
        rdev::Key::Space => Some("Space"),
        _ => None,
    }
}

/// Get the bounds of a window by matching its title within an app process.
fn get_window_bounds_by_title(app: &str, title: &str) -> Option<(i32, i32, u32, u32)> {
    // Escape quotes in title for AppleScript
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

/// Tracks a specific window by app name + window title.
struct WindowTarget {
    app_name: String,
    window_title: String,
}

impl WindowTarget {
    /// Detect the frontmost window of the frontmost app.
    fn detect(explicit_app: Option<String>) -> Option<Self> {
        // Use the explicitly provided app name, or detect the frontmost one
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
        eprintln!("[detect] app={:?} title={:?}", app, title);
        Some(Self { app_name: app, window_title: title })
    }

    fn get_bounds(&self) -> Option<(i32, i32, u32, u32)> {
        // Try title match first, fall back to front window
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(terminal_app: Option<String>) {
    tauri::Builder::default()
        .setup(move |app| {
            let window = app.get_webview_window("overlay").unwrap();
            window.set_ignore_cursor_events(true)?;

            // Detect which window launched us
            let target = WindowTarget::detect(terminal_app);
            if let Some(ref t) = target {
                eprintln!("[overlay] tracking app={:?} title={:?}", t.app_name, t.window_title);
                if let Some((x, y, w, h)) = t.get_bounds() {
                    apply_bounds(&window, x, y, w, h);
                }
            } else {
                eprintln!("[overlay] WARNING: could not identify parent window");
            }

            // Poll window position
            let win_track = window.clone();
            std::thread::spawn(move || {
                let mut last = (0i32, 0i32, 0u32, 0u32);
                loop {
                    let bounds = target.as_ref().and_then(|t| t.get_bounds());
                    if let Some(b) = bounds {
                        if b != last {
                            apply_bounds(&win_track, b.0, b.1, b.2, b.3);
                            last = b;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            });

            // Handle SIGINT (Ctrl+C) for clean shutdown
            let app_handle = app.handle().clone();
            let sigint_flag = Arc::new(AtomicBool::new(false));
            signal_hook::flag::register(SIGINT, sigint_flag.clone())?;
            std::thread::spawn(move || {
                while !sigint_flag.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                app_handle.exit(0);
            });

            // Global keyboard listener for game controls
            let win_keys = window.clone();
            std::thread::spawn(move || {
                rdev::listen(move |event| {
                    match event.event_type {
                        rdev::EventType::KeyPress(key) => {
                            if let Some(code) = rdev_key_to_code(key) {
                                let _ = win_keys.emit("global-keydown", code);
                            }
                        }
                        rdev::EventType::KeyRelease(key) => {
                            if let Some(code) = rdev_key_to_code(key) {
                                let _ = win_keys.emit("global-keyup", code);
                            }
                        }
                        _ => {}
                    }
                }).ok();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
