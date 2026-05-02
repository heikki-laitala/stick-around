import { describe, it, expect } from 'vitest';
import {
  SHARDFALL_MISSION,
  SHARDFALL_DURATION,
  SHARDFALL_PRIMER_MANA,
  SHARDFALL_GOAL,
  GOLD_SHARD_VALUE,
} from '../missions/shardfall.js';
import { STASIS_SCALE } from '../spells.js';

function makeState(overrides = {}) {
  return {
    gx: 400, feetY: 400,
    gvx: 0, gvy: 0, grounded: true,
    faceR: true,
    posture: 'standing',
    platforms: [{ x: 0, y: 400, w: 800, hash: 0xFFFF }],
    holes: [],
    particles: [],
    score: 0,
    mana: 0,
    screenW: 800,
    screenH: 600,
    textOffsetX: 0,
    textOffsetY: 80,
    textWidth: 800,
    textHeight: 500,
    lineHeight: 16,
    missionScene: {},
    gameOver: false,
    stasisActive: false,
    ...overrides,
  };
}

describe('SHARDFALL_MISSION onEnter', () => {
  it('primes the player to at least SHARDFALL_PRIMER_MANA', () => {
    const s = makeState({ mana: 0 });
    SHARDFALL_MISSION.onEnter(s);
    expect(s.mana).toBe(SHARDFALL_PRIMER_MANA);
  });

  it('does not lower mana if the player already has more', () => {
    const s = makeState({ mana: SHARDFALL_PRIMER_MANA + 10 });
    SHARDFALL_MISSION.onEnter(s);
    expect(s.mana).toBe(SHARDFALL_PRIMER_MANA + 10);
  });

  it('seeds an empty shard list and zeroed counters', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    expect(Array.isArray(s.missionScene.shards)).toBe(true);
    expect(s.missionScene.shards.length).toBe(0);
    expect(s.missionScene.caughtCount).toBe(0);
    expect(s.missionScene.missedCount).toBe(0);
  });

  it('auto-selects the stasis spell slot', () => {
    const s = makeState({ spells: ['shield', 'lightning', 'stasis'], spellIdx: 0 });
    SHARDFALL_MISSION.onEnter(s);
    expect(s.spellIdx).toBe(2);
  });

  it('leaves spellIdx alone if the stasis slot is missing', () => {
    const s = makeState({ spells: ['shield', 'lightning'], spellIdx: 1 });
    SHARDFALL_MISSION.onEnter(s);
    expect(s.spellIdx).toBe(1);
  });

  it('starts the timer at SHARDFALL_DURATION', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    expect(s.missionScene.timeLeft).toBeCloseTo(SHARDFALL_DURATION, 5);
  });
});

describe('SHARDFALL_MISSION shard physics', () => {
  it('shards fall at their vy (full speed when stasis is inactive)', () => {
    const s = makeState({ stasisActive: false });
    SHARDFALL_MISSION.onEnter(s);
    const shard = { x: 400, y: 100, vy: 300, caught: false };
    s.missionScene.shards.push(shard);
    s.missionScene.spawnTimer = 0;
    s.missionScene.spawnsLeft = 0;                  // suppress new spawns
    SHARDFALL_MISSION.update(s, 0.1);
    expect(shard.y).toBeCloseTo(100 + 300 * 0.1, 4);
  });

  it('stasis (active + mana) slows shards by STASIS_SCALE', () => {
    const s = makeState({ stasisActive: true, mana: 50 });
    SHARDFALL_MISSION.onEnter(s);
    const shard = { x: 400, y: 100, vy: 300, caught: false };
    s.missionScene.shards.push(shard);
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.1);
    expect(shard.y).toBeCloseTo(100 + 300 * 0.1 * STASIS_SCALE, 4);
  });

  it('shards run at full speed once stasis is released', () => {
    const s = makeState({ stasisActive: true, mana: 50 });
    SHARDFALL_MISSION.onEnter(s);
    s.stasisActive = false;                         // tickSpells does this when mana hits zero
    const shard = { x: 400, y: 100, vy: 300, caught: false };
    s.missionScene.shards.push(shard);
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.1);
    expect(shard.y).toBeCloseTo(100 + 300 * 0.1, 4);
  });

  it('shards that intersect the player body are counted caught + removed', () => {
    const s = makeState({ gx: 400, feetY: 400 });
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.shards.push({ x: 400, y: 388, vy: 0, caught: false, kind: 'common' });
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.016);
    expect(s.missionScene.caughtCount).toBe(1);
    expect(s.missionScene.shards.length).toBe(0);
  });

  it('gold shards are worth GOLD_SHARD_VALUE on catch', () => {
    const s = makeState({ gx: 400, feetY: 400 });
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.shards.push({ x: 400, y: 388, vy: 0, caught: false, kind: 'gold' });
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.016);
    expect(s.missionScene.caughtCount).toBe(GOLD_SHARD_VALUE);
    expect(s.missionScene.shards.length).toBe(0);
  });

  it('a shard punches a hole in any platform top it crosses', () => {
    const s = makeState({
      gx: -9999,                                    // park player far away
      platforms: [{ x: 0, y: 200, w: 800, hash: 0xFFFF }],
      holes: [],
    });
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.shards.push({ x: 400, y: 100, vy: 600, caught: false });
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.5);               // crosses y=200
    expect(s.holes.length).toBe(1);
    expect(s.holes[0].x).toBeCloseTo(400 - 22 / 2, 4);
  });

  it('shards that fall past the bottom of the screen count as missed', () => {
    const s = makeState({ screenH: 600 });
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.shards.push({ x: 400, y: 700, vy: 0, caught: false });
    s.missionScene.spawnsLeft = 0;
    SHARDFALL_MISSION.update(s, 0.016);
    expect(s.missionScene.missedCount).toBe(1);
    expect(s.missionScene.shards.length).toBe(0);
  });
});

describe('SHARDFALL_MISSION timer + check', () => {
  it('drains the timer each tick', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    SHARDFALL_MISSION.update(s, 1.0);
    expect(s.missionScene.timeLeft).toBeCloseTo(SHARDFALL_DURATION - 1.0, 5);
  });

  it('check() returns true once the player catches the goal count', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.caughtCount = SHARDFALL_GOAL;
    expect(SHARDFALL_MISSION.check(s)).toBe(true);
  });

  it('check() is false while caughtCount is below the goal', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.caughtCount = SHARDFALL_GOAL - 1;
    expect(SHARDFALL_MISSION.check(s)).toBe(false);
  });

  it('sets gameOver when the timer expires before the goal is met', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    SHARDFALL_MISSION.update(s, SHARDFALL_DURATION + 0.1);
    expect(s.gameOver).toBe(true);
  });

  it('does not flip gameOver if the goal is met when the timer expires', () => {
    const s = makeState();
    SHARDFALL_MISSION.onEnter(s);
    s.missionScene.caughtCount = SHARDFALL_GOAL;
    SHARDFALL_MISSION.update(s, SHARDFALL_DURATION + 0.1);
    expect(s.gameOver).toBe(false);
  });
});
