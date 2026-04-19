import { describe, it, expect } from 'vitest';
import {
  SPELLS,
  SHIELD_MANA_PER_SECOND,
  LIGHTNING_MANA_COST,
  initialSpells,
  cycleSpell,
  castSpell,
  tickSpells,
  isShielded,
  selectedSpell,
  canCastSelected,
} from '../spells.js';

function make(overrides = {}) {
  return { mana: 0, ...initialSpells(), ...overrides };
}

describe('initialSpells', () => {
  it('includes shield and lightning with shield selected by default', () => {
    const s = make();
    expect(s.spells).toEqual(['shield', 'lightning']);
    expect(s.spellIdx).toBe(0);
    expect(selectedSpell(s)).toBe('shield');
    expect(s.shieldActive).toBe(false);
    expect(s.shieldFadeIn).toBe(0);
    expect(s.castFlash).toBeNull();
  });

  it('exposes SPELLS as a stable ordered list', () => {
    expect(SPELLS).toEqual(['shield', 'lightning']);
  });
});

describe('cycleSpell', () => {
  it('advances the selected spell with wraparound', () => {
    const s = make();
    cycleSpell(s); expect(selectedSpell(s)).toBe('lightning');
    cycleSpell(s); expect(selectedSpell(s)).toBe('shield');
  });
});

describe('canCastSelected', () => {
  it('shield: true when mana > 0, false when mana = 0 and inactive', () => {
    const s = make({ mana: 1 });
    expect(canCastSelected(s)).toBe(true);
    s.mana = 0;
    expect(canCastSelected(s)).toBe(false);
  });

  it('shield: true even at zero mana if already active (to allow toggle-off)', () => {
    const s = make({ mana: 0, shieldActive: true });
    expect(canCastSelected(s)).toBe(true);
  });

  it('lightning: gates on the full mana cost', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    expect(canCastSelected(s)).toBe(true);
    s.mana = LIGHTNING_MANA_COST - 1;
    expect(canCastSelected(s)).toBe(false);
  });
});

describe('castSpell — shield (drain model)', () => {
  it('activates the shield without spending mana upfront', () => {
    const s = make({ mana: 5 });
    expect(castSpell(s)).toBe(true);
    expect(s.shieldActive).toBe(true);
    expect(s.mana).toBe(5); // drain happens on tick, not on cast
    expect(isShielded(s)).toBe(true);
  });

  it('is a no-op when mana is zero and shield is not active', () => {
    const s = make({ mana: 0 });
    expect(castSpell(s)).toBe(false);
    expect(s.shieldActive).toBe(false);
  });

  it('toggles the shield off when cast while already active', () => {
    const s = make({ mana: 10 });
    castSpell(s);
    expect(s.shieldActive).toBe(true);
    castSpell(s);
    expect(s.shieldActive).toBe(false);
  });
});

describe('castSpell — lightning', () => {
  it('is a stub that costs mana and sets a brief cast flash', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    expect(castSpell(s)).toBe(true);
    expect(s.mana).toBe(0);
    expect(s.castFlash).not.toBeNull();
    expect(s.castFlash.spell).toBe('lightning');
  });

  it('does not activate the shield', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    expect(isShielded(s)).toBe(false);
  });

  it('is a no-op when mana is insufficient', () => {
    const s = make({ mana: LIGHTNING_MANA_COST - 1, spellIdx: 1 });
    expect(castSpell(s)).toBe(false);
    expect(s.mana).toBe(LIGHTNING_MANA_COST - 1);
    expect(s.castFlash).toBeNull();
  });
});

describe('tickSpells — shield drain', () => {
  it('drains mana continuously while shielded', () => {
    const s = make({ mana: 10 });
    castSpell(s);
    tickSpells(s, 1.0);
    expect(s.mana).toBeCloseTo(10 - SHIELD_MANA_PER_SECOND, 5);
    expect(isShielded(s)).toBe(true);
  });

  it('drops the shield when mana runs out', () => {
    const s = make({ mana: 1 });
    castSpell(s);
    // 1 mana at 2/sec lasts 0.5s — tick past that and it should be done.
    tickSpells(s, 1.0);
    expect(s.mana).toBe(0);
    expect(isShielded(s)).toBe(false);
  });

  it('a shield sustains as long as new mana keeps coming in', () => {
    const s = make({ mana: 2 });
    castSpell(s);
    for (let i = 0; i < 10; i++) {
      tickSpells(s, 0.25);          // drain 0.5/tick
      s.mana = (s.mana || 0) + 1;   // simulate a mine-drain pulse
    }
    // Net: earned 10 mana over 2.5s, drained 5 → should still be shielded.
    expect(isShielded(s)).toBe(true);
    expect(s.mana).toBeGreaterThan(0);
  });

  it('does not drain when inactive', () => {
    const s = make({ mana: 10 });
    tickSpells(s, 1.0);
    expect(s.mana).toBe(10);
  });

  it('fade-in counter ramps up while active and decays after toggle-off', () => {
    const s = make({ mana: 10 });
    castSpell(s);
    tickSpells(s, 0.1);
    expect(s.shieldFadeIn).toBeGreaterThan(0);
    const mid = s.shieldFadeIn;
    castSpell(s); // toggle off
    tickSpells(s, 0.1);
    expect(s.shieldFadeIn).toBeLessThan(mid);
  });
});

describe('tickSpells — cast flash', () => {
  it('ages out the cast flash to null', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    tickSpells(s, 1.0);
    expect(s.castFlash).toBeNull();
  });

  it('is a safe no-op when nothing is active', () => {
    const s = make();
    tickSpells(s, 1.0);
    expect(s.shieldActive).toBe(false);
    expect(s.castFlash).toBeNull();
  });
});
