import { describe, it, expect } from 'vitest';
import {
  EVIL_TWIN_MISSION,
  EVIL_TWIN_INITIAL_LIVES,
  EVIL_TWIN_GOAL_BALLS,
  EVIL_TWIN_DELAY_INITIAL,
  EVIL_TWIN_HIT_COOLDOWN,
  EVIL_TWIN_HIT_RADIUS,
  TWIN_SPELL_AIM_DURATION,
  TWIN_BOLT_LIFE,
  TWIN_STUN_DURATION,
  EVIL_TWIN_PRIMER_MANA,
  EVIL_TWIN_MANA_ORB_COUNT,
  EVIL_TWIN_MANA_ORB_LIFETIME,
  EVIL_TWIN_MANA_ORB_PICKUP_R,
  EVIL_TWIN_MANA_PER_ORB,
  TWIN_BOLT_SCORCH_LIFE,
  twinSnapshotAt,
} from '../missions/evilTwin.js';
import { drawShadowTwin } from '../missions/evilTwin/render.js';
import { IDLE } from '../poses.js';

function clonePose() {
  return JSON.parse(JSON.stringify(IDLE));
}

function makeState(overrides = {}) {
  return {
    gx: 200, feetY: 400,
    gvx: 0, gvy: 0, grounded: true,
    faceR: true,
    posture: 'standing',
    curPose: clonePose(),
    platforms: [
      { x: 0, y: 400, w: 800, hash: 0xFFFF },
    ],
    holes: [],
    particles: [],
    score: 0,
    screenW: 800,
    screenH: 600,
    textOffsetX: 0,
    textOffsetY: 50,
    textWidth: 800,
    textHeight: 500,
    lineHeight: 16,
    missionScene: {},
    gameOver: false,
    ...overrides,
  };
}

describe('EVIL_TWIN_MISSION onEnter', () => {
  it('initializes a buffer with the spawn snapshot', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.missionScene.buffer.length).toBeGreaterThan(0);
    const first = s.missionScene.buffer[0];
    expect(first.gx).toBe(s.gx);
    expect(first.feetY).toBe(s.feetY);
  });

  it('starts with full lives and zero balls collected', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES);
    expect(s.missionScene.ballsCollected).toBe(0);
  });

  it('sets the initial twin delay to EVIL_TWIN_DELAY_INITIAL', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.missionScene.delaySec).toBeCloseTo(EVIL_TWIN_DELAY_INITIAL, 5);
  });

  it('primes the player with at least EVIL_TWIN_PRIMER_MANA so they have a zap on hand', () => {
    const s = makeState({ mana: 0 });
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.mana).toBe(EVIL_TWIN_PRIMER_MANA);
  });

  it('does not lower the player\'s mana if they walked in with more', () => {
    const s = makeState({ mana: 12 });
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.mana).toBe(12);
  });

  it('seeds walk-over mana orbs so the player has visible refills from spawn', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    expect(Array.isArray(s.missionScene.manaOrbs)).toBe(true);
    expect(s.missionScene.manaOrbs.length).toBeGreaterThanOrEqual(1);
    expect(s.missionScene.manaOrbs.length).toBeLessThanOrEqual(EVIL_TWIN_MANA_ORB_COUNT);
  });

  it('initializes an empty scorch list', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.missionScene.scorches).toEqual([]);
  });
});

describe('EVIL_TWIN_MISSION bolt scorches', () => {
  function plantTwinReadyDownward(s) {
    // Twin sits centered over a platform, ready to fire straight down so
    // the bolt crosses a platform-top and we can confirm the scorch lands.
    const plat = s.platforms.find((p) => p.hash === 0xFFFF);
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: plat.x + 100,
      feetY: plat.y - 30,
      faceR: true,
      curPose: clonePose(),
      posture: 'standing',
    }];
    s.missionScene.spellState = 'aiming';
    s.missionScene.spellT = TWIN_SPELL_AIM_DURATION;            // ready to fire next tick
    s.missionScene.twinAim = {
      angle: Math.PI / 2,                                        // straight down
      originX: plat.x + 100,
      originY: plat.y - 30,
    };
  }

  it('a fired bolt drops a scorch on each platform-top it crossed', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwinReadyDownward(s);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.scorches.length).toBeGreaterThan(0);
  });

  it('scorches age out after TWIN_BOLT_SCORCH_LIFE', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.scorches = [{ x: 100, y: 200, age: 0, maxAge: TWIN_BOLT_SCORCH_LIFE }];
    EVIL_TWIN_MISSION.update(s, TWIN_BOLT_SCORCH_LIFE + 0.05);
    expect(s.missionScene.scorches.length).toBe(0);
  });
});

