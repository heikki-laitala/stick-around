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
    fn CFRelease(cf: CFTypeRef);
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

const CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
const CF_NUMBER_SINT64_TYPE: i32 = 4;
const CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

unsafe fn cfstr(s: &str) -> CFTypeRef {
    let c = CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), CF_STRING_ENCODING_UTF8)
}

unsafe fn dict_string(dict: CFTypeRef, key: &str) -> Option<String> {
    let k = cfstr(key);
    if k.is_null() {
        return None;
    }
    let s = CFDictionaryGetValue(dict, k);
    CFRelease(k);
    if s.is_null() {
        return None;
    }
    let mut buf = [0i8; 256];
    if CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, CF_STRING_ENCODING_UTF8) {
        let cstr = std::ffi::CStr::from_ptr(buf.as_ptr());
        Some(cstr.to_string_lossy().into_owned())
    } else {
        None
    }
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

/// Process names of supported terminal hosts. Compared case-sensitively
/// against the value of `name of process` reported by System Events,
/// which equals the .app's CFBundleName for GUI apps. Trailing names
/// like "VS Code" / "Cursor" let users with the integrated terminal
/// open in front still launch the overlay onto their IDE window.
const TERMINAL_PROCESS_NAMES: &[&str] = &[
    "Terminal",
    "iTerm2",
    "iTerm",
    "Ghostty",
    "WezTerm",
    "Alacritty",
    "kitty",
    "Hyper",
    "Warp",
    "Tabby",
    "Code",     // VS Code (integrated terminal)
    "Cursor",   // Cursor (VS Code fork)
    "Code - Insiders",
];

fn is_terminal_process(name: &str) -> bool {
    TERMINAL_PROCESS_NAMES.iter().any(|t| name == *t)
}

/// `.app` bundle names of supported terminal hosts. Compared against
/// the `Foo.app` segment in the executable path returned by
/// `proc_pidpath`. Tracks `TERMINAL_PROCESS_NAMES` but uses the bundle
/// name (which is what shows up in the path) — for VS Code that's
/// "Visual Studio Code", not "Code".
const TERMINAL_APP_BUNDLES: &[&str] = &[
    "Terminal",
    "iTerm",
    "iTerm2",
    "Ghostty",
    "WezTerm",
    "Alacritty",
    "kitty",
    "Hyper",
    "Warp",
    "Tabby",
    "Visual Studio Code",
    "Code - Insiders",
    "Cursor",
];

#[link(name = "System", kind = "framework")]
extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
}

fn proc_path_for(pid: u32) -> Option<String> {
    let mut buf = [0u8; 4096];
    let n = unsafe {
        proc_pidpath(pid as i32, buf.as_mut_ptr() as *mut c_void, buf.len() as u32)
    };
    if n <= 0 {
        return None;
    }
    std::str::from_utf8(&buf[..n as usize])
        .ok()
        .map(|s| s.to_string())
}

/// Returns true if `path` looks like the executable inside a known
/// terminal-host .app bundle. Path pattern: `…/Foo.app/Contents/MacOS/<exe>`.
fn is_terminal_app_path(path: &str) -> bool {
    let Some(idx) = path.find(".app/") else {
        return false;
    };
    let prefix = &path[..idx];
    let bundle = prefix.rsplit('/').next().unwrap_or("");
    TERMINAL_APP_BUNDLES.iter().any(|b| bundle == *b)
}

fn parent_pid_for(pid: u32) -> Option<u32> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "ppid="])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Returns the controlling-TTY device path for `pid` (e.g.
/// `/dev/ttys003`), or None if the process has no TTY (background
/// daemons, Tauri-spawned subprocesses with stdin redirected, …).
/// `ps -o tty=` reports the short form (`ttys003`); we prepend
/// `/dev/` to match what iTerm/Terminal report from their AppleScript
/// dictionaries.
fn tty_for(pid: u32) -> Option<String> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "tty="])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() || s == "??" || s == "?" {
        None
    } else {
        Some(format!("/dev/{}", s))
    }
}

/// Result of walking our parent chain looking for the host terminal.
pub struct TerminalAncestor {
    pub pid: u32,
    /// TTY of the closest-to-the-terminal ancestor that has one. iTerm
    /// and Terminal.app both report `tty` per session in their
    /// AppleScript dictionaries, so this lets us pin the overlay to
    /// the *specific* tab/session running Claude Code instead of
    /// whichever window of the terminal app happens to be front.
    pub tty: Option<String>,
}

