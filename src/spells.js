/**
 * Spell system. Mana earned from mining mana mines is spent here.
 *
 * Two spells today:
 *   - `shield`    toggles a magical dome that drains mana continuously
 *                 while active and absorbs mission hazards.
 *   - `lightning` uses a rope-style aim: press-to-aim, release-to-fire.
 *                 The launched bolt is a straight ray that vaporises
 *                 hazards whose perpendicular distance to the ray is
 *                 within LIGHTNING_BEAM_WIDTH/2. Mana is charged only on
 *                 fire, so cancelling mid-aim is free.
 *
 * Mana is stored as a float so drain can be smooth; callers that
 * display mana should `Math.floor` it.
 *
 * State shape (flattened onto the game state via `initialSpells()`):
 *   spells: string[]             — ordered list shown in the HUD
 *   spellIdx: number             — index into spells
 *   shieldActive: boolean        — true while the dome is up
 *   shieldFadeIn: number         — 0..0.2s ramp for visual fade-in
 *   castFlash: { spell, life, maxLife } | null   — brief visual after a cast
 *   lightningAim: { angle } | null
 *       Present while the caster is charging a bolt. `angle` is a
 *       standard 2D radian angle (−π/2 = straight up, 0 = right).
 *       Origin x/y are sampled from the man each frame, so the aim
 *       line follows the player as they move.
 *   lightningBolt: { x, y, angle, life, maxLife, zig } | null
 *       A live bolt after fire. `(x, y)` is frozen at the head position
 *       at cast-time; `angle` is the ray direction. `zig` is a
 *       precomputed jagged offset table so render stays stable.
 */

export const SPELLS = ['shield', 'lightning', 'stasis'];
export const SHIELD_MANA_PER_SECOND = 0.5;
export const LIGHTNING_MANA_COST = 2;
// Stasis: hold-to-active, drain-while-held. Effect (slow-mo on
// hazards) is applied per-mission — most missions just see the cast
// flash and the vignette; shardfall reads it to scale shard physics.
export const STASIS_MANA_PER_SECOND = 6;
export const LIGHTNING_BEAM_WIDTH = 52;
export const LIGHTNING_BOLT_LIFE = 0.35;
export const LIGHTNING_RANGE = 2000;
export const LIGHTNING_HOLE_W = 32;
// Aim arc mirrors the rope's — upper half only, short of true horizontal
// so the player can't point into the floor or at the HUD strip.
export const LIGHTNING_AIM_MIN = -Math.PI * 0.95;
export const LIGHTNING_AIM_MAX = -Math.PI * 0.05;
export const LIGHTNING_AIM_DEFAULT = -Math.PI / 2;
const SHIELD_FADE_IN_DURATION = 0.2;
const CAST_FLASH_DURATION = 0.35;

export function initialSpells() {
  return {
    spells: [...SPELLS],
    spellIdx: 0,
    shieldActive: false,
    shieldFadeIn: 0,
    castFlash: null,
    lightningAim: null,
    lightningBolt: null,
    stasisActive: false,
  };
}

export function selectedSpell(state) {
  if (!state.spells || state.spells.length === 0) return null;
  return state.spells[state.spellIdx || 0] ?? null;
}

export function canCastSelected(state) {
  const spell = selectedSpell(state);
  if (!spell) return false;
  if (spell === 'shield') {
    // While active, Z toggles the shield off — still "castable".
    return state.shieldActive || (state.mana || 0) > 0;
  }
  if (spell === 'lightning') return (state.mana || 0) >= LIGHTNING_MANA_COST;
  if (spell === 'stasis') return state.stasisActive || (state.mana || 0) > 0;
  return false;
}

/**
 * Select a spell by name and cast it in a single step. Used by the
 * slot-style keybindings (`1` → shield, `2` → lightning) so each spell
 * is bound to a dedicated key instead of a select-then-cast pair.
 *
 * Switching to a different spell cancels any in-progress aim from the
 * previous one — pressing the shield slot mid-aim drops the lightning
 * charge, so the player isn't stuck holding a ghost cast.
 */
