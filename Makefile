ifeq ($(OS),Windows_NT)
EXE     := .exe
DEPS_OS := windows
# Plugin-version detection on Windows: spawn powershell.exe explicitly
# from $(shell ...) instead of trying to set SHELL := powershell.exe.
# GNU make's Windows port has a hardcoded shell-name allow-list (sh,
# bash, cmd, command), so SHELL := powershell.exe is silently ignored
# for recipe execution even though $(shell) and `make -p` show it set.
# Calling powershell.exe inline sidesteps that completely. We avoid
# embedded double-quote tokens (Select-String '"version":' fails with
# 'Missing expression after ','' when passed through the argv layer)
# by matching the bare word `version` and splitting on chr(34).
PLUGIN_VERSION := $(shell powershell.exe -NoProfile -Command "(Select-String version .claude-plugin/plugin.json).Line.Split([char]34)[3]")
PLUGIN_HOME    := $(USERPROFILE)
else
EXE :=
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
DEPS_OS := macos
else
DEPS_OS := linux
endif
# Derive the plugin version from plugin.json so the cache path tracks
# whatever version the manifest currently says. Hard-coding the version
# would silently desync `make dev` from real installs after a release
# bump (Claude Code keys cache dirs on this value, and bootstrap reads
# the same field to build the binary download URL).
PLUGIN_VERSION := $(shell sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .claude-plugin/plugin.json | head -n1)
PLUGIN_HOME    := $(HOME)
endif

PLUGIN_CACHE := $(PLUGIN_HOME)/.claude/plugins/cache/stick-around/stick-around/$(PLUGIN_VERSION)
BINARY_SRC   := src-tauri/target/release/stick-around$(EXE)
BINARY_DST   := $(PLUGIN_CACHE)/stick-around$(EXE)

GNOME_EXTENSION_UUID := stick-around@stickaround.dev
GNOME_EXTENSION_DIR  := $(HOME)/.local/share/gnome-shell/extensions/$(GNOME_EXTENSION_UUID)

DESKTOP_FILE_DIR := $(HOME)/.local/share/applications
DESKTOP_ICON_DIR := $(HOME)/.local/share/icons/hicolor/512x512/apps

.PHONY: build install dev link-dev clean test lint install-extension uninstall-extension install-desktop uninstall-desktop release deps deps-linux deps-macos deps-windows check-rust check-node

## One-shot dev environment setup. Detects the host OS, installs the
## platform's system build dependencies (apt on Linux, Xcode CLT on
## macOS), warns if Rust or Node aren't on PATH, and runs `npm install`.
## After this, `make dev` will build and sync the binary to the plugin
## cache so /stick-around:play picks it up. Re-running is safe:
## apt-get / xcode-select / npm install are all idempotent.
deps: deps-$(DEPS_OS) check-rust check-node
	@echo ""
	@echo "Done. Next step: make dev"

## Linux (Debian/Ubuntu) system deps. Mirrors the apt list in
## .github/workflows/ci.yml so a fresh checkout builds with the same
## libraries CI uses. Non-apt distros print a manual-install hint and
## bail; pacman/dnf wrappers can be added later if there's demand.
deps-linux:
	@if ! command -v apt-get >/dev/null 2>&1; then \
		echo "Non-Debian/Ubuntu Linux detected. Install these system packages with your distro's package manager:"; \
		echo "  build-essential pkg-config libssl-dev libgtk-3-dev"; \
		echo "  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev"; \
		echo "  librsvg2-dev libglib2.0-bin"; \
		exit 1; \
	fi
	sudo apt-get update
	sudo apt-get install -y \
		build-essential \
		pkg-config \
		libssl-dev \
		libgtk-3-dev \
		libwebkit2gtk-4.1-dev \
		libayatana-appindicator3-dev \
		librsvg2-dev \
		libglib2.0-bin

## macOS system deps. Tauri 2 on macOS only needs the Xcode Command Line
## Tools — `xcode-select --install` is a one-shot GUI prompt the first
## time and a no-op afterward. We guard with `xcode-select -p` so a
## second `make deps` doesn't re-pop the prompt.
deps-macos:
	@if xcode-select -p >/dev/null 2>&1; then \
		echo "Xcode Command Line Tools already installed."; \
	else \
		echo "Installing Xcode Command Line Tools (a system dialog will open)..."; \
		xcode-select --install || true; \
		echo "Re-run 'make deps' once the Xcode CLT installer finishes."; \
		exit 1; \
	fi

