/**
 * Cross-mission helpers. Keep this file boring — just primitives that are
 * provably needed by 2+ missions. Anything mission-specific belongs in
 * the mission's own file.
 */

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