/// Walk up the parent-process chain from our own PID until we hit a
/// known terminal-host .app or run out of ancestors. Captures the
/// deepest controlling TTY in the chain along the way — that's the
/// TTY iTerm/Terminal allocated for the shell where Claude Code runs,
/// which we use to identify the specific window/session later.
fn walk_to_terminal() -> Option<TerminalAncestor> {
    let mut pid = std::process::id();
    let mut tty: Option<String> = None;
    // 32 is well above any plausible nesting (the deepest realistic
    // chain on macOS is ~8: launchd → terminal → server → login →
    // shell → mux → shell → claude → bash → us). The bound just
    // guards against pid-reuse cycles confusing the walk.
    for _ in 0..32 {
        if let Some(t) = tty_for(pid) {
            // Always overwrite: we want the TTY of the deepest ancestor
            // that has one, which is the closest to the terminal app.
            tty = Some(t);
        }
        if let Some(path) = proc_path_for(pid) {
            if is_terminal_app_path(&path) {
                return Some(TerminalAncestor { pid, tty });
            }
        }
        let Some(ppid) = parent_pid_for(pid) else { break };
        if ppid == 0 || ppid == 1 || ppid == pid {
            break;
        }
        pid = ppid;
    }
    None
}

fn find_terminal_ancestor() -> Option<u32> {
    walk_to_terminal().map(|a| a.pid)
}

/// Public version of the ancestor walk — exposes the TTY so callers
/// can target the specific tab/session. Returns None if no terminal
/// ancestor was found (caller should fall back to frontmost / window
/// list strategies).
pub fn launch_terminal_ancestor() -> Option<TerminalAncestor> {
    walk_to_terminal()
}

/// Look up the on-screen bounds of the window holding the iTerm or
/// Terminal.app session whose `tty` matches `tty_path`. Returns None
/// if the terminal app has no matching session (e.g. user closed the
/// tab between launch and our query) or if scripting access is denied.
pub fn get_window_bounds_for_tty(
    app_name: &str,
    tty_path: &str,
) -> Option<(i32, i32, u32, u32)> {
    let script = if app_name.starts_with("iTerm") {
        // iTerm: position/size are on the window, sessions live two
        // levels down. `tty` is the device path (`/dev/ttys003`).
        format!(
            r#"tell application "iTerm2"
                set out to ""
                try
                    repeat with w in windows
                        repeat with t in tabs of w
                            repeat with s in sessions of t
                                try
                                    if tty of s is "{tty}" then
                                        set p to position of w
                                        set sz to size of w
                                        set out to ((item 1 of p) as string) & "," & ((item 2 of p) as string) & "," & ((item 1 of sz) as string) & "," & ((item 2 of sz) as string)
                                        return out
                                    end if
                                end try
                            end repeat
                        end repeat
                    end repeat
                end try
                return out
            end tell"#,
            tty = tty_path
        )
    } else {
        // Terminal.app: tabs share a window, `tty` lives on the tab,
        // and the window exposes `bounds` ({x1, y1, x2, y2}).
        format!(
            r#"tell application "Terminal"
                set out to ""
                try
                    repeat with w in windows
                        repeat with t in tabs of w
                            try
                                if tty of t is "{tty}" then
                                    set b to bounds of w
                                    set x1 to item 1 of b
                                    set y1 to item 2 of b
                                    set x2 to item 3 of b
                                    set y2 to item 4 of b
                                    set out to (x1 as string) & "," & (y1 as string) & "," & ((x2 - x1) as string) & "," & ((y2 - y1) as string)
                                    return out
                                end if
                            end try
                        end repeat
                    end repeat
                end try
                return out
            end tell"#,
            tty = tty_path
        )
    };
    run_osascript(&script).and_then(|s| parse_bounds(&s))
}