## Windows is too varied to automate cleanly — winget vs. Visual Studio
## Installer vs. manual MSVC, plus rustup-init.exe and the Node.js MSI.
## We can't auto-install, but we can keep `make deps` idempotent:
## succeed silently when cargo + npm are already on PATH, otherwise
## print targeted install pointers (only the missing pieces) and exit
## non-zero. Inline-PS through powershell.exe -Command; we re-call
## Get-Command per branch to avoid any `$` temporaries (bash would
## expand them before powershell sees them).
deps-windows:
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "\
	  if ((Get-Command cargo -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) { \
	    Write-Host 'Windows dev prerequisites already on PATH (cargo + npm).' \
	  } else { \
	    Write-Host 'Windows dev setup is manual. Install:'; \
	    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { \
	      Write-Host '  - Rust toolchain via rustup-init.exe from https://rustup.rs'; \
	      Write-Host '  - Visual Studio Build Tools 2019+ with the Desktop development with C++ workload'; \
	      Write-Host '    https://visualstudio.microsoft.com/downloads/' \
	    }; \
	    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { \
	      Write-Host '  - Node.js 20+ from https://nodejs.org' \
	    }; \
	    Write-Host '  - WebView2 Runtime (typically pre-installed on Windows 10/11)'; \
	    Write-Host ''; \
	    Write-Host 'Then re-run: make deps'; \
	    exit 1 \
	  }"

## Fail if Rust isn't on PATH so `make deps` doesn't claim success and
## then leave `make dev` to die with a confusing 'cargo: command not
## found'. We don't auto-install rustup because the recommended path
## is a curl-pipe from sh.rustup.rs, which the user should run
## interactively.
check-rust:
ifeq ($(OS),Windows_NT)
	powershell.exe -NoProfile -Command "\
	  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { \
	    Write-Host 'ERROR: cargo not found. Install Rust via rustup-init.exe from https://rustup.rs, then re-run make deps.'; \
	    exit 1 \
	  }"
else
	@if ! command -v cargo >/dev/null 2>&1; then \
		echo "ERROR: cargo not found. Install Rust via:"; \
		echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; \
		echo "Then re-run 'make deps'."; \
		exit 1; \
	fi
endif

## Verify Node + npm and pull JS dev dependencies (vitest, eslint, the
## Tauri CLI). Splitting this from the system-deps target keeps each
## piece individually re-runnable.
check-node:
ifeq ($(OS),Windows_NT)
	powershell.exe -NoProfile -Command "\
	  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { \
	    Write-Host 'ERROR: npm not found. Install Node.js 20+ from https://nodejs.org, then re-run make deps.'; \
	    exit 1 \
	  }"
	npm install
else
	@if ! command -v npm >/dev/null 2>&1; then \
		echo "ERROR: npm not found. Install Node.js 20+ from https://nodejs.org or your package manager, then re-run 'make deps'."; \
		exit 1; \
	fi
	npm install
endif

## Build the Tauri overlay binary (release mode). The binary stays under
## src-tauri/target/release; we don't copy it to the repo root because a
## binary at the marketplace root would clobber the plugin install path
## (cache/<marketplace>/<plugin>/<version>/) when /plugin install mirrors
## the source directory. For the directory-marketplace dev flow, see the
## gitignored symlink created by `link-dev`.
build:
	cargo build --release --manifest-path src-tauri/Cargo.toml
ifneq ($(OS),Windows_NT)
	chmod +x $(BINARY_SRC)
endif

