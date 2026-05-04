/**
 * Long-press-S "drill" — punches a hole through the platform under
 * the man's feet so he can drop to the platform below.
 *
 * Holds the same charge-up rhythm as the lightning aim: building
 * `drillCharge` while S is held under the right conditions, releasing
 * it for free if the player lets go before the threshold. At threshold
 * we add an entry to `state.holes` (the same array the lightning bolt
 * and the crouch-burst-jump already use) and unground the man — the
 * existing `isInHole` collision short-circuit then carries him through
 * on the next physics frame.
 *
 * Cancels (charge resets to 0) on:
 *   - S released
 *   - airborne (grounded false)
 *   - rope, axe swing, or lightning aim active
 *
 * Posture-agnostic — the same input works whether the man is standing
 * or prone, so a low-profile drill is reachable without un-proning.
 */

export const DRILL_HOLD_TIME = 0.7;
export const DRILL_HOLE_W = 32;
// Short window where the platform-collision check is bypassed after a
// drill so sideways motion (e.g. holding D mid-drill) can't drift the
// man past the hole edge and snap him back onto the same platform.
// physics.js gates landing on `dropThrough <= 0`; 150 ms is long
// enough for gravity to push feet past its `prevFeetY + 4` tolerance
// regardless of horizontal velocity.
const DRILL_DROP_THROUGH = 0.15;

export function initialDrill() {
  return { drillCharge: 0 };
}

export function tickDrill(state, dt, keys) {
  if (!state || !keys) return;
  const sHeld = keys.has('KeyS');
  const eligible = sHeld
    && state.grounded
    && !state.rope
    && !state.axeSwing
    && !state.lightningAim;
  if (!eligible) {
    state.drillCharge = 0;
    return;
  }
  state.drillCharge = (state.drillCharge || 0) + dt;
  if (state.drillCharge < DRILL_HOLD_TIME) return;
  state.drillCharge = 0;
  triggerDrill(state);
}

export function triggerDrill(state) {
  if (!state || !state.standingHash) return false;
  if (!Array.isArray(state.platforms) || !Array.isArray(state.holes)) return false;
  const plat = state.platforms.find((p) => p.hash === state.standingHash);
  if (!plat) return false;
  // If a hole already covers the man's x at this platform, skip — the
  // player already drilled through here. Avoids stacking redundant
  // hole records when the player long-presses on a re-traversed gap.
  for (const h of state.holes) {
    if (Math.abs(h.y - plat.y) < 2 && state.gx >= h.x && state.gx <= h.x + h.w) return false;
  }
  state.holes.push({
    x: state.gx - DRILL_HOLE_W / 2,
    y: plat.y,
    w: DRILL_HOLE_W,
    age: 0,
  });
  state.grounded = false;
  state.standingHash = 0;
  state.dropThrough = DRILL_DROP_THROUGH;
  if (Array.isArray(state.particles)) {
    spawnDrillDust(state.particles, state.gx, plat.y);
  }
  return true;
}

function spawnDrillDust(particles, x, y) {
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI + Math.random() * Math.PI; // upward hemisphere
    const sp = 30 + Math.random() * 70;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 30,
      life: 0.45,
      maxLife: 0.45,
    });
  }
}
