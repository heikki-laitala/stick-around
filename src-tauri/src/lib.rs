mod platform;

use tauri::{Emitter, Manager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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
fn focus_terminal(window: tauri::WebviewWindow, state: tauri::State<'_, TerminalState>) {
    deactivate_overlay_impl(&window, &state);
}

#[tauri::command]
fn activate_overlay(window: tauri::WebviewWindow) {
    activate_overlay_impl(&window);
}

#[tauri::command]
fn deactivate_overlay(window: tauri::WebviewWindow, state: tauri::State<'_, TerminalState>) {
    deactivate_overlay_impl(&window, &state);
}

fn activate_overlay_impl(window: &tauri::WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_window) = window.ns_window() {
            unsafe { platform::make_key_window(ns_window) };
        }
    }
    let _ = window.set_focus();
}

fn deactivate_overlay_impl(window: &tauri::WebviewWindow, state: &TerminalState) {
    let _ = window.set_ignore_cursor_events(true);
    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_window) = window.ns_window() {
            unsafe { platform::resign_key_window(ns_window) };
        }
    }
    let (x, y, _, _) = *state.bounds.lock().unwrap();
    platform::raise_window_at(state.pid, x, y);
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

fn pid_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join("stick-around.pid")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(terminal_app: Option<String>) {
    let pid_file = pid_file_path();
    std::fs::write(&pid_file, std::process::id().to_string()).ok();

    // Detect the terminal PID (frontmost process at launch)
    let terminal_pid: Option<u32> = terminal_app
        .and_then(|name| platform::get_pid_by_name(&name))
        .or_else(|| platform::get_frontmost_pid());

    let pid = match terminal_pid {
        Some(p) => p,
        None => {
            eprintln!("[stick-around] could not detect terminal PID");
            return;
        }
    };

    let initial_bounds = platform::get_front_window_bounds(pid);
    let shared_bounds = Arc::new(Mutex::new(initial_bounds.unwrap_or((0, 0, 800, 600))));
    let poll_bounds = shared_bounds.clone();

    let state = TerminalState {
        pid,
        bounds: shared_bounds,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state)
        .setup(move |app| {
            let window = app.get_webview_window("overlay").unwrap();

            // On macOS, convert to a non-activating panel so the terminal
            // keeps rendering while the overlay receives keyboard events.
            #[cfg(target_os = "macos")]
            {
                if let Ok(ns_window) = window.ns_window() {
                    unsafe { platform::configure_as_panel(ns_window) };
                }
            }

            if let Some((x, y, w, h)) = initial_bounds {
                apply_bounds(&window, x, y, w, h);
            }

            // Start in passive mode: clicks pass through to whatever is underneath,
            // and the overlay doesn't capture keyboard input. Users activate via
            // Cmd+Shift+G or Ctrl+click.
            let _ = window.set_ignore_cursor_events(true);
            #[cfg(target_os = "macos")]
            {
                if let Ok(ns_window) = window.ns_window() {
                    unsafe { platform::resign_key_window(ns_window) };
                }
            }

            // Cmd+Shift+G: global shortcut that activates the overlay.
            let activation_window = window.clone();
            let shortcut = Shortcut::new(
                Some(Modifiers::META | Modifiers::SHIFT),
                Code::KeyG,
            );
            let shortcut_match = shortcut;
            app.handle()
                .global_shortcut()
                .on_shortcut(shortcut, move |_app, triggered, event| {
                    if triggered == &shortcut_match && event.state() == ShortcutState::Pressed {
                        let handler_window = activation_window.clone();
                        let _ = activation_window.run_on_main_thread(move || {
                            activate_overlay_impl(&handler_window);
                        });
                    }
                })?;

            // Shift+left-click on the overlay area: activate without first clicking
            // through via the mouse (which would normally require the overlay to
            // already have focus).
            #[cfg(target_os = "macos")]
            {
                let click_window = window.clone();
                let click_bounds = poll_bounds.clone();
                unsafe {
                    platform::install_shift_click_monitor(click_bounds, move || {
                        let handler_window = click_window.clone();
                        let _ = click_window.run_on_main_thread(move || {
                            activate_overlay_impl(&handler_window);
                        });
                    });
                }
            }

            // Poll: track window by position, toggle alwaysOnTop when terminal is active
            let win_track = window.clone();
            std::thread::spawn(move || {
                let mut last_bounds = initial_bounds.unwrap_or((0, 0, 800, 600));
                let mut was_on_top = false;
                let my_pid = std::process::id();
                loop {
                    let frontmost_pid = platform::get_frontmost_pid().unwrap_or(0);
                    let on_top = frontmost_pid == pid || frontmost_pid == my_pid;

                    if on_top != was_on_top {
                        let _ = win_track.set_always_on_top(on_top);
                        was_on_top = on_top;
                    }

                    let windows = platform::get_all_window_bounds(pid);
                    if let Some(b) = find_closest_window(&windows, last_bounds) {
                        if b != last_bounds {
                            apply_bounds(&win_track, b.0, b.1, b.2, b.3);
                            last_bounds = b;
                            *poll_bounds.lock().unwrap() = b;
                        }
                    }

                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            });

            // Poll terminal text content and emit line data to frontend
            let win_text = window.clone();
            std::thread::spawn(move || {
                let mut last_content: Option<platform::TerminalContent> = None;
                loop {
                    if let Some(content) = platform::get_terminal_content(pid) {
                        if last_content.as_ref() != Some(&content) {
                            let _ = win_text.emit("terminal-content", &content);
                            last_content = Some(content);
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
            });

            // Handle shutdown signals
            let app_handle = app.handle().clone();
            let shutdown_flag = Arc::new(AtomicBool::new(false));

            #[cfg(unix)]
            {
                use signal_hook::consts::{SIGINT, SIGTERM};
                signal_hook::flag::register(SIGINT, shutdown_flag.clone())?;
                signal_hook::flag::register(SIGTERM, shutdown_flag.clone())?;
            }

            #[cfg(windows)]
            {
                let flag = shutdown_flag.clone();
                ctrlc::set_handler(move || {
                    flag.store(true, Ordering::Relaxed);
                })
                .ok();
            }

            std::thread::spawn(move || {
                while !shutdown_flag.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                app_handle.exit(0);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![focus_terminal, activate_overlay, deactivate_overlay, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    std::fs::remove_file(&pid_file).ok();
}
