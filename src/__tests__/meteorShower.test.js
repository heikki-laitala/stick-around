import { describe, it, expect } from 'vitest';
import {
  METEOR_SHOWER_MISSION,
  METEOR_DURATION,
  METEOR_SPAWN_INTERVAL,
  restartMeteorShower,
} from '../missions/meteorShower.js';
import { STANDING_HEIGHT } from '../poses.js';

function makeState(overrides = {}) {
  return {
    gx: 400,
    feetY: 500,
    gvx: 0,
    gvy: 0,
    grounded: true,
    screenW: 800,
    screenH: 600,
    textOffsetX: 20,
    textOffsetY: 40,
    textWidth: 700,
    textHeight: 500,
    lineHeight: 16,
    holes: [],
    particles: [],
    platforms: [
      { x: 20, y: 200, w: 700, h: 16, hash: 0xA1 },
      { x: 20, y: 400, w: 700, h: 16, hash: 0xA2 },
    ],
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('METEOR_SHOWER_MISSION.onEnter', () => {
  it('seeds the scene with zero survivedTime, empty meteors, goal duration', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    expect(s.missionScene.survivedTime).toBe(0);
    expect(Array.isArray(s.missionScene.meteors)).toBe(true);
    expect(s.missionScene.meteors.length).toBe(0);
    expect(s.missionScene.durationGoal).toBe(METEOR_DURATION);
  });

  it('clears gameOver, survived, and restart flags', () => {
    const s = makeState({ gameOver: true });
    METEOR_SHOWER_MISSION.onEnter(s);
    expect(s.gameOver).toBe(false);
    expect(s.missionScene.survived).toBe(false);
    expect(s.missionScene.requestRestart).toBe(false);
  });
});

describe('METEOR_SHOWER_MISSION.update — timing and spawning', () => {
  it('advances survivedTime by dt each tick', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    METEOR_SHOWER_MISSION.update(s, 0.5);
    expect(s.missionScene.survivedTime).toBeCloseTo(0.5, 5);
    METEOR_SHOWER_MISSION.update(s, 0.25);
    expect(s.missionScene.survivedTime).toBeCloseTo(0.75, 5);
  });

  it('spawns a meteor above the text area after the spawn interval elapses', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    METEOR_SHOWER_MISSION.update(s, METEOR_SPAWN_INTERVAL + 0.01);
    expect(s.missionScene.meteors.length).toBeGreaterThanOrEqual(1);
    const m = s.missionScene.meteors[0];
    expect(m.x).toBeGreaterThanOrEqual(s.textOffsetX);
    expect(m.x).toBeLessThanOrEqual(s.textOffsetX + s.textWidth);
    expect(m.y).toBeLessThanOrEqual(s.textOffsetY);
    expect(m.vy).toBeGreaterThan(0); // moving downward
    expect(typeof m.vx).toBe('number');
  });

  it('spawns faster near the end of the mission than at the start', () => {
    // Two fresh scenes: one just-started, one almost at the duration goal.
    // Both tick the same slice of time; the near-end scene should spawn
    // noticeably more meteors because the spawn interval has ramped down.
    const early = makeState();
    METEOR_SHOWER_MISSION.onEnter(early);
    const late = makeState();
    METEOR_SHOWER_MISSION.onEnter(late);
    late.missionScene.survivedTime = late.missionScene.durationGoal * 0.95;
    const window = 3.0;
    for (let t = 0; t < window; t += 0.05) {
      METEOR_SHOWER_MISSION.update(early, 0.05);
      METEOR_SHOWER_MISSION.update(late, 0.05);
    }
    expect(late.missionScene.meteors.length)
      .toBeGreaterThan(early.missionScene.meteors.length);
  });

  it('produces a mix of straight and angled meteors across many spawns', () => {
    // Randomness is involved but tight: each spawn independently has a
    // sizeable chance of being angled, so out of 100 spawns we should see
    // at least one of each. If this test flakes the angle probability has
    // drifted to an extreme — worth investigating.
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    for (let i = 0; i < 100; i++) {
      s.missionScene.spawnTimer = METEOR_SPAWN_INTERVAL;
      METEOR_SHOWER_MISSION.update(s, 0.001);
    }
    const angled = s.missionScene.meteors.filter((m) => m.vx !== 0);
    const straight = s.missionScene.meteors.filter((m) => m.vx === 0);
    expect(angled.length).toBeGreaterThan(0);
    expect(straight.length).toBeGreaterThan(0);
  });

  it('does not spawn on a short tick below the spawn interval', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    METEOR_SHOWER_MISSION.update(s, METEOR_SPAWN_INTERVAL * 0.4);
    expect(s.missionScene.meteors.length).toBe(0);
  });

  it('targets a meaningful fraction of meteors at the man\'s current x', () => {
    // If meteors scatter uniformly across a wide text area, standing still
    // and side-stepping beats the mission — most meteors land nowhere near
    // the man. A non-trivial share of spawns must project onto the man's
    // current torso column so holding position is punished.
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    for (let i = 0; i < 200; i++) {
      s.missionScene.spawnTimer = METEOR_SPAWN_INTERVAL;
      METEOR_SHOWER_MISSION.update(s, 0.001);
    }
    const torsoY = s.feetY - STANDING_HEIGHT / 2;
    const threatening = s.missionScene.meteors.filter((m) => {
      const t = (torsoY - m.y) / m.vy;
      const landX = m.x + (m.vx || 0) * t;
      return Math.abs(landX - s.gx) < 30;
    });
    // Uniform scatter across a 700px text area with gx=400 only puts ~30%
    // of meteors within ±30px of the man. Targeting should push this well
    // past that baseline.
    expect(threatening.length).toBeGreaterThan(90);
  });
});

