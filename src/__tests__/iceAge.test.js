import { describe, it, expect } from 'vitest';
import {
  ICE_AGE_MISSION,
  SNOWMAN_LAYERS,
  BUILD_ZONE_W,
  BUILD_ZONE_H,
  ICICLE_FALL_SPEED,
  ICICLE_PLAYER_HIT_R,
  ICICLE_SPAWN_INTERVAL,
  SNOW_CHUNK_LIFETIME,
  SNOW_CHUNK_SPAWN_INTERVAL,
  SNOW_CHUNK_COUNT,
} from '../missions/iceAge.js';

function makeState(overrides = {}) {
  return {
    gx: 200, feetY: 400,
    gvx: 0, gvy: 0, grounded: true,
    faceR: true,
    posture: 'standing',
    platforms: [
      { x: 0, y: 400, w: 800, hash: 0xFFFF }, // prompt-top border (stable)
      { x: 100, y: 200, w: 200, hash: 0xA1 },
      { x: 400, y: 250, w: 200, hash: 0xA2 },
      { x: 200, y: 100, w: 300, hash: 0xA3 },
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

describe('ICE_AGE_MISSION onEnter', () => {
  it('flags iceFloor so physics enters slippery mode', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    expect(s.missionScene.iceFloor).toBe(true);
  });

  it('seeds a non-empty array of snow chunks', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    expect(Array.isArray(s.missionScene.snowChunks)).toBe(true);
    expect(s.missionScene.snowChunks.length).toBeGreaterThan(0);
  });

  it('defines a build zone anchored to a platform', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const zone = s.missionScene.buildZone;
    expect(zone).toBeDefined();
    expect(zone.w).toBe(BUILD_ZONE_W);
    expect(zone.h).toBe(BUILD_ZONE_H);
    expect(zone.anchorHash).toBeDefined();
  });

  it('starts with zero collected balls and zero built layers', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    expect(s.missionScene.snowballsCollected).toBe(0);
    expect(s.missionScene.builtLayers).toBe(0);
  });

  it('seeds a populated ceiling of idle icicles and a fresh spawn timer', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    expect(s.missionScene.icicles.length).toBeGreaterThan(0);
    for (const ic of s.missionScene.icicles) {
      expect(ic.state).toBe('idle');
    }
    expect(s.missionScene.icicleSpawnTimer).toBe(0);
  });
});

describe('ICE_AGE_MISSION delivery', () => {
  function setupAtBuildZone(snowballs) {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const zone = s.missionScene.buildZone;
    s.gx = zone.x + zone.w / 2;
    s.feetY = zone.y + zone.h - 1;   // feet inside the zone rect
    s.missionScene.snowballsCollected = snowballs;
    s.missionScene.wasInBuildZone = false;
    return s;
  }

  it('deposits one snowball and grows the snowman by one layer on entry', () => {
    const s = setupAtBuildZone(2);
    ICE_AGE_MISSION.update(s, 0.016);
    expect(s.missionScene.snowballsCollected).toBe(1);
    expect(s.missionScene.builtLayers).toBe(1);
  });

  it('does not deposit when standing in the zone with no snowballs', () => {
    const s = setupAtBuildZone(0);
    ICE_AGE_MISSION.update(s, 0.016);
    expect(s.missionScene.snowballsCollected).toBe(0);
    expect(s.missionScene.builtLayers).toBe(0);
  });

  it('only deposits once per zone entry — leaving and re-entering grows again', () => {
    const s = setupAtBuildZone(3);
    ICE_AGE_MISSION.update(s, 0.016);                        // enter, deposit 1
    ICE_AGE_MISSION.update(s, 0.016);                        // still inside, no extra
    expect(s.missionScene.builtLayers).toBe(1);
    s.gx = -100;                                             // walk away
    ICE_AGE_MISSION.update(s, 0.016);
    s.gx = s.missionScene.buildZone.x + s.missionScene.buildZone.w / 2; // walk back
    ICE_AGE_MISSION.update(s, 0.016);
    expect(s.missionScene.builtLayers).toBe(2);
  });

  it('caps growth at SNOWMAN_LAYERS even with surplus snowballs', () => {
    const s = setupAtBuildZone(10);
    for (let pass = 0; pass < SNOWMAN_LAYERS + 2; pass++) {
      s.missionScene.wasInBuildZone = false;                 // simulate re-entry
      ICE_AGE_MISSION.update(s, 0.016);
    }
    expect(s.missionScene.builtLayers).toBe(SNOWMAN_LAYERS);
  });

  it('check() returns true once the snowman is built and the win-hold elapses', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.builtLayers = SNOWMAN_LAYERS;
    s.missionScene.winT = 999;                              // past the hold
    expect(ICE_AGE_MISSION.check(s)).toBe(true);
  });

  it('check() stays false during the win-hold so the snowman can be admired', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.builtLayers = SNOWMAN_LAYERS;
    s.missionScene.winT = 0;
    expect(ICE_AGE_MISSION.check(s)).toBe(false);
  });

  it('update() ticks winT after the snowman is finished and freezes hazards', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.builtLayers = SNOWMAN_LAYERS;
    s.missionScene.icicleSpawnTimer = 0;
    ICE_AGE_MISSION.update(s, 0.5);
    expect(s.missionScene.winT).toBeCloseTo(0.5, 5);
    // Spawn timer must not have advanced — the hazards are paused.
    expect(s.missionScene.icicleSpawnTimer).toBe(0);
  });

  it('check() is false while the snowman is incomplete', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.builtLayers = SNOWMAN_LAYERS - 1;
    expect(ICE_AGE_MISSION.check(s)).toBe(false);
  });
});

