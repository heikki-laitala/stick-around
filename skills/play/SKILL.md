---
description: Launch a stick man overlay game on top of your terminal. Move with WASD/arrows, jump with W/Space. Press Q to quit.
disable-model-invocation: true
allowed-tools: Bash
---

Launch the stick man overlay game by running:

```bash
"${CLAUDE_PLUGIN_ROOT}/overlay/src-tauri/target/release/stick-around-overlay" &
```

Tell the user: "Stick Around is running! A stick man is now walking on your screen. Controls: WASD/Arrow keys to move, Space/W to jump, Q to quit."

If the binary is not found, tell the user to rebuild it by running `cd overlay && npm run build` in the plugin directory.
