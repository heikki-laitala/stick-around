use std::process::Command;
use std::sync::{Mutex, OnceLock};

mod atspi;
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
    let h = HELPER
        .get_or_init(|| GnomeShellHelper::connect().ok())
        .as_ref();

    // First-call sanity probe: zbus's Proxy::new is non-failing even
    // when the destination service isn't owned, so a Some(GnomeShellHelper)
    // doesn't actually prove the extension is loaded. Call a cheap method
    // once and warn loudly on failure — non-GNOME compositors (sway, KDE,
    // Hyprland) hit this path and otherwise see only silent absence of
    // platforms / activation.
    static PROBED: OnceLock<()> = OnceLock::new();
    PROBED.get_or_init(|| {
        let reachable = h.and_then(|h| h.frontmost_pid().ok()).is_some();
        if !reachable {
            eprintln!(
                "[stick-around] GNOME Shell helper extension not reachable. \
                 Linux support requires the helper running under GNOME Shell — \
                 install with `make install-extension`, log out / log back in, \
                 then enable via `gnome-extensions enable stick-around@stickaround.dev`. \
                 See README for details."
            );
        }
    });

    h
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

/// Character offset (codepoint index) where line `line_idx` begins in
/// `text`. Walks newlines once. AT-SPI 2's Text interface uses character
/// offsets, matching `str::chars().count()`.
fn line_start_offset(text: &str, line_idx: usize) -> i32 {
    if line_idx == 0 {
        return 0;
    }
    let mut newlines = 0usize;
    let mut chars: i32 = 0;
    for c in text.chars() {
        chars += 1;
        if c == '\n' {
            newlines += 1;
            if newlines == line_idx {
                return chars;
            }
        }
    }
    chars
}

