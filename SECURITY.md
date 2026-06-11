# Security Policy

## Supported versions

Stick Around ships as a versioned plugin. Only the latest release — the
version in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) —
receives security fixes.

## Reporting a vulnerability

Please report security issues privately rather than opening a public
issue. Use GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Include the affected version, reproduction steps, and impact.

Expect an initial response within a few days. Once a fix ships, you'll
be credited in the release notes unless you ask to remain anonymous.

## How the binary is distributed

The plugin does not bundle a binary. On Claude Code `SessionStart`, the
bootstrap script (`scripts/bootstrap.sh` / `scripts/bootstrap.ps1`)
downloads the prebuilt binary for your platform from this repository's
GitHub release matching the manifest version, then verifies it against
a published SHA-256 checksum before installing it. A checksum mismatch
aborts the install.

Binaries are built and published only by the release workflow
([`.github/workflows/release.yml`](.github/workflows/release.yml)) from
tagged commits. If you would rather not run a downloaded binary, build
it yourself with `make dev` — see [CONTRIBUTING.md](CONTRIBUTING.md).
