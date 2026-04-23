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

## Quitting

- Click the **✕** button in the top-right of the HUD, or
- Press **Q** at any time.

Pressing **Esc** does *not* quit — it just releases keyboard focus back
to the terminal so you can keep typing while the stick man carries on.

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

Mana regenerates slowly. Mine mana crystals (see below) to top up faster.

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