describe('ICE_AGE_MISSION icicles', () => {
  it('arms exactly one ceiling icicle into the shaking state per spawn tick', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;                                            // keep the man clear of any drop
    ICE_AGE_MISSION.update(s, ICICLE_SPAWN_INTERVAL + 0.001);
    const shaking = s.missionScene.icicles.filter((ic) => ic.state === 'shaking');
    expect(shaking.length).toBe(1);
  });

  it('a shaking icicle transitions to falling once the shake duration elapses', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;
    s.missionScene.icicles[0].state = 'shaking';
    s.missionScene.icicles[0].shakeT = 0;
    ICE_AGE_MISSION.update(s, 1.0);                           // beyond ICICLE_SHAKE_DURATION (0.7)
    expect(['falling', 'idle']).toContain(s.missionScene.icicles[0].state);
    // Either it's now falling, or it has already fallen off-screen and been
    // respawned to idle. Both are valid end states for a 1s tick.
  });

  it('falls downward each tick at ICICLE_FALL_SPEED', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.icicles = [{ x: 200, y: 100, vy: ICICLE_FALL_SPEED, w: 14, h: 28 }];
    ICE_AGE_MISSION.update(s, 0.1);
    const ic = s.missionScene.icicles[0];
    expect(ic.y).toBeCloseTo(100 + ICICLE_FALL_SPEED * 0.1, 1);
  });

  it('hitting the man sets gameOver — the icicle is left in place for the restart sweep', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    // Drop one right onto the man's torso.
    const torsoY = s.feetY - 16;          // close enough to STANDING_HEIGHT/2 to register a hit
    s.missionScene.icicles = [{
      x: s.gx, y: torsoY,
      vy: ICICLE_FALL_SPEED, w: 14, h: 28,
      state: 'falling', shakeT: 0, anchorX: s.gx,
    }];
    ICE_AGE_MISSION.update(s, 0.001);
    expect(s.gameOver).toBe(true);
  });

  it('a shielded man survives a direct hit', () => {
    const s = makeState({ shieldActive: true });
    ICE_AGE_MISSION.onEnter(s);
    const torsoY = s.feetY - 16;          // close enough to STANDING_HEIGHT/2 to register a hit
    s.missionScene.icicles = [{
      x: s.gx, y: torsoY,
      vy: ICICLE_FALL_SPEED, w: 14, h: 28,
    }];
    ICE_AGE_MISSION.update(s, 0.001);
    expect(s.gameOver).toBe(false);
  });

  it('does not damage the build zone platform on impact', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const zone = s.missionScene.buildZone;
    const buildPlat = s.platforms.find((p) => p.hash === zone.anchorHash);
    s.missionScene.icicles = [{
      x: zone.x + zone.w / 2, y: buildPlat.y - 10,
      vy: ICICLE_FALL_SPEED, w: 14, h: 28,
    }];
    s.gx = -9999;                                              // step the man out of harm's way
    ICE_AGE_MISSION.update(s, 0.1);
    const buildHole = s.holes.find((h) => h.y === buildPlat.y);
    expect(buildHole).toBeUndefined();
  });

  it('punches a hole through a non-build-zone platform on crossing', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const target = s.platforms.find((p) => p.hash === 0xA1);
    s.missionScene.icicles = [{
      x: target.x + target.w / 2, y: target.y - 5,
      vy: ICICLE_FALL_SPEED, w: 14, h: 28,
    }];
    s.gx = -9999;
    ICE_AGE_MISSION.update(s, 0.1);
    const hole = s.holes.find((h) => h.y === target.y);
    expect(hole).toBeDefined();
  });

  it('respawns a falling icicle back to idle at the ceiling once it falls off-screen', () => {
    const s = makeState({ screenH: 600 });
    ICE_AGE_MISSION.onEnter(s);
    s.missionScene.icicles = [{
      x: 200, y: 595, anchorX: 200,
      vy: ICICLE_FALL_SPEED, w: 14, h: 28,
      state: 'falling', shakeT: 0,
    }];
    s.gx = -9999;
    ICE_AGE_MISSION.update(s, 0.1);
    const ic = s.missionScene.icicles[0];
    expect(ic.state).toBe('idle');
    // Tip should now sit just below the terminal-ceiling line — well above
    // where it was when we forced it offscreen.
    expect(ic.y).toBeLessThan(200);
    expect(ic.vy).toBe(0);
  });

  it('hit radius respects ICICLE_PLAYER_HIT_R — narrow miss spares the man', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const torsoY = s.feetY - 16;          // close enough to STANDING_HEIGHT/2 to register a hit
    s.missionScene.icicles = [{
      x: s.gx + ICICLE_PLAYER_HIT_R + 4, y: torsoY,
      vy: 0, w: 14, h: 28,
    }];
    ICE_AGE_MISSION.update(s, 0.001);
    expect(s.gameOver).toBe(false);
  });
});

