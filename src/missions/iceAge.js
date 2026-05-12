import { torsoY } from '../poses.js';
import { isInHole } from '../platforms.js';
import { resetPlayer } from '../physics.js';
import { hazardDt, isShielded } from '../spells.js';
import {
  burstParticles,
  findPlatformByHash,
  missionTopY,
  renderGameOver,
  spawnOnPlatform,
  spawnXRange,
} from './_shared.js';
import {
  renderBuildZone,
  renderIceCeiling,
  renderIceTint,
  renderIcicle,
  renderIcicleDangerShadows,
  renderRequirementBadge,
  renderSnowChunks,
  renderSnowFlakes,
  renderSnowman,
} from './iceAge/render.js';

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

// ── Snowman / build zone ───────────────────────────────────────────────
export const SNOWMAN_LAYERS = 3;
// Once the head goes on, the mission holds for a beat so the player can
// see what they built before the ladder advances. Long enough for the
// snowman to register, short enough that it doesn't feel like a stall.
export const WIN_HOLD = 1.8;
export const BUILD_ZONE_W = 56;
export const BUILD_ZONE_H = 24;

// ── Snow chunks ────────────────────────────────────────────────────────
// Chunks behave like mana mines: each one ages out and a fresh one spawns
// somewhere else, so the player can't camp a single platform — they're
// forced to traverse the map between mining sessions, which is when the
// icicles do their job.
export const SNOW_CHUNK_COUNT = 5;            // total chunks alive at once
export const SNOW_CHUNK_HITS = 2;             // axe hits per chunk — quicker than mana
export const SNOW_CHUNK_LIFETIME = 22;        // seconds before a chunk melts
export const SNOW_CHUNK_SPAWN_INTERVAL = 3.5; // seconds between respawn attempts
export const SNOW_CHUNK_MIN_DIST = 80;        // px between any two chunks
export const SNOW_CHUNK_Y_OFFSET = 8;         // chunk sits this far above its platform

// ── Icicles ────────────────────────────────────────────────────────────
// Persistent ceiling field — every icicle hangs here between drops so the
// player can read where the hazards live before the next one shakes loose.
export const CEILING_ICICLE_COUNT = 9;
export const ICICLE_W = 14;
export const ICICLE_H = 28;
export const ICICLE_FALL_SPEED = 360;
export const ICICLE_SPAWN_INTERVAL = 1.6;     // base seconds between drops
export const ICICLE_SPAWN_RAMP = 0.6;         // tightens by this fraction near the end
export const ICICLE_SHAKE_DURATION = 0.7;     // seconds of warning shake before drop
export const ICICLE_SHAKE_AMPLITUDE = 2.5;    // pixels of horizontal jiggle
export const ICICLE_HOLE_W = 30;              // platform burst width on impact
export const ICICLE_PLAYER_HIT_R = 16;        // collision radius vs the man
export const ICICLE_DANGER_W = 28;            // ground shadow width = approx hole width

// ── Ambient ────────────────────────────────────────────────────────────
// Drifting snow — purely cosmetic, never collides with anything.
export const SNOW_AMBIENT_COUNT = 60;

const PROMPT_PLATFORM_HASH = 0xFFFF;

export function ceilingY(state) {
  return missionTopY(state) - 4;               // tiny inset so icicle tips poke down
}

function eligiblePlatforms(state) {
  return (state.platforms || []).filter((p) =>
    p && typeof p.hash === 'number' && p.hash !== 0 && p.hash !== PROMPT_PLATFORM_HASH,
  );
}

function findPromptPlatform(state) {
  return (state.platforms || []).find((p) => p && p.hash === PROMPT_PLATFORM_HASH) || null;
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
  const buildZoneHash = scene.buildZone?.anchorHash;
  return spawnOnPlatform(eligiblePlatforms(state), {
    minW: 32,
    dxFracMin: 0.18,
    dxFracMax: 0.82,
    minDist: SNOW_CHUNK_MIN_DIST,
    existing: scene.snowChunks || [],
    attempts: 12,
    accept(plat) {
      // Don't seed chunks on the build-zone platform — keeps that line
      // clean for the snowman.
      return buildZoneHash == null || plat.hash !== buildZoneHash;
    },
    makeItem(plat, dxFrac) {
      return makeSnowChunk(plat, dxFrac);
    },
  });
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
  // Refill toward SNOW_CHUNK_COUNT on the spawn cadence. The timer only
  // advances while the field has room — otherwise time would bank up at
  // cap and the next axe-out triggers an immediate respawn.
  if (scene.snowChunks.length >= SNOW_CHUNK_COUNT) {
    scene.snowChunkSpawnTimer = 0;
    return;
  }
  scene.snowChunkSpawnTimer = (scene.snowChunkSpawnTimer || 0) + dt;
  if (scene.snowChunkSpawnTimer >= SNOW_CHUNK_SPAWN_INTERVAL) {
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
  const anchor = findPlatformByHash(state.platforms,zone.anchorHash);
  if (!anchor) return;
  zone.x = anchor.x + zone.anchorOffsetX;
  zone.y = anchor.y - zone.h;
}

function syncSnowChunks(state, chunks) {
  if (!chunks) return;
  for (const c of chunks) {
    const anchor = findPlatformByHash(state.platforms,c.hash);
    if (!anchor) continue;
    c.x = anchor.x + anchor.w * c.dxFrac;
    c.y = anchor.y - SNOW_CHUNK_Y_OFFSET;
  }
}

function manInBuildZone(state, zone) {
  if (!zone) return false;
  return state.gx >= zone.x
    && state.gx <= zone.x + zone.w
    && torsoY(state) <= zone.y + zone.h
    && state.feetY >= zone.y;
}

export const ICE_AGE_MISSION = {
  id: 'ice-age',
  text: 'Build a snowman from snow chunks',
  subtitle: 'mine snow with F, deliver three chunks to the build zone — watch for falling icicles',
  rewardTitle: 'snow architect',
  unlocks: ['ice-age-survivor'],

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    const built = scene.builtLayers || 0;
    const carry = scene.snowballsCollected || 0;
    return `(${built}/${SNOWMAN_LAYERS} · carrying ${carry})`;
  },

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

    // Build-zone delivery on the rising edge of "in zone" — one entry empties
    // the player's haul up to the snowman cap, so a player who collected
    // several chunks isn't forced to bounce in and out of the zone repeatedly.
    const inZone = manInBuildZone(state, scene.buildZone);
    if (inZone && !scene.wasInBuildZone) {
      const room = SNOWMAN_LAYERS - scene.builtLayers;
      const deposit = Math.min(scene.snowballsCollected, room);
      if (deposit > 0) {
        scene.snowballsCollected -= deposit;
        scene.builtLayers += deposit;
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

// ── Ceiling icicles & state machine ─────────────────────────────────────

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

    // 'falling' — stasis slows the descent so the player can sidestep.
    const yBefore = ic.y;
    ic.y += ic.vy * hazardDt(state, dt);

    // Hit the man — instant fail unless shielded (parity with meteor shower).
    if (hitsMan(state, ic)) {
      burstParticles(state, ic.x, ic.y);
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
      burstParticles(state, ic.x, ic.y);
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
  return Math.hypot(ic.x - state.gx, ic.y - torsoY(state)) < ICICLE_PLAYER_HIT_R;
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
    burstParticles(state, x, p.y);
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

