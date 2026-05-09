# Windows install helper for `make dev`.
#
# The Makefile's install recipe is written for Unix (mkdir -p / cp / rm -f /
# chmod / ln -sf). When `make` runs from PowerShell, $HOME is unset and make
# falls back to cmd.exe which does not understand those flags. Rather than
# translate every line into cmd-portable syntax, the Windows branch of the
# Makefile delegates the whole install to this script so it runs natively
# in PowerShell regardless of which terminal launched make.

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$pluginJson = Get-Content (Join-Path $root '.claude-plugin/plugin.json') -Raw | ConvertFrom-Json
$version = $pluginJson.version
if (-not $version) { throw "could not read version from plugin.json" }

$cache = Join-Path $env:USERPROFILE ".claude/plugins/cache/stick-around/stick-around/$version"
$binarySrc = Join-Path $root 'src-tauri/target/release/stick-around.exe'
$binaryDst = Join-Path $cache 'stick-around.exe'

function Copy-File($src, $dst) {
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Copy-Item -Force $src $dst
}

Write-Host "Syncing binary to plugin cache..."
Copy-File $binarySrc $binaryDst

Write-Host "Syncing skills + plugin manifest to plugin cache..."
Copy-File (Join-Path $root 'skills/play/SKILL.md') (Join-Path $cache 'skills/play/SKILL.md')
Copy-File (Join-Path $root 'skills/stop/SKILL.md') (Join-Path $cache 'skills/stop/SKILL.md')
Copy-File (Join-Path $root '.claude-plugin/plugin.json') (Join-Path $cache '.claude-plugin/plugin.json')

Write-Host "Syncing bootstrap scripts to plugin cache..."
Copy-File (Join-Path $root 'scripts/bootstrap.sh') (Join-Path $cache 'scripts/bootstrap.sh')
Copy-File (Join-Path $root 'scripts/bootstrap.ps1') (Join-Path $cache 'scripts/bootstrap.ps1')
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cache 'scripts/bootstrap.cjs')
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $cache 'scripts/bootstrap.js')

# link-dev equivalent: a real symlink needs admin or Developer Mode, so just
# refresh a copy at the repo root. `make dev` re-runs this on every build,
# so the copy stays in sync with the latest cargo output.
Copy-Item -Force $binarySrc (Join-Path $root 'stick-around.exe')

Write-Host "Done. Restart Claude Code to pick up skill changes."
