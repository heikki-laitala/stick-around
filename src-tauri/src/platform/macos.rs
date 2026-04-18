use std::ffi::{c_void, CString};
use std::os::raw::c_char;
use std::process::Command;
use std::sync::{Arc, Mutex, Once};
use objc2::runtime::{AnyClass, AnyObject, Imp};
use objc2::ffi::object_setClass;
use objc2::msg_send;
use objc2::encode::{Encode, Encoding, RefEncode};
use block2::RcBlock;

// ─── CoreGraphics / CoreFoundation FFI for stable window tracking ──────────
// We need a way to pin the overlay to *this specific terminal window*, not
// just "some window belonging to this terminal app." Among same-PID windows
// (multiple iTerm2 tabs-in-windows, multiple Ghostty windows, etc.) AX and
// AppleScript don't give us a stable identifier — the window index shifts
// with z-order, `position of w` is ambiguous if two windows overlap, and
// AppleScript references don't survive across osascript invocations.
// `CGWindowID` is stable for the window's lifetime, so we capture it at
// launch and look up bounds by that ID on every poll.

type CFTypeRef = *const c_void;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct CGRectRaw {
    origin_x: f64,
    origin_y: f64,
    size_width: f64,
    size_height: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFTypeRef;
    fn CGWindowListCreateDescriptionFromArray(array: CFTypeRef) -> CFTypeRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFTypeRef, rect: *mut CGRectRaw) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, idx: isize) -> CFTypeRef;
    fn CFArrayCreate(
        allocator: CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        callbacks: CFTypeRef,
    ) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(num: CFTypeRef, typ: i32, value_ptr: *mut c_void) -> bool;
    fn CFNumberCreate(alloc: CFTypeRef, typ: i32, value_ptr: *const c_void) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFStringCreateWithCString(
        alloc: CFTypeRef,
        cstr: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
}

const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const CF_NUMBER_SINT32_TYPE: i32 = 3;
const CF_NUMBER_SINT64_TYPE: i32 = 4;
const CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

unsafe fn cfstr(s: &str) -> CFTypeRef {
    let c = CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), CF_STRING_ENCODING_UTF8)
}

unsafe fn dict_number_i64(dict: CFTypeRef, key: &str) -> Option<i64> {
    let k = cfstr(key);
    if k.is_null() {
        return None;
    }
    let num = CFDictionaryGetValue(dict, k);
    CFRelease(k);
    if num.is_null() {
        return None;
    }
    let mut out: i64 = 0;
    if CFNumberGetValue(num, CF_NUMBER_SINT64_TYPE, &mut out as *mut _ as *mut c_void) {
        Some(out)
    } else {
        None
    }
}

/// Find the CGWindowID of the on-screen window owned by `pid` whose bounds
/// match `want` (within a small tolerance to absorb AX vs CG rounding).
///
/// Returns `None` if no match is found; the caller should fall back to a
/// position/size heuristic in that case.
pub fn get_window_id_for_bounds(pid: u32, want: (i32, i32, u32, u32)) -> Option<u32> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, 0);
        if list.is_null() {
            return None;
        }
        let count = CFArrayGetCount(list);
        let bounds_key = cfstr("kCGWindowBounds");
        let mut result: Option<u32> = None;
        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i);
            if dict.is_null() {
                continue;
            }
            if dict_number_i64(dict, "kCGWindowOwnerPID") != Some(pid as i64) {
                continue;
            }
            // Layer 0 is the normal window layer — skip menubar, dock, etc.
            if dict_number_i64(dict, "kCGWindowLayer").unwrap_or(0) != 0 {
                continue;
            }
            let bd = CFDictionaryGetValue(dict, bounds_key);
            if bd.is_null() {
                continue;
            }
            let mut r = CGRectRaw::default();
            if !CGRectMakeWithDictionaryRepresentation(bd, &mut r) {
                continue;
            }
            if (r.origin_x as i32 - want.0).abs() <= 10
                && (r.origin_y as i32 - want.1).abs() <= 10
                && (r.size_width as i32 - want.2 as i32).abs() <= 10
                && (r.size_height as i32 - want.3 as i32).abs() <= 10
            {
                if let Some(wid) = dict_number_i64(dict, "kCGWindowNumber") {
                    result = Some(wid as u32);
                    break;
                }
            }
        }
        CFRelease(bounds_key);
        CFRelease(list);
        result
    }
}

