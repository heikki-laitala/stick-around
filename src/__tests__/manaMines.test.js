import { describe, it, expect } from 'vitest';
import { spawnManaMine, updateManaMines } from '../manaMines.js';
import { MANA_MINE_HITS, MANA_MINE_LIFETIME } from '../constants.js';

describe('spawnManaMine', () => {
  const platforms = [
    { y: 200, x: 0, w: 400, hash: 1 },
  ];

  it('returns a mine with full hits on a valid platform', () => {
    const m = spawnManaMine(platforms, []);
    expect(m).not.toBeNull();
    expect(m.hits).toBe(MANA_MINE_HITS);
    expect(m.age).toBe(0);
    expect(m.y).toBe(200);
    expect(m.x).toBeGreaterThanOrEqual(16);
    expect(m.x).toBeLessThanOrEqual(400 - 16);
  });

  it('returns null when no platforms', () => {
    expect(spawnManaMine([], [])).toBeNull();
  });

  it('skips platforms that are too narrow', () => {
    expect(spawnManaMine([{ y: 10, x: 0, w: 20, hash: 1 }], [])).toBeNull();
  });
});

describe('updateManaMines', () => {
  function makeState(overrides = {}) {
    return {
      hasSpawned: true,
      platforms: [{ y: 200, x: 0, w: 400, hash: 1 }],
      manaMines: [],
      mana: 0,
      DEBUG_PLATFORMS: false,
      debugAnchorX: null,
      debugAnchorY: null,
      ...overrides,
    };
  }

  it('ages mines', () => {
    const s = makeState({
      manaMines: [{ x: 100, y: 200, hits: 2, age: 1 }],
    });
    updateManaMines(s, 0.5);
    expect(s.manaMines[0].age).toBeCloseTo(1.5, 5);
  });

  it('despawns a mine that exceeds lifetime', () => {
    const s = makeState({
      manaMines: [{ x: 100, y: 200, hits: 2, age: MANA_MINE_LIFETIME - 0.1 }],
    });
    updateManaMines(s, 0.2);
    expect(s.manaMines.length).toBe(0);
  });

  it('does not age-despawn debug-pinned mines', () => {
    const s = makeState({
      manaMines: [{ x: 100, y: 200, hits: 3, age: MANA_MINE_LIFETIME + 100, debug: true }],
    });
    updateManaMines(s, 0.2);
    expect(s.manaMines.length).toBe(1);
  });

  it('does nothing before spawn', () => {
    const s = makeState({ hasSpawned: false });
    updateManaMines(s, 100);
    expect(s.manaMines.length).toBe(0);
  });

  it('auto-spawns a pinned mine when debug is on and none exists', () => {
    const s = makeState({
      DEBUG_PLATFORMS: true,
      debugAnchorX: 300,
      debugAnchorY: 200,
    });
    updateManaMines(s, 0.016);
    const debugMine = s.manaMines.find((m) => m.debug);
    expect(debugMine).toBeDefined();
    expect(debugMine.x).toBe(330);
    expect(debugMine.y).toBe(200);
    expect(debugMine.hits).toBe(MANA_MINE_HITS);
  });

  it('does not duplicate debug-pinned mines', () => {
    const s = makeState({
      DEBUG_PLATFORMS: true,
      debugAnchorX: 300,
      debugAnchorY: 200,
    });
    updateManaMines(s, 0.016);
    updateManaMines(s, 0.016);
    const debugCount = s.manaMines.filter((m) => m.debug).length;
    expect(debugCount).toBe(1);
  });
});
