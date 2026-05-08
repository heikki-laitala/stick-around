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
  it('starts with no ball spawned and a non-zero spawn delay', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(s.missionScene.ball).toBeNull();
    expect(s.missionScene.spawnT).toBeGreaterThan(0);
    expect(s.missionScene.done).toBe(false);
  });

  it('primes mana high enough to cover all three spells', () => {
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

describe('SPELL_WARMUP_MISSION — ball spawn', () => {
  it('spawns the ball after the spawn delay elapses', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    // Walk past the spawn delay.
    for (let i = 0; i < 60; i++) SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.ball).not.toBeNull();
    expect(s.missionScene.ball.hits).toBe(0);
  });
});

describe('SPELL_WARMUP_MISSION.check', () => {
  it('returns true once the scene is marked done', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.done = true;
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(true);
  });

  it('returns false while the ball is still in play', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    expect(SPELL_WARMUP_MISSION.check(s)).toBe(false);
  });
});

describe('SPELL_WARMUP_MISSION — lightning hits', () => {
  it('counts a lightning strike on the ball as a hit', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    // Force a ball into play directly under the bolt.
    s.missionScene.ball = { x: 400, y: 200, vx: 0, vy: 0, hits: 0, invulnT: 0 };
    s.lightningBolt = {
      x: 400, y: 400, angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.35, zig: [],
    };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.ball.hits).toBe(1);
    expect(s.missionScene.ball.invulnT).toBeGreaterThan(0);
  });

  it('marks the mission done after the third lightning hit', () => {
    const s = makeState();
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.ball = { x: 400, y: 200, vx: 0, vy: 0, hits: 2, invulnT: 0 };
    s.lightningBolt = {
      x: 400, y: 400, angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.35, zig: [],
    };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.missionScene.done).toBe(true);
    expect(s.missionScene.ball).toBeNull();
  });

  it('speeds up and homes the ball toward the man on a non-final hit', () => {
    const s = makeState({ gx: 600, feetY: 500 });
    SPELL_WARMUP_MISSION.onEnter(s);
    // Place the ball off to one side with a moderate baseline speed,
    // then land a hit while it's not yet the final zap.
    s.missionScene.ball = { x: 200, y: 200, vx: 100, vy: 0, hits: 0, invulnT: 0 };
    const speedBefore = Math.hypot(s.missionScene.ball.vx, s.missionScene.ball.vy);
    s.lightningBolt = {
      x: 200, y: 400, angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.35, zig: [],
    };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    const b = s.missionScene.ball;
    expect(b.hits).toBe(1);
    // Ball is faster post-hit and now points generally toward the man (+x).
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(speedBefore);
    expect(b.vx).toBeGreaterThan(0);
  });
});

describe('SPELL_WARMUP_MISSION — player contact', () => {
  it('ends the run when the unshielded ball reaches the man', () => {
    const s = makeState({ shieldActive: false });
    SPELL_WARMUP_MISSION.onEnter(s);
    // Place the ball right on top of the man's torso (~feetY - 30).
    s.missionScene.ball = { x: s.gx, y: s.feetY - 30, vx: 0, vy: 0, hits: 0, invulnT: 0 };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
  });

  it('deflects the ball away when the shield is up', () => {
    const s = makeState({ shieldActive: true });
    SPELL_WARMUP_MISSION.onEnter(s);
    s.missionScene.ball = { x: s.gx, y: s.feetY - 30, vx: 100, vy: 200, hits: 0, invulnT: 0 };
    SPELL_WARMUP_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
    // The deflect kicks the ball upward.
    expect(s.missionScene.ball.vy).toBeLessThan(0);
  });
});