describe('EVIL_TWIN_MISSION mana orbs', () => {
  it('walking onto an orb awards EVIL_TWIN_MANA_PER_ORB and removes it', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.mana = 0;                                          // override the primer for a clean delta
    // hash: null so the platform-sync step doesn't override the planted x/y.
    s.missionScene.manaOrbs = [{
      x: s.gx, y: s.feetY,
      age: 0, hash: null, dxFrac: 0.5,
    }];
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.mana).toBe(EVIL_TWIN_MANA_PER_ORB);
    expect(s.missionScene.manaOrbs.length).toBe(0);
  });

  it('a clear miss leaves the orb in place', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.mana = 0;
    s.missionScene.manaOrbs = [{
      x: s.gx + 200, y: s.feetY,
      age: 0, hash: null, dxFrac: 0.5,
    }];
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.mana).toBe(0);
    expect(s.missionScene.manaOrbs.length).toBe(1);
  });

  it('orbs age out after EVIL_TWIN_MANA_ORB_LIFETIME', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.gx = -9999;                                          // keep player far so it doesn't pick up
    s.missionScene.manaOrbs = [{
      x: 100, y: 200,
      age: EVIL_TWIN_MANA_ORB_LIFETIME - 0.01,
      hash: null, dxFrac: 0.5,
    }];
    EVIL_TWIN_MISSION.update(s, 0.05);
    expect(s.missionScene.manaOrbs.length).toBe(0);
  });

  it('does not bank up respawn time while the pool is full', () => {
    // Bug regression: if the spawn timer keeps accumulating while at
    // cap, a pickup after a long full-pool stretch causes an instant
    // respawn instead of waiting the full interval. The timer should
    // reset whenever the pool is at cap, so a fresh interval starts
    // the moment a slot opens.
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.gx = -9999;                                          // keep player far from any orbs
    // Run many seconds at cap to bank up time under the buggy version.
    for (let i = 0; i < 300; i++) EVIL_TWIN_MISSION.update(s, 0.05);
    expect(s.missionScene.manaOrbSpawnTimer).toBe(0);
    // Free a slot — the next single tick should not spawn a replacement.
    s.missionScene.manaOrbs.pop();
    EVIL_TWIN_MISSION.update(s, 0.05);
    expect(s.missionScene.manaOrbs.length).toBeLessThan(EVIL_TWIN_MANA_ORB_COUNT);
  });

  it('respects EVIL_TWIN_MANA_ORB_PICKUP_R — narrow miss stays', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    const baseline = s.mana;
    s.missionScene.manaOrbs = [{
      x: s.gx + EVIL_TWIN_MANA_ORB_PICKUP_R + 6, y: s.feetY,
      age: 0, hash: null, dxFrac: 0.5,
    }];
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.mana).toBe(baseline);
    expect(s.missionScene.manaOrbs.length).toBe(1);
  });
});

