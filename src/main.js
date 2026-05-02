import { IDLE, SCALE, jointWorldPos } from './poses.js';
import { ROPE_COOLDOWN, hudStripHeight, isNarrowHud } from './constants.js';
import { buildPlatforms } from './platforms.js';
import { updateMovement, updateRope, updatePose, updatePosture, resetPlayer, updateParticles, startAxeSwing, updateAxeSwing } from './physics.js';
import { updateCollectibles } from './collectibles.js';
import { updateManaMines } from './manaMines.js';
import { render, isInCloseButton, wandTip } from './render.js';
import { hudNeedsTwoRows } from './renderHud.js';
import { advanceMission, debugSkipMission, initialProgression, restartActiveMission, tickActiveMission } from './progression.js';
import {
  initialSpells, castSpell, castSpellByName, releaseCast, releaseStasis,
  adjustLightningAim, isLightningAiming, tickSpells,
} from './spells.js';
import {
  adjustFlashlightAim, AIM_SPEED as FLASH_AIM_SPEED, isAloneInDarkActive,
  spendBallForBattery,
} from './missions/aloneInDark.js';
import { IS_LINUX } from './platform-info.js';

// ── Canvas Setup ─────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// WebKit2GTK on Linux falls into a slow software path for canvas
// shadow blur. Burning ~20 ms/frame on shadow setup tanks the meteor
// shower (and any other effect-heavy mission) hard enough that the
// man's movement visibly stutters. Hot-patch the prototype so every
// render call site silently skips the blur on Linux without each
// having to know about the platform.
if (IS_LINUX) {
  const proto = CanvasRenderingContext2D.prototype;
  Object.defineProperty(proto, 'shadowBlur', {
    get() { return 0; },
    set() {},
    configurable: true,
  });
}

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
resize();
window.addEventListener('resize', resize);

const W = () => window.innerWidth;
const H = () => window.innerHeight;

// ── Game State ───────────────────────────────────────────────────────
const state = {
  gx: 200,
  feetY: H() - 16,
  gvx: 0,
  gvy: 0,
  grounded: true,
  faceR: true,
  standingHash: 0,
  walkPh: 0,
  landT: 0,
  dropThrough: 0,
  curPose: JSON.parse(JSON.stringify(IDLE)),
  hasSpawned: false,
  overlayActive: false, // true while the overlay is key/focused (user can drive the man)

  // Splash screen shown on first activation until the user dismisses it.
  splashActive: true,
  version: '',
  posture: 'standing', // 'standing' | 'crouching' | 'prone'

  // HUD
  mana: 0,
  inventory: ['bottle', 'key', 'map'],
  inventoryIdx: 0,
  ...initialSpells(),
  ...initialProgression(),
  mouseX: -1,
  mouseY: -1,
  proneRequested: false, // true when user manually toggles prone with C

  // HUD strip layout: start from the width heuristic (matches Rust's
  // initial reserve) so the first paint is consistent; the render loop
  // re-measures each frame and pushes any change to the backend so the
  // reserved strip resizes to match the content.
  hudTall: isNarrowHud(window.innerWidth),

  // Rope
  rope: null,
  ropeAngle: -3 * Math.PI / 4,
  ropeCooldown: 0,

  // Platforms & regions
  platforms: [],
  lastContent: null, // last TerminalContent payload — used to rebuild on resize
  holes: [],         // { x, y, w, age } — gaps punched through platforms
  miningProgress: [], // { hash, x, hits, age } — accumulated axe hits per ceiling block
  particles: [],     // { x, y, vx, vy, life, maxLife } — burst debris
  collectibles: [],  // { x, y, age } — items to collect
  manaMines: [],     // { x, y, hits, age, debug? } — mineable crystal nodes
  axeSwing: null,    // { t, hit } while a swing is in progress
  score: 0,
  minesMined: 0,     // number of mana mines fully depleted — drives progression
  gameOver: false,   // mission-driven fail state; movement and ticks pause while true
  promptArea: null,
  footerArea: null,
  waterArea: null,  // set by missions that flood a region (e.g. meteor shower uses footerArea)

  // Terminal metrics
  textOffsetX: 0,
  textOffsetY: 28,
  textWidth: 0,
  textHeight: 0,
  lineHeight: 16,

  // Cached prompt indices
  cachedInputIdx: null,
  cachedFooterIdx: null,

  // Debug
  DEBUG_PLATFORMS: false,
  debugAnchorX: null, // captured when DEBUG_PLATFORMS turns on — anchor for pinned mine/ball
  debugAnchorY: null,
};

