import { describe, it, expect } from 'vitest';
import {
  ALONE_IN_DARK_MISSION,
  BATTERY_DRAIN_RATE,
  BATTERY_RECHARGE_PER_BALL,
  CANDLE_HALF_ANGLE,
  BASE_HALF_ANGLE,
  ITEM_KINDS,
  PICKUP_RADIUS,
  SHADOW_MAX,
  SHADOW_SPAWN_INTERVAL,
  adjustFlashlightAim,
  isAloneInDarkActive,
  isInCone,
  spendBallForBattery,
  syncItemPositions,
} from '../missions/aloneInDark.js';

function makeState(overrides = {}) {
  return {
    gx: 400,
    feetY: 500,
    gvx: 0,
    gvy: 0,
    grounded: true,
    faceR: true,
    screenW: 800,
    screenH: 600,
    textOffsetX: 20,
    textOffsetY: 40,
    textWidth: 700,
    textHeight: 500,
    lineHeight: 16,
    platforms: [
      { x: 40,  y: 150, w: 120, h: 16, hash: 0xA1 },
      { x: 220, y: 220, w: 120, h: 16, hash: 0xA2 },
      { x: 400, y: 300, w: 120, h: 16, hash: 0xA3 },
      { x: 580, y: 360, w: 120, h: 16, hash: 0xA4 },
      // Prompt platform — should be excluded from item placement.
      { x: 20,  y: 480, w: 700, h: 16, hash: 0xFFFF },
    ],
    promptArea: { x: 20, y: 480, w: 700, h: 16 },
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('ALONE_IN_DARK_MISSION.onEnter', () => {
  it('seeds one of each item kind, all unpicked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const kinds = s.missionScene.items.map((i) => i.kind).sort();
    expect(kinds).toEqual([...ITEM_KINDS].sort());
    expect(s.missionScene.items.every((i) => !i.picked)).toBe(true);
  });

  it('anchors items to real terminal platforms, skipping the prompt row', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    for (const it of s.missionScene.items) {
      expect(it.anchorHash).not.toBe(0xFFFF);
      expect([0xA1, 0xA2, 0xA3, 0xA4]).toContain(it.anchorHash);
    }
  });

  it('starts the flashlight fully charged with the base cone width', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    expect(s.missionScene.battery).toBe(1);
    expect(s.missionScene.coneHalfAngle).toBe(BASE_HALF_ANGLE);
  });

  it('teleports the man to the prompt-box spawn and clears velocity', () => {
    const s = makeState({
      gx: 123, feetY: 340, faceR: true, gvx: 50, gvy: -120,
      rope: { state: 'aiming' }, posture: 'crouching',
    });
    ALONE_IN_DARK_MISSION.onEnter(s);
    // Spawn x formula: textOffsetX + textWidth - 20*SCALE - 20 = 20 + 700 - 7 - 20 = 693
    expect(s.gx).toBeCloseTo(693, 0);
    expect(s.feetY).toBe(480);
    expect(s.gvx).toBe(0);
    expect(s.gvy).toBe(0);
    expect(s.faceR).toBe(false);
    expect(s.rope).toBeNull();
    expect(s.posture).toBe('standing');
  });
});

describe('ALONE_IN_DARK_MISSION.update — battery', () => {
  it('drains battery at BATTERY_DRAIN_RATE per second', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const before = s.missionScene.battery;
    ALONE_IN_DARK_MISSION.update(s, 1);
    expect(s.missionScene.battery).toBeCloseTo(before - BATTERY_DRAIN_RATE, 5);
  });

  it('clamps battery at zero — does not go negative', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.missionScene.battery = 0.01;
    ALONE_IN_DARK_MISSION.update(s, 10);
    expect(s.missionScene.battery).toBe(0);
  });
});

