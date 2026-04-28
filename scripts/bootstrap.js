#!/usr/bin/env node
// Stick Around plugin bootstrap.
//
// Runs on every Claude Code SessionStart (wired in via plugin.json's
// hooks). Two jobs:
//
//  1. Fetch the matching prebuilt binary from the GitHub Release
//     tagged v<version> (where <version> comes from plugin.json) and
//     drop it at ${CLAUDE_PLUGIN_ROOT}/stick-around. Plugin install
//     only mirrors the source tree, so without this step the play
//     skill's `${CLAUDE_PLUGIN_ROOT}/stick-around` invocation has
//     nothing to run.
//
//  2. On Linux additionally install the GNOME Shell helper extension,
//     a versioned .desktop entry, and a 512px dock icon — the things
//     a plugin manifest can't register on the user's behalf.
//
// Both halves are idempotent. A version stamp file under the cache
// dir lets us short-circuit on every subsequent session start once
// the binary is already up to date. The extension install hashes its
// source against what's already on disk and only triggers a copy +
// glib-compile-schemas + a "log out / log back in" hint when the
// extension code actually changed.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = 'heikki-laitala/stick-around';
const EXTENSION_UUID = 'stick-around@stickaround.dev';

main();

function main() {
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;

    // Skip when running from a source-tree directory marketplace —
    // `make dev`'s link-dev symlink owns binary delivery there, and
    // we don't want to clobber a developer's local build with a
    // download.
    if (!root.includes(path.join('.claude', 'plugins', 'cache'))) return;

    const targets = pickTargets();
    if (!targets) {
        // Unsupported platform — fail silently. Play skill will surface
        // "binary not found" if the user actually tries to run.
        return;
    }

    const manifestPath = path.join(root, '.claude-plugin', 'plugin.json');
    let version;
    try {
        version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
    } catch (err) {
        console.error(`[stick-around] could not read ${manifestPath}: ${err.message}`);
        return;
    }
    if (!version) return;

    const binaryPath = path.join(root, targets.binaryName);
    const stampPath = path.join(root, '.bootstrap-version');
    const stamped = fs.existsSync(stampPath)
        ? fs.readFileSync(stampPath, 'utf8').trim()
        : '';

    if (!fs.existsSync(binaryPath) || stamped !== version) {
        console.log(`[stick-around] fetching ${targets.asset} for v${version}…`);
        const url = `https://github.com/${REPO}/releases/download/v${version}/${targets.asset}`;
        if (!installBinary(url, targets.asset, root, binaryPath)) {
            console.error('[stick-around] binary install failed; play skill will not work until this is resolved.');
            return;
        }
        fs.writeFileSync(stampPath, version);
        console.log(`[stick-around] installed v${version}.`);
    }

    if (os.platform() === 'linux') {
        installLinuxExtras(root, binaryPath);
    }
}

function pickTargets() {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'linux' && arch === 'x64') {
        return { asset: 'stick-around-linux-x86_64.tar.gz', binaryName: 'stick-around' };
    }
    if (platform === 'darwin' && arch === 'arm64') {
        return { asset: 'stick-around-macos-arm64.tar.gz', binaryName: 'stick-around' };
    }
    if (platform === 'win32' && arch === 'x64') {
        return { asset: 'stick-around-windows-x86_64.zip', binaryName: 'stick-around.exe' };
    }
    return null;
}

function installBinary(url, asset, root, binaryPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stick-around-'));
    const tmp = path.join(tmpDir, asset);
    const tmpSha = `${tmp}.sha256`;
    try {
        if (!download(url, tmp)) return false;
        if (!download(`${url}.sha256`, tmpSha)) return false;
        const expected = fs.readFileSync(tmpSha, 'utf8').split(/\s+/)[0].toLowerCase();
        const actual = sha256OfFile(tmp);
        if (expected !== actual) {
            console.error(`[stick-around] sha256 mismatch (expected ${expected}, got ${actual}).`);
            return false;
        }
        // tar.exe ships with Windows 10 1803+ and handles both .tar.gz
        // and .zip — same command works on every supported platform.
        const result = spawnSync('tar', ['-xf', tmp, '-C', root], { stdio: 'inherit' });
        if (result.status !== 0) return false;
        if (os.platform() !== 'win32') {
            fs.chmodSync(binaryPath, 0o755);
        }
        return true;
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

function download(url, dest) {
    const result = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' });
    return result.status === 0;
}

function sha256OfFile(file) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    return hash.digest('hex').toLowerCase();
}

function installLinuxExtras(root, binaryPath) {
    const home = os.homedir();
    const extDir = path.join(home, '.local/share/gnome-shell/extensions', EXTENSION_UUID);
    const sourceExtPath = path.join(root, 'gnome-extension', 'extension.js');
    if (!fs.existsSync(sourceExtPath)) return;

    const sourceExt = fs.readFileSync(sourceExtPath, 'utf8');
    const installedExtPath = path.join(extDir, 'extension.js');
    const installedExt = fs.existsSync(installedExtPath)
        ? fs.readFileSync(installedExtPath, 'utf8')
        : '';
    if (sourceExt !== installedExt) {
        console.log('[stick-around] installing GNOME helper extension…');
        fs.mkdirSync(path.join(extDir, 'schemas'), { recursive: true });
        fs.copyFileSync(sourceExtPath, installedExtPath);
        fs.copyFileSync(
            path.join(root, 'gnome-extension', 'metadata.json'),
            path.join(extDir, 'metadata.json'),
        );
        const schemasSrc = path.join(root, 'gnome-extension', 'schemas');
        for (const f of fs.readdirSync(schemasSrc)) {
            if (f.endsWith('.gschema.xml')) {
                fs.copyFileSync(path.join(schemasSrc, f), path.join(extDir, 'schemas', f));
            }
        }
        spawnSync('glib-compile-schemas', [path.join(extDir, 'schemas')], { stdio: 'inherit' });
        // Pre-enable so it loads on next shell start.
        spawnSync('gnome-extensions', ['enable', EXTENSION_UUID], { stdio: 'ignore' });
        console.log('[stick-around] GNOME helper extension updated. Log out and log back in to load it.');
    }

    // .desktop entry: re-template against the current binary path so
    // /plugin update (which lands at a new cache version dir) doesn't
    // leave the dock pointing at a stale path.
    const desktopTemplate = fs.readFileSync(path.join(root, 'linux', 'stick-around.desktop'), 'utf8');
    const desktopContent = desktopTemplate.replace('@EXEC@', binaryPath);
    const desktopPath = path.join(home, '.local/share/applications', 'stick-around.desktop');
    const installedDesktop = fs.existsSync(desktopPath)
        ? fs.readFileSync(desktopPath, 'utf8')
        : '';
    if (installedDesktop !== desktopContent) {
        fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
        fs.writeFileSync(desktopPath, desktopContent);
    }

    // Icon: install once, never re-copy (image bytes don't change).
    const iconDir = path.join(home, '.local/share/icons/hicolor/512x512/apps');
    const iconPath = path.join(iconDir, 'stick-around.png');
    if (!fs.existsSync(iconPath)) {
        fs.mkdirSync(iconDir, { recursive: true });
        fs.copyFileSync(path.join(root, 'src-tauri', 'icons', 'icon.png'), iconPath);
    }
}
