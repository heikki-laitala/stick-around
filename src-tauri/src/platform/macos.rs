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
    fn CGRectMakeWithDictionaryRepresentation(dict: CFTypeRef, rect: *mut CGRectRaw) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, idx: isize) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(num: CFTypeRef, typ: i32, value_ptr: *mut c_void) -> bool;
    fn CFNumberCreate(alloc: CFTypeRef, typ: i32, value_ptr: *const c_void) -> CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFStringCreateWithCString(
        alloc: CFTypeRef,
        cstr: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFStringGetCString(
        the_string: CFTypeRef,
        buffer: *mut c_char,
        buffer_size: isize,
        encoding: u32,
    ) -> bool;
}

// ─── Accessibility FFI ───────────────────────────────────────────────────
// We need pixel bounds for a specific range of characters in iTerm's
// AXTextArea. AppleScript (System Events) can't pass parameters to AX
// attributes, so `AXBoundsForRange` is unreachable from there. Going
// through the C API lets us ask iTerm directly for the on-screen rectangle
// of line N — no arithmetic between sa.h, ta.h, numPara, or wrap-aware
// guessing involved.
type AXUIElementRef = CFTypeRef;

#[repr(C)]
#[derive(Default, Clone, Copy, Debug)]
struct AXCFRange {
    location: isize,
    length: isize,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: AXUIElementRef,
        parameter_attribute: CFTypeRef,
        parameter: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
    fn AXValueCreate(type_: u32, value_ptr: *const c_void) -> CFTypeRef;
    fn AXValueGetValue(value: CFTypeRef, type_: u32, out: *mut c_void) -> bool;
}

const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const CF_NUMBER_SINT64_TYPE: i32 = 4;
const CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
// Per ApplicationServices/HIServices/AXValue.h: kAXValueCGPointType = 1,
// kAXValueCGSizeType = 2, kAXValueCGRectType = 3, kAXValueCFRangeType = 4.
// Previously had CGRect = 1, so `AXValueGetValue` silently rejected every
// bounds payload and the whole stack fell back to `sa.h / term_rows`
// arithmetic — which lined up close enough to look right for row 0 but was
// never the real on-screen rect.
const AX_VALUE_TYPE_CGRECT: u32 = 3;
const AX_VALUE_TYPE_CFRANGE: u32 = 4;
const AX_ERROR_SUCCESS: i32 = 0;

/// RAII wrapper that releases a CF/AX object on drop.
struct CfGuard(CFTypeRef);
impl Drop for CfGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}
impl CfGuard {
    fn as_ref(&self) -> CFTypeRef {
        self.0
    }
}

unsafe fn cfstr(s: &str) -> CFTypeRef {
    let c = CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), CF_STRING_ENCODING_UTF8)
}

unsafe fn cfnumber_i64(v: i64) -> CFTypeRef {
    CFNumberCreate(
        std::ptr::null(),
        CF_NUMBER_SINT64_TYPE,
        &v as *const _ as *const c_void,
    )
}

unsafe fn ax_get_attr(elem: AXUIElementRef, name: &str) -> Option<CfGuard> {
    let name_cf = CfGuard(cfstr(name));
    if name_cf.as_ref().is_null() {
        return None;
    }
    let mut out: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(elem, name_cf.as_ref(), &mut out);
    if err != AX_ERROR_SUCCESS || out.is_null() {
        None
    } else {
        Some(CfGuard(out))
    }
}

unsafe fn ax_get_param_attr(
    elem: AXUIElementRef,
    name: &str,
    param: CFTypeRef,
) -> Option<CfGuard> {
    let name_cf = CfGuard(cfstr(name));
    if name_cf.as_ref().is_null() {
        return None;
    }
    let mut out: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyParameterizedAttributeValue(elem, name_cf.as_ref(), param, &mut out);
    if err != AX_ERROR_SUCCESS || out.is_null() {
        None
    } else {
        Some(CfGuard(out))
    }
}

