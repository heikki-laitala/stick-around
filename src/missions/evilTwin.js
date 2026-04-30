import { STANDING_HEIGHT, SCALE } from '../poses.js';
import { resetPlayer } from '../physics.js';
import { isShielded, lightningStrikesPoint } from '../spells.js';
import { spawnManaMine } from '../manaMines.js';
import { renderGameOver, burstParticles } from './_shared.js';
import {
  drawShadowTwin,
  drawTwinLightningAim,
  drawTwinLightningBolt,
  drawScorches,
  renderEvilTwinHud,
} from './evilTwin/render.js';

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
// Spell timings — twin charges up for AIM_DURATION (visible aim line is the
// player's chance to dodge or raise the shield), then a bolt strikes for
// BOLT_LIFE. Direct hit = game over (parity with icicle / meteor).
export const TWIN_SPELL_INTERVAL_MIN = 4.5;       // shortest gap between twin casts
export const TWIN_SPELL_INTERVAL_MAX = 8.0;       // longest gap between twin casts
export const TWIN_SPELL_AIM_DURATION = 0.9;       // seconds of telegraph before firing
// Imperfect tracking: during the charge the angle slews toward the
// player at this rate (rad/s). Enough to catch lazy drift, but not a
// hard juke — the player can still side-jump out of the lane.
export const TWIN_SPELL_TRACK_RATE = 0.7;
export const TWIN_BOLT_LIFE = 0.4;                // seconds the bolt sits visible
export const TWIN_BOLT_RANGE = 1200;
export const TWIN_BOLT_BEAM_WIDTH = 26;
// Player's lightning is the only thing that touches the twin. A hit
// stuns it for this many seconds — invisible, non-damaging, no spells —
// long enough to use as a tactical reset, short enough to keep the
// resource scarce given mana costs (2 per cast).
export const TWIN_STUN_DURATION = 2.0;
// Prime the player with enough mana for two lightning zaps so they
// always have a defensive option, regardless of how the random mission
// order ran. Won't overwrite if they walked in with more.
export const EVIL_TWIN_PRIMER_MANA = 7;
// Pre-seed this many mana mines so the player can keep refilling zaps
// during the chase. The global manaMines spawner handles respawns from
// there.
export const EVIL_TWIN_SEED_MINES = 2;
// Brief scorch left on each platform a twin bolt crossed — a visual
// breadcrumb of where the danger zones just were.
export const TWIN_BOLT_SCORCH_LIFE = 1.0;
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

// Same casting origin convention as the player's wand — fire from the
// twin's head joint so the bolt visibly erupts off the silhouette
// instead of the man's feet.
function twinCastOrigin(twin) {
  const head = twin?.curPose?.head;
  if (!head) return null;
  const fl = twin.faceR ? 1 : -1;
  return {
    x: twin.gx + head.x * SCALE * fl,
    y: twin.feetY + (head.y - 44) * SCALE,
  };
}

function rollSpellInterval() {
  return TWIN_SPELL_INTERVAL_MIN
    + Math.random() * (TWIN_SPELL_INTERVAL_MAX - TWIN_SPELL_INTERVAL_MIN);
}

function ensureSeedMines(state) {
  // Pre-seed the playfield so the player has visible mana sources from
  // spawn instead of waiting on the global manaMines spawner. The global
  // system continues to respawn after these are mined out.
  if (!Array.isArray(state.platforms) || state.platforms.length === 0) return;
  if (!state.manaMines) state.manaMines = [];
  while (state.manaMines.length < EVIL_TWIN_SEED_MINES) {
    const m = spawnManaMine(state.platforms, state.manaMines, state.lineHeight);
    if (!m) break;                                  // no valid spot — stop trying
    state.manaMines.push(m);
  }
}

