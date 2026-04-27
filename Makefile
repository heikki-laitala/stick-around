ifeq ($(OS),Windows_NT)
EXE := .exe
else
EXE :=
endif

PLUGIN_CACHE := $(HOME)/.claude/plugins/cache/stick-around/stick-around/1.0.0
BINARY_SRC   := stick-around$(EXE)
BINARY_DST   := $(PLUGIN_CACHE)/stick-around$(EXE)

GNOME_EXTENSION_UUID := stick-around@stickaround.dev
GNOME_EXTENSION_DIR  := $(HOME)/.local/share/gnome-shell/extensions/$(GNOME_EXTENSION_UUID)

.PHONY: build install dev clean test lint install-extension uninstall-extension

## Build the Tauri overlay binary (release mode)
build:
	cargo build --release --manifest-path src-tauri/Cargo.toml
	cp src-tauri/target/release/stick-around$(EXE) ./stick-around$(EXE)
	chmod +x ./stick-around$(EXE)

## Copy binary and skills to the plugin cache
install: $(BINARY_SRC)
	@echo "Syncing binary to plugin cache..."
	mkdir -p $(PLUGIN_CACHE)/skills/play $(PLUGIN_CACHE)/skills/stop
	cp $(BINARY_SRC) $(BINARY_DST)
	chmod +x $(BINARY_DST)
	@echo "Syncing skills to plugin cache..."
	cp skills/play/SKILL.md $(PLUGIN_CACHE)/skills/play/SKILL.md
	cp skills/stop/SKILL.md $(PLUGIN_CACHE)/skills/stop/SKILL.md
	@echo "Done. Restart Claude Code to pick up skill changes."

## Build and install in one step
dev: build install

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
	mkdir -p $(GNOME_EXTENSION_DIR)
	cp gnome-extension/extension.js $(GNOME_EXTENSION_DIR)/extension.js
	cp gnome-extension/metadata.json $(GNOME_EXTENSION_DIR)/metadata.json
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

## Remove the release build artifacts
clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
