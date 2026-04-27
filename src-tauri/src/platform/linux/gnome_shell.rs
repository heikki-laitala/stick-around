// D-Bus client for the Stick Around GNOME Shell extension.
//
// Wayland clients cannot enumerate or query the geometry of other apps'
// windows. The companion Shell extension (gnome-extension/) exposes the
// missing pieces over the session bus; this module is the Rust side of
// that contract.
//
// Phase A: scaffolding only — the proxy compiles and the interface is
// declared, but call sites in linux.rs are not switched over yet.

#![allow(dead_code)]

use zbus::blocking::{Connection, Proxy};

const BUS_NAME: &str = "dev.stickaround.GnomeShellHelper";
const OBJECT_PATH: &str = "/dev/stickaround/GnomeShellHelper";
const INTERFACE: &str = "dev.stickaround.GnomeShellHelper";

pub type WindowId = u64;

/// Geometry of a window in logical pixels, relative to the top-left of
/// the primary monitor. Matches what the Shell extension reports via
/// `meta_window_get_frame_rect`.
#[derive(Clone, Copy, Debug)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub struct GnomeShellHelper {
    proxy: Proxy<'static>,
}

impl GnomeShellHelper {
    pub fn connect() -> zbus::Result<Self> {
        let connection = Connection::session()?;
        let proxy = Proxy::new(&connection, BUS_NAME, OBJECT_PATH, INTERFACE)?
            .into_owned();
        Ok(Self { proxy })
    }

    pub fn frontmost_pid(&self) -> zbus::Result<u32> {
        self.proxy.call("GetFrontmostPid", &())
    }

    pub fn focused_window(&self) -> zbus::Result<(WindowId, u32, i32, i32, u32, u32)> {
        self.proxy.call("GetFocusedWindow", &())
    }

    pub fn window_geometry(&self, window_id: WindowId) -> zbus::Result<WindowGeometry> {
        let (x, y, width, height): (i32, i32, u32, u32) =
            self.proxy.call("GetWindowGeometry", &(window_id,))?;
        Ok(WindowGeometry { x, y, width, height })
    }

    pub fn windows_for_pid(
        &self,
        pid: u32,
    ) -> zbus::Result<Vec<(WindowId, i32, i32, u32, u32)>> {
        self.proxy.call("GetWindowsForPid", &(pid,))
    }

    pub fn raise_window(&self, window_id: WindowId) -> zbus::Result<()> {
        self.proxy.call("RaiseWindow", &(window_id,))
    }

    pub fn set_always_on_top(&self, window_id: WindowId, enabled: bool) -> zbus::Result<()> {
        self.proxy.call("SetAlwaysOnTop", &(window_id, enabled))
    }
}