// ── Fallback Platforms ───────────────────────────────────────────────
function initFallbackPlatforms() {
  state.platforms = [];
  const numLines = Math.floor(H() / state.lineHeight);
  for (let i = 0; i < numLines; i++) {
    const chars = 20 + Math.floor(Math.random() * 60);
    state.platforms.push({ y: i * state.lineHeight, x: 10, w: chars * 8.4, hash: Math.random() * 0xFFFFFF | 0 });
  }
}
initFallbackPlatforms();
window.addEventListener('resize', () => {
  // On resize, rebuild from the last known terminal content if we have any;
  // otherwise fall back to random platforms (pre-spawn only). The Rust poll
  // will push fresh geometry within ~50 ms to replace stale numbers.
  if (state.lastContent) handleTerminalContent(state.lastContent);
  else initFallbackPlatforms();
});

// ── Terminal Content from Backend ────────────────────────────────────
function handleTerminalContent(content) {
  if (!content || !Array.isArray(content.lines) || content.lines.length === 0) return;

  // Detect a terminal *resize* (as opposed to scroll/move/content change).
  // Chasing positions across a resize is unreliable — platform pixel
  // widths and character widths shift in ways that hash-based snapping
  // can't fully compensate for — so we treat a resize as a fresh scene:
  // clear the items and teleport the man back to his spawn position.
  const prev = state.lastContent;
  const resized = !!prev && (
    prev.term_cols !== content.term_cols
    || prev.term_rows !== content.term_rows
    || prev.text_width !== content.text_width
    || prev.text_height !== content.text_height
  );

  state.lastContent = content;

  // The overlay may have been resized by the Rust side (terminal resize →
  // apply_bounds → set_size) while blurred. On a non-activating panel that
  // programmatic resize doesn't always fire a DOM resize event, so the
  // canvas backing store can drift out of sync. Rerun resize() whenever
  // the window dimensions don't match the current canvas, so subsequent
  // platform/item math draws to a canvas of the correct pixel size.
  if (canvas.width !== window.innerWidth * devicePixelRatio
      || canvas.height !== window.innerHeight * devicePixelRatio) {
    resize();
  }

  // Capture the man's fractional position along his current platform
  // before we rebuild — only when it's NOT a resize; on resize we respawn.
  let manDxFrac = null;
  if (!resized && state.hasSpawned && state.grounded && state.standingHash !== 0) {
    const oldPlat = state.platforms.find((p) => p.hash === state.standingHash);
    if (oldPlat && oldPlat.w > 0) manDxFrac = (state.gx - oldPlat.x) / oldPlat.w;
  }

  // The overlay window extends `hudStripHeight` pixels above the terminal
  // to host the HUD strip (taller when the single-row layout doesn't fit,
  // so items wrap onto a second row). Shift every y-coordinate we receive
  // from the backend so platforms, the PROMPT rect, and the FOOTER rect
  // all render below the strip in the same basis.
  const hudH = hudStripHeight(state);
  const shiftRect = (r) => (r ? [r[0], r[1] + hudH, r[2], r[3]] : null);
  const adjusted = {
    ...content,
    text_offset_y: content.text_offset_y + hudH,
    prompt_rect: shiftRect(content.prompt_rect),
    footer_rect: shiftRect(content.footer_rect),
  };
  const result = buildPlatforms(adjusted, {
    cachedInputIdx: state.cachedInputIdx,
    cachedFooterIdx: state.cachedFooterIdx,
  });

  // Apply platform/region results to state
  state.platforms = result.platforms;
  state.promptArea = result.promptArea;
  state.footerArea = result.footerArea;
  state.textOffsetX = result.textOffsetX;
  state.textOffsetY = result.textOffsetY;
  state.textWidth = result.textWidth;
  state.textHeight = result.textHeight;
  state.lineHeight = result.lineHeight;
  state.cachedInputIdx = result.cachedInputIdx;
  state.cachedFooterIdx = result.cachedFooterIdx;

  // On resize, clear items so they respawn fresh on the new layout, and
  // force the spawn branch below to re-place the man on the prompt box.
  if (resized) {
    if (state.collectibles) state.collectibles.length = 0;
    if (state.manaMines) state.manaMines.length = 0;
    state.hasSpawned = false;
  }

  // Spawn man at terminal right edge, on top of prompt box
  if (!state.hasSpawned && state.promptArea && state.footerArea) {
    state.gx = state.textOffsetX + state.textWidth - 20 * SCALE - 20;
    state.feetY = state.promptArea.y;
    state.faceR = false;
    state.vy = 0;
    state.standingHash = 0;
    state.grounded = true;
    state.hasSpawned = true;
  } else if (state.hasSpawned && state.grounded && state.platforms.length > 0) {
    // Follow platform when terminal text changes (scroll, move). If we
    // captured manDxFrac above, snap both gx and feetY to preserve the
    // same relative spot on the platform — otherwise fall back to
    // vertical-only snap (e.g. for the first frame after spawn).
    let matched = null;
    if (state.standingHash !== 0) {
      matched = state.platforms.find((p) => p.hash === state.standingHash) || null;
    }
    if (matched) {
      if (manDxFrac !== null) state.gx = matched.x + manDxFrac * matched.w;
      state.feetY = matched.y;
    } else {
      let nearest = null, nearestDist = Infinity;
      for (const p of state.platforms) {
        const dist = Math.abs(p.y - state.feetY);
        if (dist < nearestDist && state.gx >= p.x - 10 && state.gx <= p.x + p.w + 10) {
          nearest = p;
          nearestDist = dist;
        }
      }
      if (nearest && nearestDist < state.lineHeight * 2) {
        state.feetY = nearest.y;
        state.standingHash = nearest.hash || 0;
      }
    }
  }

  // Snap items to their platform's new position on scroll/move (not resize
  // — we already cleared them above). Using a fractional offset keeps each
  // item on the same visual spot of its line.
  if (!resized) {
    const platByHash = new Map();
    for (const p of state.platforms) if (p.hash) platByHash.set(p.hash, p);
    const snapItem = (it) => {
      if (!it.hash) return;
      const p = platByHash.get(it.hash);
      if (!p) return;
      if (it.dxFrac != null) it.x = p.x + it.dxFrac * p.w;
      it.y = p.y;
      it.vy = 0;
      it.grounded = true;
    };
    if (state.collectibles) for (const c of state.collectibles) snapItem(c);
    if (state.manaMines) for (const m of state.manaMines) snapItem(m);
  }

  // Break rope if anchor platform gone or content changed
  if (state.rope && (state.rope.state === 'swinging' || state.rope.state === 'attached')) {
    const anchorPlat = state.platforms.find(p =>
      state.rope.hitX >= p.x && state.rope.hitX <= p.x + p.w &&
      Math.abs(state.rope.hitY - p.y) < 2
    );
    if (!anchorPlat || (state.rope.anchorHash && anchorPlat.hash !== state.rope.anchorHash)) {
      state.rope = null;
      state.grounded = false;
      state.standingHash = 0;
    }
  }
}