unsafe fn cfstring_to_string(s: CFTypeRef) -> Option<String> {
    let mut buf = [0i8; 128];
    if CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, CF_STRING_ENCODING_UTF8) {
        let cstr = std::ffi::CStr::from_ptr(buf.as_ptr());
        Some(cstr.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Recursively walk an AX element's children looking for the first node
/// whose `AXRole` equals `target_role`. `max_depth` caps recursion in case
/// the host app gives us a cyclic or pathologically deep tree.
///
/// Elements returned from `CFArrayGetValueAtIndex` are *not* retained; once
/// their parent array drops they become dangling. The returned `CfGuard`
/// wraps a retained ref so the found element outlives the recursion.
unsafe fn ax_find_descendant(
    elem: AXUIElementRef,
    target_role: &str,
    max_depth: usize,
) -> Option<CfGuard> {
    if max_depth == 0 || elem.is_null() {
        return None;
    }
    if let Some(role_cf) = ax_get_attr(elem, "AXRole") {
        if let Some(role) = cfstring_to_string(role_cf.as_ref()) {
            if role == target_role {
                return Some(CfGuard(CFRetain(elem)));
            }
        }
    }
    if let Some(kids_cf) = ax_get_attr(elem, "AXChildren") {
        let count = CFArrayGetCount(kids_cf.as_ref());
        for i in 0..count {
            let child = CFArrayGetValueAtIndex(kids_cf.as_ref(), i);
            if let Some(found) = ax_find_descendant(child, target_role, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

/// Walk to iTerm's AXTextArea once per poll. Caller takes ownership of the
/// returned guard. Kept separate so row-bounds queries don't re-walk the tree.
unsafe fn iterm_text_area(pid: u32) -> Option<CfGuard> {
    let app = AXUIElementCreateApplication(pid as i32);
    if app.is_null() {
        return None;
    }
    let app_guard = CfGuard(app);

    let windows = ax_get_attr(app_guard.as_ref(), "AXWindows")?;
    let count = CFArrayGetCount(windows.as_ref());
    if count == 0 {
        return None;
    }
    let window = CFArrayGetValueAtIndex(windows.as_ref(), 0);
    if window.is_null() {
        return None;
    }
    ax_find_descendant(window, "AXTextArea", 12)
}

/// On-screen rectangle of a specific AX line (paragraph) inside the given
/// text area. `line_num` is an absolute paragraph index in the full
/// scrollback — the caller converts visible-row indices to absolute via
/// `first_vis + visible_row`. Returns `None` if iTerm rejects the query.
unsafe fn measure_iterm_line_rect(ta_ref: AXUIElementRef, line_num: i64) -> Option<CGRectRaw> {
    let line_num_cf = CfGuard(cfnumber_i64(line_num));
    if line_num_cf.as_ref().is_null() {
        return None;
    }
    let line_range_cf = ax_get_param_attr(ta_ref, "AXRangeForLine", line_num_cf.as_ref())?;
    let mut line_range = AXCFRange::default();
    if !AXValueGetValue(
        line_range_cf.as_ref(),
        AX_VALUE_TYPE_CFRANGE,
        &mut line_range as *mut _ as *mut c_void,
    ) {
        return None;
    }
    let range_param = CfGuard(AXValueCreate(
        AX_VALUE_TYPE_CFRANGE,
        &line_range as *const _ as *const c_void,
    ));
    if range_param.as_ref().is_null() {
        return None;
    }
    let bounds_cf = ax_get_param_attr(ta_ref, "AXBoundsForRange", range_param.as_ref())?;
    let mut rect = CGRectRaw::default();
    if !AXValueGetValue(
        bounds_cf.as_ref(),
        AX_VALUE_TYPE_CGRECT,
        &mut rect as *mut _ as *mut c_void,
    ) {
        return None;
    }
    Some(rect)
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

/// Return the CGWindowID of the frontmost on-screen window owned by `pid`.
///
/// `CGWindowListCopyWindowInfo` returns windows z-ordered front to back, so
/// the first normal-layer window we find for our target PID is the one the
/// user is actively looking at — i.e. the terminal they just launched the
/// overlay from. We deliberately avoid matching by bounds here: two
/// same-app terminal windows often have identical or near-identical
/// geometry, and a bounds-based match is ambiguous and fragile. Picking
/// by z-order is unambiguous at launch time.
pub fn get_frontmost_window_id_for_pid(pid: u32) -> Option<u32> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, 0);
        if list.is_null() {
            return None;
        }
        let count = CFArrayGetCount(list);
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
            if let Some(wid) = dict_number_i64(dict, "kCGWindowNumber") {
                result = Some(wid as u32);
                break;
            }
        }
        CFRelease(list);
        result
    }
}

/// Look up current bounds of a specific `CGWindowID`. Returns `None` if the
/// window has been closed or is no longer reported (e.g., minimized into
/// the Dock, off-screen on a disconnected display).
///
/// We iterate the full window list and match by `kCGWindowNumber` instead of
/// using `CGWindowListCreateDescriptionFromArray`, which produced empty
/// results in practice — likely because it needs a properly retained
/// CFArray (CFArrayCreate with NULL callbacks doesn't suffice) and Apple's
/// documented usage is thin on the ground. Iteration is ~O(num_windows)
/// per poll tick (50–100 typically) and robust.
pub fn get_window_bounds_by_id(window_id: u32) -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, 0);
        if list.is_null() {
            return None;
        }
        let count = CFArrayGetCount(list);
        let mut result: Option<(i32, i32, u32, u32)> = None;
        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i);
            if dict.is_null() {
                continue;
            }
            let wid = match dict_number_i64(dict, "kCGWindowNumber") {
                Some(v) => v as u32,
                None => continue,
            };
            if wid != window_id {
                continue;
            }
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
            break;
        }
        CFRelease(list);
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

