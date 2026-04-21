import { describe, it, expect } from 'vitest';
import {
  SPELLS,
  SHIELD_MANA_PER_SECOND,
  LIGHTNING_MANA_COST,
  LIGHTNING_BEAM_WIDTH,
  LIGHTNING_BOLT_LIFE,
  LIGHTNING_AIM_DEFAULT,
  LIGHTNING_AIM_MIN,
  LIGHTNING_AIM_MAX,
  initialSpells,
  cycleSpell,
  castSpell,
  releaseCast,
  adjustLightningAim,
  cancelLightningAim,
  isLightningAiming,
  isLightningActive,
  lightningStrikesPoint,
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

describe('castSpell — lightning (aim phase)', () => {
  it('enters aim mode on keydown without spending mana', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    expect(castSpell(s)).toBe(true);
    expect(isLightningAiming(s)).toBe(true);
    expect(s.lightningAim.angle).toBe(LIGHTNING_AIM_DEFAULT);
    expect(s.mana).toBe(LIGHTNING_MANA_COST);       // no debit yet
    expect(s.castFlash).toBeNull();
    expect(isLightningActive(s)).toBe(false);        // bolt fires on release
  });

  it('does not activate the shield', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    expect(isShielded(s)).toBe(false);
  });

  it('is a no-op when mana is insufficient', () => {
    const s = make({ mana: LIGHTNING_MANA_COST - 1, spellIdx: 1 });
    expect(castSpell(s)).toBe(false);
    expect(isLightningAiming(s)).toBe(false);
    expect(s.mana).toBe(LIGHTNING_MANA_COST - 1);
  });

  it('cycling away from lightning cancels an in-progress aim', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    expect(isLightningAiming(s)).toBe(true);
    cycleSpell(s);       // back to shield
    expect(isLightningAiming(s)).toBe(false);
  });

  it('adjustLightningAim rotates the angle within the clamp arc', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    adjustLightningAim(s, 0.1);
    expect(s.lightningAim.angle).toBeCloseTo(LIGHTNING_AIM_DEFAULT + 0.1, 5);
    // Slam past the upper limit — angle clamps, doesn't wrap.
    adjustLightningAim(s, 10);
    expect(s.lightningAim.angle).toBe(LIGHTNING_AIM_MAX);
    adjustLightningAim(s, -10);
    expect(s.lightningAim.angle).toBe(LIGHTNING_AIM_MIN);
  });

  it('cancelLightningAim clears the aim without cost', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    cancelLightningAim(s);
    expect(isLightningAiming(s)).toBe(false);
    expect(s.mana).toBe(LIGHTNING_MANA_COST);
  });
});

describe('releaseCast — lightning (fire phase)', () => {
  it('launches a bolt along the aimed angle and deducts mana', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    adjustLightningAim(s, 0.2);
    expect(releaseCast(s, 100, 200)).toBe(true);
    expect(isLightningAiming(s)).toBe(false);
    expect(isLightningActive(s)).toBe(true);
    expect(s.mana).toBe(0);
    expect(s.lightningBolt.x).toBe(100);
    expect(s.lightningBolt.y).toBe(200);
    expect(s.lightningBolt.angle).toBeCloseTo(LIGHTNING_AIM_DEFAULT + 0.2, 5);
    expect(s.lightningBolt.life).toBe(LIGHTNING_BOLT_LIFE);
    expect(s.castFlash.spell).toBe('lightning');
  });

  it('is a no-op when nothing is aimed', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    expect(releaseCast(s, 0, 0)).toBe(false);
    expect(isLightningActive(s)).toBe(false);
    expect(s.mana).toBe(LIGHTNING_MANA_COST);
  });

  it('free-cancels if mana evaporated during the aim', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    s.mana = 0;         // drained by something while aiming
    expect(releaseCast(s, 0, 0)).toBe(false);
    expect(isLightningAiming(s)).toBe(false);
    expect(isLightningActive(s)).toBe(false);
  });

  it('tickSpells ages out the bolt', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    castSpell(s);
    releaseCast(s, 0, 0);
    tickSpells(s, LIGHTNING_BOLT_LIFE + 0.1);
    expect(isLightningActive(s)).toBe(false);
  });
});

