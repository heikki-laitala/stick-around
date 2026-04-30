import { STANDING_HEIGHT } from '../poses.js';
import { resetPlayer } from '../physics.js';
import { renderGameOver } from './_shared.js';
import { drawShadowTwin, renderEvilTwinHud } from './evilTwin/render.js';

/**
 * "Evil Twin" mission.
 *
 * A second stick figure shadows the player, replaying their movements
 * from a few seconds ago. Touching the twin costs a life — three hits
 * and the run ends. The twin sleeps at the spawn point until the buffer
 * fills (the first three seconds), then stalks the player through every
 * step they took.
 *
 * Goal: collect 5 glowing balls during the mission. The twin's reaction
 * lag shrinks as you progress — by the final pickup it's only ~1.5 s
 * behind, so the late game forces tighter movement than the opening.
 */

export const EVIL_TWIN_INITIAL_LIVES = 3;
export const EVIL_TWIN_GOAL_BALLS = 5;
export const EVIL_TWIN_DELAY_INITIAL = 3.0;       // seconds the twin lags at start
export const EVIL_TWIN_DELAY_FINAL = 1.5;         // delay once the goal is in sight
export const EVIL_TWIN_HIT_COOLDOWN = 1.0;        // seconds of invuln after a touch
export const EVIL_TWIN_HIT_RADIUS = 16;
// Trim entries older than this so the buffer stays bounded across long
// missions. Keep enough headroom that the initial-delay readback always
// has data even when the player is moving slowly.
const BUFFER_TRIM_SLACK = 0.4;
// Hard upper bound — guard against clock drift / very small dt loops.
const BUFFER_HARD_CAP = 360;

function clonePose(p) {
  if (!p) return null;
  const out = {};
  for (const k of Object.keys(p)) {
    const j = p[k];
    out[k] = (j && typeof j === 'object') ? { x: j.x, y: j.y } : j;
  }
  return out;
}

function pushSnapshot(scene, state) {
  scene.buffer.push({
    t: scene.elapsed,
    gx: state.gx,
    feetY: state.feetY,
    faceR: state.faceR,
    posture: state.posture,
    curPose: clonePose(state.curPose),
    // Snapshot rope state so the twin can also visibly use the rope on
    // the same arc the player took. Shallow copy is enough — rope is
    // primitive scalars + a state string, no nested live data.
    rope: state.rope ? { ...state.rope } : null,
  });
  // Trim entries older than (delaySec + slack). Caps memory while keeping
  // the readback safe; pinned by BUFFER_HARD_CAP so a runaway loop can't
  // grow it without bound either.
  const cutoff = scene.elapsed - (scene.delaySec + BUFFER_TRIM_SLACK);
  while (scene.buffer.length > 1 && scene.buffer[0].t < cutoff) {
    scene.buffer.shift();
  }
  while (scene.buffer.length > BUFFER_HARD_CAP) scene.buffer.shift();
}

/**
 * Snapshot the twin should render right now. Walks the buffer for the
 * latest entry whose timestamp lies at least `delaySec` in the past;
 * returns the spawn entry while the buffer is still filling.
 */
export function twinSnapshotAt(scene, delaySec) {
  if (!scene || !Array.isArray(scene.buffer) || scene.buffer.length === 0) {
    return null;
  }
  const target = (scene.elapsed || 0) - delaySec;
  let best = scene.buffer[0];
  for (const entry of scene.buffer) {
    if (entry.t > target) break;
    best = entry;
  }
  return best;
}

function twinHitsPlayer(state, twin) {
  if (!twin) return false;
  const torsoY = state.feetY - STANDING_HEIGHT / 2;
  const twinTorsoY = twin.feetY - STANDING_HEIGHT / 2;
  return Math.hypot(twin.gx - state.gx, twinTorsoY - torsoY) < EVIL_TWIN_HIT_RADIUS;
}

function currentDelay(scene) {
  const progress = Math.min(1, (scene.ballsCollected || 0) / EVIL_TWIN_GOAL_BALLS);
  return EVIL_TWIN_DELAY_INITIAL
    + (EVIL_TWIN_DELAY_FINAL - EVIL_TWIN_DELAY_INITIAL) * progress;
}

export const EVIL_TWIN_MISSION = {
  id: 'evil-twin',
  text: 'Outrun the evil twin and grab 5 glowing balls',
  rewardTitle: 'twin slipper',
  unlocks: ['evil-twin-survivor'],

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    const balls = scene.ballsCollected || 0;
    const lives = scene.lives ?? EVIL_TWIN_INITIAL_LIVES;
    return `(${balls}/${EVIL_TWIN_GOAL_BALLS} · lives ${lives})`;
  },

  onEnter(state) {
    const scene = state.missionScene;
    resetPlayer(state);
    scene.lives = EVIL_TWIN_INITIAL_LIVES;
    scene.ballsCollected = 0;
    scene.lastScore = state.score || 0;
    scene.delaySec = EVIL_TWIN_DELAY_INITIAL;
    scene.elapsed = 0;
    scene.invulnTimer = 0;
    scene.buffer = [];
    pushSnapshot(scene, state);
    state.gameOver = false;
  },

  check(state) {
    const scene = state.missionScene;
    if (!scene) return false;
    return (scene.ballsCollected || 0) >= EVIL_TWIN_GOAL_BALLS;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;

    // Always advance the clock + buffer so the recording stays in sync
    // with real time even after game-over (the freeze-frame replay still
    // needs the most recent buffer state).
    scene.elapsed = (scene.elapsed || 0) + dt;
    pushSnapshot(scene, state);

    if (state.gameOver) return;

    // Tighten the lag as the player gets closer to the goal — endgame
    // forces more decisive movement than the opening.
    scene.delaySec = currentDelay(scene);

    // Track ball pickups via state.score diff. Mission-local count so
    // the player's pre-mission score doesn't spill into the goal.
    const prevScore = scene.lastScore ?? 0;
    if (state.score > prevScore) {
      scene.ballsCollected = (scene.ballsCollected || 0) + (state.score - prevScore);
    }
    scene.lastScore = state.score || 0;

    scene.invulnTimer = Math.max(0, (scene.invulnTimer || 0) - dt);

    const twin = twinSnapshotAt(scene, scene.delaySec);
    if (twin && twinHitsPlayer(state, twin)) {
      if (scene.invulnTimer <= 0) {
        scene.lives = Math.max(0, (scene.lives || 0) - 1);
        scene.invulnTimer = EVIL_TWIN_HIT_COOLDOWN;
        if (scene.lives === 0) {
          state.gameOver = true;
          state.gvx = 0;
          state.gvy = 0;
        }
      }
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    const paused = state.overlayActive === false;
    const twin = twinSnapshotAt(scene, scene.delaySec);
    drawShadowTwin(ctx, twin, paused);
    renderEvilTwinHud(ctx, scene, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};