#[allow(dead_code)]
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
/// Routes to the right backend based on the terminal app:
/// - Terminal.app (and anything else using System Events AX with a
///   scroll-area/text-area hierarchy) uses `get_ax_terminal_content`.
/// - iTerm2 uses its native scripting dictionary via `get_iterm_content`
///   because it doesn't expose the same AX tree.
///
/// `target_xy` pins the query to the specific launch-time window by matching
/// its current position. Without this, the script would target `front window`
/// of the process — which swaps if the user clicks another window of the same
/// terminal app, polluting prompt/footer detection with the wrong content.
pub fn get_terminal_content(
    pid: u32,
    target_xy: Option<(i32, i32)>,
    app_name: &str,
) -> Option<TerminalContent> {
    if app_name.starts_with("iTerm") {
        return get_iterm_content(pid, target_xy);
    }
    get_ax_terminal_content(pid, target_xy)
}

/// Generic System Events AX path — works for Terminal.app.
/// Uses AXVisibleCharacterRange to get exactly the visible text.
/// Combines geometry, text, and title into a single AppleScript call for speed.
fn get_ax_terminal_content(pid: u32, target_xy: Option<(i32, i32)>) -> Option<TerminalContent> {
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
        prompt_rect: None,
        footer_rect: None,
    })
}

/// iTerm AX probe result: window origin, visible scroll-area rect, and the
/// text content that falls inside that rect (sliced from the full scrollback
/// in AXTextArea).
///
/// iTerm2's AX hierarchy is:
///   Window → AXGroup → AXSplitGroup → AXScrollArea (visible viewport)
///                                      → AXTextArea (entire scrollback buffer)
///
/// AXVisibleCharacterRange — which works for Terminal.app — returns the full
/// buffer on iTerm, so we have to compute the visible slice ourselves from
/// pixel geometry: `(sa.y - ta.y) / lineHeight` gives the first visible
/// paragraph, and `sa.h / lineHeight` gives how many are visible.
struct ItermAx {
    win_x: f64,
    win_y: f64,
    sa_x: f64,
    sa_y: f64,
    sa_w: f64,
    sa_h: f64,
    visible_text: String,
    visible_rows: usize,
    first_vis: usize,
}

