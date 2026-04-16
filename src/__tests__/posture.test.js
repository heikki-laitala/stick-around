import { describe, it, expect } from 'vitest';
import { findCeiling } from '../platforms.js';
import { STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT, CROUCH, PRONE, CROUCH_WALK, PRONE_CRAWL } from '../poses.js';
import { updatePosture, updateMovement, updatePose } from '../physics.js';
import { IDLE } from '../poses.js';

describe('posture heights', () => {
  it('STANDING_HEIGHT > CROUCH_HEIGHT > PRONE_HEIGHT', () => {
    expect(STANDING_HEIGHT).toBeGreaterThan(CROUCH_HEIGHT);
    expect(CROUCH_HEIGHT).toBeGreaterThan(PRONE_HEIGHT);
  });

  it('all heights are positive', () => {
    expect(STANDING_HEIGHT).toBeGreaterThan(0);
    expect(CROUCH_HEIGHT).toBeGreaterThan(0);
    expect(PRONE_HEIGHT).toBeGreaterThan(0);
  });
});

describe('CROUCH and PRONE poses', () => {
  const JOINT_KEYS = [
    'head', 'neck', 'hip', 'lsh', 'rsh', 'lel', 'rel',
    'lh', 'rh', 'lhip', 'rhip', 'lk', 'rk', 'lf', 'rf',
  ];

  it('CROUCH has all joints', () => {
    expect(Object.keys(CROUCH).sort()).toEqual(JOINT_KEYS.sort());
  });

  it('PRONE has all joints', () => {
    expect(Object.keys(PRONE).sort()).toEqual(JOINT_KEYS.sort());
  });

  it('CROUCH_WALK has 4 frames with all joints', () => {
    expect(CROUCH_WALK).toHaveLength(4);
    for (const frame of CROUCH_WALK) {
      expect(Object.keys(frame).sort()).toEqual(JOINT_KEYS.sort());
    }
  });

  it('PRONE_CRAWL has 4 frames with all joints', () => {
    expect(PRONE_CRAWL).toHaveLength(4);
    for (const frame of PRONE_CRAWL) {
      expect(Object.keys(frame).sort()).toEqual(JOINT_KEYS.sort());
    }
  });

  it('CROUCH head is lower than IDLE head', () => {
    expect(CROUCH.head.y).toBeGreaterThan(IDLE.head.y);
  });

  it('PRONE head is lower than CROUCH head', () => {
    expect(PRONE.head.y).toBeGreaterThan(CROUCH.head.y);
  });
});

describe('findCeiling', () => {
  const platforms = [
    { y: 100, x: 0, w: 400, hash: 1 },
    { y: 200, x: 0, w: 400, hash: 2 },
    { y: 300, x: 0, w: 400, hash: 3 },
  ];
  const lineHeight = 20;

  it('returns the nearest platform above within the man height range', () => {
    // Man standing at feetY=300, head reaches up ~32px to 268
    // Platform at y=200 has bottom at y=220. Clearance = 300-220 = 80 (plenty of room)
    const result = findCeiling(platforms, 300, 100, lineHeight);
    expect(result).not.toBeNull();
    expect(result.y).toBe(200);
  });

  it('returns null when no platform above', () => {
    const result = findCeiling(platforms, 90, 100, lineHeight);
    expect(result).toBeNull();
  });

  it('ignores platforms not horizontally overlapping', () => {
    const result = findCeiling(platforms, 300, 500, lineHeight);
    expect(result).toBeNull();
  });

  it('returns the closest platform above (highest y)', () => {
    // Man at feetY=300, platforms at 100 and 200 are both above
    const result = findCeiling(platforms, 300, 100, lineHeight);
    expect(result.y).toBe(200); // closest above
  });
});

