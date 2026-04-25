use std::cell::RefCell;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use windows::core::{Interface, BSTR, PWSTR};
use windows::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM, LRESULT, RECT, TRUE, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
    UIA_TextPatternId,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, CallNextHookEx, DispatchMessageW, EnumWindows, GetForegroundWindow,
    GetMessageW, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId,
    IsWindowVisible, SetForegroundWindow, SetWindowsHookExW, ShowWindow, TranslateMessage,
    GWL_EXSTYLE, HHOOK, MSG, MSLLHOOKSTRUCT, SW_RESTORE, WH_MOUSE_LL, WM_LBUTTONDOWN,
    WS_EX_TOOLWINDOW,
};

use super::text_analysis::{detect_terminal_regions, is_wide_char};
use super::TerminalContent;

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

/// Process names that own a terminal/console window. Matched
/// case-insensitively against the file stem returned by `get_name_by_pid`.
/// Includes IDE-integrated terminals where the whole IDE process owns the
/// window — there's no way to single out the terminal pane, so we accept
/// the IDE window as "the terminal" and let the overlay sit over the editor.
const TERMINAL_PROCESS_NAMES: &[&str] = &[
    "WindowsTerminal", // Windows Terminal
    "conhost",         // legacy console host
    "OpenConsole",     // modern console host
    "powershell",      // Windows PowerShell (when it owns its own window)
    "pwsh",            // PowerShell 7+
    "cmd",             // Command Prompt
    "Code",            // VS Code (integrated terminal)
    "Cursor",          // Cursor editor (VS Code fork)
    "alacritty",
    "mintty",          // Git Bash
    "wezterm-gui",
    "ConEmu",
    "ConEmu64",
    "Tabby",
    "FluentTerminal",
    "Hyper",
    "kitty",
];

fn is_terminal_process(name: &str) -> bool {
    TERMINAL_PROCESS_NAMES
        .iter()
        .any(|t| name.eq_ignore_ascii_case(t))
}

/// Pick a terminal PID for the overlay to follow. Tries, in order:
/// 1. The foreground process, if it's a known terminal/console host.
/// 2. The largest visible window owned by a known terminal/console host.
/// 3. Foreground PID as last-resort fallback (lets the user retry without
///    failing the launch outright).
///
/// This hardens the launch flow against the common case where the user
/// invokes the overlay while a browser, IDE, or other app happens to own
/// foreground focus — without it we'd pin to the wrong process and the
/// overlay would track the wrong window for the rest of the session.
pub fn find_terminal_pid() -> Option<u32> {
    let fg_pid = get_frontmost_pid()?;
    if let Some(name) = get_name_by_pid(fg_pid) {
        if is_terminal_process(&name) {
            return Some(fg_pid);
        }
    }

    struct Ctx {
        results: Vec<(u32, u64)>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut Ctx);
        if !is_real_top_level(hwnd) {
            return TRUE;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return TRUE;
        }
        let Some(name) = get_name_by_pid(pid) else {
            return TRUE;
        };
        if !is_terminal_process(&name) {
            return TRUE;
        }
        if let Some(rect) = visible_window_rect(hwnd) {
            let w = (rect.right - rect.left).max(0) as u64;
            let h = (rect.bottom - rect.top).max(0) as u64;
            ctx.results.push((pid, w * h));
        }
        TRUE
    }

    let mut ctx = Ctx { results: vec![] };
    unsafe {
        let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut _ as isize));
    }
    ctx.results.sort_by(|a, b| b.1.cmp(&a.1));
    ctx.results.first().map(|(pid, _)| *pid).or(Some(fg_pid))
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

// Per-thread cached IUIAutomation instance. Initialising COM and creating the
// automation object is non-trivial; we want it once per polling thread, not
// once per 50 ms tick. RefCell is fine — UIAutomation isn't Send and each
// thread that needs it lazily creates its own.
thread_local! {
    static UIA: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

unsafe fn ensure_uia() -> Option<IUIAutomation> {
    UIA.with(|cell| {
        if let Some(existing) = cell.borrow().as_ref() {
            return Some(existing.clone());
        }
        // CoInitializeEx returns S_OK or S_FALSE (already initialized) — both
        // are fine. RPC_E_CHANGED_MODE means another caller picked STA on this
        // thread; UIA still works for our read-only queries so just continue.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        match CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
            Ok(uia) => {
                *cell.borrow_mut() = Some(uia.clone());
                Some(uia)
            }
            Err(_) => None,
        }
    })
}

