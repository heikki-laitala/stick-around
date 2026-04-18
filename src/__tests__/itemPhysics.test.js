import { describe, it, expect } from 'vitest';
import { stepItemPhysics, ITEM_GRAVITY } from '../itemPhysics.js';

describe('stepItemPhysics', () => {
  it('keeps a grounded item on its platform', () => {
    const item = { x: 100, y: 200, vy: 0, grounded: true };
    const platforms = [{ x: 0, y: 200, w: 400 }];
    const alive = stepItemPhysics(item, platforms, 600, 0.1);
    expect(alive).toBe(true);
    expect(item.grounded).toBe(true);
    expect(item.y).toBe(200);
  });

  it('ungrounds when the platform disappears', () => {
    const item = { x: 100, y: 200, vy: 0, grounded: true };
    const alive = stepItemPhysics(item, [], 600, 0.1);
    expect(alive).toBe(true);
    expect(item.grounded).toBe(false);
  });

  it('ungrounds when the platform moves away', () => {
    const item = { x: 100, y: 200, vy: 0, grounded: true };
    const platforms = [{ x: 0, y: 250, w: 400 }];
    stepItemPhysics(item, platforms, 600, 0.1);
    expect(item.grounded).toBe(false);
  });

  it('accelerates a falling item by gravity', () => {
    const item = { x: 100, y: 200, vy: 0, grounded: false };
    stepItemPhysics(item, [], 600, 0.1);
    expect(item.vy).toBeCloseTo(ITEM_GRAVITY * 0.1, 5);
    expect(item.y).toBeGreaterThan(200);
  });

  it('lands on a platform below', () => {
    const item = { x: 100, y: 200, vy: 100, grounded: false };
    const platforms = [{ x: 0, y: 400, w: 400 }];
    for (let i = 0; i < 30; i++) stepItemPhysics(item, platforms, 600, 0.05);
    expect(item.grounded).toBe(true);
    expect(item.y).toBe(400);
    expect(item.vy).toBe(0);
  });

  it('returns false when it drops below the screen', () => {
    const item = { x: 100, y: 580, vy: 400, grounded: false };
    const alive = stepItemPhysics(item, [], 600, 0.2);
    expect(alive).toBe(false);
  });
});
