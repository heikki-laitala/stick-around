mod platform;

use tauri::{Emitter, Manager};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Extra strip above the terminal window reserved for the HUD. The short
/// strip fits a single row; the tall strip fits two rows so HUD items
/// don't get clipped off the right edge. Must stay in sync with
/// HUD_HEIGHT / HUD_HEIGHT_TALL / HUD_NARROW_THRESHOLD in src/constants.js.
///
/// The narrow-terminal width threshold here is only used before the
/// frontend has reported a measured `hud_tall` decision. Once JS has had
/// a frame to measure actual HUD content width, it pushes the real answer
/// via `set_hud_tall` and that value takes over.
const HUD_HEIGHT: u32 = 32;
const HUD_HEIGHT_TALL: u32 = 60;
const HUD_NARROW_THRESHOLD: u32 = 720;

fn hud_height_for(w: u32, tall_known: bool, tall: bool) -> u32 {
    if tall_known {
        if tall { HUD_HEIGHT_TALL } else { HUD_HEIGHT }
    } else if w < HUD_NARROW_THRESHOLD {
        HUD_HEIGHT_TALL
    } else {
        HUD_HEIGHT
    }
}

fn apply_bounds(
    window: &tauri::WebviewWindow,
    x: i32, y: i32, w: u32, h: u32,
    tall_known: bool, tall: bool,
) {
    let hud = hud_height_for(w, tall_known, tall);
    let _ = window.set_position(tauri::Position::Logical(
        tauri::LogicalPosition::new(x as f64, (y - hud as i32) as f64),
    ));
    let _ = window.set_size(tauri::Size::Logical(
        tauri::LogicalSize::new(w as f64, (h + hud) as f64),
    ));
}

/// Shared state: the terminal PID, the last known window bounds, and the
/// HUD tall/short flag reported by the frontend renderer.
struct TerminalState {
    pid: u32,
    bounds: Arc<Mutex<(i32, i32, u32, u32)>>,
    hud_tall: Arc<AtomicBool>,
    hud_tall_known: Arc<AtomicBool>,
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

/// Frontend reports whether the HUD needs the tall (two-row) strip.
/// Updates the shared flag and immediately re-applies the last known
/// bounds so the window resizes to match the new reserve.
#[tauri::command]
fn set_hud_tall(
    tall: bool,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, TerminalState>,
) {
    let prev_known = state.hud_tall_known.swap(true, Ordering::Relaxed);
    let prev_tall = state.hud_tall.swap(tall, Ordering::Relaxed);
    if prev_known && prev_tall == tall {
        return;
    }
    let (x, y, w, h) = *state.bounds.lock().unwrap();
    apply_bounds(&window, x, y, w, h, true, tall);
}

fn pid_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join("stick-around.pid")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pid_file = pid_file_path();
    std::fs::write(&pid_file, std::process::id().to_string()).ok();

    // Detect the terminal PID (frontmost process at launch). This runs
    // before tauri::Builder so the terminal still owns focus — the overlay
    // window hasn't been created yet.
    let pid = match platform::get_frontmost_pid() {
        Some(p) => p,
        None => {
            eprintln!("[stick-around] could not detect terminal PID");
            return;
        }
    };

    // Terminal process name, used to pick the right content-reading
    // backend (Terminal.app's AX hierarchy vs iTerm's native scripting).
    let terminal_name = platform::get_name_by_pid(pid).unwrap_or_default();

    let initial_bounds = platform::get_front_window_bounds(pid);
    let shared_bounds = Arc::new(Mutex::new(initial_bounds.unwrap_or((0, 0, 800, 600))));
    let poll_bounds = shared_bounds.clone();

    // HUD tall/short flag. Starts in `unknown` state — the frontend pushes
    // the measured value via `set_hud_tall` once it has a canvas context;
    // until then, `apply_bounds` falls back to the width-threshold heuristic.
    let hud_tall = Arc::new(AtomicBool::new(false));
    let hud_tall_known = Arc::new(AtomicBool::new(false));
    let poll_hud_tall = hud_tall.clone();
    let poll_hud_tall_known = hud_tall_known.clone();

