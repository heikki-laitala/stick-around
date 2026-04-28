// AT-SPI 2 client for reading terminal text + geometry on Linux/Wayland.
//
// macOS/Windows pull terminal contents through Accessibility (AX) and
// platform-specific APIs (AppleScript for iTerm). On Wayland, the only
// portable equivalent is AT-SPI: assistive-tech apps like Orca read
// terminal output through this same path. Most VTE-based terminals
// (Ptyxis, gnome-terminal, kgx) and many others expose their text
// widget with role=terminal, the Component interface for geometry, and
// the Text interface for character data.
//
// The bus topology: AT-SPI 2 lives on a *separate* per-user D-Bus,
// reachable by asking the session bus for `org.a11y.Bus.GetAddress`.
// Every accessible object is identified by a (bus_name, object_path)
// pair — the registry's child list returns this as `a(so)`.

use std::io::Write;
use std::sync::{Mutex, OnceLock};
use zbus::blocking::{connection, Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

/// Append a single line to /tmp/sa-atspi.log when `STICK_AROUND_DEBUG`
/// is set in the environment. AT-SPI plumbing is fragile enough that
/// having a no-overhead-by-default file log earns its keep when a
/// user reports drift, but we don't want it firing every poll on
/// every install.
/// Append a single line to /tmp/sa-atspi.log when `STICK_AROUND_DEBUG`
/// is set in the environment. AT-SPI plumbing is fragile enough that
/// having a no-overhead-by-default file log earns its keep when a
/// user reports drift, but we don't want it firing every poll on
/// every install.
pub fn dbg_log(msg: &str) {
    if std::env::var_os("STICK_AROUND_DEBUG").is_none() {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/sa-atspi.log")
    {
        let _ = writeln!(f, "{}", msg);
    }
}

const SESSION_A11Y_BUS: &str = "org.a11y.Bus";
const SESSION_A11Y_PATH: &str = "/org/a11y/bus";
const SESSION_A11Y_IFACE: &str = "org.a11y.Bus";

const REGISTRY_BUS: &str = "org.a11y.atspi.Registry";
const REGISTRY_PATH: &str = "/org/a11y/atspi/accessible/root";

const IFACE_ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const IFACE_TEXT: &str = "org.a11y.atspi.Text";
const IFACE_COMPONENT: &str = "org.a11y.atspi.Component";
const IFACE_PROPS: &str = "org.freedesktop.DBus.Properties";

// AT-SPI role enum values shift between versions; query the running
// daemon (`Atspi.Role.TERMINAL` from gjs/python) before changing this.
// On at-spi2-core 2.50+ TERMINAL is 60 — older sources list 82, but
// that's an off-by-one count from a different enum revision.
const ROLE_TERMINAL: u32 = 60;

// Coord type for Component.GetExtents. WINDOW gives us coordinates
// relative to the terminal's containing window, which is what the
// overlay's bounds tracker uses.
const COORD_WINDOW: u32 = 1;

#[derive(Clone, Debug)]
pub struct Extents {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Debug)]
pub struct TerminalSnapshot {
    pub window_extents: Extents,
    pub text: String,
    bus_name: String,
    path: String,
}

impl TerminalSnapshot {
    /// Window-relative bbox of the character at `offset`. Used to
    /// derive exact line baselines (the component bbox overshoots
    /// actual line height by ~0.7 px on Ptyxis) and the real text-grid
    /// horizontal bounds (component bbox includes ~17 px of padding
    /// outside the cell grid on Ptyxis).
    pub fn extents_at_offset(&self, offset: i32) -> Option<Extents> {
        let b = bus()?;
        b.character_extents(&self.bus_name, &self.path, offset, COORD_WINDOW)
            .ok()
    }

    pub fn y_at_offset(&self, offset: i32) -> Option<i32> {
        self.extents_at_offset(offset).map(|e| e.y)
    }
}

struct AtspiBus {
    conn: Connection,
}

impl AtspiBus {
    fn connect() -> zbus::Result<Self> {
        let session = Connection::session()?;
        let bus_proxy = Proxy::new(&session, SESSION_A11Y_BUS, SESSION_A11Y_PATH, SESSION_A11Y_IFACE)?;
        let address: String = bus_proxy.call("GetAddress", &())?;
        let conn = connection::Builder::address(address.as_str())?.build()?;
        Ok(Self { conn })
    }

    fn proxy<'a>(&self, bus: &'a str, path: &'a str, iface: &'a str) -> zbus::Result<Proxy<'a>> {
        Proxy::new(&self.conn, bus, path, iface)
    }

    fn role(&self, bus: &str, path: &str) -> zbus::Result<u32> {
        self.proxy(bus, path, IFACE_ACCESSIBLE)?.call("GetRole", &())
    }

    fn children(&self, bus: &str, path: &str) -> zbus::Result<Vec<(String, String)>> {
        let raw: Vec<(String, OwnedObjectPath)> =
            self.proxy(bus, path, IFACE_ACCESSIBLE)?.call("GetChildren", &())?;
        Ok(raw.into_iter().map(|(b, p)| (b, p.as_str().to_string())).collect())
    }

    fn pid_for_bus_name(&self, bus_name: &str) -> zbus::Result<u32> {
        // AT-SPI's `Application.Id` is the registry's *internal* app
        // number (small sequential int), not the OS PID. The PID has to
        // come from the D-Bus daemon itself: every bus-daemon exposes
        // `GetConnectionUnixProcessID` on org.freedesktop.DBus, including
        // the per-user a11y daemon spawned by at-spi-bus-launcher.
        self.proxy(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
        )?
        .call("GetConnectionUnixProcessID", &(bus_name,))
    }

    fn extents(&self, bus: &str, path: &str, coord: u32) -> zbus::Result<Extents> {
        let (x, y, w, h): (i32, i32, i32, i32) = self
            .proxy(bus, path, IFACE_COMPONENT)?
            .call("GetExtents", &(coord,))?;
        Ok(Extents { x, y, w, h })
    }

    fn character_count(&self, bus: &str, path: &str) -> zbus::Result<i32> {
        // CharacterCount is exposed as a property on the Text interface.
        let value: OwnedValue = self
            .proxy(bus, path, IFACE_PROPS)?
            .call("Get", &(IFACE_TEXT, "CharacterCount"))?;
        i32::try_from(&Value::from(value)).map_err(|_| {
            zbus::Error::Failure("Text.CharacterCount was not an i32".into())
        })
    }

    fn get_text(&self, bus: &str, path: &str, start: i32, end: i32) -> zbus::Result<String> {
        self.proxy(bus, path, IFACE_TEXT)?
            .call("GetText", &(start, end))
    }

    fn character_extents(
        &self,
        bus: &str,
        path: &str,
        offset: i32,
        coord: u32,
    ) -> zbus::Result<Extents> {
        let (x, y, w, h): (i32, i32, i32, i32) = self
            .proxy(bus, path, IFACE_TEXT)?
            .call("GetCharacterExtents", &(offset, coord))?;
        Ok(Extents { x, y, w, h })
    }
}