describe('ICE_AGE_MISSION snow chunk lifecycle', () => {
  it('seeds chunks with an age field of zero', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    for (const c of s.missionScene.snowChunks) {
      expect(c.age).toBe(0);
    }
  });

  it('ages chunks every tick', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;                                              // keep clear of build zone
    const original = s.missionScene.snowChunks[0];
    ICE_AGE_MISSION.update(s, 0.5);
    expect(original.age).toBeGreaterThanOrEqual(0.5);
  });

  it('despawns a chunk once it ages past SNOW_CHUNK_LIFETIME', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;
    // Pre-age every chunk so the next tick pushes them past lifetime in
    // one step — no need to simulate seconds in real time.
    for (const c of s.missionScene.snowChunks) c.age = SNOW_CHUNK_LIFETIME - 0.01;
    const before = s.missionScene.snowChunks.length;
    ICE_AGE_MISSION.update(s, 0.05);
    expect(s.missionScene.snowChunks.length).toBeLessThan(before);
  });

  it('respawns a fresh chunk after the spawn interval when below cap', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;
    // Drop the chunk count below max, then advance time enough to fire
    // the spawner. Building the platforms list big enough so the spawner
    // can place a fresh chunk far from the surviving one.
    s.missionScene.snowChunks = [s.missionScene.snowChunks[0]];
    s.missionScene.snowChunkSpawnTimer = 0;
    ICE_AGE_MISSION.update(s, SNOW_CHUNK_SPAWN_INTERVAL + 0.05);
    expect(s.missionScene.snowChunks.length).toBe(2);
  });

  it('does not spawn a chunk on the build-zone platform', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    const buildHash = s.missionScene.buildZone.anchorHash;
    s.gx = -9999;
    // Run many spawn attempts back-to-back; none of the resulting chunks
    // should land on the build-zone platform.
    s.missionScene.snowChunks = [];
    for (let i = 0; i < 30; i++) {
      s.missionScene.snowChunkSpawnTimer = 0;
      ICE_AGE_MISSION.update(s, SNOW_CHUNK_SPAWN_INTERVAL + 0.01);
    }
    for (const c of s.missionScene.snowChunks) {
      expect(c.hash).not.toBe(buildHash);
    }
  });

  it('does not exceed SNOW_CHUNK_COUNT chunks at once', () => {
    const s = makeState();
    ICE_AGE_MISSION.onEnter(s);
    s.gx = -9999;
    for (let i = 0; i < 50; i++) {
      s.missionScene.snowChunkSpawnTimer = 0;
      ICE_AGE_MISSION.update(s, SNOW_CHUNK_SPAWN_INTERVAL + 0.01);
    }
    expect(s.missionScene.snowChunks.length).toBeLessThanOrEqual(SNOW_CHUNK_COUNT);
  });
});
