# Stick Around plugin bootstrap (PowerShell).
#
# Windows counterpart to bootstrap.sh. Same job: on every Claude Code
# SessionStart, fetch the prebuilt binary matching the manifest version
# from the GitHub release. PowerShell rewrite so users don't need Node
# on PATH — only `Invoke-WebRequest`, `Get-FileHash`, and `tar.exe`,
# all built into Windows 10 1803+ and Windows 11.
#
# Idempotent. A `.bootstrap-version` stamp under the cache dir lets us
# short-circuit on every subsequent session start once the binary is
# already up to date.

$ErrorActionPreference = 'Stop'

$Repo = 'heikki-laitala/stick-around'

# Skip when the plugin root isn't set, or when running from a
# source-tree directory marketplace — `make dev`'s link-dev symlink
# owns binary delivery there, and we don't want to clobber a
# developer's local build with a download.
$Root = $env:CLAUDE_PLUGIN_ROOT
if (-not $Root) { exit 0 }
if ($Root -notlike '*\.claude\plugins\cache*' -and $Root -notlike '*/.claude/plugins/cache*') {
    exit 0
}

# Pick a release artifact for this platform. Anything not in the
# table exits silently — the play skill will surface "binary not
# found" if the user actually tries to run.
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
    exit 0
}
$Asset = 'stick-around-windows-x86_64.zip'
$Binary = 'stick-around.exe'

$ManifestPath = Join-Path $Root '.claude-plugin/plugin.json'
if (-not (Test-Path $ManifestPath)) { exit 0 }

# Pull the version field out of plugin.json. ConvertFrom-Json ships
# with PowerShell 3+ (Windows 8+) so we don't need a regex fallback.
try {
    $Version = (Get-Content -Raw $ManifestPath | ConvertFrom-Json).version
} catch {
    exit 0
}
if (-not $Version) { exit 0 }

$BinPath = Join-Path $Root $Binary
$Stamp = Join-Path $Root '.bootstrap-version'
$Stamped = if (Test-Path $Stamp) { (Get-Content -Raw $Stamp).Trim() } else { '' }

function Install-Binary {
    $Url = "https://github.com/$Repo/releases/download/v$Version/$Asset"
    $TmpDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "stick-around-$([guid]::NewGuid().ToString('N'))")
    try {
        $Tmp = Join-Path $TmpDir $Asset
        $TmpSha = "$Tmp.sha256"

        Write-Host "[stick-around] fetching $Asset for v$Version..."
        # Disable progress UI: Invoke-WebRequest is dramatically slower
        # with the default progress bar (background blocking write to a
        # console that may not exist), and we already log our own
        # one-line "fetching..." status above.
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing -MaximumRetryCount 3 -RetryIntervalSec 2
            Invoke-WebRequest -Uri "$Url.sha256" -OutFile $TmpSha -UseBasicParsing -MaximumRetryCount 3 -RetryIntervalSec 2
        } catch {
            Write-Error "[stick-around] download failed: $_"
            return $false
        }

        # The .sha256 sidecar is `<hash>  <filename>`; first field is
        # the hash. Lowercase it for comparison since some checksum
        # tools uppercase their output.
        $Expected = ((Get-Content -Raw $TmpSha) -split '\s+')[0].ToLower()
        $Actual = (Get-FileHash -Algorithm SHA256 $Tmp).Hash.ToLower()
        if ($Expected -ne $Actual) {
            Write-Error "[stick-around] sha256 mismatch (expected $Expected, got $Actual)."
            return $false
        }

        # tar.exe handles .zip on Windows 10 1803+ — same command
        # works on every supported platform.
        & tar.exe -xf $Tmp -C $Root
        if ($LASTEXITCODE -ne 0) { return $false }
        return $true
    } finally {
        try { Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue } catch {}
    }
}

if (-not (Test-Path $BinPath) -or $Stamped -ne $Version) {
    if (Install-Binary) {
        Set-Content -Path $Stamp -Value $Version -NoNewline
        Write-Host "[stick-around] installed v$Version."
    } else {
        Write-Error "[stick-around] binary install failed; play skill will not work until this is resolved."
    }
}

exit 0