export function castSpellByName(state, name) {
  if (!state.spells) return false;
  const idx = state.spells.indexOf(name);
  if (idx < 0) return false;
  if ((state.spellIdx || 0) !== idx) {
    state.lightningAim = null;
    state.spellIdx = idx;
  }
  return castSpell(state);
}

/**
 * Keydown handler for the cast key. For shield, toggles the dome. For
 * lightning, enters aim mode — the bolt isn't launched until the key
 * is released (see `releaseCast`).
 */
export function castSpell(state) {
  const spell = selectedSpell(state);
  if (!spell) return false;
  if (spell === 'shield') {
    if (state.shieldActive) {
      state.shieldActive = false;
      return true;
    }
    if ((state.mana || 0) <= 0) return false;
    state.shieldActive = true;
    state.shieldFadeIn = 0;
    state.castFlash = { spell, life: CAST_FLASH_DURATION, maxLife: CAST_FLASH_DURATION };
    return true;
  }
  if (spell === 'lightning') {
    if (state.lightningAim) return false;              // already aiming
    if ((state.mana || 0) < LIGHTNING_MANA_COST) return false;
    state.lightningAim = { angle: LIGHTNING_AIM_DEFAULT };
    return true;
  }
  if (spell === 'stasis') {
    if (state.stasisActive) return false;
    if ((state.mana || 0) <= 0) return false;
    state.stasisActive = true;
    state.castFlash = { spell, life: CAST_FLASH_DURATION, maxLife: CAST_FLASH_DURATION };
    return true;
  }
  return false;
}

/**
 * Keyup handler for the stasis slot. Stops the slow-mo and clears the
 * active flag. No-op when stasis isn't running.
 */
export function releaseStasis(state) {
  if (!state.stasisActive) return false;
  state.stasisActive = false;
  return true;
}

/**
 * Keyup handler for the cast key. Fires a lightning bolt from the
 * given origin along the currently-aimed angle. Deducts mana and
 * clears the aim. No-op for other spells.
 *
 * `originX`/`originY` are supplied by the caller so this module stays
 * ignorant of the man's geometry — the main game loop passes the
 * head position at release-time.
 */
export function releaseCast(state, originX, originY) {
  if (!state.lightningAim) return false;
  const aim = state.lightningAim;
  state.lightningAim = null;
  // If mana vanished mid-aim (e.g. a shield drain), treat it as a free cancel.
  if ((state.mana || 0) < LIGHTNING_MANA_COST) return false;
  state.mana -= LIGHTNING_MANA_COST;
  state.castFlash = { spell: 'lightning', life: CAST_FLASH_DURATION, maxLife: CAST_FLASH_DURATION };
  state.lightningBolt = {
    x: originX, y: originY,
    angle: aim.angle,
    life: LIGHTNING_BOLT_LIFE,
    maxLife: LIGHTNING_BOLT_LIFE,
    zig: makeZig(),
  };
  burstPlatformsAlongBolt(state);
  return true;
}

/**
 * Punch a hole through every platform whose top edge the bolt's ray
 * crosses along its LIGHTNING_RANGE span. Called once at fire-time so
 * the platform damage is deterministic (not accumulated over the bolt's
 * visible life). A crossing that lands on an existing hole is skipped
 * so repeat shots at the same spot don't pile up redundant holes.
 */