fn get_iterm_ax(pid: u32) -> Option<ItermAx> {
    // `round x` in AppleScript defaults to banker's rounding (nearest even).
    // That's fine for our purposes; what matters is that we're NOT using
    // `rounding down` here — the pixel offset lands at e.g. 945.99, and
    // floor(945.99) = 945 is one paragraph earlier than the visible start,
    // which shifted the detected prompt by 2 rows. Using nearest rounding
    // fixes the off-by-2 observed in practice.
    let script = format!(r#"tell application "System Events"
        try
            tell (first process whose unix id is {pid})
                if (count of windows) is 0 then return ""
                set w to front window
                set wp to position of w
                set grp to first UI element of w whose role is "AXGroup"
                set sg to first UI element of grp whose role is "AXSplitGroup"
                set sa to first UI element of sg whose role is "AXScrollArea"
                set sp to position of sa
                set ss to size of sa
                set ta to first UI element of sa whose role is "AXTextArea"
                set tp to position of ta
                set ts to size of ta
                set fullText to value of ta
                set numPara to count of paragraphs of fullText
                if numPara is 0 then return ""
                -- Force real division. AppleScript integer/integer returns
                -- an integer in some versions, which rounds lh to 17 from a
                -- real 17.97 and shifts every visible row.
                set taH to (item 2 of ts) * 1.0
                set lh to taH / numPara
                if lh <= 0 then return ""
                set firstVis to round ((((item 2 of sp) - (item 2 of tp)) / lh))
                set visRows to round (((item 2 of ss) / lh))
                if firstVis < 0 then set firstVis to 0
                if firstVis >= numPara then set firstVis to numPara - 1
                set lastVis to firstVis + visRows - 1
                if lastVis >= numPara then set lastVis to numPara - 1
                set visText to ""
                repeat with i from (firstVis + 1) to (lastVis + 1)
                    set visText to visText & (paragraph i of fullText) & linefeed
                end repeat
                set actualRows to (lastVis - firstVis + 1)
                -- Use "|" as the field separator. AppleScript formats real
                -- numbers using the system locale, which in European locales
                -- means a comma is the decimal separator ("1,7954E+4"). That
                -- makes a comma-split parser on the Rust side eat a digit.
                return ((item 1 of wp) as string) & "|" & ((item 2 of wp) as string) & "|" & ((item 1 of sp) as string) & "|" & ((item 2 of sp) as string) & "|" & ((item 1 of ss) as string) & "|" & ((item 2 of ss) as string) & "|" & (actualRows as string) & "|" & (firstVis as string) & linefeed & "---SPLIT---" & linefeed & visText
            end tell
        on error
            return ""
        end try
    end tell"#, pid = pid);

    let raw = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())?;
    if raw.is_empty() {
        return None;
    }
    let parts: Vec<&str> = raw.splitn(2, "---SPLIT---").collect();
    if parts.len() < 2 {
        return None;
    }
    let geo = parts[0].trim();
    let text = parts[1].strip_prefix('\n').unwrap_or(parts[1]);
    let text = text.strip_suffix('\n').unwrap_or(text);

    let fields: Vec<String> = geo
        .split('|')
        .map(|s| s.trim().replace(',', "."))
        .collect();
    if fields.len() < 8 {
        return None;
    }
    // AppleScript may format reals in scientific notation ("1.7954E+4").
    // Rust's f64::FromStr parses that fine, so after the comma→dot locale
    // fix above we can parse directly.
    let win_x: f64 = fields[0].parse().ok()?;
    let win_y: f64 = fields[1].parse().ok()?;
    let sa_x: f64 = fields[2].parse().ok()?;
    let sa_y: f64 = fields[3].parse().ok()?;
    let sa_w: f64 = fields[4].parse().ok()?;
    let sa_h: f64 = fields[5].parse().ok()?;
    let visible_rows: usize = fields[6].parse().ok()?;
    let first_vis: usize = fields[7].parse().ok()?;

    Some(ItermAx {
        win_x, win_y,
        sa_x, sa_y, sa_w, sa_h,
        visible_text: text.to_string(),
        visible_rows,
        first_vis,
    })
}

