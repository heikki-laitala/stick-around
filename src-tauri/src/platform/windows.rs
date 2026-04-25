use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use windows::core::PWSTR;
use windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM, LRESULT, RECT, TRUE, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CallNextHookEx, DispatchMessageW, EnumWindows, GetForegroundWindow,
    GetMessageW, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, SetWindowsHookExW, ShowWindow, TranslateMessage,
    GWL_EXSTYLE, HHOOK, MSG, MSLLHOOKSTRUCT, SW_RESTORE, WH_MOUSE_LL, WM_LBUTTONDOWN,
    WS_EX_TOOLWINDOW,
};

struct EnumCtx {
    pid: u32,
    results: Vec<(HWND, i32, i32, u32, u32)>,
}

/// True if `hwnd` is a window we'd want to track on behalf of `pid`:
/// visible, not a tool/utility window, and has a non-empty title. The title
/// check filters out the invisible owner/host stubs that modern apps
/// (Windows Terminal, Electron-based shells, etc.) keep around alongside
/// their real window.
unsafe fn is_real_top_level(hwnd: HWND) -> bool {
    if !IsWindowVisible(hwnd).as_bool() {
        return false;
    }
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
        return false;
    }
    GetWindowTextLengthW(hwnd) > 0
}

/// Get the window's *visible* frame bounds. `GetWindowRect` returns a rect
/// padded by the invisible DWM resize-handle border (~7 px each side on
/// Windows 10/11), which makes the overlay sit slightly wider/taller than the
/// terminal. `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` returns the
/// rect users actually perceive. Falls back to `GetWindowRect` if the DWM
/// call fails (e.g. desktop or other unmanaged HWNDs).
unsafe fn visible_window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    let dwm_ok = DwmGetWindowAttribute(
        hwnd,
        DWMWA_EXTENDED_FRAME_BOUNDS,
        &mut rect as *mut _ as *mut std::ffi::c_void,
        std::mem::size_of::<RECT>() as u32,
    )
    .is_ok();
    if dwm_ok {
        return Some(rect);
    }
    let mut fallback = RECT::default();
    if GetWindowRect(hwnd, &mut fallback).is_ok() {
        return Some(fallback);
    }
    None
}

unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut EnumCtx);
    let mut wnd_pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut wnd_pid));
    if wnd_pid == ctx.pid && is_real_top_level(hwnd) {
        if let Some(rect) = visible_window_rect(hwnd) {
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
            if let Some(rect) = unsafe { visible_window_rect(fg) } {
                let x = rect.left;
                let y = rect.top;
                let w = (rect.right - rect.left).max(0) as u32;
                let h = (rect.bottom - rect.top).max(0) as u32;
                if w > 0 && h > 0 {
                    return Some((x, y, w, h));
                }
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

/// Bring `hwnd` to the foreground, working around Win32's focus-stealing
/// prevention by briefly attaching our thread's input queue to the current
/// foreground thread. Without this, `SetForegroundWindow` is silently
/// downgraded to a taskbar flash whenever the calling thread doesn't own
/// the active foreground (e.g. right after the overlay loses focus).
unsafe fn force_foreground(hwnd: HWND) {
    let _ = ShowWindow(hwnd, SW_RESTORE);

    let cur_thread = GetCurrentThreadId();
    let fg_window = GetForegroundWindow();
    let fg_thread = if fg_window.is_invalid() {
        0
    } else {
        GetWindowThreadProcessId(fg_window, None)
    };

    let attached = fg_thread != 0
        && fg_thread != cur_thread
        && AttachThreadInput(cur_thread, fg_thread, true).as_bool();

    let _ = BringWindowToTop(hwnd);
    let _ = SetForegroundWindow(hwnd);

    if attached {
        let _ = AttachThreadInput(cur_thread, fg_thread, false);
    }
}

pub fn raise_window_at(pid: u32, x: i32, y: i32) {
    let windows = enum_windows_for_pid(pid);
    let hwnd = windows
        .iter()
        .find(|(_, wx, wy, _, _)| *wx == x && *wy == y)
        .or_else(|| windows.first())
        .map(|(h, _, _, _, _)| *h);

    if let Some(hwnd) = hwnd {
        unsafe { force_foreground(hwnd) };
    }
}

pub fn get_terminal_content(
    _pid: u32,
    _target_xy: Option<(i32, i32)>,
    _app_name: &str,
) -> Option<super::TerminalContent> {
    // Reading visible terminal text on Windows would mean wiring up either
    // UI Automation against the terminal's TextPattern (works for Windows
    // Terminal / conhost) or a console-screen-buffer reader for legacy
    // hosts. Neither is hooked up yet, so the overlay runs without the
    // prompt/footer rectangles on Windows.
    None
}

type ClickCallback = Arc<dyn Fn() + Send + Sync + 'static>;

struct HookState {
    bounds: Arc<Mutex<(i32, i32, u32, u32)>>,
    callback: ClickCallback,
}

static HOOK_STATE: OnceLock<HookState> = OnceLock::new();

unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && wparam.0 as u32 == WM_LBUTTONDOWN {
        // GetAsyncKeyState's high bit set => key currently down. VK_SHIFT covers
        // both left and right shift; we don't care which.
        let shift_held = (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0;
        if shift_held {
            if let Some(state) = HOOK_STATE.get() {
                let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                let pt = info.pt;
                let (bx, by, bw, bh) = *state.bounds.lock().unwrap();
                if pt.x >= bx
                    && pt.x < bx + bw as i32
                    && pt.y >= by
                    && pt.y < by + bh as i32
                {
                    (state.callback)();
                    // Don't consume — match the macOS global monitor's behaviour
                    // and let the click also reach whatever's underneath.
                }
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

/// Install a global low-level mouse hook that fires `callback` when the user
/// shift+left-clicks anywhere inside the tracked terminal window. The hook
/// runs on a dedicated thread with its own message pump so it stays responsive
/// regardless of what the main thread is doing.
pub unsafe fn install_shift_click_monitor<F>(
    bounds: Arc<Mutex<(i32, i32, u32, u32)>>,
    callback: F,
) where
    F: Fn() + Send + Sync + 'static,
{
    let _ = HOOK_STATE.set(HookState {
        bounds,
        callback: Arc::new(callback),
    });

    std::thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None).unwrap_or_default();
        let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), module, 0) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[stick-around] failed to install WH_MOUSE_LL hook: {:?}", e);
                return;
            }
        };

        let mut msg = MSG::default();
        // GetMessageW returns >0 for a real message, 0 on WM_QUIT, -1 on error.
        // We only care that the loop services hook callbacks; messages get
        // dispatched but no real window owns them.
        loop {
            let ret = GetMessageW(&mut msg, HWND::default(), 0, 0);
            if ret.0 <= 0 {
                break;
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
    });
}

pub fn get_name_by_pid(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result.ok()?;

        let path = OsString::from_wide(&buf[..size as usize]);
        let path_buf = PathBuf::from(path);
        let stem = path_buf.file_stem()?.to_string_lossy().into_owned();
        if stem.is_empty() { None } else { Some(stem) }
    }
}
