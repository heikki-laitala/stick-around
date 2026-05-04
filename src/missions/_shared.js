/**
 * Cross-mission helpers. Keep this file boring — just primitives that are
 * provably needed by 2+ missions. Anything mission-specific belongs in
 * the mission's own file.
 */

import { effectiveHudHeight } from '../constants.js';

/**
 * Top y of the terminal text area — the y at which a mission may
 * legitimately spawn hazards / items / scenery without colliding with
 * the HUD strip or the terminal title bar.
 *
 * `state.textOffsetY` is the canonical value (set by the Rust side
 * when terminal metrics arrive); falls back to the per-screen-width
 * HUD height when the metrics aren't yet known so the very first
 * frame after activation still renders sensibly.
 */
export function missionTopY(state) {
  const y = state?.textOffsetY;
  if (typeof y === 'number' && y > 0) return y;
  return effectiveHudHeight(state?.screenW);
}

/**
 * The base of every mission's `restart*` helper — clears the gameOver
 * latch and wipes per-run scene state so the next `advanceMission`
 * tick re-runs `onEnter` from scratch. Mission-specific cleanup
 * (e.g. flashing a ball counter) layers on top.
 *
 * Mainly a test seam now; production code goes through
 * `progression.restartActiveMission` which does this cleanup *plus*
 * a full physics reset (player, collectibles, particles, holes).
 */
export function resetMissionBase(state) {
  state.gameOver = false;
  state.currentMissionId = null;
  state.missionScene = null;
}

/**
 * Standard fail overlay used by every mission that has an instant-death
 * state (lava, meteors, icicles). Dim wash + serif "GAME OVER" + a small
 * hint line below.
 */
export function renderGameOver(ctx, W, H, hint = 'press Shift+R to try again') {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255, 220, 120, 0.98)';
  ctx.font = "bold 48px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 16);
  ctx.font = "16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.fillStyle = 'rgba(255, 220, 120, 0.75)';
  ctx.fillText(hint, W / 2, H / 2 + 20);
  ctx.restore();
}

/**
 * Find a platform by its stable line-hash. Returns null if the platform
 * has scrolled off, been edited away, or `hash` is null/0.
 */
export function findPlatformByHash(platforms, hash) {
  if (!platforms || hash == null) return null;
  for (const p of platforms) if (p && p.hash === hash) return p;
  return null;
}

/**
 * Horizontal range of the terminal text area, used by missions that spawn
 * hazards or items at random x coordinates. Falls back to screen edges
 * when terminal metrics aren't yet known.
 */
export function spawnXRange(state) {
  const x0 = typeof state.textOffsetX === 'number' ? state.textOffsetX : 0;
  const w = typeof state.textWidth === 'number' && state.textWidth > 0
    ? state.textWidth
    : (state.screenW || 800);
  return { x0, x1: x0 + w };
}

/**
 * Try to place a new item on a random platform that satisfies the
 * mission's constraints. Mirrors the pattern shared by mana mines, ice-
 * age snow chunks, and evil-twin mana orbs: pick a random wide platform,
 * sample a fractional offset, reject if too close to existing items or
 * if a mission-supplied predicate refuses the spot, return null after
 * a fixed number of attempts.
 *
 * Options:
 *   minW         minimum platform width
 *   edgePx       per-platform pixel inset (auto-clamps the fractional
 *                range so items don't spawn within `edgePx` of the edges)
 *   dxFracMin    additional fractional-offset lower bound (defaults 0)
 *   dxFracMax    additional fractional-offset upper bound (defaults 1)
 *   existing     items to avoid; rejection radius = `minDist`
 *   minDist      px distance below which a candidate is rejected
 *   attempts     how many platforms to try before giving up
 *   accept       optional `(plat, dxFrac, x, y) → bool` filter
 *   makeItem     `(plat, dxFrac, x, y) → item` factory — required
 *
 * Returns the constructed item, or null when no spot satisfies the
 * constraints within `attempts` tries.
 */
export function spawnOnPlatform(platforms, opts) {
  if (!Array.isArray(platforms) || platforms.length === 0) return null;
  const minW = opts.minW ?? 32;
  const edgePx = opts.edgePx ?? 0;
  const dxMinDefault = opts.dxFracMin ?? 0;
  const dxMaxDefault = opts.dxFracMax ?? 1;
  const minDist = opts.minDist ?? 60;
  const existing = opts.existing || [];
  const attempts = opts.attempts ?? 12;
  const accept = opts.accept;
  const makeItem = opts.makeItem;
  if (typeof makeItem !== 'function') return null;

  for (let n = 0; n < attempts; n++) {
    const plat = platforms[Math.floor(Math.random() * platforms.length)];
    if (!plat || plat.w < minW) continue;
    const edgeFrac = plat.w > 0 ? edgePx / plat.w : 0;
    const fmin = Math.max(dxMinDefault, edgeFrac);
    const fmax = Math.min(dxMaxDefault, 1 - edgeFrac);
    if (fmin >= fmax) continue;
    const dxFrac = fmin + Math.random() * (fmax - fmin);
    const x = plat.x + plat.w * dxFrac;
    const y = plat.y;
    if (accept && !accept(plat, dxFrac, x, y)) continue;
    let tooClose = false;
    for (const e of existing) {
      if (Math.hypot(e.x - x, e.y - y) < minDist) { tooClose = true; break; }
    }
    if (tooClose) continue;
    return makeItem(plat, dxFrac, x, y);
  }
  return null;
}

import { isInHole } from '../platforms.js';

/**
 * Punch holes in every platform top whose y crosses the segment from
 * `(xBefore, yBefore)` to `(xAfter, yAfter)` — meteors and shards both
 * use this when they fall through the play area. `holeW` controls how
 * wide the hole is; `onCross` is an optional callback fired at the
 * crossing point (use it for a particle burst etc.). A crossing that
 * lands inside an existing hole is skipped so repeat hits at the same
 * spot don't pile up redundant entries.
 */
export function burstPlatformsBetween(state, xBefore, yBefore, xAfter, yAfter, holeW, onCross) {
  if (!state.platforms || !state.holes) return;
  const dy = yAfter - yBefore;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    if (yBefore > p.y || yAfter < p.y) continue;
    const t = dy !== 0 ? (p.y - yBefore) / dy : 0;
    const crossX = xBefore + (xAfter - xBefore) * t;
    if (crossX < p.x || crossX > p.x + p.w) continue;
    if (isInHole(state.holes, crossX, p.y)) continue;
    state.holes.push({ x: crossX - holeW / 2, y: p.y, w: holeW, age: 0 });
    if (onCross) onCross(crossX, p.y);
  }
}

/**
 * Spray a quick burst of debris particles at (x, y). Used for hazard
 * impacts (lava splashes, meteor crashes, icicle bursts). Defaults match
 * the existing meteor/icicle impact look — wider/fatter or upward-fanned
 * variants pass overrides.
 */
export function burstParticles(state, x, y, opts = {}) {
  if (!state.particles) return;
  const count = opts.count ?? 10;
  const speedMin = opts.speedMin ?? 60;
  const speedMax = opts.speedMax ?? 180;
  const life = opts.life ?? 0.4;
  const arcStart = opts.arcStart ?? 0;
  const arcSpan = opts.arcSpan ?? Math.PI * 2;
  const biasY = opts.biasY ?? 0;
  for (let i = 0; i < count; i++) {
    const a = arcStart + Math.random() * arcSpan;
    const sp = speedMin + Math.random() * (speedMax - speedMin);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + biasY,
      life,
      maxLife: life,
    });
  }
}

