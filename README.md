<p align="center">
  <img src="src-tauri/icons/icon.png" width="140" alt="Stick Around icon" />
</p>

<h1 align="center">Stick Around</h1>

<p align="center">
  <strong>A tiny RPG that lives on top of your terminal.</strong>
</p>

<p align="center">
  <a href="https://github.com/heikki-laitala/stick-around/actions/workflows/ci.yml"><img src="https://github.com/heikki-laitala/stick-around/actions/workflows/ci.yml/badge.svg" alt="ci" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20arm64%20%7C%20Windows%20%7C%20Linux%20(GNOME)-lightgrey.svg" alt="platform: macOS arm64 | Windows | Linux (GNOME)" />
</p>

<p align="center">
  <img src="gameplay.gif" alt="Gameplay demo" />
</p>

Your next Claude Code task is going to take ninety seconds. You could
watch the spinner. Or — hear us out — you could take control of a
wizard-hat stick hero, swing a grappling rope off a `npm install` line,
mine a glowing mana crystal out of the ceiling, zap lightning at a
falling meteor, and earn titles on the way.

Stick Around is an overlay RPG for iTerm2, Terminal.app, and Windows
Terminal. Your terrain is your terminal: every line of output is solid
ground you can run, jump, and rope-swing across. When Claude streams new
output, the world rearranges itself underneath you. You adapt — cast a
shield, mine a crystal, push on to the next mission — or you fall into
the void and respawn at the start.

## Features

- **Platforms made from your terminal.** Every log line is a platform.
  Run across diffs. Stand on prompts. Surf a streaming build log.
- **Rope, spells, and an axe.** Swing a grappling rope off ceilings.
  Mine mana crystals. Hold lightning to aim, release to fire. Raise a
  shield when the world turns hostile.
- **Five missions.** Collect glowing balls → mine crystals → escape
  rising lava → survive a meteor shower → fight through a pitch-black
  level with only a flashlight.
- **Give up whenever.** `Esc` hands focus back to the terminal and the
  stick man carries on without you. `Shift+click` to take over again.
- **Zero impact on Claude.** The game runs in its own process. You are
  not slowing the spinner down. You are just refusing to be bored by it.

## Requirements

**macOS** (Apple Silicon, arm64):

- **iTerm2 or Terminal.app** as the host terminal. Intel Macs aren't
  built yet.
- **Accessibility permission** — the first launch will prompt you to
  grant the binary access under *System Settings → Privacy & Security →
  Accessibility*. Without it the overlay can't read the terminal content
  and will exit.

**Windows** (Windows 10 / 11):