if (window.__TAURI__) {
  window.__TAURI__.event.listen('terminal-content', (ev) => {
    handleTerminalContent(ev.payload);
  });
  window.__TAURI__.core.invoke('get_version')
    .then((v) => { if (typeof v === 'string') state.version = v; })
    .catch(() => {});
  // Grab focus on launch so the splash's "Any key" hint actually works.
  // Without this, the overlay stays in passive (click-through, unfocused)
  // mode and keystrokes go to the terminal beneath.
  window.__TAURI__.core.invoke('activate_overlay').catch(() => {});
}

// Dismiss the splash from any of the input/timeout paths below. The
// resize() call inside is a Linux-only workaround: WebKit2GTK on
// XWayland leaves stale pixels in the canvas backing buffer after
// ctx.clearRect, so toggling state.splashActive alone isn't enough —
// reassigning canvas.width forces a full backing reset.
//
// Linux also deactivates on dismiss: the overlay was activated on
// launch so the splash could receive clicks/keys, but on Wayland an
// active (focused, non-click-through) overlay sits on top of the
// terminal eating every event — the user can't move, focus, or type
// in the terminal underneath. macOS/Windows leave the overlay active
// (the user activates explicitly via global shortcut / shift-click),
// but Linux has no comparable re-activation path here, so we default
// the post-splash state to passive: terminal is usable, and the user
// can re-activate via Super+Shift+G when they want to play.
function dismissSplash() {
  if (!state.splashActive) return;
  state.splashActive = false;
  if (IS_LINUX) {
    resize();
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('deactivate_overlay').catch(() => {});
    }
  }
}

