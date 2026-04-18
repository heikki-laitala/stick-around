import { findFloor } from './platforms.js';

export const ITEM_GRAVITY = 600;

// findFloor synthesizes a floor at screenH - 4 so the player doesn't fall
// out of the world. Items are different: when their platform is gone we
// want them to keep falling past the bottom and get cleaned up. Pass a
// huge sentinel as screenH so that virtual floor is never within reach.
const NO_VIRTUAL_GROUND = Number.MAX_SAFE_INTEGER;

/**
 * Advance one world item (collectible, mana mine, future drops, ...) by
 * one physics step. Items share the same falling + landing behavior: when
 * no platform is beneath, gravity pulls them down; when a platform appears
 * they land; when they pass the screen bottom they're gone.
 *
 * Mutates item.vy, item.y, and item.grounded. Returns false when the
 * item has fallen off-screen and the caller should remove it.
 */
export function stepItemPhysics(item, platforms, screenH, dt) {
  if (item.grounded) {
    const floor = findFloor(platforms, item.y - 1, item.x, NO_VIRTUAL_GROUND);
    if (floor && Math.abs(item.y - floor.y) <= 2) return true;
    item.grounded = false;
  }

  item.vy += ITEM_GRAVITY * dt;
  const prevY = item.y;
  item.y += item.vy * dt;

  if (item.vy >= 0) {
    const floor = findFloor(platforms, prevY - 1, item.x, NO_VIRTUAL_GROUND);
    if (floor && item.y >= floor.y && prevY <= floor.y + 4) {
      item.y = floor.y;
      item.vy = 0;
      item.grounded = true;
    }
  }

  return item.y <= screenH + 20;
}