/// iTerm2 content reader. Walks the AX hierarchy to pull the full scrollback
/// from AXTextArea, slices to the visible viewport using AXScrollArea pixel
/// geometry, and returns both the text and the on-screen rectangle.
///
/// `target_xy` is accepted for API parity with the Terminal.app path but not
/// used yet — iTerm's AX tree gives `front window`, which matches in practice
/// because the overlay's own app doesn't steal focus. If multi-iTerm-window
/// disambiguation becomes needed, add a window-by-position lookup here.
fn get_iterm_content(pid: u32, _target_xy: Option<(i32, i32)>) -> Option<TerminalContent> {
    let ax = get_iterm_ax(pid)?;

    let text_offset_x = (ax.sa_x - ax.win_x).max(0.0);
    let text_width = ax.sa_w;

    let text_lines: Vec<&str> = ax.visible_text.lines().collect();
    let term_rows = ax.visible_rows.max(text_lines.len().max(1));

    // Ask iTerm directly for the on-screen rectangle of specific rows via
    // AX's parameterized `AXBoundsForRange`. This is the ground truth — no
    // arithmetic between sa.h, ta.h, and numPara, which all drift slightly
    // depending on scroll padding and paragraph wrapping. Fall back to the
    // sa.h/term_rows average if the AX probe fails (e.g. permissions, iTerm
    // busy), which keeps detection approximately correct instead of breaking
    // entirely.
    let ta_guard = unsafe { iterm_text_area(pid) };
    // iTerm's AXTextArea indexes AX lines into the FULL scrollback (0..numPara),
    // not the viewport. Use AppleScript's firstVis (pixel-derived) as the base
    // for visible-row → AX-line conversion; AXVisibleCharacterRange.location
    // lies (returns 0 even when scrolled).
    let first_vis_abs = ax.first_vis as i64;
    let row0_rect = ta_guard
        .as_ref()
        .and_then(|ta| unsafe { measure_iterm_line_rect(ta.as_ref(), first_vis_abs) });
    let (row0_top, line_height) = match row0_rect {
        Some(r) => (r.origin_y, r.size_height),
        None => (ax.sa_y, ax.sa_h / term_rows.max(1) as f64),
    };
    let text_height = line_height * term_rows as f64;
    let text_offset_y = (row0_top - ax.win_y).max(0.0);

    // Approximate term_cols from widest visible line; good enough for the
    // charWidth derivation frontend-side (textWidth / term_cols).
    let term_cols = text_lines
        .iter()
        .map(|l| l.chars().map(|c| if is_wide_char(c) { 2 } else { 1 }).sum::<usize>())
        .max()
        .unwrap_or(80)
        .max(1);

    let mut lines: Vec<usize> = Vec::with_capacity(text_lines.len());
    let mut line_offsets: Vec<usize> = Vec::with_capacity(text_lines.len());
    let mut hashes: Vec<u32> = Vec::with_capacity(text_lines.len());
    for l in text_lines.iter() {
        let leading: usize = l.chars()
            .take_while(|c| c.is_whitespace())
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        line_offsets.push(leading);
        let trimmed_content = l.trim();
        let width: usize = trimmed_content.chars()
            .map(|c| if is_wide_char(c) { 2 } else { 1 })
            .sum();
        lines.push(width);
        let mut h: u32 = 2166136261;
        for b in l.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16777619);
        }
        hashes.push(h);
    }

    let (input_line, footer_line) = detect_terminal_regions(&text_lines);

    // Measure the top prompt border row and the footer row directly via
    // `AXBoundsForRange`. Deriving promptArea from `input_line *
    // line_height` is brittle — iTerm's sa.h doesn't divide evenly into the
    // visible rows, so per-row arithmetic accumulates sub-pixel drift and
    // the PROMPT box bleeds by ~1 row at the bottom. Asking AX for the
    // exact rect of each row sidesteps that entirely.
    let row_rect_at = |visible_row: usize| -> Option<CGRectRaw> {
        let ta = ta_guard.as_ref()?;
        unsafe { measure_iterm_line_rect(ta.as_ref(), first_vis_abs + visible_row as i64) }
    };
    let prompt_top_rect = input_line.and_then(row_rect_at);
    let footer_top_rect = footer_line.and_then(row_rect_at);

    let prompt_rect: Option<(f64, f64, f64, f64)> = match (prompt_top_rect, footer_top_rect) {
        (Some(top), Some(bot)) => {
            let y = top.origin_y - ax.win_y;
            let h = bot.origin_y - top.origin_y;
            Some((text_offset_x, y, text_width, h.max(0.0)))
        }
        _ => None,
    };
    let footer_rect: Option<(f64, f64, f64, f64)> = footer_top_rect.map(|top| {
        let y = top.origin_y - ax.win_y;
        let h = (ax.sa_y + ax.sa_h) - top.origin_y;
        (text_offset_x, y, text_width, h.max(0.0))
    });

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
        text_offset_y,
        text_offset_x,
        text_height,
        text_width,
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

/// Set the running app's Dock icon from raw PNG bytes. We ship the binary
/// standalone (not a .app bundle), so macOS would otherwise show a generic
/// executable icon. This overrides it with the embedded stick-figure art.
pub fn set_dock_icon(png_bytes: &[u8]) {
    unsafe {
        let ns_data_cls = objc2::ffi::objc_getClass(c"NSData".as_ptr()) as *const AnyClass;
        let data: *mut AnyObject = msg_send![
            ns_data_cls,
            dataWithBytes: png_bytes.as_ptr() as *const c_void,
            length: png_bytes.len()
        ];
        if data.is_null() { return; }

        let ns_image_cls = objc2::ffi::objc_getClass(c"NSImage".as_ptr()) as *const AnyClass;
        let img: *mut AnyObject = msg_send![ns_image_cls, alloc];
        let img: *mut AnyObject = msg_send![img, initWithData: data];
        if img.is_null() { return; }

        let ns_app_cls = objc2::ffi::objc_getClass(c"NSApplication".as_ptr()) as *const AnyClass;
        let app: *mut AnyObject = msg_send![ns_app_cls, sharedApplication];
        let _: () = msg_send![app, setApplicationIconImage: img];
    }
}

/// Look up the process name for a given unix PID via System Events.
/// Used at launch to decide which terminal-content backend to run
/// (Terminal.app's generic AX path vs iTerm's own scripting dictionary).
pub fn get_name_by_pid(pid: u32) -> Option<String> {
    let script = format!(
        r#"tell application "System Events" to get name of first process whose unix id is {}"#,
        pid
    );
    run_osascript(&script).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}