/// Return the CGWindowID of the on-screen window owned by `pid` whose
/// origin matches `(x, y)`. Used at launch to pin tracking to the
/// TTY-resolved window even when it isn't the topmost window of its
/// app — `get_frontmost_window_id_for_pid` would otherwise pick the
/// z-order top, which can be a different iTerm window/tab.
pub fn get_window_id_for_pid_at(pid: u32, x: i32, y: i32) -> Option<u32> {
    unsafe {
        let list = CGWindowListCopyWindowInfo(CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY, 0);
        if list.is_null() {
            return None;
        }
        let count = CFArrayGetCount(list);
        let mut found: Option<u32> = None;
        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(list, i);
            if dict.is_null() {
                continue;
            }
            if dict_number_i64(dict, "kCGWindowOwnerPID") != Some(pid as i64) {
                continue;
            }
            if dict_number_i64(dict, "kCGWindowLayer").unwrap_or(-1) != 0 {
                continue;
            }
            // CGWindowList exposes the frame as a sub-dictionary
            // `kCGWindowBounds` containing keys `X`, `Y`, `Width`,
            // `Height` (CGRect-from-dict format). We only need the
            // origin to disambiguate between windows of the same PID.
            let bounds_key = cfstr("kCGWindowBounds");
            if bounds_key.is_null() {
                continue;
            }
            let bounds_dict = CFDictionaryGetValue(dict, bounds_key);
            CFRelease(bounds_key);
            if bounds_dict.is_null() {
                continue;
            }
            let mut rect = CGRectRaw::default();
            if !CGRectMakeWithDictionaryRepresentation(bounds_dict, &mut rect) {
                continue;
            }
            // 2 px slop: AppleScript and CGWindow occasionally disagree
            // by one pixel due to title-bar inclusion / rounding.
            if (rect.origin_x - x as f64).abs() <= 2.0
                && (rect.origin_y - y as f64).abs() <= 2.0
            {
                if let Some(wid) = dict_number_i64(dict, "kCGWindowNumber") {
                    found = Some(wid as u32);
                    break;
                }
            }
        }
        CFRelease(list);
        found
    }
}

/// Pick a terminal PID for the overlay to follow. Strategy order:
///
/// 1. Walk our own parent-process chain — most reliable when the
///    overlay is spawned from a Claude Code session, regardless of
///    what the user has frontmost at the moment.
/// 2. Frontmost PID, when it's already a known terminal app (the
///    fast path for users who just typed a command into their shell).
/// 3. CGWindowList z-order, scanned twice: current Mission Control
///    space first, then all spaces, picking the topmost window
///    owned by a known terminal app.
/// 4. Whatever `get_frontmost_pid` returns, even if it's not a
///    terminal — better to attach to something the user can see
///    than refuse to launch.
pub fn find_terminal_pid() -> Option<u32> {
    if let Some(pid) = find_terminal_ancestor() {
        return Some(pid);
    }

    if let Some(fg) = get_frontmost_pid() {
        if let Some(name) = get_name_by_pid(fg) {
            if is_terminal_process(&name) {
                return Some(fg);
            }
        }
    }

    // Try the current Mission Control space first (OnScreenOnly), then
    // fall back to all windows if no terminal is found there. The user's
    // active terminal is normally on the current space; falling back lets
    // launches from a different space (or from a Bash subprocess that
    // doesn't have a visible window of its own) still find a terminal
    // worth attaching to. Last resort: just hand back whatever the
    // frontmost PID was, even if it's not a known terminal — we'd rather
    // attach to something the user can see than refuse to launch.
    unsafe {
        if let Some(pid) = find_terminal_pid_via_cglist(CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY) {
            return Some(pid);
        }
        if let Some(pid) = find_terminal_pid_via_cglist(0) {
            return Some(pid);
        }
    }
    get_frontmost_pid()
}

