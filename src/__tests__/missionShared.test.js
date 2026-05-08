import { describe, it, expect } from 'vitest';
import { burstPlatformsBetween } from '../missions/_shared.js';

function makeState() {
  return {
    platforms: [
      { x: 100, y: 400, w: 200, h: 10, hash: 0x1 },
      { x: 100, y: 500, w: 200, h: 10, hash: 0x2 },
    ],
    holes: [],
  };
}

describe('burstPlatformsBetween', () => {
  it('punches a hole when the segment crosses a platform top going down', () => {
    const s = makeState();
    burstPlatformsBetween(s, 200, 380, 200, 420, 30);
    expect(s.holes).toHaveLength(1);
    expect(s.holes[0].y).toBe(400);
  });

  it('punches a hole when the segment crosses a platform top going up', () => {
    const s = makeState();
    // After a floor bounce the ball travels up — yBefore > yAfter.
    burstPlatformsBetween(s, 200, 420, 200, 380, 30);
    expect(s.holes).toHaveLength(1);
    expect(s.holes[0].y).toBe(400);
  });

  it('punches holes through every platform the segment spans', () => {
    const s = makeState();
    burstPlatformsBetween(s, 200, 380, 200, 520, 30);
    expect(s.holes).toHaveLength(2);
  });

  it('skips a crossing that lands inside an existing hole', () => {
    const s = makeState();
    s.holes.push({ x: 185, y: 400, w: 30, h: 0, age: 0 });
    burstPlatformsBetween(s, 200, 380, 200, 420, 30);
    expect(s.holes).toHaveLength(1);
  });

  it('invokes the onCross callback at the crossing point', () => {
    const s = makeState();
    const calls = [];
    burstPlatformsBetween(s, 200, 380, 200, 420, 30, (x, y) => calls.push([x, y]));
    expect(calls).toEqual([[200, 400]]);
  });

  it('invokes the onCross callback for upward crossings too', () => {
    const s = makeState();
    const calls = [];
    burstPlatformsBetween(s, 200, 420, 200, 380, 30, (x, y) => calls.push([x, y]));
    expect(calls).toEqual([[200, 400]]);
  });
});