function addBoltScorches(state, scene, bolt) {
  if (!state.platforms || !scene) return;
  if (!Array.isArray(scene.scorches)) scene.scorches = [];
  const sin = Math.sin(bolt.angle);
  const cos = Math.cos(bolt.angle);
  // A horizontal ray doesn't have a well-defined platform crossing —
  // the aim arc clamp prevents this in practice; guard anyway.
  if (Math.abs(sin) < 0.001) return;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    const t = (p.y - bolt.y) / sin;
    if (t < 0 || t > TWIN_BOLT_RANGE) continue;
    const crossX = bolt.x + cos * t;
    if (crossX < p.x || crossX > p.x + p.w) continue;
    scene.scorches.push({
      x: crossX,
      y: p.y,
      age: 0,
      maxAge: TWIN_BOLT_SCORCH_LIFE,
    });
  }
}

function ageScorches(scene, dt) {
  if (!scene.scorches || scene.scorches.length === 0) return;
  for (let i = scene.scorches.length - 1; i >= 0; i--) {
    scene.scorches[i].age += dt;
    if (scene.scorches[i].age >= scene.scorches[i].maxAge) {
      scene.scorches.splice(i, 1);
    }
  }
}

function makeZig() {
  // Same shape the player's bolt uses — alternating perpendicular offsets,
  // tapering toward the tip so the ray narrows to a point.
  const n = 22;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    const taper = 1 - i / n;
    arr[i] = ((i % 2 === 0 ? -1 : 1) * (8 + Math.random() * 10)) * taper;
  }
  return arr;
}

/**
 * Is the player's torso within the bolt's beam? Mirrors the player's
 * `lightningStrikesPoint` math: project onto the ray, accept if the
 * along-ray distance is within range and the perpendicular distance is
 * within half the beam width.
 */
export function twinBoltStrikesPoint(bolt, x, y) {
  if (!bolt) return false;
  const dx = x - bolt.x;
  const dy = y - bolt.y;
  const cos = Math.cos(bolt.angle);
  const sin = Math.sin(bolt.angle);
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  if (along < 0 || along > TWIN_BOLT_RANGE) return false;
  return Math.abs(across) <= TWIN_BOLT_BEAM_WIDTH / 2;
}

