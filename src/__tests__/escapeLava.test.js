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
    standingHash: 0,
    score: 5,
    screenH: 600,
    particles: [],
    platforms: [
      { x: 20, y: 80, w: 120, h: 10, hash: 0x1001 },   // topmost — door anchors here
      { x: 200, y: 300, w: 180, h: 10, hash: 0x1002 },
      { x: 500, y: 420, w: 200, h: 10, hash: 0x1003 },
    ],
    titles: [],
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('ESCAPE_LAVA_MISSION.onEnter', () => {
  it('anchors the door on the topmost trackable platform and primes the scene', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.missionScene.doorAnchorHash).toBe(0x1001);
    expect(s.missionScene.doorX).toBe(40);        // 20 + 20 inset
    expect(s.missionScene.doorY).toBeLessThan(80); // sits on top of platform y=80
    expect(s.missionScene.lavaY).toBeGreaterThan(s.screenH);
    expect(s.missionScene.reachedDoor).toBe(false);
    expect(s.missionScene.requestRestart).toBe(false);
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

  it('skips platforms with hash 0 when picking an anchor', () => {
    const s = makeState({
      platforms: [
        { x: 20, y: 40, w: 100, h: 10, hash: 0 },     // unidentifiable — skipped
        { x: 20, y: 80, w: 100, h: 10, hash: 0x2002 },
      ],
    });
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.missionScene.doorAnchorHash).toBe(0x2002);
  });

  it('spawns floating with null anchor when no trackable platforms exist', () => {
    const s = makeState({ platforms: [] });
    ESCAPE_LAVA_MISSION.onEnter(s);
    expect(s.missionScene.doorAnchorHash).toBeNull();
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

describe('ESCAPE_LAVA_MISSION.update — on lava surface', () => {
  it('parks the man half-submerged on the lava surface and drains one ball', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    const priorScore = s.score;
    s.missionScene.lavaY = 400;
    s.feetY = 420; // already below the surface
    s.gvy = 200;   // falling
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.feetY).toBe(s.missionScene.lavaY + STANDING_HEIGHT / 2);
    expect(s.gvy).toBe(0);
    expect(s.grounded).toBe(true);
    expect(s.standingHash).toBe(0);
    expect(s.score).toBe(priorScore - 1);
    expect(s.missionScene.invulnTimer).toBeGreaterThan(0);
  });

  it('spawns particles on a burn tick', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.feetY = 420;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.particles.length).toBeGreaterThan(0);
  });

  it('is invulnerable during cooldown — a second tick in the same window does not drain', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.feetY = 420;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    const scoreAfterFirstTick = s.score;
    s.feetY = s.missionScene.lavaY + 2; // still on lava
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.score).toBe(scoreAfterFirstTick);
  });

  it('drains another ball after the cooldown expires', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.feetY = 420;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    const scoreAfterFirstTick = s.score;
    for (let i = 0; i < 80; i++) ESCAPE_LAVA_MISSION.update(s, 0.05);
    expect(s.score).toBeLessThan(scoreAfterFirstTick);
  });

  it('triggers gameOver when a burn tick fires with score 0', () => {
    const s = makeState({ score: 0 });
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.score = 0;
    s.missionScene.lavaY = 400;
    s.feetY = 420;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
    expect(s.gvx).toBe(0);
    expect(s.gvy).toBe(0);
  });

  it('a shielded man standing in lava neither burns nor dies', () => {
    const s = makeState({ score: 0, shieldActive: true });
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.score = 0;
    s.shieldActive = true;
    s.missionScene.lavaY = 400;
    s.feetY = 420;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
    expect(s.score).toBe(0);
  });

  it('is a no-op when gameOver is already set', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    const lavaYBefore = s.missionScene.lavaY;
    s.gameOver = true;
    ESCAPE_LAVA_MISSION.update(s, 1.0);
    expect(s.missionScene.lavaY).toBe(lavaYBefore);
  });

  it('does not re-park the man when he is jumping upward (gvy<0)', () => {
    const s = makeState({ grounded: false });
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.missionScene.wasOnLava = true;
    s.feetY = 420;      // still below surface, but rising
    s.gvy = -JUMP_V;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    // Must not reset feetY back to the submerged clamp, nor re-ground him.
    expect(s.feetY).toBe(420);
    expect(s.grounded).toBe(false);
  });

  it('boosts the jump with a distance-based velocity when launching off lava', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.missionScene.wasOnLava = true;   // parked last frame
    s.feetY = 420;                     // physics has moved feet up a bit during the jump
    s.gvy = -JUMP_V;                   // physics just applied normal jump
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    // Resulting velocity must be stronger than the baseline jump.
    expect(Math.abs(s.gvy)).toBeGreaterThan(JUMP_V);
    expect(s.missionScene.wasOnLava).toBe(false);
  });

  it('does not apply the lava boost when the man never touched lava', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    s.missionScene.lavaY = 400;
    s.missionScene.wasOnLava = false;
    s.feetY = 300;           // nowhere near lava
    s.gvy = -JUMP_V;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.gvy).toBe(-JUMP_V);
  });
});

