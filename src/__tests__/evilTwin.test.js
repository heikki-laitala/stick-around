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
  twinSnapshotAt,
} from '../missions/evilTwin.js';
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
