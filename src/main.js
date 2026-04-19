import { IDLE, SCALE } from './poses.js';
import { ROPE_COOLDOWN, HUD_HEIGHT } from './constants.js';
import { buildPlatforms } from './platforms.js';
import { updateMovement, updateRope, updatePose, updatePosture, resetPlayer, updateParticles, startAxeSwing, updateAxeSwing } from './physics.js';
import { updateCollectibles } from './collectibles.js';
import { updateManaMines } from './manaMines.js';
import { render, isInCloseButton } from './render.js';
import { advanceMission, debugSkipMission, initialProgression, restartActiveMission, tickActiveMission } from './progression.js';
import { initialSpells, cycleSpell, castSpell, tickSpells } from './spells.js';

// ── Canvas Setup ─────────────────────────────────────────────────────
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

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
  DEBUG_DRAW: false,
  DEBUG_PLATFORMS: false,
  debugAnchorX: null, // captured when DEBUG_PLATFORMS turns on — anchor for pinned mine/ball
  debugAnchorY: null,
  lastDebugLines: [],
  lastInputLine: null,
  lastFooterLine: null,
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

  // The overlay window extends HUD_HEIGHT pixels above the terminal to host
  // the HUD strip. Shift text_offset_y so platforms render below the strip.
  const adjusted = { ...content, text_offset_y: content.text_offset_y + HUD_HEIGHT };
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
  state.lastDebugLines = result.lastDebugLines;
  state.lastInputLine = result.lastInputLine;
  state.lastFooterLine = result.lastFooterLine;

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
// mouse events pass through to the terminal beneath).
window.addEventListener('click', (e) => {
  if (!state.overlayActive) return;
  if (!isInCloseButton(e.clientX, e.clientY, W())) return;
  if (window.__TAURI__) window.__TAURI__.core.invoke('quit_app').catch(() => {});
});
window.addEventListener('mousemove', (e) => {
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;
});

// ── Input ────────────────────────────────────────────────────────────
const keys = new Set();

document.addEventListener('keydown', e => {
  if (window.__TAURI__) {
    if (e.code === 'KeyQ') {
      window.__TAURI__.core.invoke('quit_app').catch(() => {});
      return;
    }
    if (e.code === 'Escape') {
      window.__TAURI__.core.invoke('deactivate_overlay').catch(() => {});
      return;
    }
  }

  if (e.code === 'KeyB') { state.DEBUG_DRAW = !state.DEBUG_DRAW; return; }
  if (e.code === 'KeyV') {
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
  if (e.code === 'KeyR') {
    if (state.gameOver) {
      restartActiveMission(state);
      resetPlayer(state);
    } else {
      resetPlayer(state);
    }
    return;
  }
  if (e.code === 'Tab') {
    if (state.inventory.length > 0) {
      state.inventoryIdx = (state.inventoryIdx + 1) % state.inventory.length;
    }
    e.preventDefault();
    return;
  }

  if (e.code === 'KeyX') { cycleSpell(state); return; }
  if (e.code === 'KeyZ') { castSpell(state); return; }

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
  if (e.code === 'KeyE' && state.rope && state.rope.state === 'aiming') {
    state.rope.state = 'flying';
    state.rope.tipX = state.gx;
    state.rope.tipY = state.feetY - 15 * SCALE;
  }
});

// ── Game Loop ────────────────────────────────────────────────────────
let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

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
        tickSpells(state, dt);
        tickActiveMission(state, dt);
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
