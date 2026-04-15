PLUGIN_CACHE := $(HOME)/.claude/plugins/cache/stick-around/stick-around/1.0.0
BINARY_SRC   := stick-around
BINARY_DST   := $(PLUGIN_CACHE)/stick-around

.PHONY: build install dev clean

## Build the Tauri overlay binary (release mode)
build:
	cargo build --release --manifest-path src-tauri/Cargo.toml
	cp src-tauri/target/release/stick-around ./stick-around
	chmod +x ./stick-around

## Copy binary and skills to the plugin cache
install: $(BINARY_SRC)
	@echo "Syncing binary to plugin cache..."
	cp $(BINARY_SRC) $(BINARY_DST)
	chmod +x $(BINARY_DST)
	@echo "Syncing skills to plugin cache..."
	cp skills/play/SKILL.md $(PLUGIN_CACHE)/skills/play/SKILL.md
	cp skills/stop/SKILL.md $(PLUGIN_CACHE)/skills/stop/SKILL.md
	@echo "Done. Restart Claude Code to pick up skill changes."

## Build and install in one step
dev: build install

## Remove the release build artifacts
clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
