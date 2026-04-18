import { describe, it, expect } from 'vitest';
import { ESCAPE_LAVA_MISSION, restartEscapeLava } from '../missions/escapeLava.js';
import { JUMP_V } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';

function makeState(overrides = {}) {
  return {
    gx: 400,
    feetY: 500,
    gvx: 0,
    gvy: 0,
    grounded: true,
    score: 5,
    screenH: 600,
    particles: [],
    platforms: [
      { x: 20, y: 80, w: 120, h: 10 },   // topmost — where the door anchors
      { x: 200, y: 300, w: 180, h: 10 },
      { x: 500, y: 420, w: 200, h: 10 },
    ],
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('ESCAPE_LAVA_MISSION.onEnter', () => {
  it('starts lava just below the screen and anchors the door on the topmost platform', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.missionScene.lavaY).toBeGreaterThan(s.screenH);
    expect(s.missionScene.doorX).toBe(40);  // 20 (top platform x) + 20 inset
    expect(s.missionScene.doorY).toBeLessThan(80); // above the topmost platform
    expect(s.missionScene.reachedDoor).toBe(false);
    expect(s.gameOver).toBe(false);
  });

  it('primes score to at least 5 so there is always a buffer', () => {
    const s = makeState({ score: 1 });
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.score).toBe(5);
  });

  it('leaves higher scores untouched', () => {
    const s = makeState({ score: 20 });
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.score).toBe(20);
  });
});

describe('ESCAPE_LAVA_MISSION.update — lava behavior', () => {
  it('lava rises over time (lavaY decreases)', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    const before = s.missionScene.lavaY;
    ESCAPE_LAVA_MISSION.update(s, 1.0);
    expect(s.missionScene.lavaY).toBeLessThan(before);
  });

  it('lava caps at the top of the screen', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = -5;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.missionScene.lavaY).toBe(0);
  });
});

describe('ESCAPE_LAVA_MISSION.update — lava hit', () => {
  it('decrements score, knocks the man up, and sets invuln when feet touch lava', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    const priorScore = s.score;
    s.missionScene.lavaY = s.feetY - 5;      // lava surface is above feet
    s.feetY = s.missionScene.lavaY + 2;      // feet dipped below surface
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.score).toBe(priorScore - 1);
    expect(s.gvy).toBeLessThan(0);
    expect(Math.abs(s.gvy)).toBeGreaterThan(JUMP_V);
    expect(s.grounded).toBe(false);
    expect(s.missionScene.invulnTimer).toBeGreaterThan(0);
  });

  it('spawns particles on a lava hit', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = s.feetY - 5;
    s.feetY = s.missionScene.lavaY + 2;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.particles.length).toBeGreaterThan(0);
  });

  it('is invulnerable during cooldown — a second hit in the same window does nothing', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = s.feetY - 5;
    s.feetY = s.missionScene.lavaY + 2;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    const scoreAfterFirstHit = s.score;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.score).toBe(scoreAfterFirstHit);
  });

  it('triggers gameOver when hit with score 0', () => {
    const s = makeState({ score: 0 });
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.score = 0; // onEnter primes to PRIME_SCORE; override for this test
    s.missionScene.lavaY = s.feetY - 5;
    s.feetY = s.missionScene.lavaY + 2;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
    expect(s.gvx).toBe(0);
    expect(s.gvy).toBe(0);
  });

  it('is a no-op when gameOver is already set', () => {
    const s = makeState({ score: 3 });
    ESCAPE_LAVA_MISSION.onEnter(s);
    const lavaYBefore = s.missionScene.lavaY;
    s.gameOver = true;
    ESCAPE_LAVA_MISSION.update(s, 1.0);
    expect(s.missionScene.lavaY).toBe(lavaYBefore);
  });
});

describe('ESCAPE_LAVA_MISSION.update — door collision', () => {
  it('sets reachedDoor when the torso overlaps the door rect', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.gx = s.missionScene.doorX + s.missionScene.doorW / 2;
    s.feetY = s.missionScene.doorY + STANDING_HEIGHT / 2 + 10;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.missionScene.reachedDoor).toBe(true);
  });

  it('does not set reachedDoor when the man is nowhere near the door', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.gx = s.missionScene.doorX + 500;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.missionScene.reachedDoor).toBe(false);
  });
});

describe('ESCAPE_LAVA_MISSION.check', () => {
  it('returns true only when reachedDoor is true', () => {
    expect(ESCAPE_LAVA_MISSION.check({ missionScene: { reachedDoor: true } })).toBe(true);
    expect(ESCAPE_LAVA_MISSION.check({ missionScene: { reachedDoor: false } })).toBe(false);
    expect(ESCAPE_LAVA_MISSION.check({ missionScene: null })).toBe(false);
    expect(ESCAPE_LAVA_MISSION.check({})).toBe(false);
  });
});

describe('restartEscapeLava', () => {
  it('clears gameOver and resets scene state so advanceMission re-enters the mission', () => {
    const s = {
      gameOver: true,
      currentMissionId: 'escape-lava',
      missionScene: { lavaY: 10, reachedDoor: false },
    };
    restartEscapeLava(s);
    expect(s.gameOver).toBe(false);
    expect(s.currentMissionId).toBeNull();
    expect(s.missionScene).toBeNull();
  });
});