/// Walk the UIA subtree under `root` and return every descendant element
/// that exposes TextPattern, paired with its bounding-rect area. The caller
/// picks the largest — that's the actual terminal viewport, while the small
/// matches are tab titles, search boxes, status indicators, etc.
unsafe fn collect_text_pattern_elements(
    uia: &IUIAutomation,
    root: &IUIAutomationElement,
    max_depth: usize,
    out: &mut Vec<(IUIAutomationElement, i64)>,
) {
    if max_depth == 0 {
        return;
    }
    if root
        .GetCurrentPattern(UIA_TextPatternId)
        .ok()
        .and_then(|p| p.cast::<IUIAutomationTextPattern>().ok())
        .is_some()
    {
        let area = root
            .CurrentBoundingRectangle()
            .map(|r| {
                let w = (r.right - r.left).max(0) as i64;
                let h = (r.bottom - r.top).max(0) as i64;
                w * h
            })
            .unwrap_or(0);
        out.push((root.clone(), area));
    }
    let walker = match uia.RawViewWalker() {
        Ok(w) => w,
        Err(_) => return,
    };
    let mut child = match walker.GetFirstChildElement(root) {
        Ok(c) => c,
        Err(_) => return,
    };
    loop {
        collect_text_pattern_elements(uia, &child, max_depth - 1, out);
        match walker.GetNextSiblingElement(&child) {
            Ok(next) => child = next,
            Err(_) => return,
        }
    }
}

unsafe fn find_terminal_text_element(
    uia: &IUIAutomation,
    root: &IUIAutomationElement,
) -> Option<IUIAutomationElement> {
    let mut all = Vec::new();
    collect_text_pattern_elements(uia, root, 10, &mut all);
    all.into_iter().max_by_key(|(_, area)| *area).map(|(el, _)| el)
}

