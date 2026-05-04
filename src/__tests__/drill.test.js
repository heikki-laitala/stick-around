import { describe, it, expect } from 'vitest';
import {
  DRILL_HOLD_TIME,
  DRILL_HOLE_W,
  tickDrill,
  triggerDrill,
} from '../drill.js';

function keysOf(...codes) {
  const s = new Set();
  for (const c of codes) s.add(c);
  return s;
}

function makeState(overrides = {}) {
  return {
    gx: 100,
    feetY: 200,
    gvy: 0,
    grounded: true,
    standingHash: 0xABCD,
    posture: 'standing',
    drillCharge: 0,
    rope: null,
    axeSwing: null,
    lightningAim: null,
    platforms: [{ x: 50, y: 200, w: 200, h: 10, hash: 0xABCD }],
    holes: [],
    particles: [],
    ...overrides,
  };
}

describe('tickDrill — charging', () => {
  it('builds drillCharge while S is held on the ground', () => {
    const s = makeState();
    tickDrill(s, 0.1, keysOf('KeyS'));
    expect(s.drillCharge).toBeCloseTo(0.1);
    tickDrill(s, 0.2, keysOf('KeyS'));
    expect(s.drillCharge).toBeCloseTo(0.3);
  });

  it('resets drillCharge when S is released', () => {
    const s = makeState({ drillCharge: 0.4 });
    tickDrill(s, 0.05, keysOf());
    expect(s.drillCharge).toBe(0);
  });

  it('does not charge while airborne', () => {
    const s = makeState({ grounded: false });
    tickDrill(s, 0.5, keysOf('KeyS'));
    expect(s.drillCharge).toBe(0);
  });

  it('does not charge while on a rope', () => {
    const s = makeState({ rope: { state: 'swinging' } });
    tickDrill(s, 0.5, keysOf('KeyS'));
    expect(s.drillCharge).toBe(0);
  });

  it('does not charge while an axe swing is in flight', () => {
    const s = makeState({ axeSwing: { t: 0, hit: false } });
    tickDrill(s, 0.5, keysOf('KeyS'));
    expect(s.drillCharge).toBe(0);
  });

  it('does not charge while aiming a lightning bolt', () => {
    const s = makeState({ lightningAim: { angle: 0 } });
    tickDrill(s, 0.5, keysOf('KeyS'));
    expect(s.drillCharge).toBe(0);
  });

  it('charges in prone too — drilling works flat on the floor', () => {
    const s = makeState({ posture: 'prone' });
    tickDrill(s, 0.2, keysOf('KeyS'));
    expect(s.drillCharge).toBeCloseTo(0.2);
  });
});

describe('tickDrill — trigger at threshold', () => {
  it('punches a hole and ungrounds the man once the hold time is reached', () => {
    const s = makeState({ drillCharge: DRILL_HOLD_TIME - 0.05 });
    tickDrill(s, 0.1, keysOf('KeyS'));
    expect(s.holes).toHaveLength(1);
    expect(s.holes[0]).toMatchObject({ y: 200, w: DRILL_HOLE_W });
    expect(s.holes[0].x).toBeCloseTo(s.gx - DRILL_HOLE_W / 2);
    expect(s.grounded).toBe(false);
    expect(s.standingHash).toBe(0);
    expect(s.drillCharge).toBe(0);
  });

  it('opens a brief dropThrough window so sideways motion cannot snap the man back onto the platform', () => {
    // Without this, a player drilling while holding D could drift past
    // the 32px hole edge within a couple of frames and re-land on the
    // same platform, since physics.js still allows a snap when
    // prevFeetY <= floor.y + 4 and dropThrough <= 0.
    const s = makeState({ drillCharge: DRILL_HOLD_TIME, dropThrough: 0 });
    tickDrill(s, 0.01, keysOf('KeyS'));
    expect(s.dropThrough).toBeGreaterThan(0);
  });

  it('spawns a dust burst at the platform the man was standing on', () => {
    const s = makeState({ drillCharge: DRILL_HOLD_TIME });
    tickDrill(s, 0.01, keysOf('KeyS'));
    expect(s.particles.length).toBeGreaterThan(0);
  });
});

describe('triggerDrill — direct invocation', () => {
  it('refuses to drill when standingHash matches no platform (lava/prompt floor)', () => {
    const s = makeState({ standingHash: 0 });
    expect(triggerDrill(s)).toBe(false);
    expect(s.holes).toHaveLength(0);
  });

  it('refuses to re-drill an existing hole at the same x', () => {
    const s = makeState({
      holes: [{ x: 90, y: 200, w: DRILL_HOLE_W, age: 0 }],
    });
    expect(triggerDrill(s)).toBe(false);
    expect(s.holes).toHaveLength(1); // unchanged
  });

  it('refuses to drill when standingHash does not match any platform (despite being non-zero)', () => {
    const s = makeState({ standingHash: 0xDEAD });
    expect(triggerDrill(s)).toBe(false);
    expect(s.holes).toHaveLength(0);
  });
});
