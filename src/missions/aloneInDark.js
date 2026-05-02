import { jointWorldPos, torsoY } from '../poses.js';
import { resetPlayer } from '../physics.js';
import { LIGHTNING_RANGE } from '../spells.js';

/**
 * "Alone in the dark" mission.
 *
 * The overlay paints the terminal pitch-black; the stick man carries a
 * conical flashlight that emits from his active hand in the direction he
 * faces. Four collectibles — a key, a candle, a battery, and a scroll —
 * are anchored to real terminal platforms. Walk onto each to pick it up;
 * finding all four completes the mission.
 *
 * The flashlight battery drains over time. Picking up the battery item
 * refills it; picking up the candle widens the beam. Firing the lightning
 * spell momentarily illuminates a corridor along the bolt's path so the
 * player can scout faster at a mana cost.
 */

export const BASE_HALF_ANGLE = 0.52;       // ~30° half-angle cone at start
export const CANDLE_HALF_ANGLE = 0.78;     // ~45° half-angle after candle pickup
export const BASE_CONE_LEN = 260;
export const BATTERY_EMPTY_LEN = 40;       // cone shrinks to this when battery dead
export const BATTERY_DRAIN_RATE = 1 / 120; // full → empty in 2 minutes
export const BATTERY_RECHARGE_PER_BALL = 0.25; // glowing ball = ~30 seconds of light
export const DESPERATION_SECS = 30;            // below this, glowing balls reveal themselves
export const PICKUP_RADIUS = 26;
export const ITEM_Y_OFFSET = 10;           // item sits this far above its platform
export const LIGHTNING_CORRIDOR_W = 36;    // destination-out strip width along bolt
export const AIM_SPEED = 1.8;              // radians/sec while aiming the flashlight

// Active-mission darkness fill. Windows WebView2 lets noticeably more
// light through a partly-opaque canvas layer than macOS's NSPanel does,
// so terminal text remains readable behind a 0.94 alpha that reads as
// fully black on macOS. Detect once and bake into a constant — webview
// platform doesn't change at runtime. Read userAgent via `window` (which
// is in the eslint globals) rather than the bare `navigator` identifier.
const IS_WINDOWS = typeof window !== 'undefined'
  && /Windows/i.test(window.navigator?.userAgent || '');
const DARKNESS_ACTIVE_FILL = IS_WINDOWS
  ? 'rgba(0, 0, 0, 1)'
  : 'rgba(0, 0, 0, 0.94)';

export const SHADOW_MAX = 6;
export const SHADOW_SPAWN_INTERVAL = 1.2;  // seconds between spawn attempts
export const SHADOW_DRIFT_SPEED = 28;      // idle drift speed
export const SHADOW_FLEE_ACCEL = 260;      // accel away from cone origin when lit
export const SHADOW_MAX_SPEED = 170;
export const SHADOW_RADIUS = 11;
export const SHADOW_SPAWN_MIN_R = 120;     // min distance from player at spawn
export const SHADOW_SPAWN_MAX_R = 240;     // max distance from player at spawn

export const ITEM_KINDS = ['key', 'candle', 'battery', 'scroll'];

const PROMPT_PLATFORM_HASH = 0xFFFF;

function eligiblePlatforms(state) {
  const plats = (state.platforms || []).filter(
    (p) =>
      p &&
      typeof p.hash === 'number' &&
      p.hash !== 0 &&
      p.hash !== PROMPT_PLATFORM_HASH,
  );
  plats.sort((a, b) => a.x - b.x || a.y - b.y);
  return plats;
}

function seedItems(state) {
  const plats = eligiblePlatforms(state);
  const items = [];
  if (plats.length === 0) return items;
  for (let i = 0; i < ITEM_KINDS.length; i++) {
    const idx = Math.floor(((i + 0.5) * plats.length) / ITEM_KINDS.length);
    const plat = plats[Math.min(idx, plats.length - 1)];
    const offsetX = Math.max(8, Math.min(plat.w - 8, plat.w / 2));
    items.push({
      kind: ITEM_KINDS[i],
      anchorHash: plat.hash,
      offsetX,
      x: plat.x + offsetX,
      y: plat.y - ITEM_Y_OFFSET,
      picked: false,
    });
  }
  return items;
}