describe('ESCAPE_LAVA_MISSION.update — door physics', () => {
  it('rides the anchor platform as its y changes (terminal scrolled up)', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    const initialDoorY = s.missionScene.doorY;
    // Simulate the terminal scrolling: the anchor platform moves up.
    const anchor = s.platforms.find((p) => p.hash === s.missionScene.doorAnchorHash);
    anchor.y -= 30;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.missionScene.doorY).toBe(initialDoorY - 30);
  });

  it('detaches and starts falling when the anchor platform vanishes', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    // Remove the anchor platform from the world.
    s.platforms = s.platforms.filter((p) => p.hash !== s.missionScene.doorAnchorHash);
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.missionScene.doorAnchorHash).toBeNull();
  });

  it('falls and re-anchors on the next platform below', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    // Replace anchor with a single lower platform directly under the door.
    s.platforms = [{ x: 20, y: 300, w: 120, h: 10, hash: 0x2002 }];
    s.missionScene.doorAnchorHash = null;
    s.missionScene.doorY = 100;
    s.missionScene.doorVy = 0;
    for (let i = 0; i < 60; i++) ESCAPE_LAVA_MISSION.update(s, 0.05);
    expect(s.missionScene.doorAnchorHash).toBe(0x2002);
    expect(s.missionScene.doorY).toBe(300 - s.missionScene.doorH);
  });

  it('requests a mission restart when the door hits lava', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    // Remove all platforms so the door falls unimpeded, and pin lava near the top.
    s.platforms = [];
    s.missionScene.doorAnchorHash = null;
    s.missionScene.doorY = 300;
    s.missionScene.lavaY = 400;
    for (let i = 0; i < 30; i++) {
      ESCAPE_LAVA_MISSION.update(s, 0.05);
      if (s.missionScene.requestRestart) break;
    }
    expect(s.missionScene.requestRestart).toBe(true);
  });

  it('triggers gameOver when the rising lava reaches the door', () => {
    const s = makeState();
    ESCAPE_LAVA_MISSION.onEnter(s);
    // Park lava so its surface sits just above the door's bottom edge.
    s.missionScene.lavaY = s.missionScene.doorY + s.missionScene.doorH - 1;
    ESCAPE_LAVA_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
    expect(s.gvx).toBe(0);
    expect(s.gvy).toBe(0);
  });

  it('awards the "lava lucky" title and wins when the door lands on the player\'s platform', () => {
    const s = makeState({ standingHash: 0x2002, grounded: true });
    ESCAPE_LAVA_MISSION.onEnter(s);
    const playerPlatform = { x: 20, y: 300, w: 120, h: 10, hash: 0x2002 };
    s.platforms = [playerPlatform];
    s.missionScene.doorAnchorHash = null;
    s.missionScene.doorX = 30;
    s.missionScene.doorY = 100;
    s.missionScene.doorVy = 0;
    for (let i = 0; i < 60; i++) ESCAPE_LAVA_MISSION.update(s, 0.05);
    expect(s.missionScene.reachedDoor).toBe(true);
    expect(s.titles.map((t) => t.name)).toContain('lava lucky');
  });
});

describe('ESCAPE_LAVA_MISSION.update — door collision (torso win)', () => {
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
