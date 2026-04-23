# Stick Around

A tiny stick-man overlay game for Claude Code. While Claude is busy chewing
through a task, a stick man wanders across the top of your terminal — you
can take over, run across log lines, mine mana crystals, throw lightning,
and work through the mission progression instead of staring at a spinner.

<p align="center">
  <img src="src-tauri/icons/icon.png" width="160" alt="Stick Around icon" />
</p>

## Requirements

- **macOS on Apple Silicon (arm64)** — the overlay reads terminal contents
  through the macOS Accessibility API. Intel Macs aren't built yet.
- **iTerm2 or Terminal.app** as the host terminal.
- **Accessibility permission** — the first launch will prompt you to grant
  the binary access under *System Settings → Privacy & Security →
  Accessibility*. Without it the overlay can't read the terminal content
  and will exit.

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

On first launch, macOS will ask you to authorise the binary for
Accessibility. Grant it, then re-run `/stick-around:play`.

To close the overlay:

```
/stick-around:stop
```

## Controls

| Key                  | Action                                |
| -------------------- | ------------------------------------- |
| `A` / `D` or `←` / `→` | Move left / right                   |
| `W` / `Space`        | Jump                                  |
| `S` / `↓`            | Drop through a platform / crouch      |
| `C`                  | Toggle prone                          |
| `F`                  | Axe swing / mine                      |
| `Z`                  | Cast active spell                     |
| `X`                  | Cycle spell                           |
| `Arrows` (while aiming) | Aim flashlight / lightning         |
| `R`                  | Restart current mission               |
| `Tab`                | Cycle inventory                       |
| `Esc`                | Release overlay focus back to terminal |
| `Q`                  | Quit the game                         |

## Development

```bash
make dev      # build the Tauri binary and install into the plugin cache
make test     # vitest
make lint     # eslint
```

The Rust backend lives in `src-tauri/`; the canvas game code is in `src/`.
`make dev` is the round-trip — it rebuilds the binary and copies it to the
plugin cache used by the `/stick-around:play` skill, so a relaunch picks up
the new build.

Version strings are stamped at build time from `build.rs` (`v<YYYY.MM.DD>`)
and exposed to the frontend via the `get_version` Tauri command.

## License

[MIT](./LICENSE) © Heikki Laitala
