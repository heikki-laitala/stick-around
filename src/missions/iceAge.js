import { effectiveHudHeight } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';
import { isInHole } from '../platforms.js';
import { resetPlayer } from '../physics.js';
import { isShielded } from '../spells.js';

/**
 * "Ice Age" mission.
 *
 * Every platform turns to ice (slippery sliding-with-momentum), giant
 * icicles hang from the terminal-ceiling line and randomly drop —
 * bursting any platform they crash through and instantly killing the
 * man if they catch him on the head. The goal is to mine snow chunks
 * scattered across the platforms (axe, just like mana mines, but
 * faster to break) and deliver them to a build zone where a snowman
 * grows one layer per drop-off. Three layers — base, torso, head —
 * and the mission completes.
 *
 * Risk model: mining is the only stationary moment. The chunks are
 * deliberately sparse so the player has to traverse the map between
 * them, which is when the icicle hazard bites hardest. The build zone
 * is icicle-immune (the snowman is the goal, not another thing to
 * lose) so chaos shapes the *path*, not the destination.
 */

export const SNOWMAN_LAYERS = 3;
// Snow chunks behave like mana mines: each one ages out and a fresh one
// spawns somewhere else, so the player can't camp a single platform —
// they're forced to traverse the map between mining sessions, which is
// when the icicles do their job.
export const SNOW_CHUNK_LIFETIME = 22;
export const SNOW_CHUNK_SPAWN_INTERVAL = 3.5;
export const SNOW_CHUNK_MIN_DIST = 80;
// Once the head goes on, the mission holds on the screen for a beat so
// the player can see what they built before the ladder advances. Long
// enough for the snowman to register, short enough that it doesn't feel
// like a stall.
export const WIN_HOLD = 1.8;
export const SNOW_CHUNK_HITS = 2;             // axe hits per chunk — quicker than mana
export const SNOW_CHUNK_COUNT = 5;            // total chunks seeded across the map
export const SNOW_CHUNK_Y_OFFSET = 8;         // chunk sits this far above its platform
export const BUILD_ZONE_W = 56;
export const BUILD_ZONE_H = 24;
export const ICICLE_W = 14;
export const ICICLE_H = 28;
export const ICICLE_FALL_SPEED = 360;
export const ICICLE_SPAWN_INTERVAL = 1.6;     // base seconds between drops
export const ICICLE_SPAWN_RAMP = 0.6;         // tightens by this fraction near the end
export const ICICLE_HOLE_W = 30;
export const ICICLE_PLAYER_HIT_R = 16;
// Persistent ceiling field — every icicle hangs here between drops, so the
// player can read where the hazards live before the next one starts to
// shake. Count scales lightly with terminal width so wider terminals get a
// proportional ceiling.
export const CEILING_ICICLE_COUNT = 9;
export const ICICLE_SHAKE_DURATION = 0.7;     // seconds of warning shake before drop
export const ICICLE_SHAKE_AMPLITUDE = 2.5;    // pixels of horizontal jiggle
export const ICICLE_DANGER_W = 28;            // ground shadow width = approx icicle hole width
// Drifting snow ambience — purely cosmetic, never collides with anything.
export const SNOW_AMBIENT_COUNT = 60;

const PROMPT_PLATFORM_HASH = 0xFFFF;

function ceilingY(state) {
  const top = typeof state.textOffsetY === 'number' && state.textOffsetY > 0
    ? state.textOffsetY
    : effectiveHudHeight(state.screenW);
  return top - 4;                              // tiny inset so icicle tips poke down
}

function eligiblePlatforms(state) {
  return (state.platforms || []).filter((p) =>
    p && typeof p.hash === 'number' && p.hash !== 0 && p.hash !== PROMPT_PLATFORM_HASH,
  );
}

function findPromptPlatform(state) {
  return (state.platforms || []).find((p) => p && p.hash === PROMPT_PLATFORM_HASH) || null;
}

function findPlatformByHash(state, hash) {
  if (hash == null) return null;
  return (state.platforms || []).find((p) => p && p.hash === hash) || null;
}

function makeSnowChunk(plat, dxFrac) {
  const x = plat.x + plat.w * dxFrac;
  return {
    x, y: plat.y - SNOW_CHUNK_Y_OFFSET,
    hits: SNOW_CHUNK_HITS,
    hash: plat.hash,
    dxFrac,
    age: 0,
  };
}

function seedSnowChunks(state) {
  const plats = eligiblePlatforms(state);
  if (plats.length === 0) return [];
  // Spread the initial set across the map by sampling platforms at evenly-
  // spaced indices — gives the player a starting field to find. Aging +
  // respawn keep them moving from there.
  plats.sort((a, b) => a.x - b.x || a.y - b.y);
  const chunks = [];
  const wanted = Math.min(SNOW_CHUNK_COUNT, plats.length);
  for (let i = 0; i < wanted; i++) {
    const idx = Math.floor(((i + 0.5) * plats.length) / wanted);
    const plat = plats[Math.min(idx, plats.length - 1)];
    if (plat.w < 32) continue;
    chunks.push(makeSnowChunk(plat, 0.5));
  }
  return chunks;
}

