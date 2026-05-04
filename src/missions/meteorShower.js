import { effectiveHudHeight } from '../constants.js';
import { IS_LINUX } from '../platform-info.js';
import { torsoY } from '../poses.js';
import { resetPlayer } from '../physics.js';
import { hazardDt, isShielded, lightningStrikesPoint } from '../spells.js';
import {
  burstParticles, burstPlatformsBetween, missionTopY,
  renderGameOver, resetMissionBase, spawnXRange,
} from './_shared.js';

/**
 * "Dodge the meteor shower" mission.
 *
 * Meteors rain from the top of the terminal text area at a steady spawn
 * rate. Each meteor falls straight down, punching holes through any
 * platform top it crosses (same shape as a jump-burst hole), then keeps
 * going until it leaves the screen. A meteor that lands on the man ends
 * the run. Surviving the configured duration completes the mission.
 */

export const METEOR_DURATION = 30;           // seconds of survival needed
export const METEOR_SPAWN_INTERVAL = 0.55;   // seconds between spawns (base rate)
const METEOR_SPAWN_RAMP = 0.4;               // spawn interval shrinks to this fraction by duration end
const METEOR_FALL_SPEED = 360;               // px/sec downward velocity at spawn
const METEOR_ANGLED_CHANCE = 0.55;           // fraction of spawns that arrive at an angle
const METEOR_ANGLED_VX = 200;                // magnitude of horizontal drift for angled shots
const METEOR_BURST_CHANCE = 0.2;             // chance a spawn tick fires an extra meteor alongside
const METEOR_TARGETED_CHANCE = 0.5;          // fraction of spawns aimed at the man's current x
const METEOR_HOLE_W = 30;                    // width of hole punched through platforms
const METEOR_MAN_HIT_R = 18;                 // collision radius against the man
const METEOR_SPAWN_Y_MARGIN = 20;            // spawn this many px above textOffsetY

function spawnY(state) {
  return missionTopY(state) - METEOR_SPAWN_Y_MARGIN;
}

