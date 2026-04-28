// Stick Around helper extension.
//
// Wayland clients can't query other apps' windows or register global
// keyboard shortcuts. This extension runs inside gnome-shell (where
// Meta has full access) and re-exports the missing primitives over the
// session bus.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME = 'dev.stickaround.GnomeShellHelper';
const OBJECT_PATH = '/dev/stickaround/GnomeShellHelper';
const SCHEMA_ID = 'org.gnome.shell.extensions.stick-around';
const ACTIVATE_KEY = 'activate-overlay';

const INTERFACE_XML = `
<node>
  <interface name="dev.stickaround.GnomeShellHelper">
    <method name="GetFrontmostPid">
      <arg type="u" direction="out" name="pid"/>
    </method>
    <method name="GetFocusedWindow">
      <arg type="t" direction="out" name="window_id"/>
      <arg type="u" direction="out" name="pid"/>
      <arg type="i" direction="out" name="x"/>
      <arg type="i" direction="out" name="y"/>
      <arg type="u" direction="out" name="width"/>
      <arg type="u" direction="out" name="height"/>
    </method>
    <method name="GetWindowGeometry">
      <arg type="t" direction="in" name="window_id"/>
      <arg type="i" direction="out" name="x"/>
      <arg type="i" direction="out" name="y"/>
      <arg type="u" direction="out" name="width"/>
      <arg type="u" direction="out" name="height"/>
    </method>
    <method name="GetWindowsForPid">
      <arg type="u" direction="in" name="pid"/>
      <arg type="a(tiiuu)" direction="out" name="windows"/>
    </method>
    <method name="RaiseWindow">
      <arg type="t" direction="in" name="window_id"/>
    </method>
    <method name="SetAlwaysOnTop">
      <arg type="t" direction="in" name="window_id"/>
      <arg type="b" direction="in" name="enabled"/>
    </method>
    <method name="SetWindowGeometry">
      <arg type="t" direction="in" name="window_id"/>
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="u" direction="in" name="width"/>
      <arg type="u" direction="in" name="height"/>
    </method>
    <signal name="ActivateOverlay">
    </signal>
  </interface>
</node>
`;

export default class StickAroundExtension extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, this);
        this._dbus.export(Gio.DBus.session, OBJECT_PATH);
        this._busOwnerId = Gio.DBus.session.own_name(
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            null,
            null,
        );

        // Register the activation keybinding through Mutter's authoritative
        // path. Wayland blocks XGrabKey-based shortcuts (which the overlay's
        // tauri-plugin-global-shortcut tries to use), so we own this binding
        // here and emit a D-Bus signal the overlay subscribes to.
        this._settings = this.getSettings(SCHEMA_ID);
        Main.wm.addKeybinding(
            ACTIVATE_KEY,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                this._dbus.emit_signal('ActivateOverlay', null);
            },
        );
    }

    disable() {
        Main.wm.removeKeybinding(ACTIVATE_KEY);
        this._settings = null;
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }
        if (this._busOwnerId) {
            Gio.DBus.session.unown_name(this._busOwnerId);
            this._busOwnerId = 0;
        }
    }

    // Identify windows by their stable sequence — a per-window monotonic
    // ID Mutter assigns at creation, stable for the window's lifetime on
    // both X11 and Wayland. `Meta.Window.get_id()` is X11-window-ID-based
    // and not portable to Wayland.
    _findWindow(windowId) {
        const target = Number(windowId);
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (win && win.get_stable_sequence() === target) {
                return win;
            }
        }
        return null;
    }

    GetFrontmostPid() {
        const win = global.display.focus_window;
        return win ? win.get_pid() : 0;
    }

    GetFocusedWindow() {
        const win = global.display.focus_window;
        if (!win) return [0, 0, 0, 0, 0, 0];
        const r = win.get_frame_rect();
        return [win.get_stable_sequence(), win.get_pid(), r.x, r.y, r.width, r.height];
    }

    GetWindowGeometry(windowId) {
        const win = this._findWindow(windowId);
        if (!win) return [0, 0, 0, 0];
        const r = win.get_frame_rect();
        return [r.x, r.y, r.width, r.height];
    }

    GetWindowsForPid(pid) {
        const target = Number(pid);
        const out = [];
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.get_pid() !== target) continue;
            const r = win.get_frame_rect();
            out.push([win.get_stable_sequence(), r.x, r.y, r.width, r.height]);
        }
        return out;
    }

    RaiseWindow(windowId) {
        const win = this._findWindow(windowId);
        if (!win) return;
        // global.get_current_time() returns Mutter's last *processed*
        // event timestamp — by the time a D-Bus call from the overlay
        // app lands, that timestamp is stale, and Mutter's
        // focus-stealing-prevention then quietly refuses the focus
        // change (the window raises but keyboard input keeps going to
        // the previously focused client). get_current_time_roundtrip
        // fetches a fresh timestamp so the activation is accepted as
        // user-driven, which is what we are — the user just clicked
        // the strip / hit the global shortcut to ask for focus.
        const time = global.display.get_current_time_roundtrip();
        win.activate(time);
    }

    SetAlwaysOnTop(windowId, enabled) {
        const win = this._findWindow(windowId);
        if (!win) return;
        if (enabled && !win.is_above()) win.make_above();
        else if (!enabled && win.is_above()) win.unmake_above();
    }

    // Move-and-resize a window via Mutter directly. Wayland clients can't
    // reposition their own windows (xdg-shell forbids it), so the overlay
    // app proxies its position updates through here. `user_op = true`
    // marks the change as user-initiated so Mutter doesn't fight us with
    // its own placement heuristics.
    SetWindowGeometry(windowId, x, y, width, height) {
        const win = this._findWindow(windowId);
        if (!win) return;
        win.move_resize_frame(true, x, y, width, height);
    }
}
