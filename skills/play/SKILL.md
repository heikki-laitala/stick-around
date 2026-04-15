---
description: Launch a stick man overlay game on top of your terminal. Move with WASD/arrows, jump with W/Space. Press Q to quit.
disable-model-invocation: true
allowed-tools: Bash
---

Launch the stick man overlay game by running:

```bash
STICK_TERMINAL_APP=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true') \
"${CLAUDE_PLUGIN_ROOT}/stick-around" &
STICK_PID=$!
sleep 0.5
if kill -0 "$STICK_PID" 2>/dev/null; then
  echo "STICK_AROUND_RUNNING pid=$STICK_PID"
else
  echo "STICK_AROUND_FAILED"
fi
```

Do NOT use `run_in_background` for this command — the script already backgrounds the game process and returns quickly with a status check. Running it in the foreground ensures you see the output.

If the output contains `STICK_AROUND_RUNNING`, tell the user: "Stick Around is running! A stick man is now walking on your screen. Controls: WASD/Arrow keys to move, Space/W to jump, Escape to quit." Note: the game continues running as a separate process even after the command finishes.

If the output contains `STICK_AROUND_FAILED`, or the binary is not found, tell the user to rebuild it by running `npm run build` in the plugin directory.