export function isAloneInDarkActive(state) {
  return state.currentMissionId === ALONE_IN_DARK_MISSION.id;
}

// When the man turns around, snap the cone angle to the new forward
// direction so he isn't left pointing the flashlight behind him.
function syncFacing(state, scene) {
  if (scene.faceRLast === state.faceR) return;
  scene.coneAngle = state.faceR ? 0 : Math.PI;
  scene.faceRLast = state.faceR;
}

export function adjustFlashlightAim(state, delta) {
  const scene = state.missionScene;
  if (!scene || typeof scene.coneAngle !== 'number') return;
  scene.coneAngle += delta;
}

// Manual recharge: spend one glowing ball from the HUD counter in exchange
// for the same top-up a field-collected ball gives. Refuses when the
// player is out of balls OR the battery is already full, so a press
// doesn't silently waste a ball.
export function spendBallForBattery(state) {
  const scene = state.missionScene;
  if (!scene) return false;
  if ((state.score || 0) <= 0) return false;
  const charge = typeof scene.battery === 'number' ? scene.battery : 0;
  if (charge >= 1) return false;
  state.score -= 1;
  scene.battery = Math.min(1, charge + BATTERY_RECHARGE_PER_BALL);
  return true;
}

export function syncItemPositions(state) {
  const scene = state.missionScene;
  if (!scene || !scene.items) return;
  for (const it of scene.items) {
    if (it.picked) continue;
    const plat = (state.platforms || []).find((p) => p && p.hash === it.anchorHash);
    if (!plat) continue;
    it.x = plat.x + it.offsetX;
    it.y = plat.y - ITEM_Y_OFFSET;
  }
}

function tryPickup(state, scene) {
  const ty = torsoY(state);
  for (const it of scene.items) {
    if (it.picked) continue;
    const dx = state.gx - it.x;
    // Use the closer of feet / torso to the item y so standing next to it picks it up.
    const dyFeet = state.feetY - it.y;
    const dyTorso = ty - it.y;
    const dy = Math.abs(dyFeet) < Math.abs(dyTorso) ? dyFeet : dyTorso;
    if (Math.hypot(dx, dy) > PICKUP_RADIUS) continue;
    it.picked = true;
    onItemPicked(scene, it);
  }
}

function onItemPicked(scene, item) {
  if (item.kind === 'battery') scene.battery = 1;
  if (item.kind === 'candle') scene.coneHalfAngle = CANDLE_HALF_ANGLE;
}

export function isInCone(state, scene, x, y) {
  const origin = coneOrigin(state);
  const angle = coneDirection(state, scene);
  const half = scene.coneHalfAngle || BASE_HALF_ANGLE;
  const len = coneLength(scene);
  const dx = x - origin.x;
  const dy = y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > len || dist < 0.001) return false;
  // Smallest signed angle difference between the ray to (x,y) and the cone
  // axis — wraps so that a cone at angle = π and a target at −π still match.
  const to = Math.atan2(dy, dx);
  let diff = to - angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) <= half;
}

function spawnShadow(state, scene) {
  // Spawn in a ring around the player, just outside the cone, so the
  // player can find one by sweeping the flashlight around nearby — not by
  // hiking to the opposite edge of the screen.
  const W = state.screenW || 800;
  const H = state.screenH || 600;
  const topY = state.textOffsetY || 30;
  const origin = coneOrigin(state);
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = SHADOW_SPAWN_MIN_R + Math.random() * (SHADOW_SPAWN_MAX_R - SHADOW_SPAWN_MIN_R);
    const x = origin.x + Math.cos(a) * r;
    const y = origin.y + Math.sin(a) * r;
    if (x < 14 || x > W - 14) continue;
    if (y < topY + 8 || y > H - 14) continue;
    if (isInCone(state, scene, x, y)) continue;
    const da = Math.random() * Math.PI * 2;
    scene.shadows.push({
      x, y,
      vx: Math.cos(da) * SHADOW_DRIFT_SPEED,
      vy: Math.sin(da) * SHADOW_DRIFT_SPEED,
      age: 0,
      wobble: Math.random() * Math.PI * 2,
    });
    return;
  }
}

