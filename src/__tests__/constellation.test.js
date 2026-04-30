import { describe, it, expect } from 'vitest';
import {
  CONSTELLATION_MISSION,
  CONSTELLATION_DURATION,
  CONSTELLATION_PRIMER_MANA,
  starsHitByBolt,
} from '../missions/constellation.js';

function makeState(overrides = {}) {
  return {
    gx: 200, feetY: 400,
    gvx: 0, gvy: 0, grounded: true,
    faceR: true,
    posture: 'standing',
    platforms: [
      { x: 0, y: 400, w: 800, hash: 0xFFFF },
    ],
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
    lightningBolt: null,
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('CONSTELLATION_MISSION onEnter', () => {
  it('primes the player to at least CONSTELLATION_PRIMER_MANA', () => {
    const s = makeState({ mana: 0 });
    CONSTELLATION_MISSION.onEnter(s);
    expect(s.mana).toBe(CONSTELLATION_PRIMER_MANA);
  });

  it('does not lower mana if the player already has more', () => {
    const s = makeState({ mana: CONSTELLATION_PRIMER_MANA + 10 });
    CONSTELLATION_MISSION.onEnter(s);
    expect(s.mana).toBe(CONSTELLATION_PRIMER_MANA + 10);
  });

  it('seeds the star pattern and the target edge list', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    expect(Array.isArray(s.missionScene.stars)).toBe(true);
    expect(s.missionScene.stars.length).toBeGreaterThan(0);
    expect(Array.isArray(s.missionScene.edges)).toBe(true);
    expect(s.missionScene.edges.length).toBeGreaterThan(0);
    for (const e of s.missionScene.edges) expect(e.drawn).toBe(false);
  });

  it('starts the timer at CONSTELLATION_DURATION', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    expect(s.missionScene.timeLeft).toBeCloseTo(CONSTELLATION_DURATION, 5);
  });
});

describe('starsHitByBolt', () => {
  it('returns stars on the ray sorted by along-ray distance', () => {
    const stars = [
      { id: 'A', x: 100, y: 100 },
      { id: 'B', x: 100, y: 200 },                  // closer
      { id: 'C', x: 100, y: 50 },                   // farther
      { id: 'D', x: 600, y: 100 },                  // off-ray
    ];
    // Bolt fires from (100, 300) straight up — angle = -π/2.
    const bolt = { x: 100, y: 300, angle: -Math.PI / 2 };
    const hits = starsHitByBolt(stars, bolt);
    const ids = hits.map((s) => s.id);
    expect(ids).toEqual(['B', 'A', 'C']);
  });

  it('returns nothing when the bolt is null', () => {
    expect(starsHitByBolt([], null)).toEqual([]);
  });
});

describe('CONSTELLATION_MISSION update — bolt scoring', () => {
  function ctx() {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    return s;
  }

  it('marks an edge drawn when a bolt crosses both of its stars first', () => {
    const s = ctx();
    const a = s.missionScene.stars.find((x) => x.id === 'A');
    // Fire a vertical bolt from below A — ray crosses D first (it sits
    // between the player and A on the same column), then A.
    s.lightningBolt = { x: a.x, y: 500, angle: -Math.PI / 2 };
    CONSTELLATION_MISSION.update(s, 0.016);
    const edge = s.missionScene.edges.find((e) =>
      (e.a === 'A' && e.b === 'D') || (e.a === 'D' && e.b === 'A'),
    );
    expect(edge.drawn).toBe(true);
  });

  it('a bolt hitting a non-target pair leaves all edges undrawn', () => {
    const s = ctx();
    // Move stars so we can craft a non-target alignment without
    // depending on the layout.
    s.missionScene.stars = [
      { id: 'A', x: 200, y: 100 },
      { id: 'B', x: 200, y: 200 },
      { id: 'X', x: 200, y: 150 },
      { id: 'Y', x: 200, y: 250 },                 // unused-id sentinel
    ];
    s.missionScene.edges = [{ a: 'A', b: 'B', drawn: false }];
    s.lightningBolt = { x: 200, y: 400, angle: -Math.PI / 2 };
    CONSTELLATION_MISSION.update(s, 0.016);
    expect(s.missionScene.edges[0].drawn).toBe(false);
    expect(s.missionScene.flash?.success).toBe(false);
  });

  it('records a flash with success=true after a hit', () => {
    const s = ctx();
    const a = s.missionScene.stars.find((x) => x.id === 'A');
    s.lightningBolt = { x: a.x, y: 500, angle: -Math.PI / 2 };
    CONSTELLATION_MISSION.update(s, 0.016);
    expect(s.missionScene.flash).toBeDefined();
    expect(s.missionScene.flash.success).toBe(true);
    expect(['A', 'D']).toContain(s.missionScene.flash.from.id);
  });

  it('does not score the same bolt twice across multiple ticks', () => {
    const s = ctx();
    const a = s.missionScene.stars.find((x) => x.id === 'A');
    s.lightningBolt = { x: a.x, y: 500, angle: -Math.PI / 2 };
    CONSTELLATION_MISSION.update(s, 0.016);
    const drawn1 = s.missionScene.edges.filter((e) => e.drawn).length;
    // Second tick, same bolt object — should not re-score.
    CONSTELLATION_MISSION.update(s, 0.016);
    const drawn2 = s.missionScene.edges.filter((e) => e.drawn).length;
    expect(drawn2).toBe(drawn1);
  });
});

describe('CONSTELLATION_MISSION timer + check', () => {
  it('drains the timer each tick', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    CONSTELLATION_MISSION.update(s, 1.0);
    expect(s.missionScene.timeLeft).toBeCloseTo(CONSTELLATION_DURATION - 1.0, 5);
  });

  it('sets gameOver when the timer expires with edges still pending', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    CONSTELLATION_MISSION.update(s, CONSTELLATION_DURATION + 0.1);
    expect(s.gameOver).toBe(true);
  });

  it('check() returns true once every edge is drawn', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    for (const e of s.missionScene.edges) e.drawn = true;
    expect(CONSTELLATION_MISSION.check(s)).toBe(true);
  });

  it('check() is false while edges remain', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    expect(CONSTELLATION_MISSION.check(s)).toBe(false);
  });

  it('freezes the timer once every edge is drawn', () => {
    const s = makeState();
    CONSTELLATION_MISSION.onEnter(s);
    for (const e of s.missionScene.edges) e.drawn = true;
    const left = s.missionScene.timeLeft;
    CONSTELLATION_MISSION.update(s, 1.0);
    expect(s.missionScene.timeLeft).toBe(left);
  });
});
