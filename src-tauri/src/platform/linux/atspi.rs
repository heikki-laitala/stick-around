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

use std::sync::{Mutex, OnceLock};
use zbus::blocking::{connection, Connection, Proxy};
use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

const SESSION_A11Y_BUS: &str = "org.a11y.Bus";
const SESSION_A11Y_PATH: &str = "/org/a11y/bus";
const SESSION_A11Y_IFACE: &str = "org.a11y.Bus";

const REGISTRY_BUS: &str = "org.a11y.atspi.Registry";
const REGISTRY_PATH: &str = "/org/a11y/atspi/accessible/root";

const IFACE_ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const IFACE_TEXT: &str = "org.a11y.atspi.Text";
const IFACE_COMPONENT: &str = "org.a11y.atspi.Component";
const IFACE_PROPS: &str = "org.freedesktop.DBus.Properties";

// Match by role *name* (a stable string per AT-SPI spec) rather than
// the role enum number, which has shifted between versions: Ptyxis on
// at-spi2-core 2.50 reports TERMINAL=60, older sources list 82, GTK3
// once used a different revision again. The name path is one extra
// D-Bus call per accessible during the walk, but the walk only runs
// when the per-pid cache misses.
const ROLE_NAME_TERMINAL: &str = "terminal";

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

    fn role_name(&self, bus: &str, path: &str) -> zbus::Result<String> {
        self.proxy(bus, path, IFACE_ACCESSIBLE)?.call("GetRoleName", &())
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

/// Cached terminal node + last fetched text. Stored across calls so
/// we skip the tree walk on every poll (set on first lookup) and skip
/// the get_text round-trip when CharacterCount hasn't changed since
/// last refresh — terminals re-render the same buffer for many polls
/// in a row when the user isn't typing or Claude isn't streaming.
struct TerminalCache {
    pid: u32,
    bus_name: String,
    path: String,
    last_count: i32,
    last_text: String,
}

static TERMINAL_NODE: Mutex<Option<TerminalCache>> = Mutex::new(None);

fn find_terminal_under(bus: &AtspiBus, b: &str, p: &str, depth: u8) -> Option<(String, String)> {
    // GTK4 apps (e.g. Ptyxis) wrap terminals in long chains of panel/box
    // accessibles — measured 17 deep on Ptyxis 49. Keep enough headroom
    // for deeper-nested toolkits without going unbounded.
    if depth > 32 {
        return None;
    }
    if matches!(bus.role_name(b, p).as_deref(), Ok(ROLE_NAME_TERMINAL)) {
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
/// walk. Skips the text re-fetch when CharacterCount is unchanged.
/// Returns `None` if AT-SPI isn't reachable, the app for `pid` doesn't
/// expose itself, or no descendant has role-name `terminal`.
pub fn snapshot_for_pid(pid: u32) -> Option<TerminalSnapshot> {
    let bus = bus()?;

    // Resolve (bus_name, path) by hitting the cache first; on miss, walk
    // the tree once and store. We also lift any prior text/count so the
    // second-stage fetch can skip get_text when the buffer is unchanged.
    let (bus_name, path, prior) = {
        let mut guard = TERMINAL_NODE.lock().ok()?;
        match guard.as_ref() {
            Some(c) if c.pid == pid => {
                (c.bus_name.clone(), c.path.clone(), Some((c.last_count, c.last_text.clone())))
            }
            _ => {
                let (b, p) = locate_terminal_for_pid(pid)?;
                *guard = Some(TerminalCache {
                    pid,
                    bus_name: b.clone(),
                    path: p.clone(),
                    last_count: -1,
                    last_text: String::new(),
                });
                (b, p, None)
            }
        }
    };

    let extents = match bus.extents(&bus_name, &path, COORD_WINDOW) {
        Ok(e) => e,
        Err(_) => {
            // Cached node went stale (window closed, etc.). Drop the
            // whole cache so the next call re-walks.
            *TERMINAL_NODE.lock().ok()? = None;
            return None;
        }
    };
    let count = bus.character_count(&bus_name, &path).ok()?;

    let text = match prior {
        Some((last_count, last_text)) if last_count == count => last_text,
        _ => {
            let fetched = if count > 0 {
                bus.get_text(&bus_name, &path, 0, count).ok()?
            } else {
                String::new()
            };
            if let Ok(mut guard) = TERMINAL_NODE.lock() {
                if let Some(c) = guard.as_mut() {
                    c.last_count = count;
                    c.last_text = fetched.clone();
                }
            }
            fetched
        }
    };

    Some(TerminalSnapshot {
        window_extents: extents,
        text,
        bus_name,
        path,
    })
}