describe('METEOR_SHOWER_MISSION.update — meteor motion', () => {
  it('meteors fall downward over time', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.meteors.push({ x: 400, y: 50, vx: 0, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.1);
    expect(s.missionScene.meteors[0].y).toBeGreaterThan(50);
  });

  it('angled meteors drift horizontally as they fall', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.meteors.push({ x: 400, y: 50, vx: 100, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.1);
    expect(s.missionScene.meteors[0].x).toBeCloseTo(410, 5);
    expect(s.missionScene.meteors[0].y).toBeCloseTo(70, 5);
  });

  it('removes meteors that fall off the bottom of the screen', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.meteors.push({ x: 400, y: s.screenH + 1, vx: 0, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.016);
    expect(s.missionScene.meteors.length).toBe(0);
  });

  it('removes angled meteors that drift off the side of the screen', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.meteors.push({ x: s.screenW + 5, y: 200, vx: 100, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.016);
    expect(s.missionScene.meteors.length).toBe(0);
  });
});

describe('METEOR_SHOWER_MISSION.update — platform bursting', () => {
  it('a meteor crossing a platform top burns a hole through it', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    // Meteor just above the y=200 platform, moving down enough to cross it this step.
    s.missionScene.meteors.push({ x: 300, y: 195, vx: 0, vy: 500 });
    METEOR_SHOWER_MISSION.update(s, 0.05);
    const hole = s.holes.find((h) => Math.abs(h.y - 200) < 2);
    expect(hole).toBeDefined();
    expect(hole.x).toBeLessThanOrEqual(300);
    expect(hole.x + hole.w).toBeGreaterThanOrEqual(300);
  });

  it('a meteor continues falling after bursting — it can punch through a second platform', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    // Meteor well above both platforms; advance far enough to cross both in one tick.
    s.missionScene.meteors.push({ x: 300, y: 100, vx: 0, vy: 2000 });
    // Two half-steps: one crosses y=200, the next crosses y=400.
    METEOR_SHOWER_MISSION.update(s, 0.06);
    METEOR_SHOWER_MISSION.update(s, 0.12);
    const hole1 = s.holes.find((h) => Math.abs(h.y - 200) < 2);
    const hole2 = s.holes.find((h) => Math.abs(h.y - 400) < 2);
    expect(hole1).toBeDefined();
    expect(hole2).toBeDefined();
  });

  it('an angled meteor bursts the platform at its crossing x, not its start x', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    // Meteor starts at x=200, y=180 above the y=200 platform with a steep
    // downward-right vector: in one tick it lands at x=300, y=280. The
    // hole should be centered near the x where y=200 was crossed (~x=220),
    // not at x=200 (start) or x=300 (end).
    s.missionScene.meteors.push({ x: 200, y: 180, vx: 500, vy: 500 });
    METEOR_SHOWER_MISSION.update(s, 0.2);
    const hole = s.holes.find((h) => Math.abs(h.y - 200) < 2);
    expect(hole).toBeDefined();
    const center = hole.x + hole.w / 2;
    expect(center).toBeGreaterThan(210);
    expect(center).toBeLessThan(230);
  });
});

