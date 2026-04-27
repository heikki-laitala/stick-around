// Stick Around helper extension.
//
// Wayland clients can't query other apps' windows. This extension runs
// inside gnome-shell (where Meta has full access) and re-exports the
// window-tracking primitives the overlay needs over the session bus.
//
// Phase A: D-Bus interface declared, methods are stubs. Phase B fills
// them in against Meta.Display / Meta.Window.

import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BUS_NAME = 'dev.stickaround.GnomeShellHelper';
const OBJECT_PATH = '/dev/stickaround/GnomeShellHelper';

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
    }

    disable() {
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }
        if (this._busOwnerId) {
            Gio.DBus.session.unown_name(this._busOwnerId);
            this._busOwnerId = 0;
        }
    }

    GetFrontmostPid() {
        return 0;
    }

    GetFocusedWindow() {
        return [0, 0, 0, 0, 0, 0];
    }

    GetWindowGeometry(_windowId) {
        return [0, 0, 0, 0];
    }

    GetWindowsForPid(_pid) {
        return [];
    }

    RaiseWindow(_windowId) {
    }

    SetAlwaysOnTop(_windowId, _enabled) {
    }
}
