import { describe, it, expect } from 'vitest';
import { startAxeSwing, updateAxeSwing, PLATFORM_MINE_HITS } from '../physics.js';
import { AXE_SWING_DURATION, AXE_REACH, MANA_PER_MINE } from '../constants.js';
import { IDLE, WALK } from '../poses.js';

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
    platforms: [],
    holes: [],
    miningProgress: [],
    standingHash: 0,
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

  it('allows swinging while crouching or prone', () => {
    const s = makeState({ posture: 'crouching' });
    expect(startAxeSwing(s)).toBe(true);
    expect(s.axeSwing).not.toBeNull();

    const sp = makeState({ posture: 'prone' });
    expect(startAxeSwing(sp)).toBe(true);
    expect(sp.axeSwing).not.toBeNull();
  });

  it('picks the forward-most arm as lead at swing start', () => {
    // IDLE: rh.x=12, lh.x=-12 → rh is forward
    const s = makeState({ curPose: IDLE });
    startAxeSwing(s);
    expect(s.axeSwing.armR).toBe(true);

    // WALK[0]: lh.x=10, rh.x=-10 → lh is forward
    const w = makeState({ curPose: WALK[0] });
    startAxeSwing(w);
    expect(w.axeSwing.armR).toBe(false);
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

  it('increments minesMined when a mine is depleted', () => {
    const mineX = 100 + AXE_REACH;
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 1, age: 0 }],
      minesMined: 2,
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.minesMined).toBe(3);
  });

  it('does not increment minesMined on a non-depleting hit', () => {
    const mineX = 100 + AXE_REACH;
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [{ x: mineX, y: 190, hits: 3, age: 0 }],
      minesMined: 2,
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.minesMined).toBe(2);
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

describe('updateAxeSwing platform mining', () => {
  // Player stands at gx=100, feetY=200 on platform A (hash 0xA1, y=200),
  // facing right. The torso hit point is feetY - STANDING_HEIGHT/2 = 184,
  // so the side block must be a platform whose body straddles y=184 —
  // i.e. one terminal row above the player. Platform B sits at y=176
  // (body 176..192) and extends rightward past the axe head at x=128.
  function neighborState(overrides = {}) {
    return makeState({
      axeSwing: { t: 0, hit: false },
      lineHeight: 16,
      screenH: 600,
      standingHash: 0xA1,
      platforms: [
        { x: 0, y: 200, w: 100, h: 16, hash: 0xA1 },             // own platform (feet)
        { x: 100, y: 176, w: 200, h: 16, hash: 0xB2 },           // torso-level neighbor
      ],
      ...overrides,
    });
  }

  it('one swing on the torso-level neighbor registers progress but no hole', () => {
    const s = neighborState();
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.holes.length).toBe(0);
    expect(s.miningProgress.length).toBe(1);
    expect(s.miningProgress[0].hits).toBe(1);
    expect(s.miningProgress[0].hash).toBe(0xB2);
  });

  it('after PLATFORM_MINE_HITS swings on the same block, a hole bursts in the torso-level platform', () => {
    const s = neighborState();
    for (let i = 0; i < PLATFORM_MINE_HITS; i++) {
      s.axeSwing = { t: 0, hit: false };
      updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    }
    expect(s.holes.length).toBe(1);
    expect(s.holes[0].y).toBe(176);
    // Progress is cleared once the hole is spawned.
    expect(s.miningProgress.length).toBe(0);
  });

  it('skips the platform whose hash matches standingHash', () => {
    // A torso-level platform sharing the player's standing hash should be
    // ignored — the standingHash skip protects against destroying your own
    // footing even when geometry would otherwise make the body reachable.
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      lineHeight: 16,
      standingHash: 0xA1,
      platforms: [{ x: 0, y: 176, w: 400, h: 16, hash: 0xA1 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(0);
    expect(s.holes.length).toBe(0);
  });

  it('does nothing when the neighbor is at a non-torso level', () => {
    const s = neighborState({
      platforms: [
        { x: 0, y: 200, w: 100, h: 16, hash: 0xA1 },            // own
        { x: 100, y: 100, w: 200, h: 16, hash: 0xB2 },          // way above torso
      ],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(0);
  });

  it('does nothing when the player is airborne', () => {
    const s = neighborState({ grounded: false });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(0);
  });

  it('does not register progress on platforms without a stable hash', () => {
    const s = neighborState({
      platforms: [
        { x: 0, y: 200, w: 100, h: 16, hash: 0xA1 },
        { x: 100, y: 176, w: 200, h: 16, hash: 0 },             // unhashed neighbor
      ],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(0);
  });

  it('mines to the left when the player is facing left', () => {
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      faceR: false,
      lineHeight: 16,
      standingHash: 0xA1,
      platforms: [
        { x: 100 - 10, y: 200, w: 100, h: 16, hash: 0xA1 },     // own (player at gx=100)
        { x: 100 - AXE_REACH - 50, y: 176, w: 50, h: 16, hash: 0xB2 }, // left torso neighbor
      ],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(1);
    expect(s.miningProgress[0].hash).toBe(0xB2);
  });

  it('falls back to platform mining only when no mana mine is hit', () => {
    const mineX = 100 + AXE_REACH;
    const s = neighborState({
      manaMines: [{ x: mineX, y: 190, hits: 3, age: 0 }],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.manaMines[0].hits).toBe(2);
    expect(s.miningProgress.length).toBe(0);
  });

  it('picks the mana mine nearest to the man when several are in reach', () => {
    // Man at gx=100, axe tip at hx=128 (faceR, AXE_REACH=28).
    // Far mine (index 0) sits exactly at the axe tip (closer to axe, farther
    // from man). Near mine (index 1) is between man and axe tip (farther
    // from axe tip, but closer to the man). Both are within AXE_HIT_RADIUS.
    // Nearest-to-man means the near mine should take the hit.
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      manaMines: [
        { x: 115, y: 200, hits: 3, age: 0 }, // near man   (dist ~15)
        { x: 128, y: 190, hits: 3, age: 0 }, // far from man (dist ~28)
      ],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.manaMines[0].hits).toBe(2); // near one hit
    expect(s.manaMines[1].hits).toBe(3); // far one untouched
  });

  it('snaps a new hole to abut an adjacent existing hole so no sliver is left', () => {
    // Existing hole in the torso-level wall at x∈[100,130]. Man stands pressed
    // against the right edge of that hole: gx=120 (faceR, AXE_REACH=28).
    // Without snapping, the new 30-wide hole would center at hx=148 and span
    // [133,163] — a 3px sliver of wall at [130,133] blocks the man from
    // walking further right. With snapping the new hole should abut the old
    // one, spanning [130,160].
    const s = makeState({
      gx: 120, feetY: 200,
      axeSwing: { t: 0, hit: false },
      lineHeight: 16,
      standingHash: 0xA1,
      platforms: [
        { x: 0, y: 200, w: 400, h: 16, hash: 0xA1 },             // floor
        { x: 0, y: 176, w: 400, h: 16, hash: 0xB2 },             // torso-level wall
      ],
      holes: [{ x: 100, y: 176, w: 30, age: 0 }],                // pre-existing hole
    });
    for (let i = 0; i < PLATFORM_MINE_HITS; i++) {
      s.axeSwing = { t: 0, hit: false };
      updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    }
    const newHole = s.holes.find((h) => h.x !== 100);
    expect(newHole).toBeDefined();
    expect(newHole.x).toBe(130);
    expect(newHole.w).toBe(30);
  });

  it('snaps to a left-adjacent hole when the man is facing left', () => {
    // Mirror of the right-facing snap case. Existing hole at x∈[130,160];
    // man at gx=140 facing left. Without snapping, new hole would be
    // [97,127], leaving a sliver at [127,130]. With snap: [100,130].
    const s = makeState({
      gx: 140, feetY: 200,
      faceR: false,
      axeSwing: { t: 0, hit: false },
      lineHeight: 16,
      standingHash: 0xA1,
      platforms: [
        { x: 0, y: 200, w: 400, h: 16, hash: 0xA1 },
        { x: 0, y: 176, w: 400, h: 16, hash: 0xB2 },
      ],
      holes: [{ x: 130, y: 176, w: 30, age: 0 }],
    });
    for (let i = 0; i < PLATFORM_MINE_HITS; i++) {
      s.axeSwing = { t: 0, hit: false };
      updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    }
    const newHole = s.holes.find((h) => h.x !== 130);
    expect(newHole).toBeDefined();
    expect(newHole.x).toBe(100);
    expect(newHole.w).toBe(30);
  });

  it('picks the torso-level platform nearest to the man when several cover the hit point', () => {
    // Two neighboring platforms both straddle the torso hit point, but one
    // sits closer to the man's feet than the other. Nearest-to-man means
    // the closer platform gets the mining progress, not the first one.
    const s = makeState({
      axeSwing: { t: 0, hit: false },
      lineHeight: 16,
      standingHash: 0xA1,
      platforms: [
        { x: 0, y: 200, w: 100, h: 16, hash: 0xA1 },    // own platform (feet)
        { x: 100, y: 170, w: 200, h: 16, hash: 0xFA }, // torso-straddling, farther above
        { x: 100, y: 180, w: 200, h: 16, hash: 0xBB }, // torso-straddling, closer to feet
      ],
    });
    updateAxeSwing(s, AXE_SWING_DURATION * 0.55);
    expect(s.miningProgress.length).toBe(1);
    expect(s.miningProgress[0].hash).toBe(0xBB);
  });
});