function burstPlatformsAlongBolt(state) {
  const b = state.lightningBolt;
  if (!b) return;
  if (!state.platforms || !state.holes) return;
  const sin = Math.sin(b.angle);
  const cos = Math.cos(b.angle);
  // A near-horizontal ray doesn't intersect horizontal platform tops in
  // a well-defined way; our aim clamp already bars this, but guard so
  // we never divide by ~0.
  if (Math.abs(sin) < 0.001) return;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    const t = (p.y - b.y) / sin;
    if (t < 0 || t > LIGHTNING_RANGE) continue;
    const crossX = b.x + cos * t;
    if (crossX < p.x || crossX > p.x + p.w) continue;
    if (isInExistingHole(state.holes, crossX, p.y)) continue;
    state.holes.push({
      x: crossX - LIGHTNING_HOLE_W / 2,
      y: p.y,
      w: LIGHTNING_HOLE_W,
      age: 0,
    });
  }
}

function isInExistingHole(holes, x, platY) {
  for (const h of holes) {
    if (Math.abs(h.y - platY) < 2 && x >= h.x && x <= h.x + h.w) return true;
  }
  return false;
}

export function cancelLightningAim(state) {
  state.lightningAim = null;
}

export function adjustLightningAim(state, delta) {
  if (!state.lightningAim) return;
  const next = state.lightningAim.angle + delta;
  state.lightningAim.angle = Math.max(LIGHTNING_AIM_MIN, Math.min(LIGHTNING_AIM_MAX, next));
}

export function isLightningAiming(state) {
  return !!state.lightningAim;
}

export function isLightningActive(state) {
  return !!state.lightningBolt;
}

/**
 * Is the point (x, y) inside an active bolt's hit region? The region
 * is a rectangle of width LIGHTNING_BEAM_WIDTH along the ray from the
 * bolt's origin, running for LIGHTNING_RANGE pixels.
 */
export function lightningStrikesPoint(state, x, y) {
  const b = state.lightningBolt;
  if (!b) return false;
  const dx = x - b.x;
  const dy = y - b.y;
  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  const along = dx * cos + dy * sin;     // distance along the ray
  const across = -dx * sin + dy * cos;   // perpendicular distance
  if (along < 0 || along > LIGHTNING_RANGE) return false;
  return Math.abs(across) <= LIGHTNING_BEAM_WIDTH / 2;
}

export function tickSpells(state, dt) {
  if (state.shieldActive) {
    state.mana = Math.max(0, (state.mana || 0) - SHIELD_MANA_PER_SECOND * dt);
    if (state.mana <= 0) {
      state.shieldActive = false;
      state.shieldFadeIn = 0;
    } else {
      state.shieldFadeIn = Math.min(SHIELD_FADE_IN_DURATION, (state.shieldFadeIn || 0) + dt);
    }
  } else if ((state.shieldFadeIn || 0) > 0) {
    state.shieldFadeIn = Math.max(0, state.shieldFadeIn - dt * 2);
  }
  if (state.stasisActive) {
    state.mana = Math.max(0, (state.mana || 0) - STASIS_MANA_PER_SECOND * dt);
    if (state.mana <= 0) state.stasisActive = false;
  }
  if (state.castFlash) {
    state.castFlash.life -= dt;
    if (state.castFlash.life <= 0) state.castFlash = null;
  }
  if (state.lightningBolt) {
    state.lightningBolt.life -= dt;
    if (state.lightningBolt.life <= 0) state.lightningBolt = null;
  }
}

export function shieldFadeAlpha(state) {
  return Math.min(1, (state.shieldFadeIn || 0) / SHIELD_FADE_IN_DURATION);
}

export function isShielded(state) {
  return !!state.shieldActive;
}

// ── Internal ────────────────────────────────────────────────────────────

function makeZig() {
  // A short table of perpendicular offsets the renderer samples along
  // the bolt's length. Precomputed so the shape doesn't re-roll every
  // frame (the bolt would shimmer into a solid bar).
  const n = 22;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    // Alternating zigzag with some jitter, smaller near the tip so the
    // bolt looks like it narrows into a point.
    const taper = 1 - i / n;
    arr[i] = ((i % 2 === 0 ? -1 : 1) * (8 + Math.random() * 10)) * taper;
  }
  return arr;
}
