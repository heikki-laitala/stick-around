#!/bin/sh
# Stick Around plugin bootstrap (POSIX shell).
#
# Same job as the Windows-targeted bootstrap.cjs: on every Claude Code
# SessionStart, fetch the prebuilt binary matching the manifest version
# and (on Linux) install the GNOME Shell helper extension, .desktop
# entry, and dock icon. POSIX rewrite so macOS/Linux users don't need
# Node on PATH — only `curl`, `tar`, `awk`/`sed`, and `sha256sum` /
# `shasum`, all of which ship by default.
#
# Idempotent. A `.bootstrap-version` stamp under the cache dir lets us
# short-circuit on every subsequent session start once the binary is
# already up to date.

set -eu

EXTENSION_UUID="stick-around@stickaround.dev"
REPO="heikki-laitala/stick-around"

# Skip when the plugin root isn't set, or when running from a
# source-tree directory marketplace — `make dev`'s link-dev symlink
# owns binary delivery there, and we don't want to clobber a
# developer's local build with a download.
[ -z "${CLAUDE_PLUGIN_ROOT:-}" ] && exit 0
case "$CLAUDE_PLUGIN_ROOT" in
    *.claude/plugins/cache*) ;;
    *) exit 0 ;;
esac

# Pick a release artifact for this platform. Anything not in the
# table exits silently — the play skill will surface "binary not
# found" if the user actually tries to run.
case "$(uname -s)/$(uname -m)" in
    Linux/x86_64)   ASSET="stick-around-linux-x86_64.tar.gz"; BINARY="stick-around" ;;
    Darwin/arm64)   ASSET="stick-around-macos-arm64.tar.gz";  BINARY="stick-around" ;;
    *) exit 0 ;;
esac

MANIFEST="$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json"
[ -f "$MANIFEST" ] || exit 0

# Pull the version field out of plugin.json without jq. Match
# `"version": "X.Y.Z"` allowing arbitrary whitespace, capture the
# value. `head -n1` guards against a future plugin.json that
# happens to contain another "version" field.
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n1)
[ -z "$VERSION" ] && exit 0

BIN_PATH="$CLAUDE_PLUGIN_ROOT/$BINARY"
STAMP="$CLAUDE_PLUGIN_ROOT/.bootstrap-version"

# sha256 helper — Linux ships sha256sum, macOS ships shasum -a 256.
sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

install_binary() {
    URL="https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}"
    TMPDIR=$(mktemp -d)
    # shellcheck disable=SC2064
    trap "rm -rf '$TMPDIR'" EXIT INT TERM
    TMP="$TMPDIR/$ASSET"
    TMP_SHA="$TMP.sha256"

    echo "[stick-around] fetching $ASSET for v$VERSION…"
    curl -fsSL --retry 3 -o "$TMP" "$URL" || return 1
    curl -fsSL --retry 3 -o "$TMP_SHA" "$URL.sha256" || return 1

    # The .sha256 sidecar is `<hash>  <filename>`; first field is the
    # hash. Lowercase it for comparison since some checksum tools
    # uppercase their output.
    EXPECTED=$(awk '{print tolower($1)}' "$TMP_SHA")
    ACTUAL=$(sha256_of "$TMP" | tr 'A-Z' 'a-z')
    if [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "[stick-around] sha256 mismatch (expected $EXPECTED, got $ACTUAL)." >&2
        return 1
    fi

    tar -xf "$TMP" -C "$CLAUDE_PLUGIN_ROOT" || return 1
    chmod +x "$BIN_PATH"
    return 0
}

if [ ! -f "$BIN_PATH" ] || [ "$(cat "$STAMP" 2>/dev/null || echo '')" != "$VERSION" ]; then
    if install_binary; then
        printf '%s' "$VERSION" > "$STAMP"
        echo "[stick-around] installed v$VERSION."
    else
        echo "[stick-around] binary install failed; play skill will not work until this is resolved." >&2
        # Don't exit 1 — the hook is non-blocking, and we still want
        # to attempt the Linux-extras step in case the binary was
        # installed manually.
    fi
fi

# ─── Linux extras ──────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || exit 0

EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXTENSION_UUID}"
SOURCE_EXT="$CLAUDE_PLUGIN_ROOT/gnome-extension/extension.js"
[ -f "$SOURCE_EXT" ] || exit 0

INSTALLED_EXT="$EXT_DIR/extension.js"
# Only redo the extension install when the source JS actually
# changed; cmp returns 0 when the files match, 1 when they differ.
if ! cmp -s "$SOURCE_EXT" "$INSTALLED_EXT" 2>/dev/null; then
    echo "[stick-around] installing GNOME helper extension…"
    mkdir -p "$EXT_DIR/schemas"
    cp "$SOURCE_EXT" "$INSTALLED_EXT"
    cp "$CLAUDE_PLUGIN_ROOT/gnome-extension/metadata.json" "$EXT_DIR/metadata.json"
    for schema in "$CLAUDE_PLUGIN_ROOT"/gnome-extension/schemas/*.gschema.xml; do
        [ -f "$schema" ] && cp "$schema" "$EXT_DIR/schemas/"
    done
    if command -v glib-compile-schemas >/dev/null 2>&1; then
        glib-compile-schemas "$EXT_DIR/schemas"
    fi
    # Pre-enable so the extension loads on next shell start.
    if command -v gnome-extensions >/dev/null 2>&1; then
        gnome-extensions enable "$EXTENSION_UUID" >/dev/null 2>&1 || true
    fi
    echo "[stick-around] GNOME helper extension updated. Log out and log back in to load it."
fi

# .desktop entry: re-template against the current binary path so
# /plugin update (which lands at a new cache version dir) doesn't
# leave the dock pointing at a stale path.
DESKTOP_TEMPLATE="$CLAUDE_PLUGIN_ROOT/linux/stick-around.desktop"
DESKTOP_DEST="$HOME/.local/share/applications/stick-around.desktop"
if [ -f "$DESKTOP_TEMPLATE" ]; then
    DESKTOP_CONTENT=$(sed "s|@EXEC@|$BIN_PATH|" "$DESKTOP_TEMPLATE")
    if [ ! -f "$DESKTOP_DEST" ] || [ "$(cat "$DESKTOP_DEST")" != "$DESKTOP_CONTENT" ]; then
        mkdir -p "$(dirname "$DESKTOP_DEST")"
        printf '%s\n' "$DESKTOP_CONTENT" > "$DESKTOP_DEST"
    fi
fi

# Icon: install once, never re-copy (image bytes don't change).
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_DEST="$ICON_DIR/stick-around.png"
if [ ! -f "$ICON_DEST" ] && [ -f "$CLAUDE_PLUGIN_ROOT/src-tauri/icons/icon.png" ]; then
    mkdir -p "$ICON_DIR"
    cp "$CLAUDE_PLUGIN_ROOT/src-tauri/icons/icon.png" "$ICON_DEST"
fi

exit 0
