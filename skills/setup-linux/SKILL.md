---
description: One-time Linux/Wayland setup for Stick Around. Installs the GNOME Shell helper extension, the .desktop entry, and the dock icon from the plugin cache. Wayland session restart required afterwards. Linux only.
disable-model-invocation: true
allowed-tools: Bash
---

Run the bundled setup script:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-linux.sh"
```

If the script printed `Stick Around setup complete.`, tell the user:

> Linux setup is done. Now log out and log back in so GNOME Shell loads the helper extension. Then run `/stick-around:play` and press **Super+Shift+G** (or click the HUD strip) to activate the overlay over your terminal.

If the script said `This setup is for Linux only.`, tell the user no setup is needed on their platform.

If the script failed for any other reason, report the error output and suggest the user open an issue.