unsafe fn find_terminal_pid_via_cglist(options: u32) -> Option<u32> {
    let list = CGWindowListCopyWindowInfo(options, 0);
    if list.is_null() {
        return None;
    }
    let count = CFArrayGetCount(list);
    let mut found: Option<u32> = None;
    // PID → known-not-a-terminal cache. `get_name_by_pid` runs an
    // osascript per call (~100 ms), and a typical macOS window list
    // has dozens of entries from a few apps (Finder, browser tabs,
    // Slack channels). Without caching we'd burn many seconds on
    // every launch. Caching by PID makes the per-window cost ~free
    // after the first window from a given process.
    let mut not_terminal: std::collections::HashSet<u32> =
        std::collections::HashSet::new();
    for i in 0..count {
        let dict = CFArrayGetValueAtIndex(list, i);
        if dict.is_null() {
            continue;
        }
        // Skip menubar, dock, etc. — only consider normal-layer windows.
        if dict_number_i64(dict, "kCGWindowLayer").unwrap_or(-1) != 0 {
            continue;
        }
        let Some(pid_i64) = dict_number_i64(dict, "kCGWindowOwnerPID") else {
            continue;
        };
        let pid = pid_i64 as u32;
        if not_terminal.contains(&pid) {
            continue;
        }
        // Prefer the window-list owner name (cheap, no IPC), fall
        // back to System Events when it's blank/obscured (happens
        // without Screen Recording permission).
        let name = dict_string(dict, "kCGWindowOwnerName")
            .filter(|s| !s.is_empty())
            .or_else(|| get_name_by_pid(pid));
        let Some(name) = name else { continue };
        if is_terminal_process(&name) {
            found = Some(pid);
            break;
        } else {
            not_terminal.insert(pid);
        }
    }
    CFRelease(list);
    found
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

/// Debug dump for prompt/footer detection. Writes the exact text the
/// detector sees plus the indices and rects it produced to a file, but
/// only when `STICK_AROUND_DUMP_DETECTION` is set in the environment.
/// Each call truncates and rewrites the file, so the latest snapshot is
/// always there — kill the overlay (`Q` or `pkill stick-around`) to
/// freeze it before inspecting.
fn dump_detection_snapshot(
    label: &str,
    text_lines: &[&str],
    input_line: Option<usize>,
    footer_line: Option<usize>,
    prompt_rect: Option<(f64, f64, f64, f64)>,
    footer_rect: Option<(f64, f64, f64, f64)>,
    extras: &[(&str, String)],
) {
    let path = match std::env::var("STICK_AROUND_DUMP_DETECTION") {
        Ok(p) if !p.is_empty() => p,
        _ => return,
    };
    use std::fmt::Write as _;
    let mut out = String::new();
    let _ = writeln!(out, "=== stick-around prompt detection dump ===");
    let _ = writeln!(out, "backend     : {label}");
    let _ = writeln!(out, "input_line  : {:?}", input_line);
    let _ = writeln!(out, "footer_line : {:?}", footer_line);
    let _ = writeln!(out, "prompt_rect : {:?}", prompt_rect);
    let _ = writeln!(out, "footer_rect : {:?}", footer_rect);
    for (k, v) in extras {
        let _ = writeln!(out, "{k:<12}: {v}");
    }
    let _ = writeln!(out, "--- text_lines ({}) ---", text_lines.len());
    for (i, l) in text_lines.iter().enumerate() {
        let marker = if Some(i) == input_line {
            "INPUT"
        } else if Some(i) == footer_line {
            "FOOT "
        } else {
            "     "
        };
        // Preserve box-drawing characters; only escape ASCII controls
        // (newlines won't appear inside a single line, but tabs / NULs
        // would silently corrupt the dump).
        let rendered: String = l
            .chars()
            .map(|c| {
                if c == '\t' {
                    "\\t".to_string()
                } else if (c as u32) < 0x20 || c as u32 == 0x7F {
                    format!("\\x{:02X}", c as u32)
                } else {
                    c.to_string()
                }
            })
            .collect();
        let _ = writeln!(out, "[{i:3}] {marker} |{rendered}|");
    }
    let _ = std::fs::write(&path, out);
}

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

    dump_detection_snapshot(
        "ax (Terminal.app)",
        &text_lines,
        input_line,
        footer_line,
        None,
        None,
        &[
            ("title", title.to_string()),
            ("term_cols", term_cols.to_string()),
            ("term_rows", term_rows.to_string()),
            ("win_xy", format!("{},{}", win_x, win_y)),
            (
                "scroll_xywh",
                format!("{},{},{},{}", scroll_x, scroll_y, scroll_w, scroll_h),
            ),
        ],
    );

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
    /// Top of the AXTextArea in screen coords. The Nth paragraph's top
    /// sits at `ta_y + N * line_height` — `sa_y` is the viewport top,
    /// which can differ from the first visible paragraph's top by a few
    /// pixels of inset and accumulates noticeable drift if used as the
    /// row-0 anchor.
    ta_y: f64,
    /// Real per-paragraph pitch from `taH / numPara`. iTerm renders rows
    /// at this pitch; `sa_h / visible_rows` rounds away ~½ a row of error
    /// over a 24-row viewport.
    line_height: f64,
    visible_text: String,
    visible_rows: usize,
    first_vis: usize,
}