// Linux-only: auto-dismiss the splash after a few seconds. On XWayland
// with fractional scaling, the keydown/click path that normally
// dismisses the splash doesn't reliably reach the canvas, leaving the
// user stuck behind it. The timer is a hard ceiling. macOS and Windows
// dismiss interactively as designed.
if (IS_LINUX) {
  setTimeout(dismissSplash, 4000);
}

// Track overlay focus so the HUD can be hidden when the user can't drive
// the man. Tauri's non-activating panel translates NSWindow key state into
// DOM focus/blur events on the webview window.
//
// On focus we also re-run resize(): while the overlay is blurred the
// terminal can be moved/resized, and the canvas backing store can drift
// from window.innerWidth/innerHeight (Tauri's programmatic window resize
// doesn't always fire a DOM resize event on a non-activating panel).
// Left unchecked, the HUD renders into a stale-size canvas and gets
// scaled by the browser to fit the display — visibly shrunken.
state.overlayActive = typeof document !== 'undefined' && document.hasFocus && document.hasFocus();
window.addEventListener('focus', () => {
  resize();
  state.overlayActive = true;
});
window.addEventListener('blur', () => { state.overlayActive = false; });

// HUD close button — only reachable when the overlay is active (otherwise
// mouse events pass through to the terminal beneath). On Linux the
// splash dismiss takes priority over the close button so users can't
// accidentally quit while trying to clear the splash; on macOS/Windows
// the original ordering is preserved.
window.addEventListener('click', (e) => {
  // Linux: when the overlay is passive it has been shrunk to just the
  // HUD strip above the terminal (set_ignore_cursor_events is a no-op
  // under WebKit2GTK on Wayland, so we can't rely on click-through).
  // The strip is the only clickable surface, so two gestures need to
  // resolve here: clicking the close button quits, anything else
  // re-activates (this also covers Shift+click — a regular click is
  // strictly more permissive than the macOS/Windows shift-click gate
  // and Wayland blocks the kind of global click monitor we use there).
  if (IS_LINUX && !state.overlayActive && !state.splashActive) {
    if (isInCloseButton(e.clientX, e.clientY, W())) {
      if (window.__TAURI__) window.__TAURI__.core.invoke('quit_app').catch(() => {});
    } else if (window.__TAURI__) {
      window.__TAURI__.core.invoke('activate_overlay').catch(() => {});
    }
    return;
  }
  if (!state.overlayActive) return;
  if (IS_LINUX && state.splashActive) {
    dismissSplash();
    return;
  }
  if (isInCloseButton(e.clientX, e.clientY, W())) {
    if (window.__TAURI__) window.__TAURI__.core.invoke('quit_app').catch(() => {});
    return;
  }
  if (state.splashActive) state.splashActive = false;
});
window.addEventListener('mousemove', (e) => {
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;
});

// ── Input ────────────────────────────────────────────────────────────
const keys = new Set();

