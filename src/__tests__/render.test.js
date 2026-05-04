import { describe, it, expect } from 'vitest';
import {
  getCloseButtonRect, isInCloseButton, drawCenteredBanner,
  drawEndScreen, drawDrillFloorEffect,
} from '../render.js';
import { HUD_HEIGHT, HUD_HEIGHT_TALL } from '../constants.js';
import { drawShieldAura } from '../renderShield.js';
import { drawStasisVignette } from '../missions/shardfall/render.js';

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

/**
 * Mock 2D context that records every method call. Lets us smoke-test
 * the renderer without a real canvas (which vitest's default
 * environment doesn't provide). Methods return sensible stubs so
 * code that reads measureText / save-state still works.
 */
function makeMockCtx() {
  const calls = [];
  const noop = (name) => (...args) => calls.push({ name, args });
  // Gradient stub: enough surface that real-API callers (addColorStop)
  // don't crash. Returned object is interchangeable with a real
  // CanvasGradient since callers only assign it to fillStyle/strokeStyle.
  const stubGradient = () => ({ addColorStop: noop('gradient.addColorStop') });
  return {
    calls,
    save: noop('save'),
    restore: noop('restore'),
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    fillText: noop('fillText'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    arc: noop('arc'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    translate: noop('translate'),
    rotate: noop('rotate'),
    scale: noop('scale'),
    setLineDash: noop('setLineDash'),
    rect: noop('rect'),
    clip: noop('clip'),
    bezierCurveTo: noop('bezierCurveTo'),
    quadraticCurveTo: noop('quadraticCurveTo'),
    measureText: (text) => ({
      width: text ? text.length * 7 : 0,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    createLinearGradient: () => stubGradient(),
    createRadialGradient: () => stubGradient(),
    set fillStyle(v) { calls.push({ name: 'fillStyle', args: [v] }); },
    set strokeStyle(v) { calls.push({ name: 'strokeStyle', args: [v] }); },
    set shadowColor(v) { calls.push({ name: 'shadowColor', args: [v] }); },
    set shadowBlur(v) { calls.push({ name: 'shadowBlur', args: [v] }); },
    set lineWidth(v) { calls.push({ name: 'lineWidth', args: [v] }); },
    set lineCap(v) { calls.push({ name: 'lineCap', args: [v] }); },
    set lineJoin(v) { calls.push({ name: 'lineJoin', args: [v] }); },
    set font(v) { calls.push({ name: 'font', args: [v] }); },
    set textAlign(v) { calls.push({ name: 'textAlign', args: [v] }); },
    set textBaseline(v) { calls.push({ name: 'textBaseline', args: [v] }); },
    set globalAlpha(v) { calls.push({ name: 'globalAlpha', args: [v] }); },
    set globalCompositeOperation(v) { calls.push({ name: 'globalCompositeOperation', args: [v] }); },
  };
}

describe('drawCenteredBanner', () => {
  const baseOpts = () => ({
    cx: 400,
    top: 50,
    alpha: 1,
    padX: 18,
    padY: 10,
    bg:     { rgb: '15, 25, 50',    alpha: 0.78 },
    stroke: { rgb: '220, 230, 240', alpha: 0.55 },
    shadow: { rgb: '0, 0, 0',       alpha: 0.7  },
    rows: [
      { text: 'Hello', font: '20px serif', color: { rgb: '240, 230, 180', alpha: 0.98 }, height: 22 },
    ],
  });

  it('issues a fill+stroke for the bg and a fillText for each row', () => {
    const ctx = makeMockCtx();
    drawCenteredBanner(ctx, baseOpts());
    const names = ctx.calls.map((c) => c.name);
    expect(names).toContain('fillRect');
    expect(names).toContain('strokeRect');
    expect(names.filter((n) => n === 'fillText')).toHaveLength(1);
  });

  it('skips drawing entirely when alpha is below the visibility floor', () => {
    const ctx = makeMockCtx();
    drawCenteredBanner(ctx, { ...baseOpts(), alpha: 0.005 });
    expect(ctx.calls).toHaveLength(0);
  });

  it('multiplies the banner-wide alpha into each element\'s color', () => {
    const ctx = makeMockCtx();
    drawCenteredBanner(ctx, { ...baseOpts(), alpha: 0.5 });
    const fillStyle = ctx.calls.find((c) => c.name === 'fillStyle');
    // bg.alpha = 0.78 * banner alpha 0.5 = 0.39
    expect(fillStyle.args[0]).toBe('rgba(15, 25, 50, 0.39)');
  });

  it('draws every row passed in', () => {
    const ctx = makeMockCtx();
    drawCenteredBanner(ctx, {
      ...baseOpts(),
      rows: [
        { text: 'one', font: 'a', color: { rgb: '0, 0, 0', alpha: 1 }, height: 20 },
        { text: 'two', font: 'b', color: { rgb: '0, 0, 0', alpha: 1 }, height: 20, gap: 4 },
      ],
    });
    const fillTexts = ctx.calls.filter((c) => c.name === 'fillText');
    expect(fillTexts.map((c) => c.args[0])).toEqual(['one', 'two']);
  });
});

describe('drawShieldAura — smoke', () => {
  it('runs against a plausible state without throwing and emits arc / gradient draws', () => {
    const ctx = makeMockCtx();
    expect(() => drawShieldAura(ctx, 400, 300, 30, 1)).not.toThrow();
    const names = ctx.calls.map((c) => c.name);
    // The aura is built from radial gradients + arcs — both should fire.
    expect(names).toContain('arc');
    expect(names).toContain('fill');
  });

  it('still runs cleanly when alpha is mid-fade', () => {
    const ctx = makeMockCtx();
    expect(() => drawShieldAura(ctx, 400, 300, 30, 0.4)).not.toThrow();
  });
});

describe('drawStasisVignette — smoke', () => {
  it('runs against a plausible screen size without throwing', () => {
    const ctx = makeMockCtx();
    expect(() => drawStasisVignette(ctx, 800, 600, 0, 400, 300)).not.toThrow();
    expect(ctx.calls.length).toBeGreaterThan(0);
  });

  it('still runs after the vignette has aged into its ripple phase', () => {
    const ctx = makeMockCtx();
    expect(() => drawStasisVignette(ctx, 800, 600, 1.5, 400, 300)).not.toThrow();
  });
});

describe('drawEndScreen — smoke', () => {
  it('runs against a fully-completed run without throwing', () => {
    const ctx = makeMockCtx();
    const state = {
      hudTall: false,
      missionOrder: [0, 1, 2],
      titles: [
        { name: 'lava lucky', missionId: 'escape-lava', earnedAt: 1500 },
        { name: 'chronomancer', missionId: 'shardfall', earnedAt: 4500 },
      ],
      runStartedAt: 0,
      runEndedAt: 60_000,
      missionStats: {
        'escape-lava': { enteredAt: 0, completedAt: 12_000 },
        'meteor-shower': { enteredAt: 12_000, completedAt: 30_000 },
        'shardfall': { enteredAt: 30_000, completedAt: 60_000 },
      },
    };
    expect(() => drawEndScreen(ctx, state, 1024)).not.toThrow();
    const fillTexts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(fillTexts).toContain('Run complete');
  });

  it('renders cleanly with an empty title list', () => {
    const ctx = makeMockCtx();
    const state = {
      hudTall: false,
      missionOrder: [0, 1],
      titles: [],
      runStartedAt: 0,
      runEndedAt: 30_000,
      missionStats: {},
    };
    expect(() => drawEndScreen(ctx, state, 800)).not.toThrow();
  });
});

describe('drawDrillFloorEffect — smoke', () => {
  it('runs while charging on a real platform without throwing', () => {
    const ctx = makeMockCtx();
    const state = {
      gx: 200,
      standingHash: 0xABCD,
      drillCharge: 0.4,
      platforms: [{ x: 100, y: 300, w: 200, h: 10, hash: 0xABCD }],
    };
    expect(() => drawDrillFloorEffect(ctx, state, 200, 280)).not.toThrow();
    const names = ctx.calls.map((c) => c.name);
    // The floor effect always draws the connecting beam (line) and a
    // pulsing magic circle (arc).
    expect(names).toContain('arc');
    expect(names).toContain('stroke');
  });

  it('bails harmlessly when the man stands on no recognised platform', () => {
    const ctx = makeMockCtx();
    const state = {
      gx: 200,
      standingHash: 0,
      drillCharge: 0.4,
      platforms: [],
    };
    expect(() => drawDrillFloorEffect(ctx, state, 200, 280)).not.toThrow();
  });
});
