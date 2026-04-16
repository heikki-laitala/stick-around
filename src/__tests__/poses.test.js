import { describe, it, expect } from 'vitest';
import {
  lerp, lerpPose, p,
  IDLE, WALK, JUMP_RISE, JUMP_FALL, LAND, SCALE,
} from '../poses.js';

const JOINT_KEYS = [
  'head', 'neck', 'hip', 'lsh', 'rsh', 'lel', 'rel',
  'lh', 'rh', 'lhip', 'rhip', 'lk', 'rk', 'lf', 'rf',
];

describe('lerp', () => {
  it('returns a when t=0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it('returns b when t=1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('interpolates at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('extrapolates beyond 0-1', () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe('p (pose constructor)', () => {
  it('creates a pose with all 15 joint keys', () => {
    const pose = p(
      { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 },
      { x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 },
      { x: 7, y: 7 }, { x: 8, y: 8 }, { x: 9, y: 9 }, { x: 10, y: 10 },
      { x: 11, y: 11 }, { x: 12, y: 12 }, { x: 13, y: 13 }, { x: 14, y: 14 },
    );
    expect(Object.keys(pose).sort()).toEqual(JOINT_KEYS.sort());
    expect(pose.head).toEqual({ x: 0, y: 0 });
    expect(pose.rf).toEqual({ x: 14, y: 14 });
  });
});

describe('lerpPose', () => {
  it('interpolates all joints between two poses', () => {
    const a = p(
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    );
    const b = p(
      { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 },
      { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 },
      { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 },
      { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 20 },
    );
    const result = lerpPose(a, b, 0.5);
    for (const k of JOINT_KEYS) {
      expect(result[k].x).toBe(5);
      expect(result[k].y).toBe(10);
    }
  });

  it('returns pose a when t=0', () => {
    const result = lerpPose(IDLE, JUMP_RISE, 0);
    for (const k of JOINT_KEYS) {
      expect(result[k].x).toBe(IDLE[k].x);
      expect(result[k].y).toBe(IDLE[k].y);
    }
  });
});

describe('pose constants', () => {
  const poses = { IDLE, JUMP_RISE, JUMP_FALL, LAND };

  for (const [name, pose] of Object.entries(poses)) {
    it(`${name} has all 15 joints`, () => {
      expect(Object.keys(pose).sort()).toEqual(JOINT_KEYS.sort());
    });

    it(`${name} joints have x and y`, () => {
      for (const k of JOINT_KEYS) {
        expect(typeof pose[k].x).toBe('number');
        expect(typeof pose[k].y).toBe('number');
      }
    });
  }

  it('WALK has 4 frames, each with all joints', () => {
    expect(WALK).toHaveLength(4);
    for (const frame of WALK) {
      expect(Object.keys(frame).sort()).toEqual(JOINT_KEYS.sort());
    }
  });
});

describe('SCALE', () => {
  it('is a positive number', () => {
    expect(SCALE).toBeGreaterThan(0);
    expect(SCALE).toBeLessThan(1);
  });
});
