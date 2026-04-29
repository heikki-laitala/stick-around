ifeq ($(OS),Windows_NT)
EXE := .exe
else
EXE :=
endif

# Derive the plugin version from plugin.json so the cache path tracks
# whatever version the manifest currently says. Hard-coding the version
# would silently desync `make dev` from real installs after a release
# bump (Claude Code keys cache dirs on this value, and bootstrap reads
# the same field to build the binary download URL).
PLUGIN_VERSION := $(shell sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -n1)
PLUGIN_CACHE   := $(HOME)/.claude/plugins/cache/stick-around/stick-around/$(PLUGIN_VERSION)
BINARY_SRC     := src-tauri/target/release/stick-around$(EXE)
BINARY_DST     := $(PLUGIN_CACHE)/stick-around$(EXE)

GNOME_EXTENSION_UUID := stick-around@stickaround.dev
GNOME_EXTENSION_DIR  := $(HOME)/.local/share/gnome-shell/extensions/$(GNOME_EXTENSION_UUID)

DESKTOP_FILE_DIR := $(HOME)/.local/share/applications
DESKTOP_ICON_DIR := $(HOME)/.local/share/icons/hicolor/512x512/apps

.PHONY: build install dev link-dev clean test lint install-extension uninstall-extension install-desktop uninstall-desktop release

## Build the Tauri overlay binary (release mode). The binary stays under
## src-tauri/target/release; we don't copy it to the repo root because a
## binary at the marketplace root would clobber the plugin install path
## (cache/<marketplace>/<plugin>/<version>/) when /plugin install mirrors
## the source directory. For the directory-marketplace dev flow, see the
## gitignored symlink created by `link-dev`.
build:
	cargo build --release --manifest-path src-tauri/Cargo.toml
	chmod +x $(BINARY_SRC)

