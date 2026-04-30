import { describe, it, expect } from 'vitest';
import { updateMovement, updateRope, updatePose, resetPlayer, updateParticles, isInHole, isInWater, WADE_SPEED_MUL } from '../physics.js';
import { IDLE, SWIM } from '../poses.js';
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
    posture: 'standing',
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

  it('decays gvx far slower on ice than on dry ground', () => {
    const dry = makeState({ gvx: 200 });
    const ice = makeState({ gvx: 200, missionScene: { iceFloor: true } });
    for (let i = 0; i < 30; i++) {
      updateMovement(dry, 0.016, makeKeys(), 800, 600);
      updateMovement(ice, 0.016, makeKeys(), 800, 600);
    }
    // After ~half a second of coasting, ice should retain at least 2x the
    // velocity that dry friction would leave behind.
    expect(ice.gvx).toBeGreaterThan(dry.gvx * 2);
    // And ice itself should still be near full speed — sliding-with-momentum.
    expect(ice.gvx).toBeGreaterThan(150);
  });

  it('still accepts directional acceleration on ice', () => {
    const s = makeState({ gvx: 0, missionScene: { iceFloor: true } });
    updateMovement(s, 0.016, makeKeys('KeyD'), 800, 600);
    expect(s.gvx).toBeGreaterThan(0);
  });

  it('jumps when grounded and KeyW pressed', () => {
    const s = makeState({ grounded: true });
    updateMovement(s, 0.016, makeKeys('KeyW'), 800, 600);
    // gvy starts at -JUMP_V but gravity applies in same frame
    expect(s.gvy).toBeLessThan(0);
    expect(s.grounded).toBe(false);
  });

  it('does not jump when airborne', () => {
    const s = makeState({ grounded: false, gvy: 50, platforms: [] });
    updateMovement(s, 0.016, makeKeys('KeyW'), 800, 600);
    expect(s.gvy).not.toBe(-JUMP_V);
  });

  it('does not jump on bare Space — Space is unbound', () => {
    const s = makeState({ grounded: true });
    updateMovement(s, 0.016, makeKeys('Space'), 800, 600);
    expect(s.gvy).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it('does not walk on ArrowLeft/ArrowRight — arrows are reserved for aim', () => {
    const s = makeState({ grounded: true });
    updateMovement(s, 0.016, makeKeys('ArrowRight'), 800, 600);
    expect(s.gvx).toBe(0);
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
  it('adjusts aim angle leftward with ArrowLeft', () => {
    const s = makeState({
      rope: {
        state: 'aiming', angle: -Math.PI / 2,
        tipX: 0, tipY: 0, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
    });
    const angleBefore = s.rope.angle;
    updateRope(s, 0.016, makeKeys('ArrowLeft'));
    expect(s.rope.angle).toBeLessThan(angleBefore);
  });

  it('adjusts aim angle rightward with ArrowRight', () => {
    const s = makeState({
      rope: {
        state: 'aiming', angle: -Math.PI / 2,
        tipX: 0, tipY: 0, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
    });
    const angleBefore = s.rope.angle;
    updateRope(s, 0.016, makeKeys('ArrowRight'));
    expect(s.rope.angle).toBeGreaterThan(angleBefore);
  });

  it('does not aim when W is held (W stays reserved for jump/move)', () => {
    const s = makeState({
      rope: {
        state: 'aiming', angle: -Math.PI / 2,
        tipX: 0, tipY: 0, hitX: 0, hitY: 0,
        ropeLen: 0, swingAngle: 0, swingVel: 0,
      },
    });
    const angleBefore = s.rope.angle;
    updateRope(s, 0.016, makeKeys('KeyW'));
    expect(s.rope.angle).toBe(angleBefore);
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
        state: 'swinging', angle: 0, anchorHash: 3,
        tipX: 200, tipY: 100, hitX: 200, hitY: 100,
        ropeLen: 50, swingAngle: 0.3, swingVel: 0,
        swingTime: 0, startPlatY: 300,
      },
      feetY: 150, gx: 215,
      platforms: [{ y: 100, x: 0, w: 400, hash: 3 }], // anchor only
    });
    updateRope(s, 0.016, makeKeys());
    expect(s.rope.swingVel).not.toBe(0);
    expect(s.rope.swingTime).toBeGreaterThan(0);
  });

  it('damps swing velocity more after anchor decay window', () => {
    const base = () => ({
      state: 'swinging', angle: 0, anchorHash: 3,
      tipX: 200, tipY: 100, hitX: 200, hitY: 100,
      ropeLen: 80, swingAngle: 0, swingVel: 2,
      startPlatY: 300, startPlatHash: 1,
    });
    const fresh = makeState({
      rope: { ...base(), swingTime: 0 },
      grounded: false, feetY: 180, gx: 200,
      platforms: [{ y: 100, x: 0, w: 400, hash: 3 }],
    });
    const decayed = makeState({
      rope: { ...base(), swingTime: 30 },
      grounded: false, feetY: 180, gx: 200,
      platforms: [{ y: 100, x: 0, w: 400, hash: 3 }],
    });
    updateRope(fresh, 0.016, makeKeys());
    updateRope(decayed, 0.016, makeKeys());
    expect(decayed.rope.swingVel).toBeLessThan(fresh.rope.swingVel);
  });

  it('fades pump effectiveness after anchor decay window but keeps a floor', () => {
    const base = () => ({
      state: 'swinging', angle: 0, anchorHash: 3,
      tipX: 200, tipY: 100, hitX: 200, hitY: 100,
      ropeLen: 80, swingAngle: 0, swingVel: 0,
      startPlatY: 300, startPlatHash: 1,
    });
    const fresh = makeState({
      rope: { ...base(), swingTime: 0 },
      grounded: false, feetY: 180, gx: 200,
      platforms: [{ y: 100, x: 0, w: 400, hash: 3 }],
    });
    const decayed = makeState({
      rope: { ...base(), swingTime: 30 },
      grounded: false, feetY: 180, gx: 200,
      platforms: [{ y: 100, x: 0, w: 400, hash: 3 }],
    });
    updateRope(fresh, 0.016, makeKeys('KeyD'));
    updateRope(decayed, 0.016, makeKeys('KeyD'));
    expect(decayed.rope.swingVel).toBeGreaterThan(0);
    expect(decayed.rope.swingVel).toBeLessThan(fresh.rope.swingVel);
    // Floor is 25% → decayed impulse ≈ 0.25x fresh impulse (allow some slack for damping).
    expect(decayed.rope.swingVel).toBeGreaterThan(fresh.rope.swingVel * 0.2);
    expect(decayed.rope.swingVel).toBeLessThan(fresh.rope.swingVel * 0.3);
  });
});

describe('updateRope swing collision', () => {
  it('detaches rope when swinging through a platform', () => {
    // Swinging from anchor at (200, 100), ropeLen=150
    // swingAngle=0 → man at (200, 250). After physics, angle moves
    // and man position should collide with platform at y=200..220
    // Platform spans x=0..400, y=200, lineHeight=20 → body from 200 to 220
    const s = makeState({
      rope: {
        state: 'swinging', angle: 0, anchorHash: 3,
        tipX: 200, tipY: 100, hitX: 200, hitY: 100,
        ropeLen: 80, swingAngle: 0.1, swingVel: 2,
        swingTime: 0.5, startPlatY: 300,
      },
      grounded: false, feetY: 108, gx: 208,
      platforms: [
        { y: 100, x: 0, w: 400, hash: 3 },  // anchor platform
        { y: 200, x: 0, w: 400, hash: 2 },  // platform to collide with
        { y: 300, x: 0, w: 400, hash: 1 },
      ],
      lineHeight: 20,
    });
    // Simulate several frames to swing man into the platform at y=200
    for (let i = 0; i < 60; i++) {
      updateRope(s, 0.016, makeKeys());
      if (!s.rope) break;
    }
    // Should have either landed on or detached from rope (not stuck inside platform)
    if (s.rope) {
      // If still on rope, man should be above the platform, not inside it
      expect(s.feetY).toBeLessThanOrEqual(200);
    } else {
      // Detached — should be grounded on a platform or falling
      expect(s.feetY).toBeLessThanOrEqual(300);
    }
  });

  it('lands on platform when swinging into it from above', () => {
    // Man swinging with enough velocity to reach a platform
    const s = makeState({
      rope: {
        state: 'swinging', angle: 0, anchorHash: 3,
        tipX: 200, tipY: 100, hitX: 200, hitY: 100,
        ropeLen: 120, swingAngle: -0.5, swingVel: 1.5,
        swingTime: 0.5, startPlatY: 300,
      },
      grounded: false, feetY: 160, gx: 140,
      platforms: [
        { y: 100, x: 0, w: 400, hash: 3 },
        { y: 200, x: 0, w: 400, hash: 2 },
        { y: 300, x: 0, w: 400, hash: 1 },
      ],
      lineHeight: 20,
    });
    for (let i = 0; i < 120; i++) {
      updateRope(s, 0.016, makeKeys());
      if (!s.rope) break;
    }
    // Should have landed
    expect(s.rope).toBeNull();
    expect(s.grounded).toBe(true);
  });
});

describe('resetPlayer', () => {
  it('resets player to spawn position', () => {
    const s = makeState({
      gx: 50, feetY: 100, gvx: 200, gvy: -100,
      grounded: false, rope: { state: 'swinging' },
      posture: 'prone', proneRequested: true,
      promptArea: { x: 0, y: 400, w: 600, h: 40 },
      textOffsetX: 10, textWidth: 700,
    });
    resetPlayer(s);
    expect(s.gvx).toBe(0);
    expect(s.gvy).toBe(0);
    expect(s.grounded).toBe(true);
    expect(s.rope).toBeNull();
    expect(s.posture).toBe('standing');
    expect(s.proneRequested).toBe(false);
    expect(s.feetY).toBe(400); // promptArea.y
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

describe('isInHole', () => {
  it('returns true when x is inside a hole on the same platform y', () => {
    const holes = [{ x: 100, y: 200, w: 30, age: 0 }];
    expect(isInHole(holes, 115, 200)).toBe(true);
  });

  it('returns false when x is outside hole', () => {
    const holes = [{ x: 100, y: 200, w: 30, age: 0 }];
    expect(isInHole(holes, 50, 200)).toBe(false);
  });

  it('returns false when y does not match', () => {
    const holes = [{ x: 100, y: 200, w: 30, age: 0 }];
    expect(isInHole(holes, 115, 300)).toBe(false);
  });

  it('returns false with empty holes', () => {
    expect(isInHole([], 115, 200)).toBe(false);
  });
});

describe('platform burst', () => {
  it('creates hole during rope swing collision', () => {
    const s = makeState({
      rope: {
        state: 'swinging', angle: 0, anchorHash: 3,
        tipX: 200, tipY: 50, hitX: 200, hitY: 50,
        ropeLen: 120, swingAngle: 0.3, swingVel: 1.0,
        swingTime: 0.5, startPlatY: 300, startPlatHash: 1,
      },
      grounded: false, feetY: 140, gx: 236,
      platforms: [
        { y: 50, x: 0, w: 400, hash: 3 },   // anchor
        { y: 150, x: 0, w: 400, hash: 2 },   // target to burst
        { y: 300, x: 0, w: 400, hash: 1 },   // start
      ],
      holes: [],
      particles: [],
      lineHeight: 20,
    });
    // Simulate frames — burst is automatic
    for (let i = 0; i < 60; i++) {
      updateRope(s, 0.016, makeKeys());
      if (!s.rope) break;
    }
    // Should have created a hole and stayed on rope (not landed)
    expect(s.holes.length).toBeGreaterThan(0);
    expect(s.holes[0].y).toBe(150);
  });

  it('auto-bursts through platform without an explicit input', () => {
    const s = makeState({
      rope: {
        state: 'swinging', angle: 0, anchorHash: 3,
        tipX: 200, tipY: 50, hitX: 200, hitY: 50,
        ropeLen: 120, swingAngle: 0.3, swingVel: 1.0,
        swingTime: 0.5, startPlatY: 300, startPlatHash: 1,
      },
      grounded: false, feetY: 140, gx: 236,
      platforms: [
        { y: 50, x: 0, w: 400, hash: 3 },
        { y: 150, x: 0, w: 400, hash: 2 },
        { y: 300, x: 0, w: 400, hash: 1 },
      ],
      holes: [],
      particles: [],
      lineHeight: 20,
    });
    for (let i = 0; i < 60; i++) {
      updateRope(s, 0.016, makeKeys());
      if (!s.rope) break;
    }
    // Should have burst through automatically
    expect(s.holes.length).toBeGreaterThan(0);
  });

  it('man falls through holes in platforms', () => {
    const s = makeState({
      grounded: false, gvy: 200, feetY: 148,
      platforms: [{ y: 150, x: 0, w: 400, hash: 2 }],
      holes: [{ x: 185, y: 150, w: 30, age: 0 }],
      gx: 200,
    });
    updateMovement(s, 0.016, makeKeys(), 800, 600);
    // Man should fall through the hole, not land on the platform
    expect(s.feetY).toBeGreaterThan(150);
    expect(s.grounded).toBe(false);
  });
});

describe('isInWater', () => {
  it('returns false when no waterArea is set', () => {
    const s = makeState({ waterArea: null });
    expect(isInWater(s)).toBe(false);
  });

  it('returns true when feet are inside the waterArea rect', () => {
    const s = makeState({
      gx: 200, feetY: 310,
      waterArea: { x: 100, y: 300, w: 300, h: 20 },
    });
    expect(isInWater(s)).toBe(true);
  });

  it('returns false when feet are outside horizontally', () => {
    const s = makeState({
      gx: 50, feetY: 310,
      waterArea: { x: 100, y: 300, w: 300, h: 20 },
    });
    expect(isInWater(s)).toBe(false);
  });

  it('returns false when feet are above the water surface', () => {
    const s = makeState({
      gx: 200, feetY: 290,
      waterArea: { x: 100, y: 300, w: 300, h: 20 },
    });
    expect(isInWater(s)).toBe(false);
  });
});

describe('wading', () => {
  it('caps horizontal top speed far below MAXV while in water', () => {
    const s = makeState({
      gx: 200, feetY: 310, gvx: MAXV,
      waterArea: { x: 0, y: 300, w: 800, h: 20 },
    });
    updateMovement(s, 0.016, makeKeys('KeyD'), 800, 600);
    // The wade clamp is applied after accel, so gvx can't exceed
    // MAXV * WADE_SPEED_MUL even when already moving at full speed.
    expect(s.gvx).toBeLessThanOrEqual(MAXV * WADE_SPEED_MUL + 0.01);
  });

  it('does not cap speed when the waterArea is missing', () => {
    const s = makeState({ gvx: 100, waterArea: null });
    updateMovement(s, 0.016, makeKeys('KeyD'), 800, 600);
    // Without water, crouch/prone/standing mul of 1 applies — top speed
    // is MAXV, not a fraction of it.
    expect(s.gvx).toBeGreaterThan(MAXV * WADE_SPEED_MUL + 1);
  });
});

describe('swim pose', () => {
  it('uses the SWIM pose when grounded, idle, and in water', () => {
    const s = makeState({
      gx: 200, feetY: 310, gvx: 0,
      waterArea: { x: 0, y: 300, w: 800, h: 20 },
    });
    // Many frames to let the lerp converge toward SWIM.
    for (let i = 0; i < 60; i++) updatePose(s, 0.016);
    // Head pose in SWIM projects forward (x=30) and slightly above
    // water (y=0); IDLE has head near x=0 / y=-48.
    expect(s.curPose.head.x).toBeGreaterThan(15);
    expect(s.curPose.head.y).toBeGreaterThan(-20);
    expect(Math.abs(s.curPose.head.x - SWIM.head.x)).toBeLessThan(3);
  });
});

describe('updateParticles', () => {
  it('ages and removes expired particles', () => {
    const particles = [
      { x: 0, y: 0, vx: 10, vy: 10, life: 0.5, maxLife: 0.5 },
      { x: 0, y: 0, vx: 10, vy: 10, life: 0.01, maxLife: 0.5 },
    ];
    updateParticles(particles, 0.016);
    expect(particles.length).toBe(1); // second one expired
    expect(particles[0].life).toBeLessThan(0.5);
    expect(particles[0].x).toBeGreaterThan(0); // moved
  });
});