function tickTwinSpell(state, scene, twin, dt) {
  scene.spellT = (scene.spellT || 0) + dt;
  // 'idle' — count down to next charge attempt.
  if (scene.spellState === 'idle') {
    if (!twin) return;                                 // need a body to cast from
    if (scene.spellT >= scene.spellNextAt) {
      const origin = twinCastOrigin(twin);
      if (!origin) {                                   // pose not ready, retry next tick
        scene.spellT = scene.spellNextAt - 0.2;
        return;
      }
      const torsoY = state.feetY - STANDING_HEIGHT / 2;
      const angle = Math.atan2(torsoY - origin.y, state.gx - origin.x);
      scene.twinAim = { angle, originX: origin.x, originY: origin.y };
      scene.spellState = 'aiming';
      scene.spellT = 0;
    }
    return;
  }
  // 'aiming' — line stays attached to the twin's head while it moves.
  // The angle slews toward the player at TWIN_SPELL_TRACK_RATE (rad/s),
  // so steady drift gets tracked but a sharp juke still escapes the
  // lane. Final angle locks at fire-time.
  if (scene.spellState === 'aiming') {
    const origin = twin ? twinCastOrigin(twin) : null;
    if (origin && scene.twinAim) {
      scene.twinAim.originX = origin.x;
      scene.twinAim.originY = origin.y;
      const torsoY = state.feetY - STANDING_HEIGHT / 2;
      const desired = Math.atan2(torsoY - origin.y, state.gx - origin.x);
      let diff = desired - scene.twinAim.angle;
      // Wrap to (-π, π] so we slew the short way around.
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const step = TWIN_SPELL_TRACK_RATE * dt;
      const clamped = Math.max(-step, Math.min(step, diff));
      scene.twinAim.angle += clamped;
    }
    if (scene.spellT >= TWIN_SPELL_AIM_DURATION) {
      const aim = scene.twinAim;
      if (aim) {
        const bolt = {
          x: aim.originX, y: aim.originY,
          angle: aim.angle,
          life: TWIN_BOLT_LIFE,
          maxLife: TWIN_BOLT_LIFE,
          zig: makeZig(),
          struck: false,                               // gates the once-per-bolt damage
        };
        scene.twinBolt = bolt;
        addBoltScorches(state, scene, bolt);
      }
      scene.twinAim = null;
      scene.spellState = 'firing';
      scene.spellT = 0;
    }
    return;
  }
  // 'firing' — age the bolt; while it's live, a torso intersection is fatal.
  if (scene.spellState === 'firing') {
    const bolt = scene.twinBolt;
    if (bolt) {
      bolt.life -= dt;
      if (!bolt.struck && !state.gameOver) {
        const torsoY = state.feetY - STANDING_HEIGHT / 2;
        if (twinBoltStrikesPoint(bolt, state.gx, torsoY)) {
          bolt.struck = true;
          if (!isShielded(state)) {
            state.gameOver = true;
            state.gvx = 0;
            state.gvy = 0;
          }
        }
      }
      if (bolt.life <= 0) {
        scene.twinBolt = null;
        scene.spellState = 'idle';
        scene.spellT = 0;
        scene.spellNextAt = rollSpellInterval();
      }
    } else {
      // Defensive: no bolt object — skip back to idle.
      scene.spellState = 'idle';
      scene.spellT = 0;
      scene.spellNextAt = rollSpellInterval();
    }
  }
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
    if ((state.mana || 0) < EVIL_TWIN_PRIMER_MANA) state.mana = EVIL_TWIN_PRIMER_MANA;
    scene.lives = EVIL_TWIN_INITIAL_LIVES;
    scene.ballsCollected = 0;
    scene.lastScore = state.score || 0;
    scene.delaySec = EVIL_TWIN_DELAY_INITIAL;
    scene.elapsed = 0;
    scene.invulnTimer = 0;
    scene.buffer = [];
    scene.spellState = 'idle';
    scene.spellT = 0;
    scene.spellNextAt = rollSpellInterval();
    scene.twinAim = null;
    scene.twinBolt = null;
    scene.stunT = 0;
    scene.scorches = [];
    pushSnapshot(scene, state);
    ensureSeedMines(state);
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
    scene.stunT = Math.max(0, (scene.stunT || 0) - dt);

    const twin = twinSnapshotAt(scene, scene.delaySec);
    const stunned = scene.stunT > 0;

    // Player's lightning bolt zaps the twin — stun for a couple of seconds,
    // burst red sparks at the twin's torso so the hit reads visually.
    if (twin && !stunned && state.lightningBolt) {
      const twinTorsoY = twin.feetY - STANDING_HEIGHT / 2;
      if (lightningStrikesPoint(state, twin.gx, twinTorsoY)) {
        scene.stunT = TWIN_STUN_DURATION;
        burstParticles(state, twin.gx, twinTorsoY, {
          count: 14,
          speedMax: 220,
          life: 0.45,
        });
        // Drop any in-flight twin spell so the player can also interrupt
        // an incoming bolt with a well-timed zap.
        scene.spellState = 'idle';
        scene.spellT = 0;
        scene.spellNextAt = rollSpellInterval();
        scene.twinAim = null;
        scene.twinBolt = null;
      }
    }

    if (twin && !stunned && twinHitsPlayer(state, twin)) {
      // Shield neutralises contact damage (parity with lava / meteor /
      // ice age / icicle). The cooldown still ticks so the player gets a
      // brief window to escape after the shield drops.
      if (scene.invulnTimer <= 0 && !isShielded(state)) {
        scene.lives = Math.max(0, (scene.lives || 0) - 1);
        scene.invulnTimer = EVIL_TWIN_HIT_COOLDOWN;
        if (scene.lives === 0) {
          state.gameOver = true;
          state.gvx = 0;
          state.gvy = 0;
        }
      }
    }

    if (!stunned) tickTwinSpell(state, scene, twin, dt);

    ageScorches(scene, dt);
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    const paused = state.overlayActive === false;
    const stunned = (scene.stunT || 0) > 0;
    const twin = twinSnapshotAt(scene, scene.delaySec);
    drawScorches(ctx, scene.scorches);
    if (!stunned) drawShadowTwin(ctx, twin, paused);
    if (scene.twinAim) drawTwinLightningAim(ctx, scene.twinAim);
    if (scene.twinBolt) drawTwinLightningBolt(ctx, scene.twinBolt);
    renderEvilTwinHud(ctx, scene, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};