describe('METEOR_SHOWER_MISSION.update — man collision', () => {
  it('sets gameOver when a meteor lands on the man', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    // Spawn meteor directly on top of the man's torso.
    const torsoY = s.feetY - STANDING_HEIGHT / 2;
    s.missionScene.meteors.push({ x: s.gx, y: torsoY, vx: 0, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
  });

  it('does not trigger gameOver when the meteor is far from the man', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.meteors.push({ x: s.gx + 400, y: s.feetY, vx: 0, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
  });

  it('a shielded man absorbs meteors without dying', () => {
    const s = makeState({ shieldActive: true });
    METEOR_SHOWER_MISSION.onEnter(s);
    // onEnter must not clobber the pre-existing shield — it belongs to the
    // player, not the mission scene.
    s.shieldActive = true;
    const torsoY = s.feetY - STANDING_HEIGHT / 2;
    s.missionScene.meteors.push({ x: s.gx, y: torsoY, vx: 0, vy: 200 });
    METEOR_SHOWER_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
    expect(s.missionScene.meteors.length).toBe(0); // meteor was absorbed
  });
});

describe('METEOR_SHOWER_MISSION.update — survival', () => {
  it('sets scene.survived once survivedTime reaches the duration goal', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    s.missionScene.survivedTime = METEOR_DURATION - 0.01;
    METEOR_SHOWER_MISSION.update(s, 0.02);
    expect(s.missionScene.survived).toBe(true);
  });

  it('stays not-survived before the goal is hit', () => {
    const s = makeState();
    METEOR_SHOWER_MISSION.onEnter(s);
    METEOR_SHOWER_MISSION.update(s, 0.5);
    expect(s.missionScene.survived).toBe(false);
  });

  it('is a no-op when gameOver is already set', () => {
    const s = makeState({ gameOver: true });
    METEOR_SHOWER_MISSION.onEnter(s);
    s.gameOver = true;
    const t0 = s.missionScene.survivedTime;
    METEOR_SHOWER_MISSION.update(s, 1.0);
    expect(s.missionScene.survivedTime).toBe(t0);
    expect(s.missionScene.meteors.length).toBe(0);
  });
});

describe('METEOR_SHOWER_MISSION.check', () => {
  it('returns true when scene.survived is true', () => {
    expect(METEOR_SHOWER_MISSION.check({ missionScene: { survived: true } })).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(METEOR_SHOWER_MISSION.check({ missionScene: { survived: false } })).toBe(false);
    expect(METEOR_SHOWER_MISSION.check({ missionScene: null })).toBe(false);
    expect(METEOR_SHOWER_MISSION.check({})).toBe(false);
  });
});

describe('restartMeteorShower', () => {
  it('clears gameOver and missionScene so advanceMission re-enters the mission', () => {
    const s = {
      gameOver: true,
      currentMissionId: 'dodge-meteors',
      missionScene: { survivedTime: 4, meteors: [{}, {}] },
    };
    restartMeteorShower(s);
    expect(s.gameOver).toBe(false);
    expect(s.currentMissionId).toBeNull();
    expect(s.missionScene).toBeNull();
  });
});
