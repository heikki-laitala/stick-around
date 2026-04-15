---
description: Stop the stick man overlay game.
disable-model-invocation: true
allowed-tools: Bash
---

Stop the stick man overlay by running:

```bash
if [ -f /tmp/stick-around.pid ]; then
  kill -INT "$(cat /tmp/stick-around.pid)" 2>/dev/null && rm -f /tmp/stick-around.pid
  echo "Stick Around stopped."
else
  echo "Stick Around is not running."
fi
```