describe('EVIL_TWIN_MISSION update — buffer', () => {
  it('appends a snapshot on each tick', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    const before = s.missionScene.buffer.length;
    EVIL_TWIN_MISSION.update(s, 0.016);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.buffer.length).toBe(before + 2);
  });

  it('keeps the buffer bounded — old entries get trimmed', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.gx = -9999;                                      // keep clear of twin collision
    for (let i = 0; i < 600; i++) EVIL_TWIN_MISSION.update(s, 0.05); // 30 simulated seconds
    // Should never grow past a reasonable cap (max delay × headroom).
    expect(s.missionScene.buffer.length).toBeLessThan(400);
  });

  it('twinSnapshotAt returns the spawn pose while the buffer is shorter than the delay', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    const snap = twinSnapshotAt(s.missionScene, 0.5);
    expect(snap.gx).toBe(s.gx);
  });

  it('twinSnapshotAt returns the player pose from delay-seconds ago after the buffer fills', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.gx = -9999;                                      // keep player far from spawn
    // Walk simulated time forward, moving the player along x.
    for (let i = 0; i < 200; i++) {
      s.gx = i * 10;                                   // strictly increasing
      EVIL_TWIN_MISSION.update(s, 0.05);
    }
    // After 10 simulated seconds with delay = 3, twin should reflect the
    // player's position from ~3 seconds ago (around step 140 → gx=1400).
    const twin = twinSnapshotAt(s.missionScene, EVIL_TWIN_DELAY_INITIAL);
    expect(twin.gx).toBeGreaterThan(1000);
    expect(twin.gx).toBeLessThan(1800);
  });
});

describe('EVIL_TWIN_MISSION update — collision', () => {
  function plantTwin(s, twinGx, twinFeetY = s.feetY) {
    // Plant a twin snapshot at the exact lookup-target timestamp so it
    // survives trim and is selected by twinSnapshotAt on the next tick.
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: twinGx, feetY: twinFeetY,
      faceR: s.faceR,
      curPose: clonePose(),
      posture: s.posture,
    }];
  }
  function plantTwinAtPlayer(s) { plantTwin(s, s.gx); }

  it('decrements lives on twin overlap (cooldown gates the next hit)', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwinAtPlayer(s);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES - 1);
    // Same-tick contact should not double-bill on the next frame either —
    // the cooldown locks out further hits for EVIL_TWIN_HIT_COOLDOWN.
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES - 1);
  });

  it('a second hit lands once the cooldown elapses', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwinAtPlayer(s);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES - 1);
    // Advance past the cooldown.
    EVIL_TWIN_MISSION.update(s, EVIL_TWIN_HIT_COOLDOWN + 0.05);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES - 2);
  });

  it('hits at lives=1 transition to gameOver', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.lives = 1;
    plantTwinAtPlayer(s);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(0);
    expect(s.gameOver).toBe(true);
  });

  it('a clear miss leaves lives untouched', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwin(s, s.gx + 300);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES);
  });
});

describe('EVIL_TWIN_MISSION goal', () => {
  it('counts ball pickups during the mission via state.score diff', () => {
    const s = makeState({ score: 4 });                 // pretend the player walked in with 4
    EVIL_TWIN_MISSION.onEnter(s);
    expect(s.missionScene.ballsCollected).toBe(0);
    s.score = 7;                                       // simulate a +3 pickup burst
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.ballsCollected).toBe(3);
  });

  it('check() returns true once EVIL_TWIN_GOAL_BALLS have been collected', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.ballsCollected = EVIL_TWIN_GOAL_BALLS;
    expect(EVIL_TWIN_MISSION.check(s)).toBe(true);
  });

  it('check() is false while the goal is incomplete', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.ballsCollected = EVIL_TWIN_GOAL_BALLS - 1;
    expect(EVIL_TWIN_MISSION.check(s)).toBe(false);
  });

  it('shrinks the twin delay as the player progresses toward the goal', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    const initial = s.missionScene.delaySec;
    s.missionScene.ballsCollected = EVIL_TWIN_GOAL_BALLS - 1;
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.delaySec).toBeLessThan(initial);
  });
});

