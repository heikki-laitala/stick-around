#!/usr/bin/env bash
# Stick Around Linux/Wayland one-shot setup.
#
# Wires the GNOME Shell helper extension, the .desktop entry, and the
# dock icon to the binary that ships in the plugin cache (or the
# source repo if running from a `make dev` install). Run once after
# `/plugin install stick-around@stick-around` — Wayland's security
# model means the helper extension can't be loaded mid-session, so a
# log out / log back in is required before the overlay can activate.

set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This setup is for Linux only." >&2
    exit 0
fi

# Pick the plugin root. Prefer CLAUDE_PLUGIN_ROOT (set by the skill
# runner) but fall back to the marketplace cache layout so the script
# is also invokable directly from a shell.
PLUGIN="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$PLUGIN" || ! -d "$PLUGIN" ]]; then
    PLUGIN="$HOME/.claude/plugins/cache/stick-around/stick-around/1.0.0"
fi
if [[ ! -d "$PLUGIN/gnome-extension" ]]; then
    echo "Could not find plugin source at $PLUGIN — is the plugin installed?" >&2
    exit 1
fi

EXT="$HOME/.local/share/gnome-shell/extensions/stick-around@stickaround.dev"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"

echo "Installing GNOME helper extension to $EXT"
mkdir -p "$EXT/schemas"
cp "$PLUGIN/gnome-extension/extension.js"        "$EXT/extension.js"
cp "$PLUGIN/gnome-extension/metadata.json"       "$EXT/metadata.json"
cp "$PLUGIN/gnome-extension/schemas/"*.gschema.xml "$EXT/schemas/"
glib-compile-schemas "$EXT/schemas/"

echo "Installing .desktop entry and dock icon"
mkdir -p "$APPS" "$ICONS"
sed "s|@EXEC@|$PLUGIN/stick-around|" "$PLUGIN/linux/stick-around.desktop" \
    > "$APPS/stick-around.desktop"
cp "$PLUGIN/src-tauri/icons/icon.png" "$ICONS/stick-around.png"

# Ask GNOME to enable the extension on next shell load. If
# gnome-extensions isn't on PATH (rare) we just skip — the user can
# run it manually after logout.
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable stick-around@stickaround.dev || true
fi

echo
echo "Stick Around setup complete."
echo
echo "Next:"
echo "  1. Log out and log back in (Wayland session restart loads the extension)."
echo "  2. Run /stick-around:play to launch the overlay."
echo "  3. Press Super+Shift+G (or click the HUD strip) to activate."