export const METEOR_SHOWER_MISSION = {
  id: 'dodge-meteors',
  text: 'Survive the meteor shower',
  subtitle: 'dodge the falling meteors — lightning vaporises them mid-air if you have mana',
  rewardTitle: 'meteor dodger',

  onEnter(state) {
    const scene = state.missionScene;
    scene.survivedTime = 0;
    scene.durationGoal = METEOR_DURATION;
    scene.meteors = [];
    scene.spawnTimer = 0;
    scene.survived = false;
    scene.requestRestart = false;
    state.gameOver = false;
    // Teleport to the prompt-box spawn so every run of the meteor shower
    // starts from the same familiar spot regardless of where the player
    // finished the previous mission.
    resetPlayer(state);
  },

  check(state) {
    return state.missionScene?.survived === true;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;

    // Flood the footer row: while this mission runs, the footer acts as
    // water so the man can't just drop down and sprint across it to dodge
    // meteors. Refreshed each tick because footerArea moves with terminal
    // scroll. Cleared when the mission transitions (progression.js).
    state.waterArea = state.footerArea || null;

    if (state.gameOver) return;
    if (scene.survived) return;

    scene.survivedTime += dt;
    if (scene.survivedTime >= scene.durationGoal) {
      scene.survived = true;
      return;
    }

    // Advance existing meteors first, then spawn this frame's new ones.
    // Spawning after the physics step means freshly-spawned meteors keep
    // their spawn y for one frame, so the trail starts at the top edge.
    const screenW = state.screenW || 9999;
    const screenH = state.screenH || 9999;
    // Stasis slows meteor motion (not the spawn cadence or the
    // mission timer) so the player can dodge through the rain.
    const hDt = hazardDt(state, dt);
    for (let i = scene.meteors.length - 1; i >= 0; i--) {
      const m = scene.meteors[i];
      const xBefore = m.x;
      const yBefore = m.y;
      m.x += (m.vx || 0) * hDt;
      m.y += m.vy * hDt;

      // Struck by a live lightning bolt? Vaporise cleanly — no platform
      // damage, no man damage, just sparks.
      if (lightningStrikesPoint(state, m.x, m.y)) {
        burstParticles(state, m.x, m.y);
        scene.meteors.splice(i, 1);
        continue;
      }

      burstPlatformsBetween(state, xBefore, yBefore, m.x, m.y, METEOR_HOLE_W,
        (cx, cy) => burstParticles(state, cx, cy));

      if (hitsMan(state, m)) {
        burstParticles(state, m.x, m.y);
        scene.meteors.splice(i, 1);
        if (isShielded(state)) continue;
        state.gameOver = true;
        state.gvx = 0;
        state.gvy = 0;
        return;
      }

      if (m.y > screenH || m.x < 0 || m.x > screenW) {
        scene.meteors.splice(i, 1);
      }
    }

    // Difficulty ramp: spawn interval shrinks linearly from the base rate
    // down to METEOR_SPAWN_RAMP * base as survivedTime approaches the
    // goal, so the final seconds rain meteors roughly twice as fast as
    // the opening seconds.
    const progress = Math.min(1, scene.survivedTime / scene.durationGoal);
    const interval = METEOR_SPAWN_INTERVAL * (1 - (1 - METEOR_SPAWN_RAMP) * progress);

    scene.spawnTimer += dt;
    while (scene.spawnTimer >= interval) {
      scene.spawnTimer -= interval;
      spawnMeteor(state, scene);
      if (Math.random() < METEOR_BURST_CHANCE) spawnMeteor(state, scene);
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;

    if (state.waterArea) renderWater(ctx, state.waterArea, scene.survivedTime || 0);

    const paused = state.overlayActive === false;
    ctx.save();
    ctx.globalAlpha = paused ? 0.25 : 1;
    for (const m of scene.meteors) renderMeteor(ctx, m);
    ctx.restore();

    renderCountdown(ctx, scene, W, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

function renderWater(ctx, rect, t) {
  ctx.save();
  const grad = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  grad.addColorStop(0, 'rgba(90, 170, 230, 0.45)');
  grad.addColorStop(1, 'rgba(40, 90, 160, 0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Animated wavy surface line. Two offset sines add a bit of texture
  // without needing per-particle foam.
  ctx.strokeStyle = 'rgba(210, 235, 255, 0.8)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  const steps = Math.max(2, Math.ceil(rect.w / 6));
  for (let i = 0; i <= steps; i++) {
    const x = rect.x + (rect.w * i) / steps;
    const local = x - rect.x;
    const y = rect.y
      + Math.sin(local / 24 + t * 2.2) * 1.4
      + Math.sin(local / 11 - t * 3.1) * 0.6;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function spawnMeteor(state, scene) {
  const { x0, x1 } = spawnXRange(state);
  const y = spawnY(state);
  const angled = Math.random() < METEOR_ANGLED_CHANCE;
  const targeted = Math.random() < METEOR_TARGETED_CHANCE && typeof state.gx === 'number';
  const vx = angled ? (Math.random() < 0.5 ? -METEOR_ANGLED_VX : METEOR_ANGLED_VX) : 0;

  let x;
  if (targeted) {
    // Aim the spawn so the meteor arrives at the man's current torso x.
    // For angled shots, offset the spawn x upstream by vx * fall-time so
    // the lateral drift carries it onto the target column.
    const t = (torsoY(state) - y) / METEOR_FALL_SPEED;
    x = state.gx - vx * t;
    if (x < x0) x = x0;
    if (x > x1) x = x1;
  } else {
    x = x0 + Math.random() * (x1 - x0);
  }

  scene.meteors.push({ x, y, vx, vy: METEOR_FALL_SPEED });
}

function hitsMan(state, m) {
  return Math.hypot(m.x - state.gx, m.y - torsoY(state)) < METEOR_MAN_HIT_R;
}

/**
 * Reset the meteor shower to a fresh run.
 */
export function restartMeteorShower(state) {
  resetMissionBase(state);
}

function renderMeteor(ctx, m) {
  // Trail points backward along the velocity vector so angled meteors
  // look like they come from a specific direction, not a fixed overhead.
  const vx = m.vx || 0;
  const vy = m.vy || 0;
  const speed = Math.hypot(vx, vy) || 1;
  const trailLen = 28;
  const tx = m.x - (vx / speed) * trailLen;
  const ty = m.y - (vy / speed) * trailLen;
  // Perpendicular offset for the triangle base.
  const px = -(vy / speed) * 5;
  const py = (vx / speed) * 5;

  ctx.save();
  const grad = ctx.createLinearGradient(tx, ty, m.x, m.y);
  grad.addColorStop(0, 'rgba(255, 180, 60, 0)');
  grad.addColorStop(1, 'rgba(255, 180, 60, 0.9)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(m.x + px, m.y + py);
  ctx.lineTo(tx, ty);
  ctx.lineTo(m.x - px, m.y - py);
  ctx.closePath();
  ctx.fill();

  // Glow: shadowBlur is GPU-accelerated on Apple/Chromium WebKit but
  // falls into a slow software path on WebKit2GTK (Linux), tanking the
  // meteor-shower framerate badly enough that movement visibly stutters.
  // Substitute a layered radial fill on Linux — looks similar, costs
  // an order of magnitude less.
  if (IS_LINUX) {
    const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 11);
    glow.addColorStop(0, 'rgba(255, 220, 140, 0.95)');
    glow.addColorStop(0.45, 'rgba(255, 160, 60, 0.55)');
    glow.addColorStop(1, 'rgba(255, 140, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgb(255, 220, 140)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.shadowColor = 'rgba(255, 140, 40, 0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgb(255, 220, 140)';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderCountdown(ctx, scene, W, screenW) {
  const remaining = Math.max(0, scene.durationGoal - scene.survivedTime);
  ctx.save();
  ctx.font = "bold 18px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.fillStyle = 'rgba(255, 220, 140, 0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  ctx.fillText(`${remaining.toFixed(1)}s`, W / 2, effectiveHudHeight(screenW) + 4);
  ctx.restore();
}

