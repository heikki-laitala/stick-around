import { effectiveHudHeight } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';
import { isInHole } from '../platforms.js';
import { resetPlayer } from '../physics.js';
import { hazardDt } from '../spells.js';
import { burstParticles, renderGameOver, spawnXRange } from './_shared.js';
import { drawShards } from './shardfall/render.js';

/**
 * "Shardfall" mission.
 *
 * Magical shards rain from the top. The player has to intercept them
 * with their body — walk underneath as one lands, or jump up to grab
 * one mid-fall. The catch is the speed: shards drop fast enough that
 * pure reflex isn't always enough.
 *
 * For the duration of the mission, the player has access to the
 * `stasis` spell — hold the slot to slow falling shards to 0.25× and
 * carve out a window to read trajectories and reposition. Mana drains
 * while held (managed by spells.js), so the player can't sit on it.
 *
 * Completing the mission unlocks the `stasis` flag, the spell's
 * permanent unlock for future runs.
 */

export const SHARDFALL_DURATION = 60;              // seconds before timeout
export const SHARDFALL_PRIMER_MANA = 30;           // ~5s of stasis on top of catching gameplay
export const SHARDFALL_GOAL = 6;                   // shards needed to win
export const SHARDFALL_TOTAL_SHARDS = 15;          // shards spawned across the mission — keeps falling until the timer ends
export const SHARD_FALL_SPEED = 320;               // px/sec downward velocity at spawn
export const SHARD_HIT_RADIUS = 18;                // catch radius against the player torso
export const SHARD_RADIUS = 9;                     // visual radius
export const SHARD_HOLE_W = 22;                    // width of the hole a shard punches through a platform top
export const GOLD_SHARD_CHANCE = 0.15;             // fraction of spawns that come up gold
export const GOLD_SHARD_VALUE = 2;                 // counted toward the goal when caught

function spawnY(state) {
  const top = typeof state.textOffsetY === 'number' && state.textOffsetY > 0
    ? state.textOffsetY
    : effectiveHudHeight(state.screenW);
  return top - 24;
}

function spawnShard(state, scene) {
  const { x0, x1 } = spawnXRange(state);
  const w = Math.max(1, x1 - x0);
  // Bias spawns to the inner 80% of the spawn range so shards never
  // land directly on the screen edge where the player can't reach.
  const fx = 0.10 + Math.random() * 0.80;
  const x = x0 + w * fx;
  const y = spawnY(state);
  // Speed varies a bit so the player can't memorise one cadence — the
  // slowest shards are catchable without stasis, the fastest need it.
  const vy = SHARD_FALL_SPEED * (0.85 + Math.random() * 0.5);
  const kind = Math.random() < GOLD_SHARD_CHANCE ? 'gold' : 'common';
  scene.shards.push({ x, y, vy, caught: false, kind });
}

function intersectsPlayer(state, shard) {
  const torsoY = state.feetY - STANDING_HEIGHT / 2;
  return Math.hypot(shard.x - state.gx, shard.y - torsoY) < SHARD_HIT_RADIUS;
}

/**
 * Punch holes through every platform top the shard crossed during this
 * tick — same shape the meteor shower uses, just with a smaller hole
 * since shards are slimmer. Handy side effect: walking under a shard
 * is harder once a few have already torn the platforms above you.
 */
function burstPlatforms(state, xBefore, yBefore, xAfter, yAfter) {
  if (!state.platforms || !state.holes) return;
  const dy = yAfter - yBefore;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    if (yBefore > p.y || yAfter < p.y) continue;
    const t = dy !== 0 ? (p.y - yBefore) / dy : 0;
    const crossX = xBefore + (xAfter - xBefore) * t;
    if (crossX < p.x || crossX > p.x + p.w) continue;
    if (isInHole(state.holes, crossX, p.y)) continue;
    state.holes.push({ x: crossX - SHARD_HOLE_W / 2, y: p.y, w: SHARD_HOLE_W, age: 0 });
    burstParticles(state, crossX, p.y, { count: 6, speedMin: 40, speedMax: 120, life: 0.3 });
  }
}

