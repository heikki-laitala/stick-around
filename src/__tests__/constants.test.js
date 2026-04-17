import { describe, it, expect } from 'vitest';
import {
  GRAV, JUMP_V, ACCEL, FRIC, MAXV,
  ROPE_AIM_SPEED, ROPE_FLY_SPEED, ROPE_MAX_LEN,
  SWING_GRAVITY, SWING_PUMP, SWING_DAMPING, ROPE_COOLDOWN,
  HUD_HEIGHT,
} from '../constants.js';

describe('game constants', () => {
  it('GRAV is positive (downward)', () => {
    expect(GRAV).toBeGreaterThan(0);
  });

  it('JUMP_V is positive', () => {
    expect(JUMP_V).toBeGreaterThan(0);
  });

  it('ACCEL is positive', () => {
    expect(ACCEL).toBeGreaterThan(0);
  });

  it('FRIC is between 0 and 1 (damping factor)', () => {
    expect(FRIC).toBeGreaterThan(0);
    expect(FRIC).toBeLessThan(1);
  });

  it('MAXV is positive', () => {
    expect(MAXV).toBeGreaterThan(0);
  });
});

describe('rope constants', () => {
  it('all rope constants are positive finite numbers', () => {
    const constants = {
      ROPE_AIM_SPEED, ROPE_FLY_SPEED, ROPE_MAX_LEN,
      SWING_GRAVITY, SWING_PUMP, SWING_DAMPING, ROPE_COOLDOWN,
    };
    for (const [name, val] of Object.entries(constants)) {
      expect(val, name).toBeGreaterThan(0);
      expect(Number.isFinite(val), `${name} is finite`).toBe(true);
    }
  });

  it('SWING_DAMPING is between 0 and 1', () => {
    expect(SWING_DAMPING).toBeLessThan(1);
  });
});

describe('overlay layout', () => {
  it('HUD_HEIGHT is a positive integer number of pixels', () => {
    expect(HUD_HEIGHT).toBeGreaterThan(0);
    expect(Number.isInteger(HUD_HEIGHT)).toBe(true);
  });
});
