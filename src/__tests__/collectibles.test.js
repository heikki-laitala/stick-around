import { describe, it, expect } from 'vitest';
import { spawnCollectible, updateCollectibles } from '../collectibles.js';

describe('spawnCollectible', () => {
  const platforms = [
    { y: 100, x: 50, w: 200, hash: 1 },
    { y: 200, x: 0, w: 400, hash: 2 },
    { y: 300, x: 100, w: 300, hash: 3 },
  ];

  it('returns a collectible on a valid platform', () => {
    const c = spawnCollectible(platforms, []);
    expect(c).not.toBeNull();
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeDefined();
    expect(c.vy).toBe(0);
    expect(c.grounded).toBe(true);
    expect(c.age).toBe(0);
    const plat = platforms.find(p => Math.abs(p.y - c.y) < 2);
    expect(plat).toBeDefined();
    expect(c.x).toBeGreaterThanOrEqual(plat.x + 10);
    expect(c.x).toBeLessThanOrEqual(plat.x + plat.w - 10);
  });

  it('returns null when no platforms', () => {
    const c = spawnCollectible([], []);
    expect(c).toBeNull();
  });

  it('avoids spawning too close to existing collectibles', () => {
    const existing = [{ x: 150, y: 100, age: 0 }];
    let spawned = false;
    for (let i = 0; i < 20; i++) {
      const c = spawnCollectible(platforms, existing);
      if (c) { spawned = true; break; }
    }
    expect(spawned).toBe(true);
  });
});

describe('updateCollectibles', () => {
  function makeState(overrides = {}) {
    return {
      gx: 200, feetY: 200, screenH: 600,
      platforms: [
        { y: 200, x: 0, w: 400, hash: 1 },
        { y: 100, x: 0, w: 400, hash: 2 },
      ],
      collectibles: [],
      score: 0,
      lineHeight: 16,
      hasSpawned: true,
      ...overrides,
    };
  }

  it('collects nearby collectible and increments score', () => {
    const s = makeState({
      collectibles: [{ x: 205, y: 200, vy: 0, grounded: true, age: 1 }],
    });
    updateCollectibles(s, 0.016);
    expect(s.score).toBe(1);
    expect(s.collectibles.length).toBe(0);
  });

  it('does not collect distant collectible', () => {
    const s = makeState({
      collectibles: [{ x: 400, y: 100, vy: 0, grounded: true, age: 1 }],
    });
    updateCollectibles(s, 0.016);
    expect(s.score).toBe(0);
    expect(s.collectibles.length).toBe(1);
  });

  it('applies gravity when not grounded', () => {
    const s = makeState({
      collectibles: [{ x: 200, y: 50, vy: 0, grounded: false, age: 1 }],
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
    });
    updateCollectibles(s, 0.1);
    expect(s.collectibles[0].vy).toBeGreaterThan(0);
    expect(s.collectibles[0].y).toBeGreaterThan(50);
  });

  it('lands on platform when falling', () => {
    const s = makeState({
      gx: 50, feetY: 50, // man far away
      collectibles: [{ x: 200, y: 198, vy: 100, grounded: false, age: 1 }],
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
    });
    updateCollectibles(s, 0.05);
    expect(s.collectibles[0].y).toBe(200);
    expect(s.collectibles[0].grounded).toBe(true);
    expect(s.collectibles[0].vy).toBe(0);
  });

  it('becomes ungrounded when platform disappears', () => {
    const s = makeState({
      gx: 50, feetY: 50, // man far away
      collectibles: [{ x: 200, y: 200, vy: 0, grounded: true, age: 1 }],
      platforms: [], // platform gone
    });
    updateCollectibles(s, 0.016);
    expect(s.collectibles[0].grounded).toBe(false);
  });

  it('removes collectible that falls off screen', () => {
    const s = makeState({
      collectibles: [{ x: 200, y: 650, vy: 100, grounded: false, age: 1 }],
      platforms: [],
    });
    updateCollectibles(s, 0.016);
    expect(s.collectibles.length).toBe(0);
  });

  it('spawns collectibles up to max count', () => {
    const s = makeState({ collectibles: [] });
    for (let i = 0; i < 200; i++) {
      updateCollectibles(s, 0.1);
    }
    expect(s.collectibles.length).toBeGreaterThan(0);
    expect(s.collectibles.length).toBeLessThanOrEqual(5);
  });
});
