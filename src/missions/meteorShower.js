import { effectiveHudHeight } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';
import { isInHole } from '../platforms.js';
import { isShielded } from '../spells.js';

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
  const top = typeof state.textOffsetY === 'number' && state.textOffsetY > 0
    ? state.textOffsetY
    : effectiveHudHeight(state.screenW);
  return top - METEOR_SPAWN_Y_MARGIN;
}

function spawnXRange(state) {
  const x0 = typeof state.textOffsetX === 'number' ? state.textOffsetX : 0;
  const w = typeof state.textWidth === 'number' && state.textWidth > 0
    ? state.textWidth
    : (state.screenW || 800);
  return { x0, x1: x0 + w };
}

export const METEOR_SHOWER_MISSION = {
  id: 'dodge-meteors',
  text: 'Survive the meteor shower',
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
  },

  check(state) {
    return state.missionScene?.survived === true;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
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
    for (let i = scene.meteors.length - 1; i >= 0; i--) {
      const m = scene.meteors[i];
      const xBefore = m.x;
      const yBefore = m.y;
      m.x += (m.vx || 0) * dt;
      m.y += m.vy * dt;

      burstPlatformsBetween(state, xBefore, yBefore, m.x, m.y);

      if (hitsMan(state, m)) {
        spawnImpactParticles(state, m.x, m.y);
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
    const paused = state.overlayActive === false;
    ctx.save();
    ctx.globalAlpha = paused ? 0.25 : 1;
    for (const m of scene.meteors) renderMeteor(ctx, m);
    ctx.restore();

    renderCountdown(ctx, scene, W, state.screenW || W);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

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
    const torsoY = state.feetY - STANDING_HEIGHT / 2;
    const t = (torsoY - y) / METEOR_FALL_SPEED;
    x = state.gx - vx * t;
    if (x < x0) x = x0;
    if (x > x1) x = x1;
  } else {
    x = x0 + Math.random() * (x1 - x0);
  }

  scene.meteors.push({ x, y, vx, vy: METEOR_FALL_SPEED });
}

function burstPlatformsBetween(state, xBefore, yBefore, xAfter, yAfter) {
  if (!state.platforms || !state.holes) return;
  const dy = yAfter - yBefore;
  for (const p of state.platforms) {
    if (!p || p.x == null) continue;
    if (yBefore > p.y || yAfter < p.y) continue;
    // Linear interpolation of x at the y = p.y crossing. For straight-down
    // meteors dy > 0 and the crossing is well-defined; the dy === 0 branch
    // just falls back to the start x.
    const t = dy !== 0 ? (p.y - yBefore) / dy : 0;
    const crossX = xBefore + (xAfter - xBefore) * t;
    if (crossX < p.x || crossX > p.x + p.w) continue;
    if (isInHole(state.holes, crossX, p.y)) continue;
    state.holes.push({ x: crossX - METEOR_HOLE_W / 2, y: p.y, w: METEOR_HOLE_W, age: 0 });
    spawnImpactParticles(state, crossX, p.y);
  }
}

function hitsMan(state, m) {
  const torsoY = state.feetY - STANDING_HEIGHT / 2;
  return Math.hypot(m.x - state.gx, m.y - torsoY) < METEOR_MAN_HIT_R;
}

function spawnImpactParticles(state, x, y) {
  if (!state.particles) return;
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 120;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4, maxLife: 0.4,
    });
  }
}

/**
 * Reset the meteor shower to a fresh run.
 */
export function restartMeteorShower(state) {
  state.gameOver = false;
  state.currentMissionId = null;
  state.missionScene = null;
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

  ctx.shadowColor = 'rgba(255, 140, 40, 0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgb(255, 220, 140)';
  ctx.beginPath();
  ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
  ctx.fill();
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

function renderGameOver(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255, 220, 120, 0.98)';
  ctx.font = "bold 48px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 16);
  ctx.font = "16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.fillStyle = 'rgba(255, 220, 120, 0.75)';
  ctx.fillText('press R to try again', W / 2, H / 2 + 20);
  ctx.restore();
}