fn bus() -> Option<&'static AtspiBus> {
    static BUS: OnceLock<Option<AtspiBus>> = OnceLock::new();
    BUS.get_or_init(|| AtspiBus::connect().ok()).as_ref()
}

/// (bus_name, object_path) of the terminal accessibility node, cached
/// per process across calls so we don't re-walk the tree every poll.
static TERMINAL_NODE: Mutex<Option<(u32, String, String)>> = Mutex::new(None);

fn find_terminal_under(bus: &AtspiBus, b: &str, p: &str, depth: u8) -> Option<(String, String)> {
    // GTK4 apps (e.g. Ptyxis) wrap terminals in long chains of panel/box
    // accessibles — measured 17 deep on Ptyxis 49. Keep enough headroom
    // for deeper-nested toolkits without going unbounded.
    if depth > 32 {
        return None;
    }
    if matches!(bus.role(b, p), Ok(ROLE_TERMINAL)) {
        return Some((b.to_string(), p.to_string()));
    }
    let children = bus.children(b, p).ok()?;
    for (cb, cp) in children {
        if let Some(hit) = find_terminal_under(bus, &cb, &cp, depth + 1) {
            return Some(hit);
        }
    }
    None
}

fn locate_terminal_for_pid(pid: u32) -> Option<(String, String)> {
    let bus = bus()?;
    let apps = bus.children(REGISTRY_BUS, REGISTRY_PATH).ok()?;
    for (app_bus, app_path) in apps {
        if let Ok(app_pid) = bus.pid_for_bus_name(&app_bus) {
            if app_pid == pid {
                if let Some(term) = find_terminal_under(bus, &app_bus, &app_path, 0) {
                    return Some(term);
                }
            }
        }
    }
    None
}

/// Pull the focused terminal's text + window-relative geometry.
/// Caches the AT-SPI node by PID so subsequent calls skip the tree
/// walk. Returns `None` if AT-SPI isn't reachable, the app for `pid`
/// doesn't expose itself, or no descendant has `role=TERMINAL`.
pub fn snapshot_for_pid(pid: u32) -> Option<TerminalSnapshot> {
    let bus = bus()?;

    // Reuse the cached node when the pid matches; otherwise re-walk.
    let mut guard = TERMINAL_NODE.lock().ok()?;
    let node = match guard.as_ref() {
        Some((cached_pid, b, p)) if *cached_pid == pid => Some((b.clone(), p.clone())),
        _ => None,
    };
    let (bus_name, path) = match node {
        Some(n) => n,
        None => {
            let found = locate_terminal_for_pid(pid)?;
            *guard = Some((pid, found.0.clone(), found.1.clone()));
            found
        }
    };
    drop(guard);

    let extents = match bus.extents(&bus_name, &path, COORD_WINDOW) {
        Ok(e) => e,
        Err(_) => {
            // Cached node went stale (window closed, etc.). Drop it so
            // the next call re-walks.
            *TERMINAL_NODE.lock().ok()? = None;
            return None;
        }
    };
    let count = bus.character_count(&bus_name, &path).ok()?;
    let text = if count > 0 {
        bus.get_text(&bus_name, &path, 0, count).ok()?
    } else {
        String::new()
    };

    Some(TerminalSnapshot {
        window_extents: extents,
        text,
        bus_name,
        path,
    })
}