/// Look up current bounds of a specific `CGWindowID`. Returns `None` if the
/// window has been closed or is no longer reported (e.g., minimized into
/// the Dock, off-screen on a disconnected display).
pub fn get_window_bounds_by_id(window_id: u32) -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let id_val: i32 = window_id as i32;
        let num = CFNumberCreate(
            std::ptr::null(),
            CF_NUMBER_SINT32_TYPE,
            &id_val as *const _ as *const c_void,
        );
        if num.is_null() {
            return None;
        }
        let vals: [CFTypeRef; 1] = [num];
        let arr = CFArrayCreate(std::ptr::null(), vals.as_ptr(), 1, std::ptr::null());
        CFRelease(num);
        if arr.is_null() {
            return None;
        }

        let desc = CGWindowListCreateDescriptionFromArray(arr);
        CFRelease(arr);
        if desc.is_null() {
            return None;
        }

        let mut result = None;
        if CFArrayGetCount(desc) > 0 {
            let dict = CFArrayGetValueAtIndex(desc, 0);
            if !dict.is_null() {
                let bounds_key = cfstr("kCGWindowBounds");
                let bd = CFDictionaryGetValue(dict, bounds_key);
                CFRelease(bounds_key);
                if !bd.is_null() {
                    let mut r = CGRectRaw::default();
                    if CGRectMakeWithDictionaryRepresentation(bd, &mut r) {
                        result = Some((
                            r.origin_x as i32,
                            r.origin_y as i32,
                            r.size_width as u32,
                            r.size_height as u32,
                        ));
                    }
                }
            }
        }
        CFRelease(desc);
        result
    }
}

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
/// Combines geometry, text, and title into a single AppleScript call for speed.
///
/// `target_xy` pins the query to the specific launch-time window by matching
/// its current position. Without this, the script would target `front window`
/// of the process — which swaps if the user clicks another window of the same
/// terminal app, polluting prompt/footer detection with the wrong content.
pub fn get_terminal_content(pid: u32, target_xy: Option<(i32, i32)>) -> Option<TerminalContent> {
    let window_lookup = match target_xy {
        Some((tx, ty)) => format!(
            r#"set targetWin to missing value
                repeat with w in windows
                    try
                        set p to position of w
                        if (item 1 of p) is {tx} and (item 2 of p) is {ty} then
                            set targetWin to w
                            exit repeat
                        end if
                    end try
                end repeat
                if targetWin is missing value then
                    if (count of windows) is 0 then return ""
                    set targetWin to front window
                end if"#,
            tx = tx,
            ty = ty
        ),
        None => r#"if (count of windows) is 0 then return ""
                set targetWin to front window"#
            .to_string(),
    };

    // Single combined AppleScript: geometry + visible text + window title
    // Results separated by a unique delimiter to parse apart
    let combined_script = format!(
        r#"tell application "System Events"
            tell (first process whose unix id is {pid})
                {window_lookup}
                tell targetWin
                    set wp to position of it
                    try
                        set sa to scroll area 1 of splitter group 1
                    on error
                        set sa to scroll area 1
                    end try
                    set sp to position of sa
                    set ss to size of sa
                    set geo to "" & (item 1 of wp) & "," & (item 2 of wp) & "," & (item 1 of sp) & "," & (item 2 of sp) & "," & (item 1 of ss) & "," & (item 2 of ss)
                    try
                        set ta to text area 1 of scroll area 1 of splitter group 1
                    on error
                        set ta to text area 1 of scroll area 1
                    end try
                    set vcr to value of attribute "AXVisibleCharacterRange" of ta
                    set fullText to value of ta
                    -- AX reports the range in UTF-16 units, but AppleScript's `text`
                    -- counts composed characters. With large scrollback containing
                    -- multi-unit glyphs (emoji, box drawing, etc.) the AX end index
                    -- drifts past AppleScript's character count, so clamp to avoid
                    -- "Can't get text X thru Y" errors.
                    set ftLen to count of fullText
                    set vStart to (item 1 of vcr)
                    if vStart < 0 then set vStart to 0
                    if vStart > ftLen then set vStart to ftLen
                    set vEnd to (item 2 of vcr)
                    if vEnd > ftLen then set vEnd to ftLen
                    if vStart < vEnd then
                        set visText to text (vStart + 1) thru vEnd of fullText
                    else
                        set visText to ""
                    end if
                    set winTitle to name of it
                    return geo & linefeed & "---SPLIT---" & linefeed & visText & linefeed & "---SPLIT---" & linefeed & winTitle
                end tell
            end tell
        end tell"#,
        pid = pid,
        window_lookup = window_lookup
    );
    let raw = run_osascript(&combined_script)?;

    // Parse the combined result: geo \n ---SPLIT--- \n text \n ---SPLIT--- \n title
    let parts: Vec<&str> = raw.splitn(3, "---SPLIT---").collect();
    if parts.len() < 3 {
        return None;
    }
    let geo = parts[0].trim();
    let text = parts[1].trim_start_matches('\n').trim_end_matches('\n');
    let title = parts[2].trim();

    let nums: Vec<f64> = geo.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    if nums.len() < 6 {
        return None;
    }
    let (win_x, win_y) = (nums[0], nums[1]);
    let (scroll_x, scroll_y) = (nums[2], nums[3]);
    let (scroll_w, scroll_h) = (nums[4], nums[5]);

    let (term_cols, term_rows) = parse_dimensions_from_title(title).unwrap_or((80, 24));

    // Count Unicode display width, compute content hash, and detect input area
    let mut lines: Vec<usize> = Vec::new();
    let mut line_offsets: Vec<usize> = Vec::new();
    let mut hashes: Vec<u32> = Vec::new();
    let text_lines: Vec<&str> = text.lines().collect();
    for l in text_lines.iter() {
        // Measure leading whitespace offset (in display columns)
        let leading: usize = l.chars()
            .take_while(|c| c.is_whitespace())
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        line_offsets.push(leading);
        // Measure trimmed content width (exclude padding spaces).
        // This prevents UI chrome (borders, status bars) padded to full
        // terminal width from creating full-width platforms.
        let trimmed_content = l.trim();
        let width: usize = trimmed_content.chars()
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        lines.push(width);
        // Simple FNV-1a hash for content-based coloring
        let mut h: u32 = 2166136261;
        for b in l.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16777619);
        }
        hashes.push(h);
    }

    // Detect terminal regions: prompt (between separators) and footer (below).
    let (input_line, footer_line) = detect_terminal_regions(&text_lines);

    // Debug: capture last 8 lines for frontend display
    let total = text_lines.len();
    let start = if total > 8 { total - 8 } else { 0 };
    let debug_lines: Vec<String> = text_lines[start..].iter().enumerate().map(|(i, l)| {
        let idx = start + i;
        let escaped: String = l.chars().take(60).map(|c| {
            if c.is_ascii_graphic() || c == ' ' {
                c.to_string()
            } else {
                format!("U+{:04X}", c as u32)
            }
        }).collect();
        format!("[{}] {}", idx, escaped)
    }).collect();

    Some(TerminalContent {
        text_offset_y: scroll_y - win_y,
        text_offset_x: scroll_x - win_x,
        text_height: scroll_h,
        text_width: scroll_w,
        term_cols,
        term_rows,
        footer_line,
        input_line,
        lines,
        line_offsets,
        hashes,
        debug_lines,
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

/// Detect terminal regions by finding separator lines (U+2500 box drawing).
/// Returns (input_line, footer_line):
///   - input_line: first line of the prompt/input box (top separator)
///   - footer_line: first line below the prompt box (bottom separator + 1)
///
/// Claude Code layout:
///   content...
///   ─────────── (top border)    ← input_line
///   ❯ input     (prompt area)
///   ─────────── (bottom border)
///   footer/status               ← footer_line
fn detect_terminal_regions(text_lines: &[&str]) -> (Option<usize>, Option<usize>) {
    let len = text_lines.len();
    if len == 0 {
        return (None, None);
    }

    // Scan bottom-up collecting all separator line indices
    let mut separators: Vec<usize> = Vec::new();
    for i in (0..len).rev() {
        let trimmed = text_lines[i].trim();
        if is_separator_line(trimmed) {
            separators.push(i);
        }
        // Stop after finding 2 separators (we only need the bottom pair)
        if separators.len() >= 2 {
            break;
        }
    }

    match separators.len() {
        0 => {
            // No separators — fall back to prompt character detection
            let mut prompt_idx = None;
            for i in (0..len).rev() {
                let trimmed = text_lines[i].trim();
                if trimmed.is_empty() {
                    continue;
                }
                if is_prompt_line(trimmed) {
                    prompt_idx = Some(i);
                    break;
                }
            }
            (prompt_idx, None)
        }
        1 => {
            // One separator found — treat it as the top border of the prompt box
            // The bottom border might be styled differently or missing
            let top_border = separators[0];
            // Look for a footer line below: scan down for the next non-empty line
            // that isn't a prompt line, or infer footer from remaining lines
            let footer = if top_border + 2 < len { Some(top_border + 2) } else { None };
            (Some(top_border), footer)
        }
        _ => {
            // Two separators — top and bottom borders of the prompt box
            // separators[0] is the bottom one (found first scanning up)
            // separators[1] is the top one
            let bottom_border = separators[0];
            let top_border = separators[1];
            let footer = if bottom_border + 1 < len { Some(bottom_border + 1) } else { None };
            (Some(top_border), footer)
        }
    }
}

/// Check if a trimmed line looks like a shell prompt.
fn is_prompt_line(trimmed: &str) -> bool {
    // Common prompt indicators (checked at start of trimmed line)
    const PROMPT_CHARS: &[char] = &[
        '\u{276F}', // ❯ — starship, some zsh themes
        '\u{279C}', // ➜ — oh-my-zsh robbyrussell
        '\u{03BB}', // λ — lambda prompts
        '\u{2192}', // → — arrow prompts
    ];

    // Check Unicode prompt characters
    if let Some(first) = trimmed.chars().next() {
        if PROMPT_CHARS.contains(&first) {
            return true;
        }
    }

    // Check common ASCII prompt endings: "$ ", "% ", "> ", "# "
    // These need context — a lone $ or % at the start suggests a prompt.
    // We look for patterns like "user@host:path$ " or just "$ "
    let bytes = trimmed.as_bytes();
    let last_meaningful = trimmed.trim_end();
    if let Some(last) = last_meaningful.chars().last() {
        if matches!(last, '$' | '%' | '#' | '>') {
            // Single prompt char or ends with prompt char after a path/user string
            let non_prompt: &str = &last_meaningful[..last_meaningful.len() - last.len_utf8()];
            let non_prompt = non_prompt.trim_end();
            // Accept if the line is just the prompt char, or has typical prompt prefix
            if non_prompt.is_empty()
                || non_prompt.ends_with(':')
                || non_prompt.ends_with(')')
                || non_prompt.contains('@')
            {
                return true;
            }
        }
    }

    // "PS1"-style: line starts with [ and contains ] followed by prompt char
    if bytes.first() == Some(&b'[') && trimmed.contains(']') {
        if let Some(after_bracket) = trimmed.rsplit(']').next() {
            let after = after_bracket.trim();
            if after.is_empty()
                || after == "$"
                || after == "%"
                || after == "#"
                || after == ">"
            {
                return true;
            }
        }
    }

    false
}

/// Check if a line is a separator/border (horizontal rules, box-drawing).
fn is_separator_line(trimmed: &str) -> bool {
    if trimmed.is_empty() {
        return false;
    }
    // A separator is a line made mostly of repeating border/rule characters
    let total = trimmed.chars().count();
    if total < 3 {
        return false;
    }
    let border_count = trimmed.chars().filter(|c| {
        matches!(*c,
            '\u{2500}'..='\u{257F}' // Box Drawing (includes ─ ━ │ ┃ corners etc.)
            | '\u{2580}'..='\u{259F}' // Block Elements (▀ ▄ █ etc.)
            | '-' | '=' | '_'
            | '\u{23AF}' // Horizontal line extension
            | '\u{2015}' // Horizontal bar
            | '\u{2014}' // Em dash
            | '\u{2013}' // En dash
        )
    }).count();
    // At least 60% border characters (allow corners, spaces, decorative elements)
    border_count * 5 >= total * 3
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

/// Install a global NSEvent monitor that fires `callback` whenever the user
/// Shift+left-clicks anywhere, provided the click is inside the overlay's bounds.
/// Used to activate the overlay without the user having to first give it focus.
///
/// # Safety
/// Must be called from the main thread (Cocoa requirement).
#[repr(C)]
#[derive(Clone, Copy)]
struct NSPointRaw { x: f64, y: f64 }

#[repr(C)]
#[derive(Clone, Copy)]
struct NSSizeRaw { width: f64, height: f64 }

#[repr(C)]
#[derive(Clone, Copy)]
struct NSRectRaw { origin: NSPointRaw, size: NSSizeRaw }

unsafe impl Encode for NSPointRaw {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl RefEncode for NSPointRaw {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}
unsafe impl Encode for NSSizeRaw {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl RefEncode for NSSizeRaw {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}
unsafe impl Encode for NSRectRaw {
    const ENCODING: Encoding = Encoding::Struct(
        "CGRect",
        &[<NSPointRaw as Encode>::ENCODING, <NSSizeRaw as Encode>::ENCODING],
    );
}
unsafe impl RefEncode for NSRectRaw {
    const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
}

pub unsafe fn install_shift_click_monitor<F>(
    bounds: Arc<Mutex<(i32, i32, u32, u32)>>,
    callback: F,
)
where
    F: Fn() + Send + Sync + 'static,
{
    let block = RcBlock::new(move |event: *mut AnyObject| {
        let flags: usize = msg_send![event, modifierFlags];
        // NSEventModifierFlagShift = 1 << 17
        if (flags & (1 << 17)) == 0 {
            return;
        }

        // NSEvent.mouseLocation is screen coords, origin bottom-left of the primary
        // display. The bounds we track come from AX (top-left origin). Flip Y using
        // the main screen's height.
        let ns_event_cls = objc2::ffi::objc_getClass(c"NSEvent".as_ptr()) as *const AnyClass;
        let loc: NSPointRaw = msg_send![ns_event_cls, mouseLocation];

        let ns_screen_cls = objc2::ffi::objc_getClass(c"NSScreen".as_ptr()) as *const AnyClass;
        let main_screen: *mut AnyObject = msg_send![ns_screen_cls, mainScreen];
        let screen_frame: NSRectRaw = msg_send![main_screen, frame];
        let screen_h = screen_frame.size.height;
        let click_x = loc.x;
        let click_y = screen_h - loc.y;

        let (bx, by, bw, bh) = *bounds.lock().unwrap();
        if click_x >= bx as f64
            && click_x <= (bx + bw as i32) as f64
            && click_y >= by as f64
            && click_y <= (by + bh as i32) as f64
        {
            callback();
        }
    });

    let ns_event_cls = objc2::ffi::objc_getClass(c"NSEvent".as_ptr()) as *const AnyClass;
    // NSEventMaskLeftMouseDown = 1 << 1
    const MASK: u64 = 1 << 1;
    let _: *mut AnyObject = msg_send![
        ns_event_cls,
        addGlobalMonitorForEventsMatchingMask: MASK,
        handler: &*block
    ];

    // Keep the block alive for the lifetime of the app
    std::mem::forget(block);
}

/// Make the overlay the key window (receives keyboard input).
///
/// # Safety
/// `ns_window` must be a valid NSWindow pointer.
pub unsafe fn make_key_window(ns_window: *mut std::ffi::c_void) {
    let window = ns_window as *mut AnyObject;
    let _: () = msg_send![window, makeKeyWindow];
}

/// Resign key status so the overlay stops capturing keyboard events.
///
/// # Safety
/// `ns_window` must be a valid NSWindow pointer.
pub unsafe fn resign_key_window(ns_window: *mut std::ffi::c_void) {
    let window = ns_window as *mut AnyObject;
    let _: () = msg_send![window, resignKeyWindow];
}

pub fn get_pid_by_name(name: &str) -> Option<u32> {
    let script = format!(
        r#"tell application "System Events" to get unix id of first process whose name is "{}""#,
        name
    );
    run_osascript(&script).and_then(|s| s.parse().ok())
}