function updateShadows(state, scene, dt) {
  if (!Array.isArray(scene.shadows)) scene.shadows = [];

  scene.shadowSpawnTimer = (scene.shadowSpawnTimer || 0) + dt;
  while (
    scene.shadowSpawnTimer >= SHADOW_SPAWN_INTERVAL &&
    scene.shadows.length < SHADOW_MAX
  ) {
    scene.shadowSpawnTimer -= SHADOW_SPAWN_INTERVAL;
    spawnShadow(state, scene);
  }

  const origin = coneOrigin(state);
  const W = state.screenW || 800;
  const H = state.screenH || 600;

  for (let i = scene.shadows.length - 1; i >= 0; i--) {
    const sh = scene.shadows[i];
    sh.age += dt;
    sh.wobble += dt * 2;

    if (isInCone(state, scene, sh.x, sh.y)) {
      // Flee straight away from the cone origin. A unit vector times
      // accel * dt gives a frame-rate-independent acceleration.
      const dx = sh.x - origin.x;
      const dy = sh.y - origin.y;
      const len = Math.hypot(dx, dy) || 1;
      sh.vx += (dx / len) * SHADOW_FLEE_ACCEL * dt;
      sh.vy += (dy / len) * SHADOW_FLEE_ACCEL * dt;
    } else {
      // Mild drag so fleeing shadows eventually return to a gentle drift
      // after escaping the light.
      sh.vx *= Math.pow(0.85, dt * 60);
      sh.vy *= Math.pow(0.85, dt * 60);
    }

    // Clamp speed.
    const sp = Math.hypot(sh.vx, sh.vy);
    if (sp > SHADOW_MAX_SPEED) {
      sh.vx = (sh.vx / sp) * SHADOW_MAX_SPEED;
      sh.vy = (sh.vy / sp) * SHADOW_MAX_SPEED;
    }

    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;

    // Reap anything that has wandered off the screen; a fresh one will
    // spawn to replace it next spawn tick.
    if (sh.x < -40 || sh.x > W + 40 || sh.y < -40 || sh.y > H + 40) {
      scene.shadows.splice(i, 1);
    }
  }
}

