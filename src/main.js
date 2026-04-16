import { IDLE, SCALE } from './poses.js';
import { ROPE_COOLDOWN } from './constants.js';
import { buildPlatforms } from './platforms.js';
import { updateMovement, updateRope, updatePose, updatePosture, resetPlayer, updateParticles } from './physics.js';
import { render } from './render.js';

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
  posture: 'standing', // 'standing' | 'crouching' | 'prone'
  proneRequested: false, // true when user manually toggles prone with C

  // Rope
  rope: null,
  ropeAngle: -3 * Math.PI / 4,
  ropeCooldown: 0,

  // Platforms & regions
  platforms: [],
  holes: [],      // { x, y, w, age } — gaps punched through platforms
  particles: [],  // { x, y, vx, vy, life, maxLife } — burst debris
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
window.addEventListener('resize', initFallbackPlatforms);

// ── Terminal Content from Backend ────────────────────────────────────
function handleTerminalContent(content) {
  if (!content || !Array.isArray(content.lines) || content.lines.length === 0) return;

  const result = buildPlatforms(content, {
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

  // Spawn man at terminal right edge, on top of prompt box
  if (!state.hasSpawned && state.promptArea && state.footerArea) {
    state.gx = state.textOffsetX + state.textWidth - 20 * SCALE - 20;
    state.feetY = state.promptArea.y;
    state.faceR = false;
    state.hasSpawned = true;
  } else if (state.hasSpawned && state.grounded && state.platforms.length > 0) {
    // Follow platform when terminal text changes (scroll tracking)
    let matched = null;
    if (state.standingHash !== 0) {
      let matchDist = Infinity;
      for (const p of state.platforms) {
        if (p.hash === state.standingHash && state.gx >= p.x - 10 && state.gx <= p.x + p.w + 10) {
          const dist = Math.abs(p.y - state.feetY);
          if (dist < matchDist) {
            matched = p;
            matchDist = dist;
          }
        }
      }
    }
    if (matched) {
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

// ── Input ────────────────────────────────────────────────────────────
const keys = new Set();

document.addEventListener('keydown', e => {
  if (window.__TAURI__) {
    if (e.code === 'KeyQ') {
      window.__TAURI__.core.invoke('quit_app').catch(() => {});
      return;
    }
    if (e.code === 'Escape') {
      window.__TAURI__.core.invoke('focus_terminal').catch(() => {});
      return;
    }
  }

  if (e.code === 'KeyB') { state.DEBUG_DRAW = !state.DEBUG_DRAW; return; }
  if (e.code === 'KeyV') { state.DEBUG_PLATFORMS = !state.DEBUG_PLATFORMS; return; }
  if (e.code === 'KeyR') { resetPlayer(state); return; }

  // Prone toggle: C key (works anytime on ground)
  if (e.code === 'KeyC') {
    state.proneRequested = !state.proneRequested;
    if (state.proneRequested) {
      state.posture = 'prone';
    }
    return;
  }

  if (e.code === 'KeyE') {
    if (!state.rope && state.ropeCooldown <= 0 && state.posture === 'standing') {
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
    updateRope(state, dt, keys);
    updateMovement(state, dt, keys, W(), H());
    updatePosture(state);
    updatePose(state, dt);
    updateParticles(state.particles, dt);
    // Age holes and remove old ones
    for (let i = state.holes.length - 1; i >= 0; i--) {
      state.holes[i].age += dt;
      if (state.holes[i].age > 8) state.holes.splice(i, 1);
    }
  }

  render(ctx, state, W(), H());
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
