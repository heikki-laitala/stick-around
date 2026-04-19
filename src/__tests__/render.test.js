import { describe, it, expect } from 'vitest';
import { getCloseButtonRect, isInCloseButton } from '../render.js';
import { HUD_HEIGHT, HUD_HEIGHT_TALL } from '../constants.js';

describe('HUD close button', () => {
  it('sits inset from the right edge of the HUD strip', () => {
    const r = getCloseButtonRect(800);
    // Inset by at least 1 px on each edge so it looks like a button, not a slab.
    expect(r.x + r.w).toBeLessThan(800);
    expect(r.y).toBeGreaterThan(0);
    expect(r.h).toBeLessThan(HUD_HEIGHT);
    expect(r.w).toBe(r.h); // square
  });

  it('hit-tests a click in the middle of the button as a hit', () => {
    const r = getCloseButtonRect(800);
    expect(isInCloseButton(r.x + r.w / 2, r.y + r.h / 2, 800)).toBe(true);
  });

  it('hit-tests a click outside the button (left of it) as a miss', () => {
    const r = getCloseButtonRect(800);
    expect(isInCloseButton(r.x - 1, r.y + r.h / 2, 800)).toBe(false);
  });

  it('hit-tests a click below the button as a miss', () => {
    const r = getCloseButtonRect(800);
    expect(isInCloseButton(r.x + r.w / 2, r.y + r.h + 1, 800)).toBe(false);
  });

  it('hit-tests a click above the button as a miss', () => {
    const r = getCloseButtonRect(800);
    expect(isInCloseButton(r.x + r.w / 2, r.y - 1, 800)).toBe(false);
  });

  it('stays the same compact size on a narrow (tall-HUD) screen — never balloons to fill the taller strip', () => {
    const wide = getCloseButtonRect(800);
    const narrow = getCloseButtonRect(500);
    expect(narrow.w).toBe(wide.w);
    expect(narrow.h).toBe(wide.h);
    expect(narrow.h).toBeLessThan(HUD_HEIGHT_TALL);
  });
});
