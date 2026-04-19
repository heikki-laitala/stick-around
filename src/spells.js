/**
 * Spell system. Mana earned from mining mana mines is spent here.
 *
 * Two spells today: `shield` toggles a magical dome that drains mana
 * continuously while active and absorbs mission hazards (meteors, lava)
 * — press cast again (or let mana run out) to drop it. `lightning` is a
 * stub: selectable and castable so the cycle/HUD plumbing works, but
 * has no gameplay effect yet beyond a cast-flash.
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
 */

export const SPELLS = ['shield', 'lightning'];
export const SHIELD_MANA_PER_SECOND = 0.5;
export const LIGHTNING_MANA_COST = 8;
const SHIELD_FADE_IN_DURATION = 0.2;
const CAST_FLASH_DURATION = 0.35;

export function initialSpells() {
  return {
    spells: [...SPELLS],
    spellIdx: 0,
    shieldActive: false,
    shieldFadeIn: 0,
    castFlash: null,
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
  return false;
}

export function cycleSpell(state) {
  if (!state.spells || state.spells.length === 0) return;
  state.spellIdx = ((state.spellIdx || 0) + 1) % state.spells.length;
}

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
    if ((state.mana || 0) < LIGHTNING_MANA_COST) return false;
    state.mana -= LIGHTNING_MANA_COST;
    state.castFlash = { spell, life: CAST_FLASH_DURATION, maxLife: CAST_FLASH_DURATION };
    return true;
  }
  return false;
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
  if (state.castFlash) {
    state.castFlash.life -= dt;
    if (state.castFlash.life <= 0) state.castFlash = null;
  }
}

export function shieldFadeAlpha(state) {
  return Math.min(1, (state.shieldFadeIn || 0) / SHIELD_FADE_IN_DURATION);
}

export function isShielded(state) {
  return !!state.shieldActive;
}
