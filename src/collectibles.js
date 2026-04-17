import { findFloor } from './platforms.js';

const MAX_COLLECTIBLES = 5;
const COLLECT_RADIUS = 15;
const SPAWN_INTERVAL = 2.0; // seconds between spawn attempts
const MIN_DIST = 40; // minimum distance between collectibles
const LIFETIME = 10; // seconds before a collectible expires
const GRAV = 600; // gravity for collectibles (slightly less than player)

let spawnTimer = 0;

/**
 * Spawn a collectible on a random platform.
 * Returns the collectible object or null if no valid spot found.
 */
export function spawnCollectible(platforms, existing) {
  if (platforms.length === 0) return null;

  // Try a few times to find a good spot
  for (let attempt = 0; attempt < 10; attempt++) {
    const plat = platforms[Math.floor(Math.random() * platforms.length)];
    if (plat.w < 30) continue; // too narrow

    const x = plat.x + 10 + Math.random() * (plat.w - 20);
    const y = plat.y;

    // Check distance from existing collectibles
    let tooClose = false;
    for (const e of existing) {
      if (Math.hypot(e.x - x, e.y - y) < MIN_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    return { x, y, vy: 0, grounded: true, age: 0 };
  }

  return null;
}

/**
 * Update collectibles: physics, collection, age, and spawn new ones.
 * Mutates state.collectibles, state.score.
 */
export function updateCollectibles(state, dt) {
  if (!state.hasSpawned) return;

  const screenH = state.screenH || 600;

  for (let i = state.collectibles.length - 1; i >= 0; i--) {
    const c = state.collectibles[i];
    c.age += dt;

    // Expire old collectibles — debug pins are exempt so they persist.
    if (!c.debug && c.age >= LIFETIME) {
      state.collectibles.splice(i, 1);
      continue;
    }

    // Gravity and platform collision
    if (!c.grounded) {
      c.vy += GRAV * dt;
      const prevY = c.y;
      c.y += c.vy * dt;

      // Land on platform
      if (c.vy >= 0) {
        const floor = findFloor(state.platforms, prevY - 1, c.x, screenH);
        if (floor && c.y >= floor.y && prevY <= floor.y + 4) {
          c.y = floor.y;
          c.vy = 0;
          c.grounded = true;
        }
      }

      // Remove if fell off screen
      if (c.y > screenH + 20) {
        state.collectibles.splice(i, 1);
        continue;
      }
    } else {
      // Check if platform still exists beneath
      const floor = findFloor(state.platforms, c.y - 1, c.x, screenH);
      if (!floor || Math.abs(c.y - floor.y) > 2) {
        c.grounded = false;
      }
    }

    // Collection check — proximity to man's position
    const dx = state.gx - c.x;
    const dy = state.feetY - c.y;
    if (Math.hypot(dx, dy) < COLLECT_RADIUS) {
      state.collectibles.splice(i, 1);
      state.score += 1;
      if (state.particles) {
        for (let j = 0; j < 8; j++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 30 + Math.random() * 80;
          state.particles.push({
            x: c.x, y: c.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40,
            life: 0.3 + Math.random() * 0.3,
            maxLife: 0.6,
          });
        }
      }
    }
  }

  // Debug: while DEBUG_PLATFORMS is on, keep one pinned glowing ball next
  // to the man's position at the moment debug was toggled on.
  if (state.DEBUG_PLATFORMS && state.debugAnchorX != null) {
    const hasDebug = state.collectibles.some((c) => c.debug);
    if (!hasDebug) {
      state.collectibles.push({
        x: state.debugAnchorX - 20,
        y: state.debugAnchorY,
        vy: 0, grounded: true, age: 0,
        debug: true,
      });
    }
  }

  // Spawn new collectibles periodically
  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL && state.collectibles.length < MAX_COLLECTIBLES) {
    spawnTimer = 0;
    const c = spawnCollectible(state.platforms, state.collectibles);
    if (c) state.collectibles.push(c);
  }
}
