use std::process::Command;
use std::sync::Once;
use objc2::runtime::{AnyClass, AnyObject, Imp};
use objc2::ffi::object_setClass;
use objc2::msg_send;

/// Create a custom NSPanel subclass that always returns YES for canBecomeKeyWindow.
/// NSPanel without decorations returns NO by default, blocking keyboard events.
fn get_key_panel_class() -> *const AnyClass {
    static REGISTER: Once = Once::new();
    static mut CLASS_PTR: *const AnyClass = std::ptr::null();

    REGISTER.call_once(|| {
        unsafe {
            let superclass = objc2::ffi::objc_getClass(c"NSPanel".as_ptr());
            let new_class = objc2::ffi::objc_allocateClassPair(
                superclass,
                c"StickAroundPanel".as_ptr(),
                0,
            );

            unsafe extern "C-unwind" fn can_become_key(
                _self: *mut AnyObject,
                _sel: objc2::runtime::Sel,
            ) -> objc2::runtime::Bool {
                objc2::runtime::Bool::YES
            }

            let sel = objc2::ffi::sel_registerName(c"canBecomeKeyWindow".as_ptr()).unwrap();
            let imp: Imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, objc2::runtime::Sel) -> objc2::runtime::Bool,
                Imp,
            >(can_become_key);
            objc2::ffi::class_addMethod(
                new_class,
                sel,
                imp,
                c"B@:".as_ptr(),
            );

            objc2::ffi::objc_registerClassPair(new_class);
            CLASS_PTR = new_class as *const _;
        }
    });

    unsafe { CLASS_PTR }
}

/// Convert a Tauri window into a non-activating panel.
/// This lets the overlay receive keyboard events without stealing
/// active status from the terminal, so it keeps rendering.
///
/// # Safety
/// `ns_window` must be a valid pointer to an NSWindow.
pub unsafe fn configure_as_panel(ns_window: *mut std::ffi::c_void) {
    let window = ns_window as *mut AnyObject;

    // Swap to our custom NSPanel subclass that can become key window
    let panel_class = get_key_panel_class();
    object_setClass(window as *mut _, panel_class as *const _);

    // Get current style mask and add nonactivatingPanel (1 << 7)
    let style_mask: usize = msg_send![window, styleMask];
    let new_mask = style_mask | (1 << 7);
    let _: () = msg_send![window, setStyleMask: new_mask];

    // Make it a floating panel (stays above normal windows)
    let _: () = msg_send![window, setFloatingPanel: true];

    // Allow keyboard events even though the app isn't active
    let _: () = msg_send![window, setWorksWhenModal: true];

    // Always become key window when clicked (don't wait for a key view)
    let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: false];

    // Accept mouse events so clicks register
    let _: () = msg_send![window, setAcceptsMouseMovedEvents: true];

    // Explicitly make it the key window now
    let _: () = msg_send![window, makeKeyWindow];
}

