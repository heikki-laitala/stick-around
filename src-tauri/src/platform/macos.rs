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

pub fn get_pid_by_name(name: &str) -> Option<u32> {
    let script = format!(
        r#"tell application "System Events" to get unix id of first process whose name is "{}""#,
        name
    );
    run_osascript(&script).and_then(|s| s.parse().ok())
}
