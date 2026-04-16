import { describe, it, expect } from 'vitest';
import { updateMovement, updateRope, updatePose } from '../physics.js';
import { IDLE } from '../poses.js';
import { JUMP_V, MAXV } from '../constants.js';

function makeState(overrides = {}) {
  return {
    gx: 200, feetY: 300, gvx: 0, gvy: 0,
    grounded: true, faceR: true,
    standingHash: 0, walkPh: 0, landT: 0,
    dropThrough: 0,
    curPose: JSON.parse(JSON.stringify(IDLE)),
    rope: null, ropeAngle: -3 * Math.PI / 4, ropeCooldown: 0,
    platforms: [
      { y: 300, x: 0, w: 400, hash: 1 },
      { y: 200, x: 0, w: 400, hash: 2 },
      { y: 100, x: 0, w: 400, hash: 3 },
    ],
    lineHeight: 20,
    ...overrides,
  };
}

function makeKeys(...codes) {
  return new Set(codes);
}

describe('updateMovement', () => {
  it('applies gravity when not grounded', () => {
    const s = makeState({ grounded: false, gvy: 0, platforms: [] });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    expect(s.gvy).toBeGreaterThan(0);
  });

  it('does not apply gravity when grounded', () => {
    const s = makeState({ grounded: true });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    expect(s.gvy).toBe(0);
  });

  it('accelerates left when KeyA pressed', () => {
    const s = makeState();
    updateMovement(s, 0.016, makeKeys('KeyA'), 800, 600);
    expect(s.gvx).toBeLessThan(0);
    expect(s.faceR).toBe(false);
  });

  it('accelerates right when KeyD pressed', () => {
    const s = makeState();
    updateMovement(s, 0.016, makeKeys('KeyD'), 800, 600);
    expect(s.gvx).toBeGreaterThan(0);
    expect(s.faceR).toBe(true);
  });

  it('applies friction when no directional input', () => {
    const s = makeState({ gvx: 100 });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    expect(s.gvx).toBeLessThan(100);
  });

  it('clamps velocity to MAXV', () => {
    const s = makeState({ gvx: MAXV + 100 });
    updateMovement(s, 0.016, makeKeys('KeyD'), 800, 600);
    expect(s.gvx).toBeLessThanOrEqual(MAXV);
  });

  it('jumps when grounded and jump key pressed', () => {
    const s = makeState({ grounded: true });
    updateMovement(s, 0.016, makeKeys('Space'), 800, 600);
    // gvy starts at -JUMP_V but gravity applies in same frame
    expect(s.gvy).toBeLessThan(0);
    expect(s.grounded).toBe(false);
  });

  it('does not jump when airborne', () => {
    const s = makeState({ grounded: false, gvy: 50, platforms: [] });
    updateMovement(s, 0.016, makeKeys('Space'), 800, 600);
    expect(s.gvy).not.toBe(-JUMP_V);
  });

  it('wraps position at screen edges', () => {
    const s = makeState({ gx: -25, gvx: -10 });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    expect(s.gx).toBe(800);
  });

  it('snaps to platform when falling through it', () => {
    const s = makeState({
      grounded: false, gvy: 200, feetY: 198,
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
    });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    expect(s.feetY).toBe(200);
    expect(s.grounded).toBe(true);
    expect(s.gvy).toBe(0);
  });

  it('detects walking off platform edge', () => {
    const s = makeState({
      grounded: true, feetY: 300, gx: 500,
      platforms: [{ y: 300, x: 0, w: 400, hash: 1 }],
    });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    // gx=500 is outside platform w=400, should become airborne
    expect(s.grounded).toBe(false);
  });
});

describe('updateRope', () => {
  it('adjusts aim angle with W key', () => {
    const s = makeState({
      rope: {
        state: 'aiming', angle: -Math.PI / 2,
        tipX: 0, tipY: 0, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
    });
    const angleBefore = s.rope.angle;
    updateRope(s, 0.016, makeKeys('KeyW'));
    expect(s.rope.angle).toBeLessThan(angleBefore);
  });

  it('moves tip along angle when flying', () => {
    const s = makeState({
      rope: {
        state: 'flying', angle: -Math.PI / 4,
        tipX: 200, tipY: 200, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
      feetY: 300, gx: 200,
    });
    updateRope(s, 0.016, makeKeys());
    expect(s.rope.tipX).toBeGreaterThan(200);
    expect(s.rope.tipY).toBeLessThan(200);
  });

  it('cancels rope when tip goes off screen', () => {
    const s = makeState({
      rope: {
        state: 'flying', angle: -Math.PI / 2,
        tipX: 200, tipY: -5, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
      feetY: 300, gx: 200,
      screenW: 800, screenH: 600,
    });
    updateRope(s, 0.016, makeKeys());
    expect(s.rope).toBeNull();
  });

  it('attaches to platform when tip enters bounding box', () => {
    const s = makeState({
      rope: {
        state: 'flying', angle: 0,
        tipX: 100, tipY: 105, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
      platforms: [{ y: 100, x: 0, w: 400, hash: 5 }],
      lineHeight: 20, feetY: 300, gx: 100,
    });
    updateRope(s, 0.001, makeKeys()); // tiny dt so tip barely moves
    expect(s.rope.state).toBe('swinging');
    expect(s.rope.hitY).toBe(100);
    expect(s.rope.anchorHash).toBe(5);
  });

  it('applies pendulum physics when swinging', () => {
    const s = makeState({
      rope: {
        state: 'swinging', angle: 0, anchorHash: 1,
        tipX: 200, tipY: 100, hitX: 200, hitY: 100,
        ropeLen: 100, swingAngle: 0.3, swingVel: 0,
        swingTime: 0, startPlatY: 300,
      },
      feetY: 200, gx: 230,
    });
    updateRope(s, 0.016, makeKeys());
    // Gravity should change swingVel
    expect(s.rope.swingVel).not.toBe(0);
    expect(s.rope.swingTime).toBeGreaterThan(0);
  });
});

describe('updatePose', () => {
  it('targets IDLE when grounded and stationary', () => {
    const s = makeState({ grounded: true, gvx: 0, landT: 0 });
    updatePose(s, 0.016);
    // After lerping toward IDLE, head should approach IDLE head
    expect(s.curPose.head.y).toBeLessThan(0);
  });

  it('uses walk cycle when moving horizontally', () => {
    const s = makeState({ grounded: true, gvx: 100, landT: 0 });
    updatePose(s, 0.016);
    expect(s.walkPh).toBeGreaterThan(0);
  });

  it('uses JUMP_RISE when rising', () => {
    const s = makeState({ grounded: false, gvy: -200 });
    updatePose(s, 0.016);
    // Rising: target blends toward JUMP_RISE — head should be high
    expect(s.curPose.head.y).toBeLessThan(-40);
  });

  it('uses LAND pose when landT > 0', () => {
    const s = makeState({ grounded: true, gvx: 0, landT: 0.1 });
    updatePose(s, 0.016);
    expect(s.landT).toBeLessThan(0.1);
  });

  it('uses JUMP_RISE when swinging on rope', () => {
    const s = makeState({
      rope: { state: 'swinging' },
      grounded: false,
    });
    updatePose(s, 0.016);
    // Should target JUMP_RISE pose
    expect(s.curPose.head.y).toBeLessThan(-40);
  });
});
