---
description: Launch a stick man overlay game on top of your terminal. Walk with A/D, jump with W, aim and cast spells with the arrow keys. Press Shift+Q to quit.
disable-model-invocation: true
allowed-tools: Bash
---

Launch the stick man overlay game by running:

```bash
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

If the output contains `STICK_AROUND_RUNNING`, tell the user: "Stick Around is running! A stick man is now walking on your screen. Controls: A/D to walk, W to jump, C to toggle prone, hold S to drill through the platform under you; E to aim the rope (release to throw, press E again to detach mid-swing); 1 toggles the shield, hold 2 to aim lightning (release to fire), hold 3 for stasis; arrow keys ←/→ sweep aim, ↑ casts the active spell, ↓ cycles to the next spell; Q cancels any active spell; F swings the axe to mine crystals; G burns a glowing ball to recharge the flashlight in the dark mission; Shift+R restarts the current mission; Escape hands focus back to your terminal (press Ctrl+Shift+G to grab it back); Shift+Q to quit." Note: the game continues running as a separate process even after the command finishes.

If the output contains `STICK_AROUND_FAILED`, or the binary is not found, tell the user to rebuild it by running `make dev` in the plugin directory.