## Copy binary, skills, plugin manifest, and bootstrap payload to the
## plugin cache. Marketplace users land at the same layout via
## /plugin install; the SessionStart hook in plugin.json runs the
## bootstrap script from the cache to fetch the right binary on
## first session and to install the GNOME helper / .desktop on Linux.
install: $(BINARY_SRC)
	@echo "Syncing binary to plugin cache..."
	mkdir -p $(PLUGIN_CACHE)/skills/play $(PLUGIN_CACHE)/skills/stop $(PLUGIN_CACHE)/scripts $(PLUGIN_CACHE)/gnome-extension/schemas $(PLUGIN_CACHE)/linux $(PLUGIN_CACHE)/src-tauri/icons $(PLUGIN_CACHE)/.claude-plugin
	cp $(BINARY_SRC) $(BINARY_DST)
	chmod +x $(BINARY_DST)
	@echo "Syncing skills + plugin manifest to plugin cache..."
	cp skills/play/SKILL.md $(PLUGIN_CACHE)/skills/play/SKILL.md
	cp skills/stop/SKILL.md $(PLUGIN_CACHE)/skills/stop/SKILL.md
	cp .claude-plugin/plugin.json $(PLUGIN_CACHE)/.claude-plugin/plugin.json
	@echo "Syncing bootstrap script + Linux assets to plugin cache..."
	cp scripts/bootstrap.sh $(PLUGIN_CACHE)/scripts/bootstrap.sh
	cp scripts/bootstrap.ps1 $(PLUGIN_CACHE)/scripts/bootstrap.ps1
	chmod +x $(PLUGIN_CACHE)/scripts/bootstrap.sh
	rm -f $(PLUGIN_CACHE)/scripts/bootstrap.cjs $(PLUGIN_CACHE)/scripts/bootstrap.js
	cp gnome-extension/extension.js $(PLUGIN_CACHE)/gnome-extension/extension.js
	cp gnome-extension/metadata.json $(PLUGIN_CACHE)/gnome-extension/metadata.json
	cp gnome-extension/schemas/*.gschema.xml $(PLUGIN_CACHE)/gnome-extension/schemas/
	cp linux/stick-around.desktop $(PLUGIN_CACHE)/linux/stick-around.desktop
	cp src-tauri/icons/icon.png $(PLUGIN_CACHE)/src-tauri/icons/icon.png
	@echo "Done. Restart Claude Code to pick up skill changes."

## Symlink the built binary at repo root so directory-marketplace dev
## installs (where CLAUDE_PLUGIN_ROOT is the source repo) can resolve
## ${CLAUDE_PLUGIN_ROOT}/stick-around. The path is gitignored.
link-dev:
	ln -sf $(BINARY_SRC) stick-around$(EXE)

## Build and install in one step
dev: build install link-dev

## Run unit tests
test:
	npx vitest run

## Run linter
lint:
	npx eslint src/

## Install the GNOME Shell helper extension into the user's local
## extensions directory. Linux only. Requires a Shell restart
## (log out / log in on Wayland; Alt+F2 r on X11) and a one-time
## `gnome-extensions enable $(GNOME_EXTENSION_UUID)`.
install-extension:
	mkdir -p $(GNOME_EXTENSION_DIR)/schemas
	cp gnome-extension/extension.js $(GNOME_EXTENSION_DIR)/extension.js
	cp gnome-extension/metadata.json $(GNOME_EXTENSION_DIR)/metadata.json
	cp gnome-extension/schemas/*.gschema.xml $(GNOME_EXTENSION_DIR)/schemas/
	glib-compile-schemas $(GNOME_EXTENSION_DIR)/schemas/
	@echo ""
	@echo "Extension installed at $(GNOME_EXTENSION_DIR)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Restart GNOME Shell:"
	@echo "       Wayland: log out and log back in"
	@echo "       X11:     Alt+F2, type 'r', press Enter"
	@echo "  2. Enable the extension:"
	@echo "       gnome-extensions enable $(GNOME_EXTENSION_UUID)"

uninstall-extension:
	gnome-extensions disable $(GNOME_EXTENSION_UUID) || true
	rm -rf $(GNOME_EXTENSION_DIR)
	@echo "Extension removed. Restart GNOME Shell to fully unload."

## Install a .desktop entry plus a 512px copy of the bundled icon under
## ~/.local/share so GNOME shows the stick-figure art in the dock and
## alt-tab thumbnails. Without this, GTK falls back to a generic
## placeholder because Wayland looks up the running window's app_id in
## the .desktop database to find an Icon=. Linux only.
##
## Substitutes @EXEC@ with the absolute path to the installed binary.
## Required: glib's GDesktopAppInfo loader runs `g_find_program_in_path`
## on the Exec= argv[0] and rejects the file (returning NULL) if the
## binary isn't in PATH. A bare `Exec=stick-around` makes the .desktop
## invisible to GNOME Shell's app system, breaking icon matching.
install-desktop: $(BINARY_DST)
	mkdir -p $(DESKTOP_FILE_DIR) $(DESKTOP_ICON_DIR)
	sed "s|@EXEC@|$(BINARY_DST)|" linux/stick-around.desktop > $(DESKTOP_FILE_DIR)/stick-around.desktop
	cp src-tauri/icons/icon.png $(DESKTOP_ICON_DIR)/stick-around.png
	@echo "Installed stick-around.desktop and icon under ~/.local/share."

uninstall-desktop:
	rm -f $(DESKTOP_FILE_DIR)/stick-around.desktop
	rm -f $(DESKTOP_ICON_DIR)/stick-around.png
	@echo "Removed .desktop entry and icon."

## Cut a release: bump plugin.json, commit, tag.
##
## Usage: make release V=YYYY.MM.DD     (e.g. V=2026.04.29)
##
## The version string MUST be zero-padded calver (YYYY.MM.DD) because
## Claude Code currently compares plugin versions lexicographically, not
## as semver — without leading zeros, "2026.4.29" sorts after
## "2026.4.5" and update detection breaks. The bootstrap URL is built
## from this field as releases/download/v$(V)/..., so plugin.json,
## the git tag, and the GitHub Release asset path stay aligned.
##
## Push is intentionally NOT automatic so the commit + tag can be
## reviewed locally before they go public; copy the printed command
## to publish.
release:
	@test -n "$(V)" || { echo "usage: make release V=YYYY.MM.DD"; exit 1; }
	@echo "$(V)" | grep -Eq '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$$' || { \
		echo "version $(V) must match YYYY.MM.DD with zero-padded month/day"; \
		echo "(Claude Code uses lexicographic comparison — see issue #16705)"; \
		exit 1; \
	}
	@test -z "$$(git status --porcelain)" || { echo "working tree dirty — commit or stash first"; exit 1; }
	@if git rev-parse --verify --quiet "v$(V)" >/dev/null; then \
		echo "tag v$(V) already exists"; exit 1; \
	fi
	sed -i.bak 's/"version"[[:space:]]*:[[:space:]]*"[^"]*"/"version": "$(V)"/' .claude-plugin/plugin.json
	rm -f .claude-plugin/plugin.json.bak
	git add .claude-plugin/plugin.json
	git commit -m "chore: release v$(V)"
	git tag "v$(V)"
	@echo ""
	@echo "Tagged v$(V). To publish:"
	@echo "  git push origin $$(git branch --show-current) v$(V)"

## Remove the release build artifacts
clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