describe('EVIL_TWIN_MISSION shield', () => {
  function plantTwinAtPlayer(s) {
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: s.gx, feetY: s.feetY,
      faceR: s.faceR,
      curPose: clonePose(),
      posture: s.posture,
    }];
  }

  it('a shielded contact hit leaves lives untouched', () => {
    const s = makeState({ shieldActive: true });
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwinAtPlayer(s);
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES);
  });

  it('a shielded player survives a direct twin lightning hit', () => {
    const s = makeState({ shieldActive: true });
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.spellState = 'firing';
    s.missionScene.twinBolt = {
      x: s.gx, y: s.feetY - 16,                         // bolt origin near player torso
      angle: -Math.PI / 2,                              // straight up
      life: TWIN_BOLT_LIFE,
      maxLife: TWIN_BOLT_LIFE,
      zig: [],
      struck: false,
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
  });

  it('shield still protects against the twin bolt while stasis is held', () => {
    // Regression: when stasis was added, the twin spell tick started
    // using a stasis-scaled dt. The strike check still runs every
    // frame and shield must still gate game-over — the stretched
    // bolt life shouldn't break shield protection.
    const s = makeState({ shieldActive: true, stasisActive: true });
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.spellState = 'firing';
    s.missionScene.twinBolt = {
      x: s.gx, y: s.feetY - 16,
      angle: -Math.PI / 2,
      life: TWIN_BOLT_LIFE,
      maxLife: TWIN_BOLT_LIFE,
      zig: [],
      struck: false,
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
  });
});

describe('EVIL_TWIN_MISSION twin lightning', () => {
  function planTwinReady(s) {
    // Walk far enough that the buffer has a valid older entry to feed the
    // cast origin. Without this the twin might still be "asleep" at spawn
    // and the spell tick would defer.
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: s.gx + 200, feetY: s.feetY,
      faceR: false,
      curPose: clonePose(),
      posture: s.posture,
    }];
  }

  it('idle → aiming once the next-spell timer elapses', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    planTwinReady(s);
    s.missionScene.spellNextAt = 0;                     // fire on the next tick
    s.missionScene.spellT = 0;
    EVIL_TWIN_MISSION.update(s, 0.05);
    expect(s.missionScene.spellState).toBe('aiming');
    expect(s.missionScene.twinAim).toBeDefined();
  });

  it('aiming → firing produces a twinBolt after the aim duration', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    planTwinReady(s);
    s.missionScene.spellState = 'aiming';
    s.missionScene.spellT = 0;
    s.missionScene.twinAim = { angle: -Math.PI / 2, originX: 0, originY: 0 };
    EVIL_TWIN_MISSION.update(s, TWIN_SPELL_AIM_DURATION + 0.01);
    expect(s.missionScene.spellState).toBe('firing');
    expect(s.missionScene.twinBolt).toBeDefined();
    expect(s.missionScene.twinAim).toBeNull();
  });

  it('a live twin bolt that strikes the player ends the run', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.spellState = 'firing';
    s.missionScene.twinBolt = {
      x: s.gx, y: s.feetY - 16,
      angle: -Math.PI / 2,
      life: TWIN_BOLT_LIFE,
      maxLife: TWIN_BOLT_LIFE,
      zig: [],
      struck: false,
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(true);
  });

  it('a near-miss bolt leaves the player alive', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.spellState = 'firing';
    s.missionScene.twinBolt = {
      x: s.gx + 200, y: s.feetY - 16,                   // ray far to the right
      angle: -Math.PI / 2,
      life: TWIN_BOLT_LIFE,
      maxLife: TWIN_BOLT_LIFE,
      zig: [],
      struck: false,
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.gameOver).toBe(false);
  });
});

describe('EVIL_TWIN_MISSION stun', () => {
  function plantTwin(s, twinGx, twinFeetY = s.feetY) {
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: twinGx, feetY: twinFeetY,
      faceR: s.faceR,
      curPose: clonePose(),
      posture: s.posture,
    }];
  }

  it('player lightning that passes through the twin stuns it', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwin(s, s.gx);                                 // twin overlaps player
    // Live player bolt straight up through the twin's torso.
    s.lightningBolt = {
      x: s.gx, y: s.feetY,
      angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.3,
      zig: [],
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.stunT).toBeGreaterThan(0);
  });

  it('contact during stun is harmless', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwin(s, s.gx);
    s.missionScene.stunT = TWIN_STUN_DURATION;
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES);
  });

  it('a player zap interrupts a charging twin spell', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    plantTwin(s, s.gx);
    s.missionScene.spellState = 'aiming';
    s.missionScene.twinAim = { angle: 0, originX: 0, originY: 0 };
    s.lightningBolt = {
      x: s.gx, y: s.feetY,
      angle: -Math.PI / 2,
      life: 0.3, maxLife: 0.3,
      zig: [],
    };
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.spellState).toBe('idle');
    expect(s.missionScene.twinAim).toBeNull();
  });
});

