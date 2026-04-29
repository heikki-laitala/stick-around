import { describe, it, expect } from 'vitest';
import { findFloor, findPlatformAbove, buildPlatforms } from '../platforms.js';

describe('findFloor', () => {
  const platforms = [
    { y: 100, x: 0, w: 200, hash: 1 },
    { y: 200, x: 0, w: 200, hash: 2 },
    { y: 300, x: 0, w: 200, hash: 3 },
  ];

  it('returns nearest platform at or below feetY within horizontal bounds', () => {
    const result = findFloor(platforms, 95, 100, 500);
    expect(result.y).toBe(100);
  });

  it('skips platforms the man is not horizontally on', () => {
    const result = findFloor(platforms, 95, 300, 500);
    // x=300 is outside w=200, so no platform matches — falls to ground
    expect(result.y).toBe(496); // H - 4
  });

  it('returns ground floor when no platforms below', () => {
    const result = findFloor(platforms, 350, 100, 500);
    expect(result.y).toBe(496); // H - 4
  });

  it('returns ground floor for empty platforms', () => {
    const result = findFloor([], 100, 50, 500);
    expect(result.y).toBe(496);
  });

  it('picks the closest platform below, not a farther one', () => {
    const result = findFloor(platforms, 150, 100, 500);
    expect(result.y).toBe(200);
  });
});

describe('findPlatformAbove', () => {
  const platforms = [
    { y: 50, x: 0, w: 200, hash: 1 },
    { y: 100, x: 0, w: 200, hash: 2 },
    { y: 200, x: 0, w: 200, hash: 3 },
  ];

  it('returns nearest platform above within maxDist', () => {
    const result = findPlatformAbove(platforms, 210, 100, 300);
    expect(result.y).toBe(200);
  });

  it('returns null when no platform above', () => {
    const result = findPlatformAbove(platforms, 40, 100, 300);
    expect(result).toBeNull();
  });

  it('returns null when platforms are beyond maxDist', () => {
    const result = findPlatformAbove(platforms, 210, 100, 5);
    expect(result).toBeNull();
  });

  it('returns the closest (highest y) platform above', () => {
    const result = findPlatformAbove(platforms, 210, 100, 300);
    expect(result.y).toBe(200); // closest above, not 100 or 50
  });
});

describe('buildPlatforms', () => {
  const makeContent = (overrides = {}) => ({
    text_offset_x: 10,
    text_offset_y: 30,
    text_height: 400,
    text_width: 600,
    term_rows: 20,
    term_cols: 80,
    lines: new Array(20).fill(40),
    hashes: new Array(20).fill(0).map((_, i) => i + 1),
    input_line: 16,
    footer_line: 18,
    ...overrides,
  });

  it('builds platforms for each visible line before input_line', () => {
    const result = buildPlatforms(makeContent(), {});
    // Lines 0..15 = 16 platforms + 1 prompt platform = 17
    expect(result.platforms).toHaveLength(17);
  });

  it('adds prompt platform at full width', () => {
    const result = buildPlatforms(makeContent(), {});
    const promptPlat = result.platforms[result.platforms.length - 1];
    expect(promptPlat.w).toBe(600); // full textWidth
    expect(promptPlat.hash).toBe(0xFFFF);
  });

  it('computes promptArea bounding box', () => {
    const result = buildPlatforms(makeContent(), {});
    expect(result.promptArea).not.toBeNull();
    expect(result.promptArea.x).toBe(10);
    expect(result.promptArea.w).toBe(600);
  });

  it('computes footerArea bounding box', () => {
    const result = buildPlatforms(makeContent(), {});
    expect(result.footerArea).not.toBeNull();
    expect(result.footerArea.x).toBe(10);
    expect(result.footerArea.w).toBe(600);
  });

  it('returns null promptArea when input_line is null', () => {
    const result = buildPlatforms(makeContent({ input_line: null }), {});
    expect(result.promptArea).toBeNull();
  });

  it('returns null footerArea when footer_line is null', () => {
    const result = buildPlatforms(makeContent({ footer_line: null }), {});
    expect(result.footerArea).toBeNull();
  });

  it('skips empty lines (cols === 0)', () => {
    const lines = new Array(20).fill(40);
    lines[5] = 0; // empty line
    const result = buildPlatforms(makeContent({ lines }), {});
    // 15 non-empty lines before input_line + 1 prompt = 16
    expect(result.platforms).toHaveLength(16);
  });

  it('uses cached indices when detection fails', () => {
    const cached = { cachedInputIdx: 16, cachedFooterIdx: 18 };
    const result = buildPlatforms(
      makeContent({ input_line: null, footer_line: null }),
      cached,
    );
    expect(result.promptArea).not.toBeNull();
    expect(result.footerArea).not.toBeNull();
  });

  it('updates terminal metrics', () => {
    const result = buildPlatforms(makeContent(), {});
    expect(result.textOffsetX).toBe(10);
    expect(result.textOffsetY).toBe(30);
    expect(result.textWidth).toBe(600);
    expect(result.textHeight).toBe(400);
    expect(result.lineHeight).toBe(20); // 400 / 20 rows
  });

  it('returns empty platforms for empty lines array', () => {
    const result = buildPlatforms(makeContent({ lines: [] }), {});
    expect(result.platforms).toHaveLength(0);
  });
});
