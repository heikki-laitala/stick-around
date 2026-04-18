import {
  MANA_MINE_HITS,
  MANA_MINE_LIFETIME,
  MANA_MINE_MAX,
  MANA_MINE_SPAWN_INTERVAL,
  MANA_MINE_MIN_DIST,
} from './constants.js';
import { findCeiling } from './platforms.js';
import { stepItemPhysics } from './itemPhysics.js';
import { PRONE_HEIGHT } from './poses.js';

// The man can swing an axe in any posture, so a mine only needs enough
// clearance for the prone pose — that's the lowest way he can approach
// the spot. A little slack keeps the swing arc from clipping the ceiling.
const MIN_CLEARANCE = PRONE_HEIGHT + 4;

let spawnTimer = 0;

/**
 * Spawn a mana mine on a random platform that (a) is wide enough to host
 * one and (b) has standing clearance above it, so the man can actually
 * reach the spot and swing an axe. Returns null if no valid spot is found.
 */
export function spawnManaMine(platforms, existing, lineHeight = 16) {
  if (platforms.length === 0) return null;

  for (let attempt = 0; attempt < 15; attempt++) {
    const plat = platforms[Math.floor(Math.random() * platforms.length)];
    if (plat.w < 40) continue;

    const x = plat.x + 16 + Math.random() * (plat.w - 32);
    const y = plat.y;

    // Reject if a ceiling platform is close enough to block standing.
    const ceiling = findCeiling(platforms, y, x, lineHeight);
    if (ceiling) {
      const ceilingBottom = ceiling.y + lineHeight;
      if (y - ceilingBottom < MIN_CLEARANCE) continue;
    }

    // Reject if too close to another mine.
    let tooClose = false;
    for (const e of existing) {
      if (Math.hypot(e.x - x, e.y - y) < MANA_MINE_MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    return { x, y, hits: MANA_MINE_HITS, age: 0, hash: plat.hash || 0, dx: x - plat.x, vy: 0, grounded: true };
  }

  return null;
}

/**
 * Age mana mines and despawn those past their lifetime, then spawn new
 * ones periodically up to MANA_MINE_MAX. Axe hits (in physics.js) are
 * responsible for depleting hits and awarding mana.
 */
export function updateManaMines(state, dt) {
  if (!state.hasSpawned) return;
  if (!state.manaMines) state.manaMines = [];

  const screenH = state.screenH || 600;

  for (let i = state.manaMines.length - 1; i >= 0; i--) {
    const m = state.manaMines[i];
    m.age += dt;
    // Debug mines never expire by age — they persist and respawn on depletion
    // so the player can practice mining in place.
    if (!m.debug && m.age >= MANA_MINE_LIFETIME) {
      state.manaMines.splice(i, 1);
      continue;
    }

    // Shared item physics — debug pins stay put for practice.
    if (!m.debug) {
      const alive = stepItemPhysics(m, state.platforms, screenH, dt);
      if (!alive) state.manaMines.splice(i, 1);
    }
  }

  // Debug: while DEBUG_PLATFORMS is on and an anchor was captured, keep one
  // pinned mine next to the man's position for easier mining practice.
  if (state.DEBUG_PLATFORMS && state.debugAnchorX != null) {
    const hasDebug = state.manaMines.some((m) => m.debug);
    if (!hasDebug) {
      state.manaMines.push({
        x: state.debugAnchorX + 30,
        y: state.debugAnchorY,
        hits: MANA_MINE_HITS,
        age: 0,
        hash: 0,
        vy: 0,
        grounded: true,
        debug: true,
      });
    }
  }

  spawnTimer += dt;
  if (spawnTimer >= MANA_MINE_SPAWN_INTERVAL && state.manaMines.length < MANA_MINE_MAX) {
    spawnTimer = 0;
    const m = spawnManaMine(state.platforms, state.manaMines, state.lineHeight);
    if (m) state.manaMines.push(m);
  }
}
