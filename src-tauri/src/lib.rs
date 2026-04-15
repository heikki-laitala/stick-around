use tauri::Manager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use signal_hook::consts::SIGINT;

/// Get all window bounds for a process identified by PID.
fn get_all_window_bounds(pid: u32) -> Vec<(i32, i32, u32, u32)> {
    let script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {})
                set out to ""
                repeat with w in windows
                    set p to position of w
                    set s to size of w
                    set out to out & (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s) & ";"
                end repeat
                return out
            end tell
        end tell"#,
        pid
    );
    let output = match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => return vec![],
    };
    output
        .split(';')
        .filter(|s| !s.is_empty())
        .filter_map(|entry| {
            let parts: Vec<i32> = entry.split(',').filter_map(|p| p.trim().parse().ok()).collect();
            if parts.len() == 4 {
                Some((parts[0], parts[1], parts[2] as u32, parts[3] as u32))
            } else {
                None
            }
        })
        .collect()
}

/// Get the bounds of the front window of a process by PID.
fn get_front_window_bounds(pid: u32) -> Option<(i32, i32, u32, u32)> {
    let script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {})
                if (count of windows) > 0 then
                    set w to front window
                    set p to position of w
                    set s to size of w
                    return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
                end if
            end tell
        end tell"#,
        pid
    );
    parse_bounds_output(&script)
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

/// Get the PID of the frontmost process.
fn get_frontmost_pid() -> Option<u32> {
    let script = r#"tell application "System Events" to get unix id of first process whose frontmost is true"#;
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
}

/// Raise the window at position (x, y) in the process identified by PID, then activate.
fn raise_window_at(pid: u32, x: i32, y: i32) {
    let script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {pid})
                repeat with w in windows
                    set p to position of w
                    if (item 1 of p) is {x} and (item 2 of p) is {y} then
                        perform action "AXRaise" of w
                        exit repeat
                    end if
                end repeat
                set frontmost to true
            end tell
        end tell"#,
        pid = pid,
        x = x,
        y = y
    );
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();
}

/// Find the window closest to a known position (by center point distance).
fn find_closest_window(
    windows: &[(i32, i32, u32, u32)],
    last: (i32, i32, u32, u32),
) -> Option<(i32, i32, u32, u32)> {
    let cx = last.0 + last.2 as i32 / 2;
    let cy = last.1 + last.3 as i32 / 2;
    windows
        .iter()
        .min_by_key(|w| {
            let wx = w.0 + w.2 as i32 / 2;
            let wy = w.1 + w.3 as i32 / 2;
            (wx - cx).pow(2) + (wy - cy).pow(2)
        })
        .copied()
}

fn apply_bounds(window: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    let _ = window.set_position(tauri::Position::Logical(
        tauri::LogicalPosition::new(x as f64, y as f64),
    ));
    let _ = window.set_size(tauri::Size::Logical(
        tauri::LogicalSize::new(w as f64, h as f64),
    ));
}

/// Shared state: the terminal PID and the last known window bounds.
struct TerminalState {
    pid: u32,
    bounds: Arc<Mutex<(i32, i32, u32, u32)>>,
}

#[tauri::command]
fn focus_terminal(state: tauri::State<'_, TerminalState>) {
    let (x, y, _, _) = *state.bounds.lock().unwrap();
    raise_window_at(state.pid, x, y);
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

const PID_FILE: &str = "/tmp/stick-around.pid";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(terminal_app: Option<String>) {
    std::fs::write(PID_FILE, std::process::id().to_string()).ok();

    // Detect the terminal PID (frontmost process at launch)
    let terminal_pid: Option<u32> = terminal_app
        .and_then(|name| {
            // If given an app name, find its PID
            let script = format!(
                r#"tell application "System Events" to get unix id of first process whose name is "{}""#,
                name
            );
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output()
                .ok()
                .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
        })
        .or_else(|| get_frontmost_pid());

    let pid = match terminal_pid {
        Some(p) => p,
        None => {
            eprintln!("[stick-around] could not detect terminal PID");
            return;
        }
    };

    let initial_bounds = get_front_window_bounds(pid);
    let shared_bounds = Arc::new(Mutex::new(initial_bounds.unwrap_or((0, 0, 800, 600))));
    let poll_bounds = shared_bounds.clone();

    let state = TerminalState {
        pid,
        bounds: shared_bounds,
    };

    tauri::Builder::default()
        .manage(state)
        .setup(move |app| {
            let window = app.get_webview_window("overlay").unwrap();

            if let Some((x, y, w, h)) = initial_bounds {
                apply_bounds(&window, x, y, w, h);
            }

            // Poll: track window by position, toggle alwaysOnTop when terminal is active
            let win_track = window.clone();
            std::thread::spawn(move || {
                let mut last_bounds = initial_bounds.unwrap_or((0, 0, 800, 600));
                let mut was_on_top = false;
                loop {
                    // Overlay on top when the terminal process or the overlay is frontmost
                    let frontmost_pid = get_frontmost_pid().unwrap_or(0);
                    let my_pid = std::process::id();
                    let on_top = frontmost_pid == pid || frontmost_pid == my_pid;

                    if on_top != was_on_top {
                        let _ = win_track.set_always_on_top(on_top);
                        was_on_top = on_top;
                    }

                    let windows = get_all_window_bounds(pid);
                    if let Some(b) = find_closest_window(&windows, last_bounds) {
                        if b != last_bounds {
                            apply_bounds(&win_track, b.0, b.1, b.2, b.3);
                            last_bounds = b;
                            *poll_bounds.lock().unwrap() = b;
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