export const ALONE_IN_DARK_MISSION = {
  id: 'alone-in-dark',
  text: 'Find the lost items in the dark',
  subtitle: 'sweep the flashlight with the arrow keys; press G to burn a ball into battery charge',
  rewardTitle: 'night-walker',

  onEnter(state) {
    const scene = state.missionScene;
    scene.items = seedItems(state);
    scene.battery = 1;
    scene.coneHalfAngle = BASE_HALF_ANGLE;
    state.gameOver = false;
    resetPlayer(state);
    // Cone angle lives in world coords (0 = east, π = west). Seeded from
    // current facing so the first frame points the way the man will walk.
    scene.coneAngle = state.faceR ? 0 : Math.PI;
    scene.faceRLast = state.faceR;
    scene.shadows = [];
    scene.shadowSpawnTimer = SHADOW_SPAWN_INTERVAL * 0.5; // first spawn arrives quickly
  },

  check(state) {
    const scene = state.missionScene;
    if (!scene || !scene.items || scene.items.length === 0) return false;
    return scene.items.every((i) => i.picked);
  },

  // Called by the collectibles system whenever the man walks into a glowing
  // ball. In this mission balls double as spare batteries — one ball buys
  // another ~30 seconds of light on top of the score increment.
  onCollectibleCollected(state) {
    const scene = state.missionScene;
    if (!scene) return;
    const charge = typeof scene.battery === 'number' ? scene.battery : 0;
    scene.battery = Math.min(1, charge + BATTERY_RECHARGE_PER_BALL);
  },

  questSuffix(state) {
    const scene = state.missionScene;
    const items = scene?.items;
    if (!items || !items.length) return '';
    const picked = items.filter((i) => i.picked).length;
    const charge = Math.max(0, Math.min(1, scene.battery ?? 0));
    const secsLeft = Math.ceil(charge / BATTERY_DRAIN_RATE);
    return `(${picked}/${items.length} · ${secsLeft}s)`;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
    if (state.gameOver) return;

    syncFacing(state, scene);
    syncItemPositions(state);
    // Drain first, then pick up: picking up the battery must refill to a
    // clean 1.0 rather than "1.0 minus this frame's drain".
    scene.battery = Math.max(0, scene.battery - BATTERY_DRAIN_RATE * dt);
    tryPickup(state, scene);
    updateShadows(state, scene, dt);
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;

    const paused = state.overlayActive === false;

    // Draw the items UNDER the darkness layer so the cone naturally reveals
    // them — when the destination-out cone punches a hole in the darkness,
    // the item pixels already painted beneath show through.
    for (const it of scene.items) {
      if (it.picked) continue;
      drawItem(ctx, it);
    }
    if (scene.shadows) {
      for (const sh of scene.shadows) drawShadow(ctx, sh);
    }

    drawDarkness(ctx, state, scene, W, H, paused);
  },
};

function coneOrigin(state) {
  const name = state.faceR ? 'rh' : 'lh';
  return jointWorldPos(state, name);
}

function coneDirection(state, scene) {
  if (scene && typeof scene.coneAngle === 'number') return scene.coneAngle;
  return state.faceR ? 0 : Math.PI;
}

function coneLength(scene) {
  // Linear ramp from full length at battery 1.0 down to BATTERY_EMPTY_LEN
  // at battery 0 — the cone shrinks rather than snapping off so the
  // transition is legible.
  const t = Math.max(0, Math.min(1, scene.battery));
  return BATTERY_EMPTY_LEN + (BASE_CONE_LEN - BATTERY_EMPTY_LEN) * t;
}

function drawDarkness(ctx, state, scene, W, H, paused) {
  // Build the darkness layer on an offscreen canvas so destination-out
  // only erases from the darkness (not from the world pixels already on
  // the main canvas underneath).
  const off = getOffscreen(W, H);
  const dctx = off.getContext('2d');
  dctx.clearRect(0, 0, W, H);
  // Windows WebView2 composites transparency differently than macOS's
  // NSPanel: at 0.94 alpha enough light leaks through that terminal
  // contents remain readable behind the overlay. Bump to fully opaque on
  // Windows only — the macOS aesthetic at 0.94 (a faint sense of the
  // world being still there, just barely) is preserved.
  dctx.fillStyle = paused
    ? 'rgba(0, 0, 0, 0.45)'
    : DARKNESS_ACTIVE_FILL;
  dctx.fillRect(0, 0, W, H);

  dctx.globalCompositeOperation = 'destination-out';
  carveFlashlightCone(dctx, state, scene);
  carveLightningCorridor(dctx, state);
  carveCollectibleHalos(dctx, state, scene);
  dctx.globalCompositeOperation = 'source-over';

  ctx.drawImage(off, 0, 0);
}

