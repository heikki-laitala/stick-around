import { torsoY } from '../poses.js';
import { hazardDt, isShielded, lightningStrikesPoint } from '../spells.js';
import {
  burstParticles, burstPlatformsBetween, missionTopY,
  renderGameOver, resetMissionBase, spawnXRange,
} from './_shared.js';

/**
 * "Practice your spells" warm-up mission.
 *
 * A single ball drops from above the play area, bouncing perfectly
 * elastically off the four edges of the terminal text region. As it
 * travels it punches holes through any platform it crosses (same shape
 * as a meteor's trail). The player has to:
 *
 *   1. lightning  — hold `2`, sweep with arrows, release to zap the ball.
 *                   Three clean hits ends the mission.
 *   2. shield     — tap `1` to raise the dome when the ball is about to
 *                   ram the man. A shielded hit deflects the ball; an
 *                   unshielded hit ends the run.
 *   3. stasis     — hold `3` to slow the ball's motion via hazardDt, so
 *                   aiming lightning or moving into shield position is
 *                   easier on a fast pass.
 *
 * Mana is pre-primed to PRIME_MANA at entry so all three spells are
 * available without a separate mining detour.
 */

// Generous: enough for a few lightning fumbles, a couple of shield
// raises, and some stasis stalling without the player ever running dry.
export const SPELL_WARMUP_PRIME_MANA = 40;
const BALL_RADIUS = 14;
const BALL_HIT_RADIUS_PLAYER = 22;     // collision against the man's torso
const BALL_GRAVITY = 720;              // px/s^2 — close to the player's so arcs feel snappy
const BALL_INITIAL_VX = 320;           // tuned by feel — slow enough to track, fast enough to miss
const BALL_HOLE_W = 30;                // matches METEOR_HOLE_W so visual continuity holds
const BALL_INVULN = 0.4;               // s — post-zap window where lightning can't double-count
const BALL_HITS_TO_WIN = 3;
const BALL_SPAWN_DELAY = 0.6;          // s before the ball first appears, so the toast is readable
const BALL_SHIELD_BOUNCE_VY = -360;    // upward kick when a shielded man deflects the ball
const BALL_SHIELD_BOUNCE_VX = 280;     // horizontal kick away from the man on a shield deflect

function spawnBall(state) {
  const { x0, x1 } = spawnXRange(state);
  const top = missionTopY(state);
  // Spawn at a horizontal position offset from the man so the first
  // descent isn't a guaranteed bullseye.
  const margin = 60;
  const lo = x0 + margin;
  const hi = x1 - margin;
  const target = state.gx;
  // Pick a side opposite the man if there's room; otherwise center.
  const x = hi - lo > 200
    ? (target < (lo + hi) / 2 ? hi : lo)
    : (lo + hi) / 2;
  const vx = x > target ? -BALL_INITIAL_VX : BALL_INITIAL_VX;
  return {
    x,
    y: top + 8,
    vx,
    vy: 0,
    hits: 0,
    invulnT: 0,
  };
}