/// Read the visible terminal text via UI Automation TextPattern. Works for
/// Windows Terminal, modern conhost, and most TextPattern-aware terminal
/// hosts. Returns `None` if any step fails (no text element, COM error,
/// etc.) — the JS frontend already handles a missing event by keeping the
/// previous content.
pub fn get_terminal_content(
    _pid: u32,
    target_xy: Option<(i32, i32)>,
    _app_name: &str,
) -> Option<TerminalContent> {
    unsafe {
        let uia = ensure_uia()?;

        // Pin to the same window the overlay is tracking. `target_xy` is the
        // current top-left of the tracked window (from poll_bounds) — we
        // resolve it back to an HWND so multi-window terminal apps don't
        // accidentally feed us text from a different window.
        let hwnd = target_xy
            .and_then(|(tx, ty)| hwnd_at_position(tx, ty))
            .or_else(|| {
                let fg = GetForegroundWindow();
                if fg.is_invalid() { None } else { Some(fg) }
            })?;

        let element = uia.ElementFromHandle(hwnd).ok()?;
        let text_elem = find_terminal_text_element(&uia, &element)?;
        let text_pattern = text_elem
            .GetCurrentPattern(UIA_TextPatternId)
            .ok()
            .and_then(|p| p.cast::<IUIAutomationTextPattern>().ok())?;

        // Visible ranges = the text rows currently on screen. We concatenate
        // their text into one string (newline-separated) so the existing
        // line-splitting code path applies unchanged.
        let visible = text_pattern.GetVisibleRanges().ok()?;
        let count = visible.Length().ok().unwrap_or(0);
        let mut text = String::new();
        for i in 0..count {
            let range = match visible.GetElement(i) {
                Ok(r) => r,
                Err(_) => continue,
            };
            // -1 = no max, return entire range
            let s: BSTR = match range.GetText(-1) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if i > 0 {
                text.push('\n');
            }
            text.push_str(&s.to_string());
        }

        // Geometry: text element's screen rect → window-relative offset.
        // Both `CurrentBoundingRectangle` and `GetWindowRect` (via
        // `visible_window_rect`) return PHYSICAL pixels on Windows. The Tauri
        // webview's canvas is sized in CSS (logical) pixels, so JS would
        // place platforms hundreds of pixels off-screen on any DPI scaling
        // other than 100%. Divide by the window's DPI scale here so the
        // numbers we hand to JS are already in CSS pixels.
        let text_rect = text_elem.CurrentBoundingRectangle().ok()?;
        let win_rect = visible_window_rect(hwnd)?;

        let dpi = GetDpiForWindow(hwnd);
        let scale = if dpi == 0 { 1.0 } else { dpi as f64 / 96.0 };

        let text_offset_x = ((text_rect.left - win_rect.left).max(0) as f64) / scale;
        let text_offset_y = ((text_rect.top - win_rect.top).max(0) as f64) / scale;
        let text_width = ((text_rect.right - text_rect.left).max(0) as f64) / scale;
        let text_height = ((text_rect.bottom - text_rect.top).max(0) as f64) / scale;

        let text_lines: Vec<&str> = text.lines().collect();

        let mut lines: Vec<usize> = Vec::with_capacity(text_lines.len());
        let mut line_offsets: Vec<usize> = Vec::with_capacity(text_lines.len());
        let mut hashes: Vec<u32> = Vec::with_capacity(text_lines.len());
        for l in &text_lines {
            let leading: usize = l
                .chars()
                .take_while(|c| c.is_whitespace())
                .map(|c| if is_wide_char(c) { 2 } else { 1 })
                .sum();
            line_offsets.push(leading);
            let trimmed = l.trim();
            let width: usize = trimmed
                .chars()
                .map(|c| if is_wide_char(c) { 2 } else { 1 })
                .sum();
            lines.push(width);
            // FNV-1a, same constants as macOS path.
            let mut h: u32 = 2166136261;
            for b in l.bytes() {
                h ^= b as u32;
                h = h.wrapping_mul(16777619);
            }
            hashes.push(h);
        }

        // Derive term_rows/term_cols from the data we have, not from a
        // hardcoded font-size guess. JS computes `lineHeight = text_height /
        // term_rows`, so getting term_rows wrong puts every platform at the
        // wrong vertical position. Using `lines.len()` as the row count
        // assumes the visible text fills the textarea — true for full-screen
        // TUIs like Claude Code, and acceptable for plain shells (prompt
        // detection still picks the right line, only the empty rows get
        // stretched to fill the viewport).
        let term_rows = lines.len().max(1);
        let term_cols = lines.iter().copied().max().unwrap_or(80).max(80);

        let (input_line, footer_line) = detect_terminal_regions(&text_lines);

        let total = text_lines.len();
        let start = if total > 8 { total - 8 } else { 0 };
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
            // UIA exposes per-range bounding rectangles, but precise
            // prompt/footer pixel rects aren't needed for parity with the
            // Mac AX path's row-arithmetic fallback. Leaving these None keeps
            // the JS path on its line-index based math, which is good enough
            // for a first cut and avoids extra UIA traversal per poll.
            prompt_rect: None,
            footer_rect: None,
        })
    }
}

/// Resolve a window position back to an HWND. Used to keep the content reader
/// pinned to the launch-time window when the user has multiple terminals open
/// for the same PID.
unsafe fn hwnd_at_position(x: i32, y: i32) -> Option<HWND> {
    // Walk all top-level windows; `enum_windows_for_pid` requires a PID, so we
    // can't reuse it here. Inline a small enum instead.
    struct Ctx {
        target_x: i32,
        target_y: i32,
        result: Option<HWND>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut Ctx);
        if !is_real_top_level(hwnd) {
            return TRUE;
        }
        if let Some(r) = visible_window_rect(hwnd) {
            if r.left == ctx.target_x && r.top == ctx.target_y {
                ctx.result = Some(hwnd);
                return BOOL(0); // stop enumeration
            }
        }
        TRUE
    }
    let mut ctx = Ctx { target_x: x, target_y: y, result: None };
    let _ = EnumWindows(Some(cb), LPARAM(&mut ctx as *mut _ as isize));
    ctx.result
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
