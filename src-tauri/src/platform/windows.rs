use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, ShowWindow, BringWindowToTop,
    SW_RESTORE,
};

struct EnumCtx {
    pid: u32,
    results: Vec<(HWND, i32, i32, u32, u32)>,
}

unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut EnumCtx);
    let mut wnd_pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut wnd_pid));
    if wnd_pid == ctx.pid && IsWindowVisible(hwnd).as_bool() {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            let x = rect.left;
            let y = rect.top;
            let w = (rect.right - rect.left).max(0) as u32;
            let h = (rect.bottom - rect.top).max(0) as u32;
            if w > 0 && h > 0 {
                ctx.results.push((hwnd, x, y, w, h));
            }
        }
    }
    TRUE
}

fn enum_windows_for_pid(pid: u32) -> Vec<(HWND, i32, i32, u32, u32)> {
    let mut ctx = EnumCtx {
        pid,
        results: vec![],
    };
    unsafe {
        let _ = EnumWindows(Some(enum_callback), LPARAM(&mut ctx as *mut _ as isize));
    }
    ctx.results
}

pub fn get_all_window_bounds(pid: u32) -> Vec<(i32, i32, u32, u32)> {
    enum_windows_for_pid(pid)
        .into_iter()
        .map(|(_, x, y, w, h)| (x, y, w, h))
        .collect()
}

pub fn get_front_window_bounds(pid: u32) -> Option<(i32, i32, u32, u32)> {
    let fg = unsafe { GetForegroundWindow() };
    if !fg.is_invalid() {
        let mut wnd_pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(fg, Some(&mut wnd_pid)) };
        if wnd_pid == pid {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(fg, &mut rect) }.is_ok() {
                let x = rect.left;
                let y = rect.top;
                let w = (rect.right - rect.left).max(0) as u32;
                let h = (rect.bottom - rect.top).max(0) as u32;
                return Some((x, y, w, h));
            }
        }
    }
    // Fallback: first visible window of the PID
    get_all_window_bounds(pid).into_iter().next()
}

pub fn get_frontmost_pid() -> Option<u32> {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        return None;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
    if pid > 0 { Some(pid) } else { None }
}

pub fn raise_window_at(pid: u32, x: i32, y: i32) {
    let windows = enum_windows_for_pid(pid);
    let hwnd = windows
        .iter()
        .find(|(_, wx, wy, _, _)| *wx == x && *wy == y)
        .or_else(|| windows.first())
        .map(|(h, _, _, _, _)| *h);

    if let Some(hwnd) = hwnd {
        unsafe {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
            let _ = BringWindowToTop(hwnd);
        }
    }
}

pub fn get_terminal_content(
    _pid: u32,
    _target_xy: Option<(i32, i32)>,
    _app_name: &str,
) -> Option<super::TerminalContent> {
    // TODO: implement terminal text reading for Windows
    None
}

pub fn get_name_by_pid(_pid: u32) -> Option<String> {
    // TODO: implement process name lookup for Windows
    None
}
