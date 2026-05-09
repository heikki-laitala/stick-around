# Windows prereq check for `make deps`.
#
# We can't auto-install Visual Studio Build Tools / Rust / Node.js, but
# we can keep `make deps` idempotent: when cargo + npm are already on
# PATH, succeed silently and let the parent Makefile continue to
# check-rust / check-node / npm install. Only bail with the manual
# install instructions when something is actually missing.
#
# This script exists because the equivalent `if command -v cargo ...`
# shell idiom only works under sh; when make is launched from
# PowerShell, recipes fall back to cmd.exe which can't parse it.

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue

if ($cargo -and $npm) {
    Write-Host "Windows dev prerequisites already on PATH (cargo + npm)."
    exit 0
}

Write-Host "Windows dev setup is manual. Install:"
if (-not $cargo) {
    Write-Host "  - Rust toolchain via rustup-init.exe from https://rustup.rs"
    Write-Host "  - Visual Studio Build Tools 2019+ with the 'Desktop development with C++' workload"
    Write-Host "    https://visualstudio.microsoft.com/downloads/"
}
if (-not $npm) {
    Write-Host "  - Node.js 20+ from https://nodejs.org"
}
Write-Host "  - WebView2 Runtime (typically pre-installed on Windows 10/11)"
Write-Host ""
Write-Host "Then re-run: make deps"
exit 1
