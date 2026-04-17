import { describe, it, expect } from 'vitest';
import { startAxeSwing, updateAxeSwing } from '../physics.js';
import { AXE_SWING_DURATION, AXE_REACH, MANA_PER_MINE } from '../constants.js';

function makeState(overrides = {}) {
  return {
    gx: 100, feetY: 200,
    faceR: true,
    grounded: true,
    posture: 'standing',
    axeSwing: null,
    rope: null,
    manaMines: [],
    mana: 0,
    particles: [],
    ...overrides,
  };
}

describe('startAxeSwing', () => {
  it('initializes axeSwing when grounded, standing, no rope', () => {
    const s = makeState();
    expect(startAxeSwing(s)).toBe(true);
    expect(s.axeSwing).not.toBeNull();
    expect(s.axeSwing.t).toBe(0);
    expect(s.axeSwing.hit).toBe(false);
  });

  it('no-op when already swinging', () => {
    const s = makeState({ axeSwing: { t: 0.1, hit: false } });
    expect(startAxeSwing(s)).toBe(false);
    expect(s.axeSwing.t).toBe(0.1);
  });

  it('no-op when airborne', () => {
    const s = makeState({ grounded: false });
    expect(startAxeSwing(s)).toBe(false);
    expect(s.axeSwing).toBeNull();
  });

  it('no-op while roping', () => {
    const s = makeState({ rope: { state: 'swinging' } });
    expect(startAxeSwing(s)).toBe(false);
    expect(s.axeSwing).toBeNull();
  });

  it('no-op when crouching or prone', () => {
    const s = makeState({ posture: 'crouching' });
    expect(startAxeSwing(s)).toBe(false);
    expect(s.axeSwing).toBeNull();

    const sp = makeState({ posture: 'prone' });
    expect(startAxeSwing(sp)).toBe(false);
    expect(sp.axeSwing).toBeNull();
  });
});

describe('updateAxeSwing', () => {
  it('advances t', () => {
    const s = makeState({ axeSwing: { t: 0, hit: false } });
    updateAxeSwing(s, 0.1);
    expect(s.axeSwing.t).toBeCloseTo(0.1, 5);
  });

  it('clears axeSwing after full duration', () => {
    const s = makeState({ axeSwing: { t: 0, hit: false } });
    updateAxeSwing(s, AXE_SWING_DURATION + 0.01);
    expect(s.axeSwing).toBeNull();
  });

  it('triggers a hit on a nearby mine at apex, decrements hits', () => {
    const mineX = 100 + AXE_REACH; // directly at axe tip when facing right
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 3, age: 0 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55); // past apex
    expect(s.manaMines[0].hits).toBe(2);
    expect(s.axeSwing.hit).toBe(true);
    expect(s.particles.length).toBeGreaterThan(0); // chip particles emitted
  });

  it('depletes a mine on its final hit, awards mana and removes it', () => {
    const mineX = 100 + AXE_REACH;
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 1, age: 0 }],
      mana: 5,
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.manaMines.length).toBe(0);
    expect(s.mana).toBe(5 + MANA_PER_MINE);
  });

  it('misses when the mine is out of reach', () => {
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: 500, y: 190, hits: 3, age: 0 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.manaMines[0].hits).toBe(3);
  });

  it('hits to the left when facing left', () => {
    const mineX = 100 - AXE_REACH;
    const s = makeState({
      faceR: false,
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 3, age: 0 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.manaMines[0].hits).toBe(2);
  });

  it('does not double-hit within a single swing', () => {
    const mineX = 100 + AXE_REACH;
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 3, age: 0 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55); // first hit (hits → 2)
    updateAxeSwing(s, 0.01); // still mid-swing
    expect(s.manaMines[0].hits).toBe(2);
  });

  it('does nothing when axeSwing is null', () => {
    const s = makeState({ axeSwing: null });
    updateAxeSwing(s, 0.1);
    expect(s.axeSwing).toBeNull();
  });
});