document.addEventListener('keydown', e => {
  // Linux: the splash hint says "any key dismisses" but the original
  // ordering matched Q (quit) and Esc (deactivate) first, so users
  // pressing Q to clear the splash quit the app instead. On Linux the
  // splash dismiss takes priority. Other platforms keep the original
  // ordering since their focus / key delivery behaves differently and
  // we don't want to change behavior there.
  if (IS_LINUX && state.splashActive) {
    dismissSplash();
    e.preventDefault();
    return;
  }

  if (window.__TAURI__) {
    if (e.code === 'KeyQ' && e.shiftKey) {
      window.__TAURI__.core.invoke('quit_app').catch(() => {});
      return;
    }
    if (e.code === 'Escape') {
      window.__TAURI__.core.invoke('deactivate_overlay').catch(() => {});
      return;
    }
  }

  if (state.splashActive) {
    state.splashActive = false;
    e.preventDefault();
    return;
  }

  // Debug bindings all live behind Shift so a stray tap can't fire them
  // mid-run — Shift+V toggles platform overlay, Shift+N skips the
  // mission, Shift+R restarts it.
  if (e.code === 'KeyV' && e.shiftKey) {
    state.DEBUG_PLATFORMS = !state.DEBUG_PLATFORMS;
    if (state.DEBUG_PLATFORMS) {
      state.debugAnchorX = state.gx;
      state.debugAnchorY = state.feetY;
    } else {
      state.debugAnchorX = null;
      state.debugAnchorY = null;
      state.collectibles = state.collectibles.filter((c) => !c.debug);
      state.manaMines = state.manaMines.filter((m) => !m.debug);
    }
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('set_dump_enabled', { enabled: state.DEBUG_PLATFORMS })
        .then((path) => { console.log(`[debug] detection dump ${state.DEBUG_PLATFORMS ? 'on' : 'off'} at ${path}`); })
        .catch(() => {});
    }
    return;
  }
  if (e.code === 'KeyF') { startAxeSwing(state); return; }
  if (e.code === 'KeyN' && e.shiftKey) {
    // Debug: skip to the next mission. Applies rewards for the current one
    // so progression stays consistent.
    restartActiveMission(state);
    debugSkipMission(state);
    resetPlayer(state);
    return;
  }
  if (e.code === 'KeyR' && e.shiftKey) {
    // Shift+R restarts the active mission — reseeds its scene (items,
    // hazards, timers) and teleports the man back to spawn. Works mid-run,
    // not only from a game-over screen.
    restartActiveMission(state);
    resetPlayer(state);
    return;
  }
  // Bare R casts the spell currently shown in the HUD — same effect as
  // the slot key for that spell (1 = shield toggle, 2 = lightning hold).
  // Reachable from the WASD posture without stretching for the number row.
  if (e.code === 'KeyR') {
    castSpell(state);
    return;
  }
  // Bare G spends one glowing ball to top up the flashlight battery during
  // the alone-in-dark mission. Silently refused when out of balls or already
  // at full charge — no wasted balls. Outside that mission the key is inert.
  if (e.code === 'KeyG') {
    if (isAloneInDarkActive(state)) spendBallForBattery(state);
    return;
  }
  if (e.code === 'Tab') {
    if (state.inventory.length > 0) {
      state.inventoryIdx = (state.inventoryIdx + 1) % state.inventory.length;
    }
    e.preventDefault();
    return;
  }

  // Spell slots: tap 1 to toggle the shield, hold 2 to aim lightning
  // (released on keyup below). Direct slots replace the old cycle+cast
  // pair so each spell has a dedicated finger.
  if (e.code === 'Digit1') { castSpellByName(state, 'shield'); return; }
  if (e.code === 'Digit2') { castSpellByName(state, 'lightning'); return; }
  if (e.code === 'Digit3') { castSpellByName(state, 'stasis'); return; }

  // Prone toggle: C key (works anytime on ground)
  if (e.code === 'KeyC') {
    state.proneRequested = !state.proneRequested;
    if (state.proneRequested) {
      state.posture = 'prone';
    }
    return;
  }

  if (e.code === 'KeyE') {
    if (!state.rope && state.ropeCooldown <= 0 && state.posture !== 'prone') {
      const defaultAngle = state.faceR ? -Math.PI / 4 : -3 * Math.PI / 4;
      state.ropeAngle = defaultAngle;
      state.rope = {
        state: 'aiming', angle: state.ropeAngle,
        tipX: 0, tipY: 0, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      };
    } else if (state.rope && (state.rope.state === 'aiming' || state.rope.state === 'flying')) {
      state.rope = null;
      state.ropeCooldown = ROPE_COOLDOWN;
    } else if (state.rope && state.rope.state === 'swinging') {
      const len = state.rope.ropeLen;
      const tangentVx = -state.rope.swingVel * len * Math.cos(state.rope.swingAngle);
      const tangentVy = -state.rope.swingVel * len * Math.sin(state.rope.swingAngle);
      const MIN_RELEASE_VX = 180;
      const dirX = Math.sin(state.rope.swingAngle) > 0 ? 1 : -1;
      state.gvx = Math.abs(tangentVx) > MIN_RELEASE_VX ? tangentVx : dirX * MIN_RELEASE_VX;
      // Add upward boost when releasing rope
      const MIN_RELEASE_VY = -150;
      state.gvy = Math.min(tangentVy, MIN_RELEASE_VY);
      state.grounded = false;
      state.standingHash = 0;
      state.rope = null;
      state.ropeCooldown = ROPE_COOLDOWN;
    }
  }

  keys.add(e.code);
});