## Copy binary, skills, plugin manifest, and bootstrap payload to the
## plugin cache. Marketplace users land at the same layout via
## /plugin install; the SessionStart hook in plugin.json runs the
## bootstrap script from the cache to fetch the right binary on
## first session and to install the GNOME helper / .desktop on Linux.
##
## Windows: one powershell.exe -Command invocation runs the whole
## recipe (joined via `\` continuations) so a Copy-Item failure aborts
## the install instead of leaving a half-synced cache. Avoids any `$`
## tokens in the inline PS — bash would expand them as shell variables
## before powershell.exe even sees them — by adding -ErrorAction Stop
## per cmdlet rather than setting $ErrorActionPreference. The trailing
## Copy-Item to repo root stands in for the link-dev symlink (a real
## symlink needs admin / Developer Mode).
install: $(BINARY_SRC)
ifeq ($(OS),Windows_NT)
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "\
	  Write-Host 'Syncing binary to plugin cache...'; \
	  New-Item -ItemType Directory -Force -ErrorAction Stop -Path '$(PLUGIN_CACHE)','$(PLUGIN_CACHE)/skills/play','$(PLUGIN_CACHE)/skills/stop','$(PLUGIN_CACHE)/scripts','$(PLUGIN_CACHE)/.claude-plugin' | Out-Null; \
	  Copy-Item -Force -ErrorAction Stop '$(BINARY_SRC)' '$(BINARY_DST)'; \
	  Write-Host 'Syncing skills + plugin manifest to plugin cache...'; \
	  Copy-Item -Force -ErrorAction Stop 'skills/play/SKILL.md' '$(PLUGIN_CACHE)/skills/play/SKILL.md'; \
	  Copy-Item -Force -ErrorAction Stop 'skills/stop/SKILL.md' '$(PLUGIN_CACHE)/skills/stop/SKILL.md'; \
	  Copy-Item -Force -ErrorAction Stop '.claude-plugin/plugin.json' '$(PLUGIN_CACHE)/.claude-plugin/plugin.json'; \
	  Write-Host 'Syncing bootstrap scripts to plugin cache...'; \
	  Copy-Item -Force -ErrorAction Stop 'scripts/bootstrap.sh' '$(PLUGIN_CACHE)/scripts/bootstrap.sh'; \
	  Copy-Item -Force -ErrorAction Stop 'scripts/bootstrap.ps1' '$(PLUGIN_CACHE)/scripts/bootstrap.ps1'; \
	  Remove-Item -Force -ErrorAction SilentlyContinue '$(PLUGIN_CACHE)/scripts/bootstrap.cjs','$(PLUGIN_CACHE)/scripts/bootstrap.js'; \
	  Copy-Item -Force -ErrorAction Stop '$(BINARY_SRC)' 'stick-around$(EXE)'; \
	  Write-Host 'Done. Restart Claude Code to pick up skill changes.'"
else
	@echo "Syncing binary to plugin cache..."
	mkdir -p $(PLUGIN_CACHE)/skills/play $(PLUGIN_CACHE)/skills/stop $(PLUGIN_CACHE)/scripts $(PLUGIN_CACHE)/.claude-plugin
	cp $(BINARY_SRC) $(BINARY_DST)
	chmod +x $(BINARY_DST)
	@echo "Syncing skills + plugin manifest to plugin cache..."
	cp skills/play/SKILL.md $(PLUGIN_CACHE)/skills/play/SKILL.md
	cp skills/stop/SKILL.md $(PLUGIN_CACHE)/skills/stop/SKILL.md
	cp .claude-plugin/plugin.json $(PLUGIN_CACHE)/.claude-plugin/plugin.json
	@echo "Syncing bootstrap scripts to plugin cache..."
	cp scripts/bootstrap.sh $(PLUGIN_CACHE)/scripts/bootstrap.sh
	cp scripts/bootstrap.ps1 $(PLUGIN_CACHE)/scripts/bootstrap.ps1
	chmod +x $(PLUGIN_CACHE)/scripts/bootstrap.sh
	rm -f $(PLUGIN_CACHE)/scripts/bootstrap.cjs $(PLUGIN_CACHE)/scripts/bootstrap.js
ifeq ($(DEPS_OS),linux)
	@echo "Syncing Linux assets (GNOME extension + .desktop) to plugin cache..."
	mkdir -p $(PLUGIN_CACHE)/gnome-extension/schemas $(PLUGIN_CACHE)/linux $(PLUGIN_CACHE)/src-tauri/icons
	cp gnome-extension/extension.js $(PLUGIN_CACHE)/gnome-extension/extension.js
	cp gnome-extension/metadata.json $(PLUGIN_CACHE)/gnome-extension/metadata.json
	cp gnome-extension/schemas/*.gschema.xml $(PLUGIN_CACHE)/gnome-extension/schemas/
	cp linux/stick-around.desktop $(PLUGIN_CACHE)/linux/stick-around.desktop
	cp src-tauri/icons/icon.png $(PLUGIN_CACHE)/src-tauri/icons/icon.png
endif
	@echo "Done. Restart Claude Code to pick up skill changes."
endif

## Symlink the built binary at repo root so directory-marketplace dev
## installs (where CLAUDE_PLUGIN_ROOT is the source repo) can resolve
## ${CLAUDE_PLUGIN_ROOT}/stick-around. The path is gitignored.
##
## On Windows the install recipe already refreshes a copy at the repo
## root (real symlinks require admin / Developer Mode), so this target
## is a no-op there.
link-dev:
ifneq ($(OS),Windows_NT)
	ln -sf $(BINARY_SRC) stick-around$(EXE)
endif

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
