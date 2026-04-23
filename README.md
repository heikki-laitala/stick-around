<p align="center">
  <img src="src-tauri/icons/icon.png" width="140" alt="Stick Around icon" />
</p>

<h1 align="center">Stick Around</h1>

<p align="center">
  <strong>Your terminal is a platformer now.</strong>
</p>

<p align="center">
  <a href="https://github.com/heikki-laitala/stick-around/actions/workflows/ci.yml"><img src="https://github.com/heikki-laitala/stick-around/actions/workflows/ci.yml/badge.svg" alt="ci" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20arm64-lightgrey.svg" alt="platform: macOS arm64" />
</p>

<p align="center">
  <img src="gameplay.gif" alt="Gameplay demo" />
</p>

Your next Claude Code task is going to take ninety seconds. You could
watch the spinner. Or — hear us out — you could take control of a
wizard-hat stick man, jump across platforms made of *your own log
output*, fire a grappling rope off an `npm install` line, mine a glowing
mana crystal out of the ceiling, and zap lightning at a falling meteor.

Stick Around is an overlay game for iTerm2 and Terminal.app. It reads
your terminal contents in real time and turns every line of output into
solid ground. When Claude streams new output, the floor rearranges
under your feet. You adapt. Or you fall into the void and get sent back
to spawn.

## Features

- 🧱 **Platforms made from your terminal.** Every log line is a platform.
  Run across diffs. Stand on prompts. Surf a streaming build log.
- 🧙 **Rope, spells, and an axe.** Swing a grappling rope off ceilings.
  Mine mana crystals. Hold lightning to aim, release to fire. Raise a
  shield when the world turns hostile.
- 🎯 **Five missions.** Collect glowing balls → mine crystals → escape
  rising lava → survive a meteor shower → fight through a pitch-black
  level with only a flashlight.
- 🏃 **Give up whenever.** `Esc` hands focus back to the terminal and
  the stick man carries on without you. `Shift+click` to take over
  again.
- 🆓 **Zero impact on Claude.** The game runs in its own process. You
  are not slowing the spinner down. You are just refusing to be bored
  by it.

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

## Taking and releasing focus

The overlay floats above the terminal and only grabs your keyboard when
it has focus. You toggle between the two:

- **Shift + click** anywhere on the overlay — grabs focus so keys go to
  the game.
- **Cmd + Shift + G** — same thing, without the mouse.
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