function carveFlashlightCone(dctx, state, scene) {
  const origin = coneOrigin(state);
  const angle = coneDirection(state, scene);
  const half = scene.coneHalfAngle || BASE_HALF_ANGLE;
  const len = coneLength(scene);

  // Radial gradient from hand outward fades cone edge to transparent so
  // the circle of light has a soft falloff instead of a hard triangle.
  const grad = dctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, len);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.85)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  dctx.fillStyle = grad;

  dctx.beginPath();
  dctx.moveTo(origin.x, origin.y);
  dctx.arc(origin.x, origin.y, len, angle - half, angle + half);
  dctx.closePath();
  dctx.fill();

  // Tight pool at the hand so the holder is always visible even when
  // pressed against a wall — prevents the "invisible man in the dark"
  // look when the cone clips off-screen.
  const poolR = 22;
  const pool = dctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, poolR);
  pool.addColorStop(0, 'rgba(0,0,0,1)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  dctx.fillStyle = pool;
  dctx.beginPath();
  dctx.arc(origin.x, origin.y, poolR, 0, Math.PI * 2);
  dctx.fill();
}

// Glowing balls pierce the darkness as emergency beacons — but ONLY once
// the flashlight is in its final DESPERATION_SECS. Before that the player
// is expected to ration light with the main cone and the R-key recharge;
// the balls only reveal themselves when the situation gets dire, turning
// the last 30 seconds into a desperate scramble for salvage light.
// Halo alpha ramps in as charge crosses the threshold so they fade into
// view rather than popping on instantly.
function carveCollectibleHalos(dctx, state, scene) {
  const balls = state.collectibles;
  if (!balls || balls.length === 0) return;
  const charge = Math.max(0, Math.min(1, scene.battery ?? 0));
  const secsLeft = charge / BATTERY_DRAIN_RATE;
  if (secsLeft > DESPERATION_SECS) return;
  // Fade-in over the final 5 seconds of the threshold (from 30s → 25s of
  // remaining light the beacons ramp from invisible to fully visible).
  const reveal = Math.max(0, Math.min(1, (DESPERATION_SECS - secsLeft) / 5));
  for (const c of balls) {
    const fadeIn = Math.min(1, (c.age || 0) * 2);
    const fadeOut = (c.age || 0) > 7 ? Math.max(0, 1 - ((c.age || 0) - 7) / 3) : 1;
    const alpha = fadeIn * fadeOut * reveal;
    if (alpha <= 0.01) continue;
    const r = 34;
    const cy = c.y - 6; // match the orb's platform-surface offset in render.js
    const grad = dctx.createRadialGradient(c.x, cy, 0, c.x, cy, r);
    grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = grad;
    dctx.beginPath();
    dctx.arc(c.x, cy, r, 0, Math.PI * 2);
    dctx.fill();
  }
}

function carveLightningCorridor(dctx, state) {
  const b = state.lightningBolt;
  if (!b) return;
  const fade = Math.max(0, Math.min(1, b.life / (b.maxLife || 1)));
  const x2 = b.x + Math.cos(b.angle) * LIGHTNING_RANGE;
  const y2 = b.y + Math.sin(b.angle) * LIGHTNING_RANGE;
  dctx.save();
  dctx.lineCap = 'round';
  dctx.strokeStyle = `rgba(0,0,0,${0.95 * fade})`;
  dctx.lineWidth = LIGHTNING_CORRIDOR_W;
  dctx.beginPath();
  dctx.moveTo(b.x, b.y);
  dctx.lineTo(x2, y2);
  dctx.stroke();
  dctx.restore();
}