export const SHARDFALL_MISSION = {
  id: 'shardfall',
  text: 'Catch the falling shards',
  subtitle: 'walk under or jump up to grab one — hold 3 or R to cast stasis',
  rewardTitle: 'chronomancer',
  unlocks: ['stasis'],

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    const left = Math.max(0, scene.timeLeft || 0);
    return `(${scene.caughtCount || 0}/${SHARDFALL_GOAL} · ${left.toFixed(1)}s)`;
  },

  onEnter(state) {
    const scene = state.missionScene;
    if ((state.mana || 0) < SHARDFALL_PRIMER_MANA) {
      state.mana = SHARDFALL_PRIMER_MANA;
    }
    // Auto-select the stasis slot so a bare R press activates the
    // spell — the player shouldn't have to remember to switch slots
    // first when the whole mission is about that spell. Save the
    // previous selection so onExit can restore it; otherwise the
    // selection would survive into the next mission and R would
    // cast stasis there instead of the player's prior preference.
    scene.prevSpellIdx = state.spellIdx;
    const stasisIdx = state.spells ? state.spells.indexOf('stasis') : -1;
    if (stasisIdx >= 0) state.spellIdx = stasisIdx;
    scene.timeLeft = SHARDFALL_DURATION;
    scene.shards = [];
    scene.caughtCount = 0;
    scene.missedCount = 0;
    scene.spawnTimer = 0;
    // Spawn shards evenly across the whole mission window so the
    // player is never standing around with time left but no targets.
    // Goal is below the spawn count, so a few misses are forgivable.
    scene.spawnInterval = SHARDFALL_DURATION / SHARDFALL_TOTAL_SHARDS;
    scene.spawnsLeft = SHARDFALL_TOTAL_SHARDS;
    state.gameOver = false;
    resetPlayer(state);
  },

  check(state) {
    const scene = state.missionScene;
    if (!scene) return false;
    return (scene.caughtCount || 0) >= SHARDFALL_GOAL;
  },

  onExit(state) {
    // Restore whichever spell the player had selected before the
    // mission auto-switched them to stasis, so the next mission's
    // R press resumes the player's prior preference.
    const scene = state.missionScene;
    if (scene && typeof scene.prevSpellIdx === 'number') {
      state.spellIdx = scene.prevSpellIdx;
    }
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
    if (state.gameOver) return;

    const goalMet = (scene.caughtCount || 0) >= SHARDFALL_GOAL;
    // Stasis state lives on `state` (drained + aged in tickSpells),
    // and `hazardDt` scales motion by STASIS_SCALE while it's active.
    const shardDt = hazardDt(state, dt);
    const screenH = state.screenH || 9999;

    for (let i = scene.shards.length - 1; i >= 0; i--) {
      const shard = scene.shards[i];
      const yBefore = shard.y;
      shard.y += shard.vy * shardDt;
      burstPlatforms(state, shard.x, yBefore, shard.x, shard.y);
      if (intersectsPlayer(state, shard)) {
        const value = shard.kind === 'gold' ? GOLD_SHARD_VALUE : 1;
        scene.caughtCount = (scene.caughtCount || 0) + value;
        // Gold catch lands a bigger, warmer particle burst at the
        // player's body so the moment reads as "you got the rare one".
        if (shard.kind === 'gold') {
          burstParticles(state, shard.x, shard.y, {
            count: 14, speedMin: 80, speedMax: 220, life: 0.5,
          });
        }
        scene.shards.splice(i, 1);
        continue;
      }
      if (shard.y > screenH + 30) {
        scene.missedCount = (scene.missedCount || 0) + 1;
        scene.shards.splice(i, 1);
      }
    }

    // Spawn ramp: drip shards in over time so the player doesn't get
    // overwhelmed immediately. Stops once the quota is exhausted —
    // anything still in flight is the only target left.
    if ((scene.spawnsLeft || 0) > 0) {
      scene.spawnTimer = (scene.spawnTimer || 0) + dt;   // spawn cadence ignores stasis
      while (scene.spawnTimer >= scene.spawnInterval && scene.spawnsLeft > 0) {
        scene.spawnTimer -= scene.spawnInterval;
        spawnShard(state, scene);
        scene.spawnsLeft -= 1;
      }
    }

    if (goalMet) return;

    scene.timeLeft = Math.max(0, (scene.timeLeft || 0) - dt);
    if (scene.timeLeft <= 0) {
      state.gameOver = true;
      state.gvx = 0;
      state.gvy = 0;
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    drawShards(ctx, scene);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};
