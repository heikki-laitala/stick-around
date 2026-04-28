use std::process::Command;
use std::sync::{Mutex, OnceLock};

mod gnome_shell;

use gnome_shell::GnomeShellHelper;

// Cached connection to the GNOME Shell helper extension. Connecting to
// the session bus is fast but not free; we do it once and reuse. None
// means we couldn't reach the bus at all (rare — only happens when the
// process is launched outside a desktop session); a connection that
// succeeds but whose target service isn't running just makes per-call
// invocations fail, which the public functions handle by falling back
// to xdotool.
fn helper() -> Option<&'static GnomeShellHelper> {
    static HELPER: OnceLock<Option<GnomeShellHelper>> = OnceLock::new();
    HELPER
        .get_or_init(|| GnomeShellHelper::connect().ok())
        .as_ref()
}

// Cached stable_sequence of the overlay's own window, looked up via the
// extension on first access. We can't cache "None" — the window is
// realized asynchronously after Tauri startup, so a too-early lookup
// would otherwise pin us to the unhelpful answer.
static OVERLAY_WINDOW_ID: Mutex<Option<u64>> = Mutex::new(None);

fn overlay_window_id() -> Option<u64> {
    let mut guard = OVERLAY_WINDOW_ID.lock().ok()?;
    if let Some(id) = *guard {
        return Some(id);
    }
    let h = helper()?;
    let pid = std::process::id();
    let rows = h.windows_for_pid(pid).ok()?;
    let id = rows.into_iter().next().map(|(id, ..)| id)?;
    *guard = Some(id);
    Some(id)
}

/// Move/resize the overlay's own window through the GNOME Shell helper.
/// Wayland's xdg-shell forbids client-initiated window moves, so the
/// regular `tauri::WebviewWindow::set_position` path silently drops the
/// request on Wayland (and behaves unreliably under XWayland too). The
/// extension runs inside `gnome-shell` and can drive Mutter directly.
///
/// Returns `true` when the call landed on the bus. `false` means either
/// the helper isn't reachable or the overlay window hasn't been realized
/// yet — both are expected during the first few ticks after launch.
pub fn set_overlay_geometry(x: i32, y: i32, width: u32, height: u32) -> bool {
    let Some(h) = helper() else {
        return false;
    };
    let Some(id) = overlay_window_id() else {
        return false;
    };
    h.set_window_geometry(id, x, y, width, height).is_ok()
}

/// Toggle Mutter's "always on top" flag for the overlay window. Tauri's
/// `set_always_on_top` is unreliable under xdg-shell — Wayland clients
/// can't promise their own stacking order — so we drive Mutter through
/// the helper, which has compositor-side authority.
pub fn set_overlay_always_on_top(enabled: bool) -> bool {
    let Some(h) = helper() else {
        return false;
    };
    let Some(id) = overlay_window_id() else {
        return false;
    };
    h.set_always_on_top(id, enabled).is_ok()
}