/**
 * Try to place a fresh chunk on a random platform that (a) isn't the
 * build-zone host, (b) is wide enough, and (c) isn't already crowded by
 * existing chunks. Returns the new chunk on success, null after a fixed
 * number of attempts to avoid spinning when the layout is full.
 */
function spawnSnowChunk(state, scene) {
  const plats = eligiblePlatforms(state);
  if (plats.length === 0) return null;
  const buildZoneHash = scene.buildZone?.anchorHash;

  for (let attempt = 0; attempt < 12; attempt++) {
    const plat = plats[Math.floor(Math.random() * plats.length)];
    if (!plat || plat.w < 32) continue;
    if (buildZoneHash != null && plat.hash === buildZoneHash) continue;
    const dxFrac = 0.18 + Math.random() * 0.64;       // stay clear of platform edges
    const x = plat.x + plat.w * dxFrac;
    const y = plat.y - SNOW_CHUNK_Y_OFFSET;

    let tooClose = false;
    for (const existing of scene.snowChunks || []) {
      if (Math.hypot(existing.x - x, existing.y - y) < SNOW_CHUNK_MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    return makeSnowChunk(plat, dxFrac);
  }
  return null;
}

function ageAndRespawnChunks(state, scene, dt) {
  if (!scene.snowChunks) scene.snowChunks = [];
  // Age out expired chunks so the player can't camp one platform.
  for (let i = scene.snowChunks.length - 1; i >= 0; i--) {
    const c = scene.snowChunks[i];
    c.age = (c.age || 0) + dt;
    if (c.age >= SNOW_CHUNK_LIFETIME) {
      scene.snowChunks.splice(i, 1);
    }
  }
  // Refill toward SNOW_CHUNK_COUNT on the spawn cadence.
  scene.snowChunkSpawnTimer = (scene.snowChunkSpawnTimer || 0) + dt;
  if (
    scene.snowChunkSpawnTimer >= SNOW_CHUNK_SPAWN_INTERVAL
    && scene.snowChunks.length < SNOW_CHUNK_COUNT
  ) {
    scene.snowChunkSpawnTimer = 0;
    const fresh = spawnSnowChunk(state, scene);
    if (fresh) scene.snowChunks.push(fresh);
  }
}

function pickBuildZone(state) {
  // The build zone lives on the prompt-top border so it survives terminal
  // scroll just like the man's spawn point. Anchor by hash + offset so a
  // resize re-snaps it to the right spot on the line.
  const prompt = findPromptPlatform(state);
  const platforms = state.platforms || [];
  const anchor = prompt
    || platforms.find((p) => p && p.w >= BUILD_ZONE_W * 1.2)
    || null;
  if (!anchor) {
    return {
      x: (state.textOffsetX || 0) + 20,
      y: (state.screenH || 600) - BUILD_ZONE_H - 4,
      w: BUILD_ZONE_W,
      h: BUILD_ZONE_H,
      anchorHash: null,
      anchorOffsetX: 0,
    };
  }
  // Park the zone against the right edge of the prompt-top platform —
  // basically where the man spawns — so the first delivery is a single
  // tap right and the snowman grows in the most-visible spot on screen.
  const RIGHT_INSET = 14;
  const offsetX = Math.max(20, anchor.w - BUILD_ZONE_W - RIGHT_INSET);
  return {
    x: anchor.x + offsetX,
    y: anchor.y - BUILD_ZONE_H,
    w: BUILD_ZONE_W,
    h: BUILD_ZONE_H,
    anchorHash: anchor.hash,
    anchorOffsetX: offsetX,
  };
}

function syncBuildZone(state, zone) {
  if (!zone || zone.anchorHash == null) return;
  const anchor = findPlatformByHash(state, zone.anchorHash);
  if (!anchor) return;
  zone.x = anchor.x + zone.anchorOffsetX;
  zone.y = anchor.y - zone.h;
}

function syncSnowChunks(state, chunks) {
  if (!chunks) return;
  for (const c of chunks) {
    const anchor = findPlatformByHash(state, c.hash);
    if (!anchor) continue;
    c.x = anchor.x + anchor.w * c.dxFrac;
    c.y = anchor.y - SNOW_CHUNK_Y_OFFSET;
  }
}

function manInBuildZone(state, zone) {
  if (!zone) return false;
  const torsoY = state.feetY - STANDING_HEIGHT / 2;
  return state.gx >= zone.x
    && state.gx <= zone.x + zone.w
    && torsoY <= zone.y + zone.h
    && state.feetY >= zone.y;
}

export const ICE_AGE_MISSION = {
  id: 'ice-age',
  text: 'Build a snowman from snow chunks',
  rewardTitle: 'snow architect',
  unlocks: ['ice-age-survivor'],

  onEnter(state) {
    const scene = state.missionScene;
    scene.iceFloor = true;
    scene.snowChunks = seedSnowChunks(state);
    scene.snowChunkSpawnTimer = 0;
    scene.snowballsCollected = 0;
    scene.builtLayers = 0;
    scene.buildZone = pickBuildZone(state);
    scene.wasInBuildZone = false;
    scene.icicles = seedCeilingIcicles(state);
    scene.icicleSpawnTimer = 0;
    scene.snowFlakes = seedSnowFlakes(state);
    scene.winT = 0;
    scene.requestRestart = false;
    state.gameOver = false;
    resetPlayer(state);
  },

  check(state) {
    const scene = state.missionScene;
    if (!scene) return false;
    return (scene.builtLayers || 0) >= SNOWMAN_LAYERS
      && (scene.winT || 0) >= WIN_HOLD;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;

    syncBuildZone(state, scene.buildZone);
    syncSnowChunks(state, scene.snowChunks);

    if (state.gameOver) return;

    // Build-zone delivery on the rising edge of "in zone" so a single walk-
    // through deposits one ball, not many — the player has to leave and
    // return for each layer, which paces deliveries through the chaos.
    const inZone = manInBuildZone(state, scene.buildZone);
    if (inZone && !scene.wasInBuildZone) {
      if (scene.snowballsCollected > 0 && scene.builtLayers < SNOWMAN_LAYERS) {
        scene.snowballsCollected -= 1;
        scene.builtLayers += 1;
        spawnLayerPuff(state, scene);
      }
    }
    scene.wasInBuildZone = inZone;

    if (scene.builtLayers >= SNOWMAN_LAYERS) {
      // Hold the moment: tick the win timer and freeze hazards so the
      // player can see the finished snowman before the ladder advances.
      scene.winT = (scene.winT || 0) + dt;
      return;
    }

    advanceIcicles(state, scene, dt);
    scheduleIcicleSpawn(state, scene, dt);
    ageAndRespawnChunks(state, scene, dt);
    advanceSnowFlakes(state, scene, dt);
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    const paused = state.overlayActive === false;

    // Ambient drift sits behind everything else — pure mood, no gameplay
    // weight. Drawn first so platforms/snowman/icicles all read on top.
    renderSnowFlakes(ctx, scene, paused);

    renderIceTint(ctx, state, paused);
    // Danger shadows on platforms underneath shaking icicles — telegraphs
    // the impact zone without forcing the player to look up while they
    // navigate the slip.
    renderIcicleDangerShadows(ctx, state, scene, paused);
    renderBuildZone(ctx, scene);
    renderSnowman(ctx, scene);
    renderSnowChunks(ctx, scene);

    // Ceiling drawn before icicles so each icicle's base sits flush against
    // the ice band. Falling ones overlap freely once they leave the rim.
    renderIceCeiling(ctx, state, paused);

    ctx.save();
    ctx.globalAlpha = paused ? 0.3 : 1;
    for (const icicle of scene.icicles || []) renderIcicle(ctx, icicle);
    ctx.restore();

    renderRequirementBadge(ctx, scene, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

// ── Snow ambience ───────────────────────────────────────────────────────

function seedSnowFlakes(state) {
  const screenW = state.screenW || 800;
  const screenH = state.screenH || 600;
  const result = [];
  for (let i = 0; i < SNOW_AMBIENT_COUNT; i++) {
    result.push({
      x: Math.random() * screenW,
      y: Math.random() * screenH,
      vx: -6 + Math.random() * 12,             // slight lateral drift, both ways
      vy: 14 + Math.random() * 24,             // slow gentle fall
      r: 0.7 + Math.random() * 1.4,            // sub-pixel-ish dot variation
      alpha: 0.4 + Math.random() * 0.5,
    });
  }
  return result;
}

function advanceSnowFlakes(state, scene, dt) {
  if (!scene.snowFlakes) return;
  const screenW = state.screenW || 800;
  const screenH = state.screenH || 600;
  for (const f of scene.snowFlakes) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.y > screenH + 4 || f.x < -10 || f.x > screenW + 10) {
      // Recycle to the top — fresh x and slightly randomized velocities so
      // the flow stays varied over time.
      f.x = Math.random() * screenW;
      f.y = -4;
      f.vx = -6 + Math.random() * 12;
      f.vy = 14 + Math.random() * 24;
    }
  }
}

function renderSnowFlakes(ctx, scene, paused) {
  if (!scene.snowFlakes) return;
  ctx.save();
  ctx.globalAlpha = paused ? 0.3 : 1;
  ctx.fillStyle = 'rgba(245, 250, 255, 1)';
  for (const f of scene.snowFlakes) {
    ctx.globalAlpha = (paused ? 0.3 : 1) * f.alpha;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Icicle danger shadow ────────────────────────────────────────────────

function findFirstPlatformBelow(state, x, fromY) {
  // The first platform a falling icicle would land on. Used to project a
  // warning shadow onto its top so the player can read the danger zone
  // without taking their eyes off the slip.
  let best = null;
  for (const p of state.platforms || []) {
    if (!p || p.x == null) continue;
    if (p.y <= fromY) continue;
    if (x < p.x || x > p.x + p.w) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

function renderIcicleDangerShadows(ctx, state, scene, paused) {
  if (!scene.icicles) return;
  ctx.save();
  for (const ic of scene.icicles) {
    if (ic.state !== 'shaking') continue;
    const target = findFirstPlatformBelow(state, ic.anchorX, ic.y);
    if (!target) continue;
    // Shadow pulses with the same intensity ramp as the icicle's warning
    // tint so the two reads are synchronized.
    const intensity = Math.min(1, (ic.shakeT || 0) / ICICLE_SHAKE_DURATION);
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ic.shakeT * 18));
    ctx.globalAlpha = (paused ? 0.3 : 1) * intensity * pulse * 0.85;

    // Soft radial wash centered on the impact column. Sits a hair above
    // the platform top so it overlays the snow ridge cleanly.
    const cx = ic.anchorX;
    const cy = target.y - 1;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, ICICLE_DANGER_W * 0.7);
    grad.addColorStop(0, 'rgba(255, 80, 110, 0.85)');
    grad.addColorStop(0.6, 'rgba(220, 110, 160, 0.55)');
    grad.addColorStop(1, 'rgba(220, 110, 160, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ICICLE_DANGER_W * 0.7, 4 + 2 * intensity, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Ceiling icicles & state machine ─────────────────────────────────────

function spawnXRange(state) {
  const x0 = typeof state.textOffsetX === 'number' ? state.textOffsetX : 0;
  const w = typeof state.textWidth === 'number' && state.textWidth > 0
    ? state.textWidth
    : (state.screenW || 800);
  return { x0, x1: x0 + w };
}

function makeCeilingIcicle(x, ceilY) {
  return {
    anchorX: x,
    x, y: ceilY,
    vy: 0,
    state: 'idle',
    shakeT: 0,
    w: ICICLE_W, h: ICICLE_H,
  };
}

function seedCeilingIcicles(state) {
  const { x0, x1 } = spawnXRange(state);
  const ceilY = ceilingY(state);
  const w = x1 - x0;
  const result = [];
  // Even-spaced anchors with a small per-slot jitter so the row reads as
  // organic frost instead of a metronome of teeth.
  for (let i = 0; i < CEILING_ICICLE_COUNT; i++) {
    const slot = (i + 0.5) / CEILING_ICICLE_COUNT;
    const jitter = (Math.random() - 0.5) * (w / CEILING_ICICLE_COUNT) * 0.6;
    const x = x0 + w * slot + jitter;
    result.push(makeCeilingIcicle(x, ceilY + ICICLE_H));
  }
  return result;
}

function respawnIcicle(state, ic) {
  // Reset in place — idle pose at the same anchor — then nudge anchor by a
  // small drift so the ceiling slowly redistributes over time.
  const { x0, x1 } = spawnXRange(state);
  const drift = (Math.random() - 0.5) * 60;
  ic.anchorX = Math.max(x0 + 8, Math.min(x1 - 8, ic.anchorX + drift));
  ic.x = ic.anchorX;
  ic.y = ceilingY(state) + ICICLE_H;       // tip just below the ceiling line
  ic.vy = 0;
  ic.state = 'idle';
  ic.shakeT = 0;
}

// ── Icicles ─────────────────────────────────────────────────────────────

function scheduleIcicleSpawn(state, scene, dt) {
  // Difficulty ramps with how much of the snowman is built — early game
  // gives the player a chance to learn the slip, end game forces commits.
  const progress = (scene.builtLayers || 0) / SNOWMAN_LAYERS;
  const interval = ICICLE_SPAWN_INTERVAL
    * (1 - (1 - ICICLE_SPAWN_RAMP) * progress);

  scene.icicleSpawnTimer = (scene.icicleSpawnTimer || 0) + dt;
  while (scene.icicleSpawnTimer >= interval) {
    scene.icicleSpawnTimer -= interval;
    triggerIcicleDrop(scene);
  }
}

function triggerIcicleDrop(scene) {
  // Pick a random idle icicle and arm it. If everything is already mid-
  // shake or falling, the spawn tick is a no-op — the ceiling is busy and
  // the next interval will retry.
  const candidates = (scene.icicles || []).filter((ic) => ic.state === 'idle');
  if (candidates.length === 0) return;
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  target.state = 'shaking';
  target.shakeT = 0;
}

function advanceIcicles(state, scene, dt) {
  if (!scene.icicles || scene.icicles.length === 0) return;
  const screenH = state.screenH || 9999;
  const buildZone = scene.buildZone;

  for (let i = 0; i < scene.icicles.length; i++) {
    const ic = scene.icicles[i];

    // Backward-compat shim for tests that injected raw {x, y, vy, ...}
    // icicles without a state field — treat them as already falling.
    if (!ic.state) ic.state = 'falling';

    if (ic.state === 'idle') {
      // Just hangs there. No motion, no collisions — it's part of the
      // scenery until the spawn timer arms it.
      continue;
    }

    if (ic.state === 'shaking') {
      ic.shakeT += dt;
      // Higher-frequency wobble as the timer runs out, so the last beat
      // before drop is unmistakable.
      const intensity = Math.min(1, ic.shakeT / ICICLE_SHAKE_DURATION);
      const omega = 18 + 16 * intensity;
      ic.x = ic.anchorX
        + Math.sin(ic.shakeT * omega) * ICICLE_SHAKE_AMPLITUDE * intensity;
      if (ic.shakeT >= ICICLE_SHAKE_DURATION) {
        ic.state = 'falling';
        ic.vy = ICICLE_FALL_SPEED;
        ic.x = ic.anchorX;
      }
      continue;
    }

    // 'falling'
    const yBefore = ic.y;
    ic.y += ic.vy * dt;

    // Hit the man — instant fail unless shielded (parity with meteor shower).
    if (hitsMan(state, ic)) {
      spawnImpactParticles(state, ic.x, ic.y);
      if (isShielded(state)) {
        respawnIcicle(state, ic);
        continue;
      }
      state.gameOver = true;
      state.gvx = 0;
      state.gvy = 0;
      // Leave the icicle in place — next restart reseeds the ceiling.
      return;
    }

    // Sliced by lightning? Vaporise without bursting platforms.
    if (state.lightningBolt
        && Math.abs(ic.x - state.lightningBolt.x) < 40
        && ic.y >= state.lightningBolt.y - 200
        && ic.y <= state.lightningBolt.y + 40) {
      spawnImpactParticles(state, ic.x, ic.y);
      respawnIcicle(state, ic);
      continue;
    }

    // Walk through every platform top whose row the icicle crossed this
    // step — each crossing punches a hole. Build-zone platform is spared.
    burstPlatformsBetween(state, ic.x, yBefore, ic.y, buildZone);

    if (ic.y > screenH) respawnIcicle(state, ic);
  }
}

function hitsMan(state, ic) {
  const torsoY = state.feetY - STANDING_HEIGHT / 2;
  return Math.hypot(ic.x - state.gx, ic.y - torsoY) < ICICLE_PLAYER_HIT_R;
}

function burstPlatformsBetween(state, x, yBefore, yAfter, buildZone) {
  if (!state.platforms || !state.holes) return;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    if (yBefore > p.y || yAfter < p.y) continue;
    if (x < p.x || x > p.x + p.w) continue;
    if (isInHole(state.holes, x, p.y)) continue;
    // Don't burst the build-zone platform — losing the snowman to a stray
    // icicle would be a rage-quit moment, and the design already makes the
    // path dangerous enough.
    if (buildZone && p.hash === buildZone.anchorHash) continue;
    state.holes.push({
      x: x - ICICLE_HOLE_W / 2,
      y: p.y,
      w: ICICLE_HOLE_W,
      age: 0,
    });
    spawnImpactParticles(state, x, p.y);
  }
}

function spawnLayerPuff(state, scene) {
  // Quick burst of snow particles when a layer lands on the snowman, so
  // each delivery has a satisfying "pat" instead of a silent grow.
  if (!state.particles) return;
  const z = scene.buildZone;
  if (!z) return;
  const cx = z.x + z.w / 2;
  const cy = z.y - 2;
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1; // upward fan
    const sp = 40 + Math.random() * 90;
    state.particles.push({
      x: cx + (Math.random() - 0.5) * 8,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.55,
      maxLife: 0.55,
    });
  }
}

function spawnImpactParticles(state, x, y) {
  if (!state.particles) return;
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 110;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4, maxLife: 0.4,
    });
  }
}

// ── Render helpers ──────────────────────────────────────────────────────

// Shared two-sine ripple used by both the ceiling rim and the platform
// snow caps. Two octaves keep the line organic without burning a per-
// frame random table — pixel positions are stable so frost reads as
// frozen, not fizzy.
function iceWaveAt(x) {
  return (
    Math.sin(x * 0.085) * 1.6 +
    Math.sin(x * 0.23 + 1.4) * 0.9 +
    Math.sin(x * 0.41) * 0.4
  );
}

function renderIceTint(ctx, state, paused) {
  // Each platform gets the same frosted treatment as the ceiling rim:
  // a snow ridge with a wavy top edge, a soft gradient body, a frost
  // highlight, and a sparse glitter pattern. The wave amplitude is
  // small (≤ 2 px) so the man's foot landing at p.y still reads as
  // grounded — the ridges just hint at uneven snow.
  if (!state.platforms || state.platforms.length === 0) return;
  ctx.save();
  ctx.globalAlpha = paused ? 0.4 : 1;
  const lh = state.lineHeight || 16;
  const bandH = Math.min(lh, 7);

  for (const p of state.platforms || []) {
    if (!p || p.w == null || p.w < 4) continue;
    const x0 = p.x;
    const w = p.w;
    const top = p.y;
    const bottom = p.y + bandH;

    // Gradient body — snow on top fading to icy blue underneath so the
    // platform feels like a plate of ice with snow accumulated on it.
    const grad = ctx.createLinearGradient(0, top - 2, 0, bottom);
    grad.addColorStop(0, 'rgba(245, 250, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(190, 220, 240, 0.82)');
    grad.addColorStop(1, 'rgba(140, 185, 220, 0.55)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x0 + w; x += 4) {
      ctx.lineTo(x, top - 1 - iceWaveAt(x));
    }
    ctx.lineTo(x0 + w, bottom);
    ctx.closePath();
    ctx.fill();

    // Frost highlight on the snow ridge — bright thin line tracing the wave.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x0 + w; x += 4) {
      const y = top - 1 - iceWaveAt(x);
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Soft shadow line along the bottom edge so each platform reads as
    // a 3D plate, not a flat tint.
    ctx.strokeStyle = 'rgba(60, 100, 140, 0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x0 + w, bottom);
    ctx.stroke();

    // Sparse glitter — count scales with width so wide platforms don't
    // look bare and narrow ones don't speckle.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    const count = Math.max(1, Math.floor(w / 70));
    for (let i = 0; i < count; i++) {
      const sx = x0 + ((i + 0.5) * (w / count)) + ((i * 53) % 17) - 8;
      const sy = top + 1 + ((i * 31) % Math.max(1, bandH - 2));
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  ctx.restore();
}

function renderBuildZone(ctx, scene) {
  const z = scene.buildZone;
  if (!z) return;
  ctx.save();
  // Snow base — soft white pill, sits on the platform like a flat drift.
  const grad = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(1, 'rgba(210, 230, 245, 0.85)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(z.x + 6, z.y + z.h);
  ctx.quadraticCurveTo(z.x, z.y + z.h, z.x, z.y + z.h - 4);
  ctx.quadraticCurveTo(z.x, z.y + 2, z.x + z.w * 0.2, z.y);
  ctx.quadraticCurveTo(z.x + z.w / 2, z.y - 2, z.x + z.w * 0.8, z.y);
  ctx.quadraticCurveTo(z.x + z.w, z.y + 2, z.x + z.w, z.y + z.h - 4);
  ctx.quadraticCurveTo(z.x + z.w, z.y + z.h, z.x + z.w - 6, z.y + z.h);
  ctx.closePath();
  ctx.fill();
  // Glint along the front edge.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(z.x + 8, z.y + 4);
  ctx.quadraticCurveTo(z.x + z.w / 2, z.y - 1, z.x + z.w - 8, z.y + 4);
  ctx.stroke();
  ctx.restore();
}

function renderSnowman(ctx, scene) {
  const z = scene.buildZone;
  if (!z || !scene.builtLayers) return;
  const cx = z.x + z.w / 2;
  const baseY = z.y + 2;                       // sit just above the snow drift
  const radii = [13, 10, 7];                   // base, torso, head
  let bottomY = baseY;

  // Animation timer kicks in once the snowman is finished — the win-hold
  // gets a celebrating snowman instead of a still life.
  const aliveT = scene.winT || 0;
  const alive = aliveT > 0;
  // Subtle breathing scale. Stays close to 1 so the silhouette doesn't
  // visibly shudder, just feels alive.
  const breathe = alive ? 1 + Math.sin(aliveT * 4.5) * 0.03 : 1;

  ctx.save();
  for (let i = 0; i < scene.builtLayers; i++) {
    const r = radii[i] * breathe;
    const cy = bottomY - r;
    drawSnowBall(ctx, cx, cy, r);
    if (i === 1) drawArms(ctx, cx, cy, r, aliveT);
    if (i === 2) drawFace(ctx, cx, cy, r, aliveT);
    bottomY = cy - r + 2;                      // overlap a hair so seams don't show
  }
  ctx.restore();
}

function drawSnowBall(ctx, cx, cy, r) {
  const grad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 1, cx, cy, r);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.6, 'rgba(235, 245, 255, 1)');
  grad.addColorStop(1, 'rgba(180, 205, 230, 1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 150, 180, 0.55)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawArms(ctx, cx, cy, r, aliveT = 0) {
  ctx.save();
  ctx.strokeStyle = 'rgb(95, 60, 30)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  // Mirrored sway — left twig rises while right twig dips. Slightly
  // bigger than the breathing scale so it reads as a wave, not a wobble.
  const sway = aliveT > 0 ? Math.sin(aliveT * 3.2) * r * 0.45 : 0;
  // Left twig.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy);
  ctx.lineTo(cx - r * 1.9, cy - r * 0.8 - sway);
  ctx.moveTo(cx - r * 1.55, cy - r * 0.6 - sway * 0.7);
  ctx.lineTo(cx - r * 1.9, cy - r * 1.3 - sway);
  ctx.stroke();
  // Right twig — opposite phase so the snowman waves both arms.
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, cy);
  ctx.lineTo(cx + r * 1.9, cy - r * 0.8 + sway);
  ctx.moveTo(cx + r * 1.55, cy - r * 0.6 + sway * 0.7);
  ctx.lineTo(cx + r * 1.9, cy - r * 1.3 + sway);
  ctx.stroke();
  ctx.restore();
}

function drawFace(ctx, cx, cy, r, aliveT = 0) {
  ctx.save();
  // Eye blink: closed for a fraction of every cycle so the face reads as
  // alive without the eyes constantly disappearing. Cycle length kept
  // long so blinks are noticeable but not distracting.
  const eyeY = cy - r * 0.2;
  const blinkPhase = aliveT > 0 ? aliveT % 1.7 : 1;
  const blinking = blinkPhase < 0.13;
  if (blinking) {
    ctx.strokeStyle = 'rgb(30, 30, 35)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, eyeY); ctx.lineTo(cx - r * 0.2, eyeY);
    ctx.moveTo(cx + r * 0.2, eyeY);  ctx.lineTo(cx + r * 0.55, eyeY);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgb(30, 30, 35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.38, eyeY, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.38, eyeY, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  // Carrot nose — short, straight on, so it doesn't look like a horn.
  ctx.fillStyle = 'rgb(240, 130, 40)';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.18, cy + r * 0.05);
  ctx.lineTo(cx + r * 0.55, cy + r * 0.18);
  ctx.lineTo(cx - r * 0.18, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 80, 20, 0.7)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Coal smile — three dots curving up so the face reads happy at any
  // size. Smile widens slightly during the alive state.
  ctx.fillStyle = 'rgb(30, 30, 35)';
  const smileSpread = aliveT > 0 ? 0.36 : 0.32;
  const smileLift = aliveT > 0 ? Math.sin(aliveT * 2.2) * r * 0.05 : 0;
  for (let i = -1; i <= 1; i++) {
    const sx = cx + i * r * smileSpread;
    const sy = cy + r * 0.55 + Math.abs(i) * r * 0.1 - smileLift;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderSnowChunks(ctx, scene) {
  if (!scene.snowChunks) return;
  ctx.save();
  for (const c of scene.snowChunks) {
    const intact = c.hits / SNOW_CHUNK_HITS;
    const r = 8 * (0.6 + 0.4 * intact);
    const grad = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, 1, c.x, c.y, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.7, 'rgba(220, 235, 250, 1)');
    grad.addColorStop(1, 'rgba(160, 195, 225, 1)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Sparkle accent — three tiny crosses at offsets, scaled to remaining
    // intact mass so a near-depleted chunk reads as worn.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 0.8;
    const sparkles = [
      [c.x - r * 0.45, c.y - r * 0.55],
      [c.x + r * 0.55, c.y - r * 0.2],
      [c.x - r * 0.1, c.y + r * 0.55],
    ];
    for (const [sx, sy] of sparkles) {
      ctx.beginPath();
      ctx.moveTo(sx - 1.5, sy); ctx.lineTo(sx + 1.5, sy);
      ctx.moveTo(sx, sy - 1.5); ctx.lineTo(sx, sy + 1.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function renderIceCeiling(ctx, state, paused) {
  // A continuous frozen rim that spans the terminal text area. Icicles
  // dangle from its bumpy underside, so the ceiling is a real visible
  // surface instead of an implicit line.
  const top = effectiveHudHeight(state.screenW || 800);
  const bottom = ceilingY(state);
  if (bottom <= top) return;
  const x0 = typeof state.textOffsetX === 'number' ? state.textOffsetX : 0;
  const w = typeof state.textWidth === 'number' && state.textWidth > 0
    ? state.textWidth
    : (state.screenW || 800);

  ctx.save();
  ctx.globalAlpha = paused ? 0.45 : 1;

  const grad = ctx.createLinearGradient(0, top, 0, bottom + 4);
  grad.addColorStop(0, 'rgba(140, 185, 220, 0.9)');
  grad.addColorStop(0.55, 'rgba(220, 235, 250, 0.95)');
  grad.addColorStop(1, 'rgba(170, 205, 235, 0.95)');
  ctx.fillStyle = grad;

  // Top straight, bottom undulating — two sines layered so the wave
  // doesn't look mechanical, and small bumps suggest tiny stalactites
  // along the rim between the larger icicles.
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x0 + w, top);
  ctx.lineTo(x0 + w, bottom);
  for (let x = x0 + w; x >= x0; x -= 4) {
    ctx.lineTo(x, bottom + iceWaveAt(x));
  }
  ctx.lineTo(x0, bottom);
  ctx.closePath();
  ctx.fill();

  // Bright frost line along the very top edge.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, top + 1);
  ctx.lineTo(x0 + w, top + 1);
  ctx.stroke();

  // Subtle shadow along the underside for depth — separates the ceiling
  // from the play area cleanly even when icicles overlap it.
  ctx.strokeStyle = 'rgba(60, 100, 140, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = x0; x <= x0 + w; x += 4) {
    const y = bottom + iceWaveAt(x);
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Sparkle dots scattered through the ice mass — fixed pattern so they
  // don't shimmer wildly each frame.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const sparkleCount = Math.max(8, Math.floor(w / 60));
  for (let i = 0; i < sparkleCount; i++) {
    const sx = x0 + ((i + 0.5) * (w / sparkleCount)) + ((i * 53) % 19) - 9;
    const sy = top + 2 + ((i * 31) % Math.max(1, bottom - top - 4));
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
  }

  ctx.restore();
}

function renderIcicle(ctx, ic) {
  const x = ic.x, y = ic.y;
  const w = ic.w, h = ic.h;
  ctx.save();

  if (ic.state === 'falling') {
    // Soft blue glow trail behind the icicle so its motion reads at speed.
    const trail = ctx.createLinearGradient(x, y - h * 1.2, x, y);
    trail.addColorStop(0, 'rgba(160, 220, 255, 0)');
    trail.addColorStop(1, 'rgba(160, 220, 255, 0.4)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.3, y - h * 1.2);
    ctx.lineTo(x + w * 0.3, y - h * 1.2);
    ctx.lineTo(x + w * 0.5, y);
    ctx.lineTo(x - w * 0.5, y);
    ctx.closePath();
    ctx.fill();
  }

  // Icicle body — narrowing crystal with a highlight ridge down the middle.
  const body = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
  if (ic.state === 'shaking') {
    // Warning tint as the icicle works itself loose. Pulses red as the
    // shake intensity climbs so the last beat before drop is unmistakable.
    const intensity = Math.min(1, (ic.shakeT || 0) / ICICLE_SHAKE_DURATION);
    const warm = 0.4 + 0.6 * intensity;
    body.addColorStop(0, `rgba(${200 + 50 * warm}, ${150 - 80 * intensity}, ${180 - 130 * intensity}, 0.95)`);
    body.addColorStop(0.5, `rgba(255, ${220 - 90 * intensity}, ${230 - 130 * intensity}, 1)`);
    body.addColorStop(1, `rgba(${180 + 60 * warm}, ${130 - 70 * intensity}, ${170 - 130 * intensity}, 0.95)`);
  } else {
    body.addColorStop(0, 'rgba(150, 200, 240, 0.95)');
    body.addColorStop(0.5, 'rgba(230, 245, 255, 1)');
    body.addColorStop(1, 'rgba(110, 170, 220, 0.95)');
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.lineTo(x + w * 0.15, y - h * 0.2);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w * 0.15, y - h * 0.2);
  ctx.closePath();
  ctx.fill();
  // Highlight stripe.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.1, y - h * 0.95);
  ctx.lineTo(x, y - h * 0.05);
  ctx.stroke();
  ctx.restore();
}

function renderRequirementBadge(ctx, scene, screenW) {
  const built = scene.builtLayers || 0;
  ctx.save();
  ctx.font = "bold 16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  if (built >= SNOWMAN_LAYERS) {
    ctx.fillStyle = 'rgba(255, 240, 200, 0.98)';
    ctx.fillText('Snowman complete!', screenW / 2, effectiveHudHeight(screenW) + 4);
  } else {
    const haves = scene.snowballsCollected || 0;
    ctx.fillStyle = 'rgba(220, 240, 255, 0.95)';
    ctx.fillText(`snowman ${built} / ${SNOWMAN_LAYERS}  •  carrying ${haves}`, screenW / 2, effectiveHudHeight(screenW) + 4);
  }
  ctx.restore();
}

function renderGameOver(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(220, 240, 255, 0.98)';
  ctx.font = "bold 48px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 16);
  ctx.font = "16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.fillStyle = 'rgba(220, 240, 255, 0.75)';
  ctx.fillText('press Shift+R to try again', W / 2, H / 2 + 20);
  ctx.restore();
}