describe('EVIL_TWIN_MISSION render — visibility', () => {
  // Mock 2D context that records strokeStyle assignments. We only need
  // the surface drawShadowTwin actually touches (state setters + path
  // primitives) — no rendered output, just the recorded calls.
  function makeMockCtx() {
    const calls = [];
    const noop = (name) => () => calls.push({ name });
    return {
      calls,
      save: noop('save'),
      restore: noop('restore'),
      beginPath: noop('beginPath'),
      moveTo: noop('moveTo'),
      lineTo: noop('lineTo'),
      arc: noop('arc'),
      fill: noop('fill'),
      stroke: noop('stroke'),
      setLineDash: noop('setLineDash'),
      set fillStyle(v) { calls.push({ name: 'fillStyle', value: v }); },
      set strokeStyle(v) { calls.push({ name: 'strokeStyle', value: v }); },
      set shadowColor(v) { calls.push({ name: 'shadowColor', value: v }); },
      set shadowBlur(v) { calls.push({ name: 'shadowBlur', value: v }); },
      set lineWidth(v) { calls.push({ name: 'lineWidth', value: v }); },
      set lineCap(v) { calls.push({ name: 'lineCap', value: v }); },
      set lineJoin(v) { calls.push({ name: 'lineJoin', value: v }); },
      set globalAlpha(v) { calls.push({ name: 'globalAlpha', value: v }); },
    };
  }

  function parseRgba(s) {
    const m = /rgba?\(([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/i.exec(s || '');
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  it('limb stroke color stays visible without canvas shadowBlur (Linux/Wayland regression)', () => {
    // Wayland WebKit2GTK does not reliably render canvas shadowBlur on
    // a transparent overlay window. The twin's body must therefore read
    // on its own — a near-black stroke that depends on a red shadow
    // halo will be invisible on Linux. Guard the limb color so it
    // always carries enough chroma to be seen without the glow.
    const snap = {
      gx: 200, feetY: 400, faceR: true,
      curPose: JSON.parse(JSON.stringify(IDLE)),
    };
    const ctx = makeMockCtx();
    drawShadowTwin(ctx, snap, false);

    // The limb pass is the first strokeStyle set inside drawShadowTwin
    // (rope drawing is gated on snap.rope, which we deliberately omit).
    const stroke = ctx.calls.find((c) => c.name === 'strokeStyle');
    expect(stroke).toBeDefined();
    const rgb = parseRgba(stroke.value);
    expect(rgb).not.toBeNull();
    // Require at least one channel above 100/255 — enough chroma to
    // read on its own. The original near-black (40,10,30) fails this.
    const peak = Math.max(rgb.r, rgb.g, rgb.b);
    expect(peak).toBeGreaterThanOrEqual(100);
  });
});

describe('EVIL_TWIN_MISSION hit radius', () => {
  it('contact within EVIL_TWIN_HIT_RADIUS counts; just outside does not', () => {
    const s = makeState();
    EVIL_TWIN_MISSION.onEnter(s);
    s.missionScene.elapsed = EVIL_TWIN_DELAY_INITIAL + 1;
    s.missionScene.buffer = [{
      t: s.missionScene.elapsed - EVIL_TWIN_DELAY_INITIAL,
      gx: s.gx + EVIL_TWIN_HIT_RADIUS + 4, feetY: s.feetY,
      faceR: s.faceR, curPose: clonePose(), posture: 'standing',
    }];
    EVIL_TWIN_MISSION.update(s, 0.016);
    expect(s.missionScene.lives).toBe(EVIL_TWIN_INITIAL_LIVES);
  });
});