/// Raise the overlay above its siblings without taking focus away from
/// the terminal. Used after a deactivate so the strip doesn't sink behind
/// the terminal once `make_above` is toggled or stacking re-evaluated.
pub fn raise_overlay_window() -> bool {
    let Some(h) = helper() else {
        return false;
    };
    let Some(id) = overlay_window_id() else {
        return false;
    };
    h.raise_window(id).is_ok()
}

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn xdotool_geometry(wid: &str) -> Option<(i32, i32, u32, u32)> {
    let output = run_cmd("xdotool", &["getwindowgeometry", "--shell", wid])?;
    let mut x = 0i32;
    let mut y = 0i32;
    let mut w = 0u32;
    let mut h = 0u32;
    for line in output.lines() {
        if let Some(val) = line.strip_prefix("X=") {
            x = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("Y=") {
            y = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("WIDTH=") {
            w = val.parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("HEIGHT=") {
            h = val.parse().unwrap_or(0);
        }
    }
    if w > 0 && h > 0 {
        Some((x, y, w, h))
    } else {
        None
    }
}

pub fn get_all_window_bounds(pid: u32) -> Vec<(i32, i32, u32, u32)> {
    if let Some(h) = helper() {
        if let Ok(rows) = h.windows_for_pid(pid) {
            if !rows.is_empty() {
                return rows
                    .into_iter()
                    .map(|(_, x, y, w, height)| (x, y, w, height))
                    .collect();
            }
        }
    }
    let output = match run_cmd("xdotool", &["search", "--pid", &pid.to_string()]) {
        Some(o) => o,
        None => return vec![],
    };
    output
        .lines()
        .filter_map(|wid| xdotool_geometry(wid.trim()))
        .collect()
}

pub fn get_front_window_bounds(pid: u32) -> Option<(i32, i32, u32, u32)> {
    if let Some(h) = helper() {
        if let Ok((_id, focused_pid, x, y, w, height)) = h.focused_window() {
            if focused_pid == pid && w > 0 && height > 0 {
                return Some((x, y, w, height));
            }
        }
        if let Ok(rows) = h.windows_for_pid(pid) {
            if let Some((_, x, y, w, height)) = rows.into_iter().next() {
                return Some((x, y, w, height));
            }
        }
    }
    let active = run_cmd("xdotool", &["getactivewindow"])?;
    let active_pid = run_cmd("xdotool", &["getwindowpid", active.trim()])?;
    if active_pid.trim().parse::<u32>().ok() == Some(pid) {
        return xdotool_geometry(active.trim());
    }
    get_all_window_bounds(pid).into_iter().next()
}

pub fn get_frontmost_pid() -> Option<u32> {
    if let Some(h) = helper() {
        if let Ok(pid) = h.frontmost_pid() {
            if pid != 0 {
                return Some(pid);
            }
        }
    }
    let wid = run_cmd("xdotool", &["getactivewindow"])?;
    let pid_str = run_cmd("xdotool", &["getwindowpid", wid.trim()])?;
    pid_str.trim().parse().ok()
}

pub fn raise_window_at(pid: u32, x: i32, y: i32) {
    if let Some(h) = helper() {
        if let Ok(rows) = h.windows_for_pid(pid) {
            let target = rows
                .iter()
                .find(|(_, wx, wy, _, _)| *wx == x && *wy == y)
                .or_else(|| rows.first());
            if let Some((id, _, _, _, _)) = target {
                let _ = h.raise_window(*id);
                return;
            }
        }
    }
    let output = match run_cmd("xdotool", &["search", "--pid", &pid.to_string()]) {
        Some(o) => o,
        None => return,
    };
    for wid in output.lines() {
        let wid = wid.trim();
        if let Some((wx, wy, _, _)) = xdotool_geometry(wid) {
            if wx == x && wy == y {
                let _ = Command::new("xdotool")
                    .args(["windowactivate", wid])
                    .output();
                return;
            }
        }
    }
    if let Some(wid) = output.lines().next() {
        let _ = Command::new("xdotool")
            .args(["windowactivate", wid.trim()])
            .output();
    }
}

pub fn get_terminal_content(
    _pid: u32,
    _target_xy: Option<(i32, i32)>,
    _app_name: &str,
) -> Option<super::TerminalContent> {
    None
}

/// Subscribe to the GNOME Shell helper extension's `ActivateOverlay`
/// signal and run `callback` each time it fires. The extension owns
/// the activation keybinding (Super+Shift+G by default) through
/// Mutter's authoritative path, working around Wayland's rejection of
/// the overlay's own XGrabKey-based registration.
///
/// Silently does nothing if the helper extension isn't running.
pub fn install_activation_keybinding<F>(callback: F)
where
    F: Fn() + Send + Sync + 'static,
{
    GnomeShellHelper::subscribe_activate_overlay(callback);
}

pub fn get_name_by_pid(pid: u32) -> Option<String> {
    let output = run_cmd("ps", &["-p", &pid.to_string(), "-o", "comm="])?;
    let name = output.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