describe('spendBallForBattery', () => {
  it('decrements score and tops up battery when the player spends a ball', () => {
    const s = makeState({ score: 3 });
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.score = 3;
    s.missionScene.battery = 0.2;
    const spent = spendBallForBattery(s);
    expect(spent).toBe(true);
    expect(s.score).toBe(2);
    expect(s.missionScene.battery).toBeCloseTo(0.2 + BATTERY_RECHARGE_PER_BALL, 5);
  });

  it('returns false and changes nothing when the player has no balls', () => {
    const s = makeState({ score: 0 });
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.score = 0;
    s.missionScene.battery = 0.2;
    const spent = spendBallForBattery(s);
    expect(spent).toBe(false);
    expect(s.score).toBe(0);
    expect(s.missionScene.battery).toBe(0.2);
  });

  it('returns false when the battery is already full (no wasted ball)', () => {
    const s = makeState({ score: 5 });
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.score = 5;
    s.missionScene.battery = 1;
    const spent = spendBallForBattery(s);
    expect(spent).toBe(false);
    expect(s.score).toBe(5);
    expect(s.missionScene.battery).toBe(1);
  });

  it('clamps battery at 1.0 when the top-up would overshoot', () => {
    const s = makeState({ score: 2 });
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.score = 2;
    s.missionScene.battery = 0.9;
    spendBallForBattery(s);
    expect(s.missionScene.battery).toBe(1);
    expect(s.score).toBe(1);
  });
});

describe('ALONE_IN_DARK_MISSION.onCollectibleCollected', () => {
  it('tops up the battery by BATTERY_RECHARGE_PER_BALL when a glowing ball is collected', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.missionScene.battery = 0.3;
    ALONE_IN_DARK_MISSION.onCollectibleCollected(s);
    expect(s.missionScene.battery).toBeCloseTo(0.3 + BATTERY_RECHARGE_PER_BALL, 5);
  });

  it('clamps battery at 1.0 when already near full', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.missionScene.battery = 0.9;
    ALONE_IN_DARK_MISSION.onCollectibleCollected(s);
    expect(s.missionScene.battery).toBe(1);
  });

  it('is a no-op if missionScene is missing', () => {
    const s = makeState();
    s.missionScene = null;
    expect(() => ALONE_IN_DARK_MISSION.onCollectibleCollected(s)).not.toThrow();
  });
});

describe('ALONE_IN_DARK_MISSION.update — pickups', () => {
  it('picks up an item the man steps onto', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const item = s.missionScene.items[0];
    s.gx = item.x;
    s.feetY = item.y;
    ALONE_IN_DARK_MISSION.update(s, 0.016);
    expect(item.picked).toBe(true);
  });

  it('does not pick up items outside PICKUP_RADIUS', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const item = s.missionScene.items[0];
    s.gx = item.x + PICKUP_RADIUS + 10;
    s.feetY = item.y;
    ALONE_IN_DARK_MISSION.update(s, 0.016);
    expect(item.picked).toBe(false);
  });

  it('refills the battery to full when the battery item is picked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.missionScene.battery = 0.1;
    const bat = s.missionScene.items.find((i) => i.kind === 'battery');
    s.gx = bat.x; s.feetY = bat.y;
    ALONE_IN_DARK_MISSION.update(s, 0.016);
    expect(s.missionScene.battery).toBe(1);
  });

  it('widens the cone when the candle is picked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const candle = s.missionScene.items.find((i) => i.kind === 'candle');
    s.gx = candle.x; s.feetY = candle.y;
    ALONE_IN_DARK_MISSION.update(s, 0.016);
    expect(s.missionScene.coneHalfAngle).toBe(CANDLE_HALF_ANGLE);
  });
});

describe('ALONE_IN_DARK_MISSION.check', () => {
  it('fails while any item remains unpicked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    for (const it of s.missionScene.items.slice(0, -1)) it.picked = true;
    expect(ALONE_IN_DARK_MISSION.check(s)).toBe(false);
  });

  it('succeeds only when every item is picked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    for (const it of s.missionScene.items) it.picked = true;
    expect(ALONE_IN_DARK_MISSION.check(s)).toBe(true);
  });
});