function drawShadow(ctx, sh) {
  const wob = 1 + 0.15 * Math.sin(sh.wobble || 0);
  const r = SHADOW_RADIUS * wob;
  ctx.save();
  ctx.shadowBlur = 0;
  // Layered radial fills — black core with a faint violet halo. Under the
  // darkness layer this reads as a sooty blob only visible where the cone
  // cuts through.
  const halo = ctx.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, r * 2.2);
  halo.addColorStop(0, 'rgba(50, 20, 70, 0.55)');
  halo.addColorStop(1, 'rgba(20, 0, 30, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sh.x, sh.y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createRadialGradient(sh.x, sh.y, 0, sh.x, sh.y, r);
  body.addColorStop(0, 'rgba(10, 6, 14, 0.95)');
  body.addColorStop(0.7, 'rgba(18, 10, 22, 0.75)');
  body.addColorStop(1, 'rgba(10, 5, 18, 0)');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(sh.x, sh.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Two dim eye glints — sell the "creature" read.
  ctx.fillStyle = 'rgba(200, 200, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(sh.x - r * 0.35, sh.y - r * 0.1, 1.1, 0, Math.PI * 2);
  ctx.arc(sh.x + r * 0.35, sh.y - r * 0.1, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawItem(ctx, it) {
  ctx.save();
  ctx.shadowBlur = 0;
  switch (it.kind) {
    case 'key':     drawKey(ctx, it.x, it.y); break;
    case 'candle':  drawCandle(ctx, it.x, it.y); break;
    case 'battery': drawBattery(ctx, it.x, it.y); break;
    case 'scroll':  drawScroll(ctx, it.x, it.y); break;
  }
  ctx.restore();
}

function drawKey(ctx, x, y) {
  ctx.fillStyle = '#f0c85a';
  ctx.strokeStyle = '#6b4a1d';
  ctx.lineWidth = 1;
  // Bow (head of the key).
  ctx.beginPath();
  ctx.arc(x - 4, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Shaft.
  ctx.fillRect(x - 1, y - 1, 10, 2);
  ctx.strokeRect(x - 1, y - 1, 10, 2);
  // Teeth.
  ctx.fillRect(x + 5, y + 1, 2, 3);
  ctx.fillRect(x + 8, y + 1, 2, 2);
  ctx.strokeRect(x + 5, y + 1, 2, 3);
  ctx.strokeRect(x + 8, y + 1, 2, 2);
}

function drawCandle(ctx, x, y) {
  // Holder.
  ctx.fillStyle = '#8a6338';
  ctx.fillRect(x - 5, y + 3, 10, 2);
  // Candle body.
  ctx.fillStyle = '#e8e0c4';
  ctx.fillRect(x - 2, y - 6, 4, 9);
  ctx.strokeStyle = '#7a6a48';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x - 2, y - 6, 4, 9);
  // Wick.
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(x - 0.5, y - 9, 1, 3);
  // Flame.
  const grad = ctx.createRadialGradient(x, y - 10, 0, x, y - 10, 5);
  grad.addColorStop(0, 'rgba(255, 240, 180, 1)');
  grad.addColorStop(0.5, 'rgba(255, 180, 60, 0.9)');
  grad.addColorStop(1, 'rgba(255, 120, 30, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(x, y - 10, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBattery(ctx, x, y) {
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(x - 6, y - 3, 12, 7);
  ctx.fillStyle = '#6fdc6f';
  ctx.fillRect(x - 5, y - 2, 10, 5);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(x + 6, y - 1, 2, 3);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+', x, y);
}

function drawScroll(ctx, x, y) {
  ctx.fillStyle = '#e8dcb0';
  ctx.strokeStyle = '#7a5a2a';
  ctx.lineWidth = 1;
  // Body.
  ctx.fillRect(x - 6, y - 4, 12, 8);
  ctx.strokeRect(x - 6, y - 4, 12, 8);
  // Rolled ends.
  ctx.fillStyle = '#b99a5a';
  ctx.fillRect(x - 7, y - 5, 2, 10);
  ctx.fillRect(x + 5, y - 5, 2, 10);
  ctx.strokeRect(x - 7, y - 5, 2, 10);
  ctx.strokeRect(x + 5, y - 5, 2, 10);
  // Text lines.
  ctx.strokeStyle = '#5a4a2a';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 2); ctx.lineTo(x + 4, y - 2);
  ctx.moveTo(x - 4, y);     ctx.lineTo(x + 3, y);
  ctx.moveTo(x - 4, y + 2); ctx.lineTo(x + 2, y + 2);
  ctx.stroke();
}

let _offscreen = null;
function getOffscreen(w, h) {
  if (!_offscreen || _offscreen.width !== w || _offscreen.height !== h) {
    _offscreen = document.createElement('canvas');
    _offscreen.width = w;
    _offscreen.height = h;
  }
  return _offscreen;
}