fn get_iterm_ax(pid: u32, target_xy: Option<(i32, i32)>) -> Option<ItermAx> {
    // `round x` in AppleScript defaults to banker's rounding (nearest even).
    // That's fine for our purposes; what matters is that we're NOT using
    // `rounding down` here — the pixel offset lands at e.g. 945.99, and
    // floor(945.99) = 945 is one paragraph earlier than the visible start,
    // which shifted the detected prompt by 2 rows. Using nearest rounding
    // fixes the off-by-2 observed in practice.
    //
    // `target_xy` pins the lookup to the launch-time iTerm window by
    // matching its current position. Without this we'd target `front
    // window`, which swaps if the user clicks another window of the
    // same iTerm process — polluting prompt detection with content
    // from the wrong window. We match by position (not CGWindowID)
    // because System Events only exposes position/size, not the
    // CG-level window number.
    let window_lookup = match target_xy {
        Some((tx, ty)) => format!(
            r#"set w to missing value
                repeat with candidate in windows
                    try
                        set p to position of candidate
                        if (item 1 of p) is {tx} and (item 2 of p) is {ty} then
                            set w to candidate
                            exit repeat
                        end if
                    end try
                end repeat
                if w is missing value then
                    if (count of windows) is 0 then return ""
                    set w to front window
                end if"#,
            tx = tx,
            ty = ty
        ),
        None => r#"if (count of windows) is 0 then return ""
                set w to front window"#
            .to_string(),
    };
    let script = format!(r#"tell application "System Events"
        try
            tell (first process whose unix id is {pid})
                {window_lookup}
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
                return ((item 1 of wp) as string) & "|" & ((item 2 of wp) as string) & "|" & ((item 1 of sp) as string) & "|" & ((item 2 of sp) as string) & "|" & ((item 1 of ss) as string) & "|" & ((item 2 of ss) as string) & "|" & (actualRows as string) & "|" & (firstVis as string) & "|" & ((item 2 of tp) as string) & "|" & (lh as string) & linefeed & "---SPLIT---" & linefeed & visText
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
    if fields.len() < 10 {
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
    let ta_y: f64 = fields[8].parse().ok()?;
    let line_height: f64 = fields[9].parse().ok()?;

    Some(ItermAx {
        win_x, win_y,
        sa_x, sa_y, sa_w, sa_h,
        ta_y, line_height,
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
fn get_iterm_content(pid: u32, target_xy: Option<(i32, i32)>) -> Option<TerminalContent> {
    let ax = get_iterm_ax(pid, target_xy)?;

    let text_offset_x = (ax.sa_x - ax.win_x).max(0.0);
    let text_width = ax.sa_w;

    let text_lines: Vec<&str> = ax.visible_text.lines().collect();
    let term_rows = ax.visible_rows.max(text_lines.len().max(1));

    // Anchor row 0 at `sa_y` (the visible viewport top — iTerm renders
    // rows top-flush in the scroll area). Use `lh = taH / numPara` from
    // AppleScript as the row pitch: dividing `sa_h / visible_rows` rounds
    // away ~½ a px of fractional precision per row, which compounds into
    // ½-row drift by the time we reach the prompt box. The footer rect
    // still extends to `sa_y + sa_h` so any bottom inset (the gap between
    // the last text row and the viewport bottom) is filled by the footer
    // strip rather than left as empty space below the rect.
    let line_height = ax.line_height.max(1.0);
    let text_offset_y = (ax.sa_y - ax.win_y).max(0.0);
    let text_height = ax.sa_h;

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

    let prompt_rect: Option<(f64, f64, f64, f64)> = match (input_line, footer_line) {
        (Some(top), Some(bot)) if bot >= top => {
            let y = text_offset_y + top as f64 * line_height;
            let h = (bot - top) as f64 * line_height;
            Some((text_offset_x, y, text_width, h))
        }
        _ => None,
    };
    let footer_rect: Option<(f64, f64, f64, f64)> = footer_line.map(|top| {
        let y = text_offset_y + top as f64 * line_height;
        let bottom = text_offset_y + text_height;
        (text_offset_x, y, text_width, (bottom - y).max(0.0))
    });

    dump_detection_snapshot(
        "iterm",
        &text_lines,
        input_line,
        footer_line,
        prompt_rect,
        footer_rect,
        &[
            ("term_cols", term_cols.to_string()),
            ("term_rows", term_rows.to_string()),
            ("visible_rows", ax.visible_rows.to_string()),
            ("first_vis", ax.first_vis.to_string()),
            ("win_xy", format!("{},{}", ax.win_x, ax.win_y)),
            (
                "sa_xywh",
                format!("{},{},{},{}", ax.sa_x, ax.sa_y, ax.sa_w, ax.sa_h),
            ),
            ("ta_y", format!("{:.3}", ax.ta_y)),
            ("line_height", format!("{:.4}", line_height)),
            ("text_offset_y", format!("{:.3}", text_offset_y)),
            ("text_height", format!("{:.3}", text_height)),
        ],
    );

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
use super::text_analysis::{detect_terminal_regions, is_wide_char};

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