describe('releaseCast — lightning platform bursting', () => {
  function fireUp(s, originX, originY) {
    s.lightningAim = { angle: -Math.PI / 2 };
    return releaseCast(s, originX, originY);
  }

  it('punches a hole in every platform the ray crosses', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    s.platforms = [
      { x: 100, y: 200, w: 400, hash: 0xA1 },
      { x: 100, y: 400, w: 400, hash: 0xA2 },
    ];
    s.holes = [];
    fireUp(s, 300, 500);              // ray at x=300, going up
    const hole1 = s.holes.find((h) => Math.abs(h.y - 200) < 1);
    const hole2 = s.holes.find((h) => Math.abs(h.y - 400) < 1);
    expect(hole1).toBeDefined();
    expect(hole2).toBeDefined();
    expect(hole1.x).toBeLessThanOrEqual(300);
    expect(hole1.x + hole1.w).toBeGreaterThanOrEqual(300);
  });

  it('leaves platforms outside the ray column untouched', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    s.platforms = [{ x: 100, y: 200, w: 100, hash: 0xA1 }]; // ends at x=200
    s.holes = [];
    fireUp(s, 300, 500);              // ray at x=300, well past platform's right edge
    expect(s.holes.length).toBe(0);
  });

  it('does not double-burst a platform already punched at that spot', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    s.platforms = [{ x: 100, y: 200, w: 400, hash: 0xA1 }];
    s.holes = [{ x: 285, y: 200, w: 30, age: 0 }];
    fireUp(s, 300, 500);
    expect(s.holes.length).toBe(1);
  });

  it('an angled bolt bursts platforms at the ray-crossing x, not the origin x', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    s.platforms = [{ x: 100, y: 300, w: 800, hash: 0xA1 }];
    s.holes = [];
    // Up-right 45°: from (300, 500), y=300 is crossed at x = 300 + (500-300) = 500.
    s.lightningAim = { angle: -Math.PI / 4 };
    releaseCast(s, 300, 500);
    const hole = s.holes.find((h) => Math.abs(h.y - 300) < 1);
    expect(hole).toBeDefined();
    const center = hole.x + hole.w / 2;
    expect(center).toBeGreaterThan(490);
    expect(center).toBeLessThan(510);
  });

  it('does nothing when state has no platforms/holes arrays', () => {
    // Spells must tolerate being driven by a state that hasn't yet
    // initialised the terrain — e.g. the menu screen.
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    expect(() => fireUp(s, 300, 500)).not.toThrow();
  });
});

describe('lightningStrikesPoint', () => {
  function fire(s, angle) {
    s.lightningAim = { angle };
    return releaseCast(s, 500, 400);
  }

  it('returns false when no bolt is active', () => {
    const s = make();
    expect(lightningStrikesPoint(s, 500, 100)).toBe(false);
  });

  it('hits a point directly along a straight-up bolt', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    fire(s, -Math.PI / 2);                 // straight up
    expect(lightningStrikesPoint(s, 500, 100)).toBe(true);       // same column, above
  });

  it('misses points beyond half the beam width', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    fire(s, -Math.PI / 2);
    const farX = 500 + LIGHTNING_BEAM_WIDTH / 2 + 5;
    expect(lightningStrikesPoint(s, farX, 100)).toBe(false);
  });

  it('misses points behind the origin (negative "along" distance)', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    fire(s, -Math.PI / 2);                 // firing up, so "behind" is below
    expect(lightningStrikesPoint(s, 500, 500)).toBe(false);
  });

  it('hits along an angled bolt', () => {
    const s = make({ mana: LIGHTNING_MANA_COST, spellIdx: 1 });
    fire(s, -Math.PI / 4);                 // up-right
    const reach = 200;
    const x = 500 + Math.cos(-Math.PI / 4) * reach;
    const y = 400 + Math.sin(-Math.PI / 4) * reach;
    expect(lightningStrikesPoint(s, x, y)).toBe(true);
    // Perpendicular to the ray by one full beam width → miss.
    const nx = -Math.sin(-Math.PI / 4) * LIGHTNING_BEAM_WIDTH;
    const ny =  Math.cos(-Math.PI / 4) * LIGHTNING_BEAM_WIDTH;
    expect(lightningStrikesPoint(s, x + nx, y + ny)).toBe(false);
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
    // Drain for far longer than the mana supply — shield must be down.
    tickSpells(s, 100.0);
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
    releaseCast(s, 0, 0);
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