fn run_osascript(script: &str) -> Option<String> {
    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_bounds(s: &str) -> Option<(i32, i32, u32, u32)> {
    let parts: Vec<i32> = s.split(',').filter_map(|p| p.trim().parse().ok()).collect();
    if parts.len() == 4 {
        Some((parts[0], parts[1], parts[2] as u32, parts[3] as u32))
    } else {
        None
    }
}

pub fn get_all_window_bounds(pid: u32) -> Vec<(i32, i32, u32, u32)> {
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
    run_osascript(&script)
        .unwrap_or_default()
        .split(';')
        .filter(|s| !s.is_empty())
        .filter_map(|entry| parse_bounds(entry))
        .collect()
}

pub fn get_front_window_bounds(pid: u32) -> Option<(i32, i32, u32, u32)> {
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
    run_osascript(&script).and_then(|s| parse_bounds(&s))
}

pub fn get_frontmost_pid() -> Option<u32> {
    let script = r#"tell application "System Events" to get unix id of first process whose frontmost is true"#;
    run_osascript(script).and_then(|s| s.parse().ok())
}

pub fn raise_window_at(pid: u32, x: i32, y: i32) {
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
    run_osascript(&script);
}

use super::TerminalContent;

/// Read the terminal's text area geometry and visible line content.
/// Uses AXVisibleCharacterRange to get exactly the visible text.
/// Returns metadata on first line, visible text on subsequent lines.
pub fn get_terminal_content(pid: u32) -> Option<TerminalContent> {
    // Step 1: get geometry (separate call — fast and reliable)
    let geo_script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {})
                tell front window
                    set wp to position of it
                    try
                        set sa to scroll area 1 of splitter group 1
                    on error
                        set sa to scroll area 1
                    end try
                    set sp to position of sa
                    set ss to size of sa
                    return "" & (item 1 of wp) & "," & (item 2 of wp) & "," & (item 1 of sp) & "," & (item 2 of sp) & "," & (item 1 of ss) & "," & (item 2 of ss)
                end tell
            end tell
        end tell"#,
        pid
    );
    let geo = run_osascript(&geo_script)?;
    let nums: Vec<f64> = geo.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    if nums.len() < 6 {
        return None;
    }
    let (win_x, win_y) = (nums[0], nums[1]);
    let (scroll_x, scroll_y) = (nums[2], nums[3]);
    let (scroll_w, scroll_h) = (nums[4], nums[5]);

    // Step 2: get visible text via AXVisibleCharacterRange
    let text_script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {})
                tell front window
                    try
                        set ta to text area 1 of scroll area 1 of splitter group 1
                    on error
                        set ta to text area 1 of scroll area 1
                    end try
                    set vcr to value of attribute "AXVisibleCharacterRange" of ta
                    set fullText to value of ta
                    set vStart to (item 1 of vcr)
                    set vLen to (item 2 of vcr) - vStart
                    if vLen > 0 then
                        return text (vStart + 1) thru (vStart + vLen) of fullText
                    else
                        return ""
                    end if
                end tell
            end tell
        end tell"#,
        pid
    );
    let text = run_osascript(&text_script).unwrap_or_default();

    // Step 3: get terminal column count from window title (most terminals show COLSxROWS)
    let title_script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {})
                return name of front window
            end tell
        end tell"#,
        pid
    );
    let title = run_osascript(&title_script).unwrap_or_default();
    let (term_cols, term_rows) = parse_dimensions_from_title(&title).unwrap_or((80, 24));

    // Count Unicode display width and compute content hash per line
    let mut lines: Vec<usize> = Vec::new();
    let mut hashes: Vec<u32> = Vec::new();
    for l in text.lines() {
        let width: usize = l.chars().map(|c| if is_wide_char(c) { 2 } else { 1 }).sum();
        lines.push(width);
        // Simple FNV-1a hash for content-based coloring
        let mut h: u32 = 2166136261;
        for b in l.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16777619);
        }
        hashes.push(h);
    }

    Some(TerminalContent {
        text_offset_y: scroll_y - win_y,
        text_offset_x: scroll_x - win_x,
        text_height: scroll_h,
        text_width: scroll_w,
        term_cols,
        term_rows,
        lines,
        hashes,
    })
}

/// Parse terminal dimensions (cols, rows) from window title.
/// Most terminals include "COLSxROWS" or "COLS×ROWS" in the title.
fn parse_dimensions_from_title(title: &str) -> Option<(usize, usize)> {
    for sep in &["\u{00d7}", "x", "X"] {
        for word in title.split(|c: char| c.is_whitespace() || c == '\u{2014}' || c == '-') {
            let word = word.trim();
            if let Some(idx) = word.find(sep) {
                let left = &word[..idx];
                let right = &word[idx + sep.len()..];
                if let (Ok(cols), Ok(rows)) = (left.parse::<usize>(), right.parse::<usize>()) {
                    if cols > 10 && cols < 1000 && rows > 1 && rows < 500 {
                        return Some((cols, rows));
                    }
                }
            }
        }
    }
    None
}

/// Approximate check for wide (2-column) characters in a terminal.
fn is_wide_char(c: char) -> bool {
    let cp = c as u32;
    // CJK Unified Ideographs, CJK Compatibility Ideographs, etc.
    matches!(cp,
        0x1100..=0x115F   // Hangul Jamo
        | 0x2E80..=0x303E // CJK Radicals, Kangxi, Ideographic Description
        | 0x3040..=0x33BF // Hiragana, Katakana, Bopomofo, CJK Compatibility
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xA000..=0xA4CF // Yi
        | 0xAC00..=0xD7AF // Hangul Syllables
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
        | 0xFE10..=0xFE6F // Vertical forms, CJK Compatibility Forms
        | 0xFF01..=0xFF60 // Fullwidth Forms
        | 0xFFE0..=0xFFE6 // Fullwidth Signs
        | 0x1F000..=0x1FBFF // Mahjong, Dominos, Playing Cards, Emoticons, Misc Symbols
        | 0x20000..=0x2FFFF // CJK Extension B-F
        | 0x30000..=0x3FFFF // CJK Extension G-H
    )
}

pub fn get_pid_by_name(name: &str) -> Option<u32> {
    let script = format!(
        r#"tell application "System Events" to get unix id of first process whose name is "{}""#,
        name
    );
    run_osascript(&script).and_then(|s| s.parse().ok())
}