pub fn get_terminal_content(
    pid: u32,
    _target_xy: Option<(i32, i32)>,
    _app_name: &str,
) -> Option<super::TerminalContent> {
    use super::text_analysis::{detect_terminal_regions, is_wide_char};

    let snap = atspi::snapshot_for_pid(pid)?;
    let text_lines: Vec<&str> = snap.text.lines().collect();

    let mut lines: Vec<usize> = Vec::with_capacity(text_lines.len());
    let mut line_offsets: Vec<usize> = Vec::with_capacity(text_lines.len());
    let mut hashes: Vec<u32> = Vec::with_capacity(text_lines.len());
    for l in text_lines.iter() {
        let leading: usize = l
            .chars()
            .take_while(|c| c.is_whitespace())
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        line_offsets.push(leading);
        let width: usize = l
            .trim()
            .chars()
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        lines.push(width);
        let mut h: u32 = 2_166_136_261;
        for b in l.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16_777_619);
        }
        hashes.push(h);
    }

    let term_rows = text_lines.len().max(1);
    // term_cols isn't reported by AT-SPI; infer from the widest visible
    // line. Falls back to 80 for an empty buffer.
    let term_cols = text_lines
        .iter()
        .map(|l| {
            l.chars()
                .map(|c| if is_wide_char(c) { 2 } else { 1 })
                .sum::<usize>()
        })
        .max()
        .unwrap_or(80);

    let (input_line, footer_line) = detect_terminal_regions(&text_lines);

    let total = text_lines.len();
    let start = total.saturating_sub(8);
    let debug_lines: Vec<String> = text_lines[start..]
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let idx = start + i;
            let escaped: String = l
                .chars()
                .take(60)
                .map(|c| {
                    if c.is_ascii_graphic() || c == ' ' {
                        c.to_string()
                    } else {
                        format!("U+{:04X}", c as u32)
                    }
                })
                .collect();
            format!("[{}] {}", idx, escaped)
        })
        .collect();

    // Refine geometry with exact per-line measurements via AT-SPI's
    // GetCharacterExtents. The component bbox overshoots actual line
    // height by ~0.7 px on Ptyxis and is ~17 px wider than the real
    // text grid (it includes scrollbar / chrome padding). A small
    // fixed number of GetCharacterExtents round trips lets us anchor
    // every value to the actual rendered cells:
    //   - y0 / y1: exact line height
    //   - x of first / last cell on a full-width line: exact x bounds
    //   - y of input_line / footer_line: exact prompt top / bottom
    let bbox_off_x = snap.window_extents.x as f64;
    let bbox_off_y = snap.window_extents.y as f64;
    let bbox_w = snap.window_extents.w as f64;
    let bbox_h = snap.window_extents.h as f64;
    let bbox_lh = bbox_h / term_rows as f64;

    let (text_offset_y, text_height) = if term_rows >= 2 {
        let line1_off = line_start_offset(&snap.text, 1);
        match (snap.y_at_offset(0), snap.y_at_offset(line1_off)) {
            (Some(y0), Some(y1)) if y1 > y0 => {
                let lh = (y1 - y0) as f64;
                if lh >= bbox_lh * 0.5 && lh <= bbox_lh * 1.5 {
                    (y0 as f64, lh * term_rows as f64)
                } else {
                    (bbox_off_y, bbox_h)
                }
            }
            _ => (bbox_off_y, bbox_h),
        }
    } else {
        (bbox_off_y, bbox_h)
    };

    // Pick a measuring line: prefer the top prompt separator (always
    // full-width and made entirely of single-cell `─` characters, so
    // codepoint count == display column count) when detect found one,
    // otherwise fall back to the longest visible line. This keeps the
    // x-bounds measurement working as the prompt grows or shrinks
    // (bottom separator moves) and as the terminal gets resized.
    let measure_line = input_line.filter(|&i| i < text_lines.len()).or_else(|| {
        text_lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.chars().count() >= 4)
            .max_by_key(|(_, l)| l.chars().count())
            .map(|(i, _)| i)
    });
    let (text_offset_x, text_width) = measure_line
        .and_then(|line_idx| {
            let line = text_lines.get(line_idx)?;
            let chars = line.chars().count() as i32;
            if chars < 2 || term_cols < 2 {
                return None;
            }
            let off_first = line_start_offset(&snap.text, line_idx);
            let off_last = off_first + chars - 1;
            let ef = snap.extents_at_offset(off_first)?;
            let el = snap.extents_at_offset(off_last)?;
            let advance = (el.x - ef.x) as f64 / (chars - 1) as f64;
            if advance <= 0.0 || advance > bbox_w {
                return None;
            }
            Some((ef.x as f64, advance * term_cols as f64))
        })
        .unwrap_or((bbox_off_x, bbox_w));

    // Prompt / footer rects: pin to AT-SPI's character-position truth
    // so the prompt box sits flush on the real top and bottom borders
    // instead of drifting by accumulated arithmetic error.
    let prompt_rect = input_line.and_then(|i_idx| {
        let top_offset = line_start_offset(&snap.text, i_idx);
        let y_top = snap.y_at_offset(top_offset)?;
        let y_bot = match footer_line {
            Some(f_idx) => snap
                .y_at_offset(line_start_offset(&snap.text, f_idx))
                .unwrap_or(y_top + ((text_offset_y + text_height - y_top as f64) as i32)),
            None => (text_offset_y + text_height) as i32,
        };
        Some((text_offset_x, y_top as f64, text_width, (y_bot - y_top) as f64))
    });

    // Footer extends to the bottom of the AT-SPI text widget bbox
    // (not just the last text row): the area between the last visible
    // row and the widget edge belongs to the prompt strip too on
    // Ptyxis, where some padding sits below the final cell row.
    let footer_rect = footer_line.and_then(|f_idx| {
        let y_top = snap.y_at_offset(line_start_offset(&snap.text, f_idx))?;
        let y_bot = (snap.window_extents.y + snap.window_extents.h) as i32;
        Some((text_offset_x, y_top as f64, text_width, (y_bot - y_top) as f64))
    });

    Some(super::TerminalContent {
        text_offset_x,
        text_offset_y,
        text_width,
        text_height,
        term_cols,
        term_rows,
        footer_line,
        input_line,
        lines,
        line_offsets,
        hashes,
        debug_lines,
        prompt_rect,
        footer_rect,
    })
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