    // Capture a stable identifier for the launch-time terminal window so the
    // overlay follows *this specific window*, not "any window of this PID."
    // Position heuristics can't disambiguate two same-PID windows — if the
    // user drags our tracked window past another Ghostty/iTerm window, the
    // overlay would otherwise snap to whichever sibling ended up closer.
    // We pick by z-order (the frontmost same-PID window right now) rather
    // than by bounds, because same-app windows often share geometry and a
    // bounds match is ambiguous.
    #[cfg(target_os = "macos")]
    let tracked_window_id: Option<u32> = platform::get_frontmost_window_id_for_pid(pid);

    let state = TerminalState {
        pid,
        bounds: shared_bounds,
        hud_tall: hud_tall.clone(),
        hud_tall_known: hud_tall_known.clone(),
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
                // Override the generic standalone-binary Dock icon with the
                // stick-figure PNG baked into the binary at compile time.
                platform::set_dock_icon(include_bytes!("../icons/icon.png"));
            }

            if let Some((x, y, w, h)) = initial_bounds {
                apply_bounds(&window, x, y, w, h, false, false);
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

            // Second handle to the shared bounds for the content-poll thread
            // below; the position-tracker thread moves `poll_bounds` into
            // its closure, so clone it here before that move happens.
            let text_bounds = poll_bounds.clone();

            // Poll: track window by its stable CGWindowID (macOS) and toggle
            // alwaysOnTop when the terminal or our own app is frontmost.
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

                    // macOS: track strictly by CGWindowID. No heuristic
                    // fallback — a position/size heuristic can't disambiguate
                    // same-PID siblings and is exactly how the overlay used
                    // to hop onto the wrong Claude terminal during a resize.
                    // If the ID lookup fails for a tick we just skip the
                    // update and leave the overlay where it was; next tick
                    // will pick it back up.
                    #[cfg(target_os = "macos")]
                    let next = tracked_window_id.and_then(platform::get_window_bounds_by_id);

                    // Non-macOS: no stable per-window ID hooked up yet, so
                    // pick the closest same-PID window by size then position.
                    #[cfg(not(target_os = "macos"))]
                    let next = {
                        let windows = platform::get_all_window_bounds(pid);
                        windows
                            .iter()
                            .min_by_key(|w| {
                                let size_diff = (w.2 as i32 - last_bounds.2 as i32).abs()
                                    + (w.3 as i32 - last_bounds.3 as i32).abs();
                                let pos_diff =
                                    (w.0 - last_bounds.0).abs() + (w.1 - last_bounds.1).abs();
                                size_diff * 10 + pos_diff
                            })
                            .copied()
                    };

                    if let Some(b) = next {
                        if b != last_bounds {
                            let tall_known = poll_hud_tall_known.load(Ordering::Relaxed);
                            let tall = poll_hud_tall.load(Ordering::Relaxed);
                            apply_bounds(&win_track, b.0, b.1, b.2, b.3, tall_known, tall);
                            last_bounds = b;
                            *poll_bounds.lock().unwrap() = b;
                        }
                    }

                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            });

            // Poll terminal text content and emit line data to frontend.
            // The content query is pinned to the launch-time window by its
            // current position (tracked in shared_bounds), so clicking
            // another window of the same terminal app doesn't pollute the
            // overlay with content from the wrong window.
            let win_text = window.clone();
            let terminal_name_text = terminal_name.clone();
            std::thread::spawn(move || {
                let mut last_content: Option<platform::TerminalContent> = None;
                loop {
                    let (tx, ty, _, _) = *text_bounds.lock().unwrap();
                    if let Some(content) = platform::get_terminal_content(
                        pid,
                        Some((tx, ty)),
                        &terminal_name_text,
                    ) {
                        if last_content.as_ref() != Some(&content) {
                            let _ = win_text.emit("terminal-content", &content);
                            last_content = Some(content);
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
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
        .invoke_handler(tauri::generate_handler![focus_terminal, activate_overlay, deactivate_overlay, quit_app, set_hud_tall])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    std::fs::remove_file(&pid_file).ok();
}
