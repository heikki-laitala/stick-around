import { JUMP_V } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';

/**
 * "Escape the rising lava" mission.
 *
 * Lava rises from the bottom of the overlay at a steady rate. Each time the
 * man's feet touch the lava surface:
 *   - with score > 0: loses one glowing ball, gets knocked upward, and
 *     becomes briefly invulnerable so a single dip can't drain the counter.
 *   - with score == 0: GAME OVER.
 *
 * Winning is reaching the door anchored on the topmost content platform near
 * the left edge. Door contact flips state.missionScene.reachedDoor and the
 * progression ladder advances on the same frame.
 *
 * `restartEscapeLava(state)` resets gameOver and wipes missionScene so the
 * next `advanceMission` tick re-enters the mission from scratch.
 */

const LAVA_RISE_RATE = 12;        // px/sec — tune for desired difficulty
const LAVA_HIT_COOLDOWN = 1.0;    // seconds of invulnerability after a hit
const LAVA_KNOCKBACK = JUMP_V * 1.2;
const DOOR_W = 36;
const DOOR_H = 56;
const PRIME_SCORE = 5;            // minimum balls the mission starts/restarts with

function topmostPlatform(platforms) {
  if (!platforms || platforms.length === 0) return null;
  let top = platforms[0];
  for (const p of platforms) {
    if (p.y < top.y) top = p;
  }
  return top;
}

function pickDoorPosition(state) {
  const top = topmostPlatform(state.platforms);
  if (!top) return { x: 30, y: 64 };
  // Anchor left but inset from the edge so the door is visibly framed.
  return { x: top.x + 20, y: top.y - DOOR_H };
}

export const ESCAPE_LAVA_MISSION = {
  id: 'escape-lava',
  text: 'Escape the rising lava to the door',
  rewardRank: 'master pauper',
  unlocks: ['lava-scorch'],

  onEnter(state) {
    const screenH = state.screenH || 600;
    const scene = state.missionScene;
    scene.lavaY = screenH + 40;   // starts just below the visible area
    scene.invulnTimer = 0;
    scene.reachedDoor = false;
    const door = pickDoorPosition(state);
    scene.doorX = door.x;
    scene.doorY = door.y;
    scene.doorW = DOOR_W;
    scene.doorH = DOOR_H;
    state.gameOver = false;
    if ((state.score || 0) < PRIME_SCORE) state.score = PRIME_SCORE;
  },

  check(state) {
    return state.missionScene?.reachedDoor === true;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
    if (state.gameOver) return;

    scene.lavaY -= LAVA_RISE_RATE * dt;
    if (scene.lavaY < 0) scene.lavaY = 0;
    scene.invulnTimer = Math.max(0, scene.invulnTimer - dt);

    // Win condition: man's torso overlaps the door rect.
    const torsoY = state.feetY - STANDING_HEIGHT / 2;
    if (state.gx >= scene.doorX && state.gx <= scene.doorX + scene.doorW &&
        torsoY >= scene.doorY && torsoY <= scene.doorY + scene.doorH) {
      scene.reachedDoor = true;
      return;
    }

    // Lava hit: the man's feet dipped below the lava surface.
    if (scene.invulnTimer <= 0 && state.feetY >= scene.lavaY) {
      if ((state.score || 0) <= 0) {
        state.gameOver = true;
        state.gvx = 0;
        state.gvy = 0;
        return;
      }
      state.score -= 1;
      scene.invulnTimer = LAVA_HIT_COOLDOWN;
      state.gvy = -LAVA_KNOCKBACK;
      state.grounded = false;
      if (state.particles) {
        for (let i = 0; i < 12; i++) {
          const a = -Math.PI + Math.random() * Math.PI;
          const sp = 40 + Math.random() * 80;
          state.particles.push({
            x: state.gx, y: scene.lavaY,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.5, maxLife: 0.5,
          });
        }
      }
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;

    renderLava(ctx, scene.lavaY, W, H);
    renderDoor(ctx, scene.doorX, scene.doorY, scene.doorW, scene.doorH);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

/**
 * Reset the lava mission to a fresh run. Clears gameOver and wipes the
 * scene so the next `advanceMission` tick fires onEnter again.
 */
export function restartEscapeLava(state) {
  state.gameOver = false;
  state.currentMissionId = null;
  state.missionScene = null;
}

function renderLava(ctx, top, W, H) {
  ctx.save();
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, 'rgba(255, 120, 40, 0.95)');
  g.addColorStop(0.5, 'rgba(220, 70, 20, 0.95)');
  g.addColorStop(1, 'rgba(120, 30, 10, 0.95)');
  ctx.fillStyle = g;

  const t = performance.now() / 300;
  const waveAt = (x) => 3 * Math.sin(x * 0.05 + t) + 2 * Math.sin(x * 0.12 - t * 1.3);

  ctx.beginPath();
  ctx.moveTo(0, top + waveAt(0));
  for (let x = 0; x <= W; x += 10) ctx.lineTo(x, top + waveAt(x));
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Bright molten rim along the surface.
  ctx.strokeStyle = 'rgba(255, 220, 120, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 10) {
    const y = top + waveAt(x);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function renderDoor(ctx, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(255, 220, 120, 0.55)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgb(85, 45, 20)';
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + h * 0.3);
  ctx.quadraticCurveTo(x + w / 2, y, x + w, y + h * 0.3);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();

  // Plank lines + handle (shadows off so they stay crisp).
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(40, 20, 10, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w / 3, y + h * 0.2);
  ctx.lineTo(x + w / 3, y + h);
  ctx.moveTo(x + (2 * w) / 3, y + h * 0.2);
  ctx.lineTo(x + (2 * w) / 3, y + h);
  ctx.stroke();

  ctx.fillStyle = 'rgb(230, 200, 110)';
  ctx.beginPath();
  ctx.arc(x + w - 8, y + h * 0.6, 2.5, 0, Math.PI * 2);
  ctx.fill();
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
