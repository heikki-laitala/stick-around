import {
  MANA_MINE_HITS,
  MANA_MINE_LIFETIME,
  MANA_MINE_MAX,
  MANA_MINE_SPAWN_INTERVAL,
  MANA_MINE_MIN_DIST,
} from './constants.js';

let spawnTimer = 0;

/**
 * Spawn a mana mine on a random platform wide enough to host one.
 * Returns the mine object, or null if no valid spot is found.
 */
export function spawnManaMine(platforms, existing) {
  if (platforms.length === 0) return null;

  for (let attempt = 0; attempt < 10; attempt++) {
    const plat = platforms[Math.floor(Math.random() * platforms.length)];
    if (plat.w < 40) continue;

    const x = plat.x + 16 + Math.random() * (plat.w - 32);
    const y = plat.y;

    let tooClose = false;
    for (const e of existing) {
      if (Math.hypot(e.x - x, e.y - y) < MANA_MINE_MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    return { x, y, hits: MANA_MINE_HITS, age: 0, hash: plat.hash || 0 };
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

  for (let i = state.manaMines.length - 1; i >= 0; i--) {
    const m = state.manaMines[i];
    m.age += dt;
    // Debug mines never expire by age — they persist and respawn on depletion
    // so the player can practice mining in place.
    if (!m.debug && m.age >= MANA_MINE_LIFETIME) {
      state.manaMines.splice(i, 1);
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
        debug: true,
      });
    }
  }

  spawnTimer += dt;
  if (spawnTimer >= MANA_MINE_SPAWN_INTERVAL && state.manaMines.length < MANA_MINE_MAX) {
    spawnTimer = 0;
    const m = spawnManaMine(state.platforms, state.manaMines);
    if (m) state.manaMines.push(m);
  }
}