export const SPELL_WARMUP_MISSION = {
  id: 'spell-warmup',
  text: 'Practice your spells',
  subtitle: 'a falling ball — zap it 3x with lightning, shield to survive, stasis to slow',

  onEnter(state) {
    const scene = state.missionScene;
    state.gameOver = false;
    if ((state.mana || 0) < SPELL_WARMUP_PRIME_MANA) {
      state.mana = SPELL_WARMUP_PRIME_MANA;
    }
    scene.ball = null;
    scene.spawnT = BALL_SPAWN_DELAY;
    scene.done = false;
  },

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    const hits = scene.ball?.hits ?? 0;
    return `(${Math.min(BALL_HITS_TO_WIN, hits)}/${BALL_HITS_TO_WIN} zaps)`;
  },

  check(state) {
    return state.missionScene?.done === true;
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;
    if (state.gameOver) return;
    if (scene.done) return;

    if (!scene.ball) {
      scene.spawnT = (scene.spawnT || 0) - dt;
      if (scene.spawnT <= 0) scene.ball = spawnBall(state);
      return;
    }

    const b = scene.ball;
    const hDt = hazardDt(state, dt);
    if (b.invulnT > 0) b.invulnT = Math.max(0, b.invulnT - dt);

    // Integrate motion. Stasis scales both gravity and existing velocity
    // through hDt so a slowed ball loses speed believably.
    b.vy += BALL_GRAVITY * hDt;
    const xBefore = b.x;
    const yBefore = b.y;
    b.x += b.vx * hDt;
    b.y += b.vy * hDt;

    // Bounce off the four edges of the terminal text area. Perfectly
    // elastic — the mission ends on a lightning hit, not a stalled ball.
    const { x0, x1 } = spawnXRange(state);
    const yTop = missionTopY(state);
    const yBot = (state.screenH || 600) - 8;
    if (b.x - BALL_RADIUS < x0) {
      b.x = x0 + BALL_RADIUS;
      b.vx = Math.abs(b.vx);
    } else if (b.x + BALL_RADIUS > x1) {
      b.x = x1 - BALL_RADIUS;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y - BALL_RADIUS < yTop) {
      b.y = yTop + BALL_RADIUS;
      b.vy = Math.abs(b.vy);
    } else if (b.y + BALL_RADIUS > yBot) {
      b.y = yBot - BALL_RADIUS;
      b.vy = -Math.abs(b.vy);
    }

    // Punch holes through any platform tops crossed during this step.
    burstPlatformsBetween(state, xBefore, yBefore, b.x, b.y, BALL_HOLE_W,
      (cx, cy) => burstParticles(state, cx, cy, {
        count: 8, speedMin: 50, speedMax: 160, life: 0.35,
      }));

    // Lightning hit — increment counter, brief invuln window so a single
    // bolt's lifetime can't tick three hits in three frames.
    if (b.invulnT === 0 && lightningStrikesPoint(state, b.x, b.y)) {
      b.hits += 1;
      b.invulnT = BALL_INVULN;
      burstParticles(state, b.x, b.y, {
        count: 16, speedMin: 80, speedMax: 240, life: 0.45,
      });
      if (b.hits >= BALL_HITS_TO_WIN) {
        scene.ball = null;
        scene.done = true;
        return;
      }
    }

    // Player contact. Shield deflects (kick the ball up and away);
    // unshielded contact ends the run.
    if (Math.hypot(b.x - state.gx, b.y - torsoY(state)) < BALL_HIT_RADIUS_PLAYER) {
      if (isShielded(state)) {
        const dir = b.x >= state.gx ? 1 : -1;
        b.vx = dir * BALL_SHIELD_BOUNCE_VX;
        b.vy = BALL_SHIELD_BOUNCE_VY;
        // Nudge the ball outside the hit radius so the next frame
        // doesn't immediately re-trigger the deflect.
        b.x = state.gx + dir * (BALL_HIT_RADIUS_PLAYER + BALL_RADIUS + 1);
        burstParticles(state, b.x, b.y, {
          count: 12, speedMin: 80, speedMax: 200, life: 0.35,
        });
      } else {
        burstParticles(state, b.x, b.y, {
          count: 18, speedMin: 100, speedMax: 260, life: 0.5,
        });
        state.gameOver = true;
        state.gvx = 0;
        state.gvy = 0;
      }
    }
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;
    if (scene.ball) drawBall(ctx, scene.ball);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

export function restartSpellWarmup(state) {
  resetMissionBase(state);
}

// ── Render helpers ────────────────────────────────────────────────────

function drawBall(ctx, b) {
  ctx.save();
  // Brief flash while invulnerable so the player can see the hit
  // landed and the next zap won't register yet.
  const flash = b.invulnT > 0 ? 0.55 + 0.45 * (b.invulnT / BALL_INVULN) : 0;
  ctx.shadowColor = 'rgba(255, 200, 90, 0.85)';
  ctx.shadowBlur = 14;
  const grad = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, BALL_RADIUS);
  grad.addColorStop(0, 'rgba(255, 250, 220, 0.98)');
  grad.addColorStop(0.55, 'rgba(255, 180, 80, 0.95)');
  grad.addColorStop(1, 'rgba(190, 80, 40, 0.85)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_RADIUS * 0.65, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
