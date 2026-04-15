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

/// Walk up the process tree from our PID to find which terminal app launched us.
/// Returns (terminal_app_name, window_index) for tracking the specific window.
fn find_parent_terminal() -> Option<String> {
    let known = ["Terminal", "iTerm2", "Alacritty", "kitty", "WezTerm", "Ghostty"];
    let mut pid = std::process::id();

    // Walk up the PPID chain (max 20 hops to avoid infinite loops)
    for _ in 0..20 {
        if let Ok(output) = std::process::Command::new("ps")
            .args(["-o", "ppid=,comm=", "-p", &pid.to_string()])
            .output()
        {
            let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // line is like "  1234 /path/to/comm" – split on whitespace, skip empties
            let mut tokens = line.split_whitespace();
            let ppid: u32 = match tokens.next().and_then(|s| s.parse().ok()) {
                Some(p) => p,
                None => break,
            };
            let comm = match tokens.next() {
                Some(c) => c,
                None => break,
            };
            // comm might be a full path like /Applications/iTerm.app/.../iTerm2
            let basename = comm.rsplit('/').next().unwrap_or(comm);
            for term in &known {
                if basename.eq_ignore_ascii_case(term) {
                    return Some(term.to_string());
                }
            }
            if ppid <= 1 {
                break;
            }
            pid = ppid;
        } else {
            break;
        }
    }
    None
}

/// At launch, identify the specific window of our parent terminal.
/// Returns (app_name, window_id) where window_id is the macOS AX window ID.
fn identify_launch_window(terminal: &str) -> Option<i64> {
    // The frontmost window of the terminal is the one that launched us
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                if (count of windows) > 0 then
                    -- Get the id of the front window (AXWindow attribute)
                    set w to front window
                    return id of w
                end if
            end tell
        end tell"#,
        terminal
    );
    if let Ok(output) = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(wid) = s.parse::<i64>() {
            return Some(wid);
        }
    }
    None
}

/// Get bounds of a specific window by its ID in the given terminal app.
fn get_window_bounds_by_id(terminal: &str, window_id: i64) -> Option<(i32, i32, u32, u32)> {
    let script = format!(
        r#"tell application "System Events"
            tell process "{}"
                repeat with w in windows
                    if id of w is {} then
                        set p to position of w
                        set s to size of w
                        return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
                    end if
                end repeat
            end tell
        end tell"#,
        terminal, window_id
    );
    if let Ok(output) = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
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

/// Fallback: get bounds of the first terminal window found (original behavior).
fn get_terminal_bounds_fallback() -> Option<(String, i32, i32, u32, u32)> {
    let terminals = ["Terminal", "iTerm2", "Alacritty", "kitty", "WezTerm", "Ghostty"];
    for term in &terminals {
        let script = format!(
            r#"tell application "System Events"
                if exists process "{}" then
                    tell process "{}"
                        if (count of windows) > 0 then
                            set w to first window
                            set p to position of w
                            set s to size of w
                            return (item 1 of p) & "," & (item 2 of p) & "," & (item 1 of s) & "," & (item 2 of s)
                        end if
                    end tell
                end if
            end tell"#,
            term, term
        );
        if let Ok(output) = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
        {
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<i32> = s.split(',').filter_map(|p| p.trim().parse().ok()).collect();
            if parts.len() == 4 {
                return Some((term.to_string(), parts[0], parts[1], parts[2] as u32, parts[3] as u32));
            }
        }
    }
    None
}

/// Tracks a specific terminal window.
struct TerminalTarget {
    app_name: String,
    window_id: i64,
}

impl TerminalTarget {
    fn detect() -> Option<Self> {
        // First try: walk PPID chain to find our terminal
        if let Some(app) = find_parent_terminal() {
            if let Some(wid) = identify_launch_window(&app) {
                return Some(Self { app_name: app, window_id: wid });
            }
        }
        // Fallback: use frontmost terminal's front window
        if let Some((app, _, _, _, _)) = get_terminal_bounds_fallback() {
            if let Some(wid) = identify_launch_window(&app) {
                return Some(Self { app_name: app, window_id: wid });
            }
        }
        None
    }

    fn get_bounds(&self) -> Option<(i32, i32, u32, u32)> {
        get_window_bounds_by_id(&self.app_name, self.window_id)
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
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("overlay").unwrap();
            window.set_ignore_cursor_events(true)?;

            // Detect which terminal window launched us
            let target = TerminalTarget::detect();
            if let Some(ref t) = target {
                eprintln!("[overlay] tracking {} window id {}", t.app_name, t.window_id);
                if let Some((x, y, w, h)) = t.get_bounds() {
                    apply_bounds(&window, x, y, w, h);
                }
            } else {
                eprintln!("[overlay] WARNING: could not identify parent terminal window");
            }

            // Poll terminal position
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