- The overlay reads terminal text via UI Automation's `TextPattern`.
  Tested with **PowerShell** — that's the shell that's been put through
  real use. Any host that exposes `TextPattern` (Windows Terminal,
  modern conhost / console, VS Code's integrated terminal) should work,
  but combinations beyond PowerShell are unverified. Legacy hosts
  without UIA text support aren't supported.
- No special permission grant is required.

**Linux** (GNOME / Wayland):

- **GNOME Shell** (Wayland session) on Mutter 45+. Tested on Ubuntu 25.10
  with Ptyxis. Other VTE-based terminals (GNOME Terminal, kgx) and any
  terminal that exposes a `role=terminal` AT-SPI accessible should work,
  but only Ptyxis has been put through real use. Non-GNOME compositors
  aren't supported — Wayland's security model means the overlay needs
  the GNOME Shell helper extension to track terminal windows, register
  the activation shortcut, and bypass `XGrabKey`.
- **GNOME helper extension** must be installed and enabled. Build from
  source and run `make install-extension` (Wayland reload requires
  log out / log back in), then `gnome-extensions enable
  stick-around@stickaround.dev`.
- **Dock icon** — run `make install-desktop` once to drop a
  `stick-around.desktop` plus a 512 px icon under `~/.local/share` so
  the dock matches the running window's `wm_class` to the bundled art
  instead of a generic placeholder.
- No accessibility permission prompt — Linux uses AT-SPI, which is
  available without a per-app grant on most distros (Ubuntu defaults
  `org.gnome.desktop.interface.toolkit-accessibility` to `false` but
  GTK4 apps like Ptyxis still expose their text widget).

## Install

With Claude Code:

```
/plugin marketplace add heikki-laitala/stick-around
/plugin install stick-around@stick-around
```

Then from inside Claude Code:

```
/stick-around:play
```

### What happens on first launch

`/plugin install` only mirrors the source tree, so the binary itself
needs to be fetched separately. A `SessionStart` hook bundled with the
plugin (`scripts/bootstrap.cjs`) handles that automatically:

- Reads the version from `.claude-plugin/plugin.json`.
- Downloads the matching prebuilt binary from the GitHub release
  (`stick-around-{linux-x86_64,macos-arm64,windows-x86_64}.{tar.gz,zip}`)
  and verifies the sha256 sidecar.
- On Linux additionally installs the GNOME Shell helper extension,
  the `.desktop` entry, and a 512px dock icon.

The hook runs on every Claude Code session start but is idempotent
and short-circuits when everything is up to date — first session
after install / update is the only slow one.

### Per-platform follow-ups

- **macOS**: the first run prompts for Accessibility permission
  (*System Settings → Privacy & Security → Accessibility*). Grant it
  and re-run `/stick-around:play`.
- **Linux (GNOME / Wayland)**: log out and log back in once after the
  first install — Mutter only loads helper extensions on shell start,
  so the activation keybinding (`Super+Shift+G`) doesn't work until
  the session restarts.
- **Windows**: nothing additional.

### Upgrading

Run `/plugin update stick-around@stick-around` from inside Claude
Code. The next session start triggers the hook, which detects the
new version, downloads the matching release artifact, and refreshes
any platform-specific files. On Linux that means a freshly
re-templated `.desktop` (so the dock points at the new cache path)
and, if the helper extension code changed, another log-out / log-in
to load the new version.

## Taking and releasing focus

The overlay floats above the terminal and only grabs your keyboard when
it has focus. You toggle between the two:

- **Shift + click** anywhere on the overlay — grabs focus so keys go to
  the game. *macOS / Windows only* — Wayland blocks global click
  monitoring from clients, so on Linux click-to-focus works only when
  you click directly on the HUD strip.
- **Cmd/Win/Super + Shift + G** — same thing, without the mouse. (Cmd
  on macOS, Windows key on Windows, Super on Linux. The Linux binding
  is owned by the GNOME helper extension via Mutter, so it works on
  Wayland where the macOS/Windows `XGrabKey` path is rejected.)
- **Esc** — releases focus back to the terminal so you can keep typing.
  The stick man carries on; he just stops listening to your keys until
  you grab focus again.

## Quitting

- Click the **✕** button in the top-right of the HUD, or
- Press **Q** while the overlay has focus.

## Movement

| Key               | Action            |
| ----------------- | ----------------- |
| `A` / `D`         | Walk left / right |
| `W` / `Space`     | Jump              |
| `S`               | Drop through a thin platform |
| `C`               | Toggle prone (lie flat)      |

Arrow keys are reserved for **aiming** — they don't walk the stick
man. Use `A` / `D` for that.

## Rope

The rope is your main way across gaps and up to higher platforms.

1. **Aim** — press `E`. A dotted aim line appears; sweep it with
   `←` / `→` to pick an angle.
2. **Fire** — release `E`. The rope flies out. If it sticks to a ceiling
   or ledge you start swinging from it.
3. **While swinging**:
   - `A` / `D` (or `←` / `→`) pump the swing left or right.
   - `W` / `↑` climb up the rope, `S` / `↓` climb down.
   - Press `E` again to let go — you keep the swing's velocity, so
     timing the release is how you launch across long gaps.

## Spells

You carry a spellbook. Cycle through spells with `X`, cast with `Z`.

- **Shield** — press `Z` to raise it, press `Z` again to drop it. Blocks
  damage while up, but drains mana continuously.
- **Lightning** — *hold* `Z` to aim (sweep with arrow keys), *release*
  `Z` to fire. Costs 2 mana per bolt.

Mana doesn't regenerate on its own — mine mana crystals with `F` to refill.

## Tools and HUD

| Key     | Action                                |
| ------- | ------------------------------------- |
| `F`     | Swing axe — breaks crystals and thin ceilings |
| `Tab`   | Cycle inventory slot                  |
| `R`     | Restart the current mission           |

## Missions

The game runs a short progression. Each mission reseeds the world and
sets an objective shown in the HUD:

1. **Collect 5 glowing balls** — warm-up run across the rooftops.
2. **Collect 4 mana crystals** — use `F` to mine them.
3. **Escape the lava** — keep moving up before the floor catches you.
4. **Meteor shower** — dodge falling rocks; you spawn at a safe point
   when it starts.
5. **Alone in the dark** — the world goes black and you carry a
   flashlight. Sweep its beam with the arrow keys, and press `↑` to
   burn a collected ball into battery charge when the light fades.

`R` restarts just the current mission if you get stuck.

## Development

```bash
make dev                 # build the Tauri binary and install into the plugin cache
make test                # vitest
make lint                # eslint
make install-extension   # Linux: install GNOME helper, requires Wayland session restart
make install-desktop     # Linux: install .desktop entry + dock icon
```

The Rust backend lives in `src-tauri/`; the canvas game code is in `src/`.
`make dev` is the round-trip — it rebuilds the binary and copies it to the
plugin cache used by the `/stick-around:play` skill, so a relaunch picks up
the new build.

The Linux GNOME extension lives in `gnome-extension/`. It exposes window
tracking, geometry control, and the activation keybinding over D-Bus
because Wayland's security model blocks regular clients from doing those
things directly.

Version strings are stamped at build time from `build.rs` (`v<YYYY.MM.DD>`)
and exposed to the frontend via the `get_version` Tauri command.

## License

[MIT](./LICENSE) © Heikki Laitala