describe('updatePosture', () => {
  function makeState(overrides = {}) {
    return {
      gx: 200, feetY: 300, gvx: 0, gvy: 0,
      grounded: true, faceR: true,
      standingHash: 0, walkPh: 0, landT: 0,
      dropThrough: 0,
      curPose: JSON.parse(JSON.stringify(IDLE)),
      rope: null, ropeAngle: -3 * Math.PI / 4, ropeCooldown: 0,
      platforms: [],
      lineHeight: 20,
      posture: 'standing', // 'standing' | 'crouching' | 'prone'
      proneRequested: false,
      ...overrides,
    };
  }

  it('stays standing when no ceiling nearby', () => {
    const s = makeState({ platforms: [] });
    updatePosture(s);
    expect(s.posture).toBe('standing');
  });

  it('auto-crouches when ceiling is too low for standing', () => {
    // Platform bottom at 200+20=220, feetY at 240
    // Clearance = 240-220 = 20, standing height ~32 → must crouch
    const s = makeState({
      feetY: 240, gx: 100,
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
    });
    updatePosture(s);
    expect(s.posture).toBe('crouching');
  });

  it('stays standing when ceiling has enough clearance', () => {
    // Platform bottom at 200+20=220, feetY at 300
    // Clearance = 300-220 = 80 → plenty of room
    const s = makeState({
      feetY: 300, gx: 100,
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
    });
    updatePosture(s);
    expect(s.posture).toBe('standing');
  });

  it('does not auto-prone (requires button)', () => {
    const s = makeState({
      feetY: 260, gx: 100,
      platforms: [{ y: 230, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
    });
    updatePosture(s);
    expect(s.posture).toBe('crouching');
  });

  it('stays prone when proneRequested is true', () => {
    const s = makeState({
      feetY: 260, gx: 100,
      platforms: [{ y: 230, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
      proneRequested: true,
    });
    updatePosture(s);
    expect(s.posture).toBe('prone');
  });

  it('stays prone with no ceiling when proneRequested', () => {
    const s = makeState({
      feetY: 300, gx: 100,
      platforms: [],
      proneRequested: true,
    });
    updatePosture(s);
    expect(s.posture).toBe('prone');
  });

  it('returns to standing when ceiling clears and not proneRequested', () => {
    const s = makeState({
      feetY: 300, gx: 100,
      platforms: [{ y: 100, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
      posture: 'prone',
      proneRequested: false,
    });
    updatePosture(s);
    expect(s.posture).toBe('standing');
  });

  it('returns to standing when ceiling clears while crouching', () => {
    const s = makeState({
      feetY: 300, gx: 100,
      platforms: [{ y: 100, x: 0, w: 400, hash: 1 }],
      lineHeight: 20,
      posture: 'crouching',
    });
    updatePosture(s);
    expect(s.posture).toBe('standing');
  });

  it('does not update posture when airborne', () => {
    const s = makeState({
      grounded: false,
      posture: 'standing',
    });
    updatePosture(s);
    expect(s.posture).toBe('standing');
  });
});

describe('updatePose with posture', () => {
  function makeState(overrides = {}) {
    return {
      gx: 200, feetY: 300, gvx: 0, gvy: 0,
      grounded: true, faceR: true,
      standingHash: 0, walkPh: 0, landT: 0,
      dropThrough: 0,
      curPose: JSON.parse(JSON.stringify(IDLE)),
      rope: null, ropeAngle: -3 * Math.PI / 4, ropeCooldown: 0,
      platforms: [],
      lineHeight: 20,
      posture: 'standing',
      ...overrides,
    };
  }

  it('uses CROUCH pose when crouching and idle', () => {
    const s = makeState({ posture: 'crouching', gvx: 0 });
    updatePose(s, 0.5); // large dt for fast lerp
    // Head should be lower than standing IDLE
    expect(s.curPose.head.y).toBeGreaterThan(IDLE.head.y);
  });

  it('uses PRONE pose when prone', () => {
    const s = makeState({ posture: 'prone', gvx: 0 });
    updatePose(s, 0.5);
    expect(s.curPose.head.y).toBeGreaterThan(CROUCH.head.y);
  });

  it('uses crouch walk cycle when crouching and moving', () => {
    const s = makeState({ posture: 'crouching', gvx: 100 });
    updatePose(s, 0.016);
    expect(s.walkPh).toBeGreaterThan(0);
  });
});

describe('movement blocked when space too tight', () => {
  function makeState(overrides = {}) {
    return {
      gx: 200, feetY: 300, gvx: 100, gvy: 0,
      grounded: true, faceR: true,
      standingHash: 0, walkPh: 0, landT: 0,
      dropThrough: 0,
      curPose: JSON.parse(JSON.stringify(IDLE)),
      rope: null, ropeAngle: -3 * Math.PI / 4, ropeCooldown: 0,
      platforms: [],
      lineHeight: 20,
      posture: 'standing',
      ...overrides,
    };
  }

  it('does not block jump when crouching under ceiling', () => {
    // Crouching but has some clearance — should still not be able to jump
    // (can't stand up, so jump is blocked)
    const s = makeState({
      feetY: 240, gx: 100, posture: 'crouching',
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
      promptArea: null,
    });
    updateMovement(s, 0.016, new Set(['Space']), 800, 600);
    // Should not jump when crouching under a ceiling
    expect(s.gvy).toBe(0);
  });

  it('allows escape jump from footer/prompt area even when crouching', () => {
    const s = makeState({
      feetY: 500, gx: 100, posture: 'crouching',
      platforms: [],
      promptArea: { x: 0, y: 480, w: 600, h: 40 },
    });
    updateMovement(s, 0.016, new Set(['Space']), 800, 600);
    // Should jump with boosted velocity to escape footer
    expect(s.gvy).toBeLessThan(0);
    expect(s.grounded).toBe(false);
  });

  it('blocks horizontal movement into space too tight for crouch', () => {
    // Man at x=195, moving right. Platform ahead (x=200..400) has tight ceiling.
    // Current position (x=195) has no ceiling, destination does.
    // Ceiling at y=296, bottom=316, feetY=320, clearance=4 < crouch height ~21
    // Man at x=199 moving right at 200px/s with dt=0.016 → nextX ≈ 202
    // Ceiling platform at x=200..400, y=296, bottom=316
    // feetY=320, clearance=4 < CROUCH_HEIGHT ~21 → blocked
    // Also add a floor platform so man stays grounded
    const s = makeState({
      feetY: 320, gx: 199, gvx: 200, posture: 'crouching',
      platforms: [
        { y: 296, x: 200, w: 200, hash: 1 }, // ceiling
        { y: 320, x: 0, w: 600, hash: 2 },   // floor
      ],
      lineHeight: 20,
      promptArea: null,
    });
    updateMovement(s, 0.016, new Set(['KeyD']), 800, 600);
    // gvx should be zeroed — can't enter the tight space
    expect(s.gvx).toBe(0);
  });

  it('gives extra jump boost in footer area', () => {
    const s1 = makeState({
      feetY: 500, gx: 100, posture: 'standing',
      platforms: [],
      promptArea: { x: 0, y: 480, w: 600, h: 40 },
    });
    const s2 = makeState({
      feetY: 200, gx: 100, posture: 'standing',
      platforms: [],
      promptArea: { x: 0, y: 480, w: 600, h: 40 },
    });
    updateMovement(s1, 0.001, new Set(['Space']), 800, 600);
    updateMovement(s2, 0.001, new Set(['Space']), 800, 600);
    // Footer jump should be stronger (more negative gvy)
    expect(s1.gvy).toBeLessThan(s2.gvy);
  });
});