describe('flashlight aim', () => {
  it('seeds coneAngle to the facing direction', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    // resetPlayer parks the man facing left → cone points west (π).
    expect(s.missionScene.coneAngle).toBe(s.faceR ? 0 : Math.PI);
  });

  it('adjustFlashlightAim rotates the cone', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const before = s.missionScene.coneAngle;
    adjustFlashlightAim(s, 0.5);
    expect(s.missionScene.coneAngle).toBeCloseTo(before + 0.5, 5);
  });

  it('snaps the cone to the new forward direction when the man turns', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    adjustFlashlightAim(s, -0.8);
    // Flip facing — update() should resync the cone.
    s.faceR = !s.faceR;
    ALONE_IN_DARK_MISSION.update(s, 0.016);
    expect(s.missionScene.coneAngle).toBe(s.faceR ? 0 : Math.PI);
  });

  it('isAloneInDarkActive is true while this mission is the current one', () => {
    const s = makeState({ currentMissionId: 'alone-in-dark' });
    expect(isAloneInDarkActive(s)).toBe(true);
    s.currentMissionId = 'dodge-meteors';
    expect(isAloneInDarkActive(s)).toBe(false);
  });
});

describe('shadow creatures', () => {
  it('seeds an empty shadow array on entry', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    expect(Array.isArray(s.missionScene.shadows)).toBe(true);
    expect(s.missionScene.shadows.length).toBe(0);
  });

  it('spawns shadows over time up to SHADOW_MAX', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    for (let i = 0; i < 200; i++) ALONE_IN_DARK_MISSION.update(s, SHADOW_SPAWN_INTERVAL);
    expect(s.missionScene.shadows.length).toBeGreaterThan(0);
    expect(s.missionScene.shadows.length).toBeLessThanOrEqual(SHADOW_MAX);
  });

  it('pushes shadows away from the cone origin when lit', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    // Park a shadow directly in front of the man's cone.
    const scene = s.missionScene;
    scene.shadows = [{ x: s.gx + 40, y: s.feetY - 30, vx: 0, vy: 0, age: 0, wobble: 0 }];
    scene.coneAngle = 0; // point east
    s.faceR = true; scene.faceRLast = true;
    const before = { ...scene.shadows[0] };
    // Several frames to let flee acceleration accumulate.
    for (let i = 0; i < 5; i++) ALONE_IN_DARK_MISSION.update(s, 0.1);
    const after = scene.shadows[0];
    // Might have been culled off-screen if it flew far enough.
    if (after) {
      // Speed grew.
      expect(Math.hypot(after.vx, after.vy)).toBeGreaterThan(Math.hypot(before.vx, before.vy));
      // Net displacement is away from the man (positive x direction).
      expect(after.x).toBeGreaterThan(before.x);
    }
  });

  it('isInCone detects a target inside the flashlight arc', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    s.missionScene.coneAngle = 0;
    // A point just in front of the active hand — should be lit.
    const hand = { x: s.gx, y: s.feetY - 30 };
    expect(isInCone(s, s.missionScene, hand.x + 60, hand.y)).toBe(true);
    // A point behind him — should not be.
    expect(isInCone(s, s.missionScene, hand.x - 60, hand.y)).toBe(false);
  });
});

describe('syncItemPositions', () => {
  it('updates each unpicked item to track its anchor platform', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const item = s.missionScene.items[0];
    const plat = s.platforms.find((p) => p.hash === item.anchorHash);
    plat.x += 50; plat.y += 30;
    syncItemPositions(s);
    expect(item.x).toBeCloseTo(plat.x + item.offsetX, 5);
    expect(item.y).toBeCloseTo(plat.y - 10, 5);
  });

  it('does not move items that have been picked', () => {
    const s = makeState();
    ALONE_IN_DARK_MISSION.onEnter(s);
    const item = s.missionScene.items[0];
    item.picked = true;
    const frozenX = item.x, frozenY = item.y;
    const plat = s.platforms.find((p) => p.hash === item.anchorHash);
    plat.x += 80;
    syncItemPositions(s);
    expect(item.x).toBe(frozenX);
    expect(item.y).toBe(frozenY);
  });
});
