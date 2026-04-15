---
description: Launch a stick man overlay game on top of your terminal. Move with WASD/arrows, jump with W/Space. Press Q to quit.
disable-model-invocation: true
allowed-tools: Bash
---

Launch the stick man overlay game by running:

```bash
STICK_TERMINAL_APP=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true') \
"${CLAUDE_PLUGIN_ROOT}/src-tauri/target/release/stick-around-overlay"
```

This command runs in the foreground. The user can press Ctrl+C to stop the game. Tell the user: "Stick Around is running! A stick man is now walking on your screen. Controls: WASD/Arrow keys to move, Space/W to jump, Ctrl+C to quit."

If the binary is not found, tell the user to rebuild it by running `npm run build` in the plugin directory.