document.addEventListener('keyup', e => {
  keys.delete(e.code);
  // Both Digit3 (the slot key) and R (the active-spell shortcut) end
  // stasis — same pattern as lightning's release-on-keyup.
  if ((e.code === 'Digit3' || e.code === 'KeyR') && state.stasisActive) {
    releaseStasis(state);
  }
  if (e.code === 'KeyE' && state.rope && state.rope.state === 'aiming') {
    state.rope.state = 'flying';
    state.rope.tipX = state.gx;
    state.rope.tipY = state.feetY - 15 * SCALE;
  }
  // Both Digit2 (the slot key) and R (the active-spell shortcut) release
  // a lightning charge — whichever the player used to start the aim,
  // letting go of either key fires from the wand tip.
  if ((e.code === 'Digit2' || e.code === 'KeyR') && isLightningAiming(state)) {
    const hand = jointWorldPos(state, state.faceR ? 'rh' : 'lh');
    const tip = wandTip(hand.x, hand.y, state.lightningAim.angle);
    releaseCast(state, tip.x, tip.y);
  }
});

// ── Game Loop ────────────────────────────────────────────────────────
let lastTime = performance.now();

// Track the last value pushed to Rust so we only invoke on actual change.
let reportedHudTall = null;

function syncHudTall(tall) {
  if (tall === reportedHudTall) return;
  reportedHudTall = tall;
  if (window.__TAURI__) {
    window.__TAURI__.core.invoke('set_hud_tall', { tall }).catch(() => {});
  }
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  // Measure whether the HUD content still fits on a single row. On a flip,
  // update local state (so subsequent renders and terminal-content shifts
  // use the new strip height) and tell the Rust side to resize the reserve.
  const needsTall = hudNeedsTwoRows(ctx, state, W());
  if (needsTall !== state.hudTall) {
    state.hudTall = needsTall;
  }
  syncHudTall(state.hudTall);

  if (state.hasSpawned) {
    state.screenW = W();
    state.screenH = H();
    // When the active mission has declared game over (e.g. lava hit with 0
    // balls), freeze gameplay updates. The mission's render hook keeps
    // drawing the GAME OVER overlay until the user restarts with R.
    if (!state.gameOver) {
      updateRope(state, dt, keys);
      updateMovement(state, dt, keys, W(), H());
      updatePosture(state);
      updatePose(state, dt);
      updateAxeSwing(state, dt);
      updateCollectibles(state, dt);
      updateManaMines(state, dt);
      updateParticles(state.particles, dt);
      // Mission tick runs before advance so the active mission's update can
      // satisfy its own win condition on the same frame it happens. When
      // the overlay is deactivated (user pressed Escape to focus the
      // terminal), the mission pauses — lava stops rising, the door stops
      // moving, and the render hook fades hazards to low alpha.
      if (state.overlayActive) {
        // Rotate the lightning aim while the spell-2 slot is held.
        // Default points straight up, so Left/Right swings the bolt
        // toward the respective horizon. Movement is suppressed while
        // aiming (see physics.js), so no conflict with the walk keys.
        if (isLightningAiming(state)) {
          const AIM_SPEED = 2.0;
          if (keys.has('ArrowLeft'))  adjustLightningAim(state, -AIM_SPEED * dt);
          if (keys.has('ArrowRight')) adjustLightningAim(state,  AIM_SPEED * dt);
        } else if (isAloneInDarkActive(state)) {
          if (keys.has('ArrowLeft'))  adjustFlashlightAim(state, -FLASH_AIM_SPEED * dt);
          if (keys.has('ArrowRight')) adjustFlashlightAim(state,  FLASH_AIM_SPEED * dt);
        }
        tickSpells(state, dt);
        tickActiveMission(state, dt);
        // Age the mission-change toast so the renderer can fade it
        // out — set in progression.js whenever missionIdx advances.
        if (state.missionToast) {
          state.missionToast.age += dt;
          if (state.missionToast.age >= 4.0) state.missionToast = null;
        }
        // Missions can ask for an automatic restart (e.g. lava swallowed
        // the door). Honor it before advance so onEnter re-fires on this
        // tick.
        if (state.missionScene?.requestRestart) {
          restartActiveMission(state);
          resetPlayer(state);
        }
        advanceMission(state);
      }
    }
    // Age holes and remove old ones
    for (let i = state.holes.length - 1; i >= 0; i--) {
      state.holes[i].age += dt;
      if (state.holes[i].age > 8) state.holes.splice(i, 1);
    }
    // Mining progress decays so half-mined blocks don't linger forever.
    if (state.miningProgress) {
      for (let i = state.miningProgress.length - 1; i >= 0; i--) {
        state.miningProgress[i].age += dt;
        if (state.miningProgress[i].age > 5) state.miningProgress.splice(i, 1);
      }
    }
  }

  render(ctx, state, W(), H());
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
