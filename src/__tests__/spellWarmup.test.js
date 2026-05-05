import { describe, it, expect } from 'vitest';
import { SPELL_WARMUP_MISSION } from '../missions/spellWarmup.js';

function makeState(overrides = {}) {
  return {
    gx: 400,
    feetY: 500,
    gvx: 0,
    gvy: 0,
    grounded: true,
    standingHash: 0xAAAA,
    posture: 'standing',
    score: 0,
    mana: 0,
    shieldActive: false,
    shieldFadeIn: 0,
    stasisActive: false,
    stasisAge: 0,
    lightningAim: null,
    lightningBolt: null,
    castFlash: null,
    spells: ['shield', 'lightning', 'stasis'],
    spellIdx: 0,
    screenW: 1024,
    screenH: 768,
    textOffsetY: 60,
    textWidth: 1024,
    textOffsetX: 0,
    platforms: [{ x: 100, y: 500, w: 800, h: 10, hash: 0xAAAA }],
    holes: [],
    particles: [],
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('SPELL_WARMUP_MISSION.onEnter', () => {
  it('starts in the lightning phase with a fresh crystal target', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(s.missionScene.phase).toBe('lightning');
    expect(s.missionScene.crystal).toBeDefined();
    expect(s.missionScene.crystal.zapped).toBe(false);
  });

  it('primes mana high enough to cover all three phases', () => {
    const s = makeState({ mana: 0 });
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(s.mana).toBeGreaterThanOrEqual(10);
  });

  it('does not lower an already-rich mana pool', () => {
    const s = makeState({ mana: 50 });
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(s.mana).toBe(50);
  });
});

describe('SPELL_WARMUP_MISSION — phase advance', () => {
  it('advances from lightning to shield once the crystal is zapped', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.crystal.zapped = true;
    SPELL_WARMUP_MISSION.update(s, 0.1);
    expect(s.missionScene.phase).toBe('shield');
  });

  it('advances from shield to stasis after blocking a fireball', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.phase = 'shield';
    s.missionScene.fireball = null;
    s.missionScene.shieldedHits = 1;        // one block recorded
    SPELL_WARMUP_MISSION.update(s, 0.1);
    expect(s.missionScene.phase).toBe('stasis');
  });

  it('advances from stasis to done after a successful slow-mo dodge', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.phase = 'stasis';
    s.missionScene.shardDodged = true;
    SPELL_WARMUP_MISSION.update(s, 0.1);
    expect(s.missionScene.phase).toBe('done');
  });
});

describe('SPELL_WARMUP_MISSION.check', () => {
  it('returns true once the phase machine reaches done', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.phase = 'done';
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(true);
  });

  it('returns false in any earlier phase', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(false);
    s.missionScene.phase = 'shield';
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(false);
    s.missionScene.phase = 'stasis';
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(false);
  });
});

describe('SPELL_WARMUP_MISSION — lightning detection', () => {
  it('marks the crystal zapped when a lightning bolt overlaps it', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    const c = s.missionScene.crystal;
    // Place a bolt that passes directly through the crystal.
    s.lightningBolt = {
      x: c.x, y: c.y + 200, angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.35, zig: [],
    };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.crystal.zapped).toBe(true);
  });
});

describe('SPELL_WARMUP_MISSION — shield detection', () => {
  it('counts a fireball as blocked when it reaches the player while shielded', () => {
    const s = makeState({ shieldActive: true });
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.phase = 'shield';
    s.missionScene.fireball = { x: s.gx, y: s.feetY - 30, vx: 200, life: 5 };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.shieldedHits).toBeGreaterThanOrEqual(1);
  });

  it('despawns and respawns the fireball when it flies past the player without a shield up', () => {
    const s = makeState({ shieldActive: false });
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.phase = 'shield';
    // Simulate a fireball that already left the play area.
    s.missionScene.fireball = { x: 9999, y: 200, vx: 200, age: 1 };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.fireball).toBeNull();
    // Walk the timer past the respawn delay; a fresh fireball should be back.
    for (let i = 0; i < 60; i++) SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.fireball).not.toBeNull();
    expect(s.missionScene.shieldedHits || 0).toBe(0);
  });
});
