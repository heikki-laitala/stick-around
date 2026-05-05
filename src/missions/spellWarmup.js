import { torsoY } from '../poses.js';
import { hazardDt, isShielded, lightningStrikesPoint } from '../spells.js';
import { burstParticles, missionTopY, resetMissionBase } from './_shared.js';

/**
 * "Practice your spells" warm-up mission.
 *
 * A short tutorial that runs the player through each spell in turn so
 * they walk into the variable mission tail knowing the keys exist:
 *
 *   1. lightning  — a fixed crystal target hangs above the spawn area;
 *                   player has to hold `2`, sweep with arrows, release.
 *   2. shield     — a telegraphed fireball loops in toward the man at
 *                   torso height; raising the dome (`1`) absorbs it.
 *   3. stasis     — a fast shard drops at the man's column; engaging
 *                   stasis (`3`) slows it enough to step aside.
 *
 * The mission is FORGIVING — missing a phase doesn't fail the run; the
 * relevant target/projectile just respawns and the player tries again.
 * Mana is pre-primed to PRIME_MANA at entry so none of the three
 * exercises gates on a separate mining trip.
 *
 * Each phase exposes its own `subtitle` style hint via the renderer so
 * the player always knows what the current step is asking for.
 */

export const SPELL_WARMUP_PRIME_MANA = 12;
const CRYSTAL_RADIUS = 12;
const CRYSTAL_ABOVE = 110;             // px above the player's spawn feet
const FIREBALL_SPEED = 240;
const FIREBALL_RADIUS = 12;
const FIREBALL_HIT_RADIUS = 22;        // collision against the player torso
const FIREBALL_TELEGRAPH = 0.7;        // s — dotted line warning before launch
const FIREBALL_RESPAWN_DELAY = 0.6;
const SHARD_RADIUS = 9;
const SHARD_FALL_SPEED = 360;
const SHARD_DODGE_PX = 36;             // horizontal distance from shard to count as dodged
const SHARD_RESPAWN_DELAY = 0.5;
const SHARD_SPAWN_ABOVE = 80;          // px above missionTopY for the shard's spawn

function spawnCrystal(state) {
  const cx = state.gx;
  const top = missionTopY(state);
  const cy = Math.max(top + 30, state.feetY - CRYSTAL_ABOVE);
  return { x: cx, y: cy, zapped: false };
}

function spawnFireball(state) {
  // Pick a side opposite the player so the bolt sweeps toward them.
  const fromLeft = state.gx > (state.screenW || 800) / 2;
  const x = fromLeft ? -30 : (state.screenW || 800) + 30;
  const vx = fromLeft ? FIREBALL_SPEED : -FIREBALL_SPEED;
  const y = torsoY(state);
  return { x, y, vx, age: 0, telegraphed: false };
}

function spawnShard(state) {
  return { x: state.gx, y: missionTopY(state) - SHARD_SPAWN_ABOVE, vy: SHARD_FALL_SPEED };
}

function intersectsPlayer(state, p, radius) {
  return Math.hypot(p.x - state.gx, p.y - torsoY(state)) < radius;
}

function setPhase(state, phase) {
  const scene = state.missionScene;
  if (!scene) return;
  scene.phase = phase;
  // Refresh the entry-banner hint each time the phase advances so the
  // player gets a clear subtitle for the next exercise.
  state.missionToast = {
    age: 0,
    text: phaseTitle(phase),
    subtitle: phaseSubtitle(phase),
  };
}

function phaseTitle(phase) {
  if (phase === 'lightning') return 'Lightning practice';
  if (phase === 'shield') return 'Shield practice';
  if (phase === 'stasis') return 'Stasis practice';
  return 'Practice complete';
}

function phaseSubtitle(phase) {
  if (phase === 'lightning') return 'hold 2 to aim, release to fire — zap the crystal above';
  if (phase === 'shield') return 'tap 1 to raise the shield — block the incoming fireball';
  if (phase === 'stasis') return 'hold 3 to slow time — step aside as the shard falls';
  return null;
}

export const SPELL_WARMUP_MISSION = {
  id: 'spell-warmup',
  text: 'Practice your spells',
  subtitle: 'a short workout for shield, lightning, and stasis',

  onEnter(state) {
    const scene = state.missionScene;
    state.gameOver = false;
    if ((state.mana || 0) < SPELL_WARMUP_PRIME_MANA) {
      state.mana = SPELL_WARMUP_PRIME_MANA;
    }
    scene.phase = 'lightning';
    scene.crystal = spawnCrystal(state);
    scene.fireball = null;
    scene.shieldedHits = 0;
    scene.fireballRespawnT = 0;
    scene.shard = null;
    scene.shardDodged = false;
    scene.shardRespawnT = 0;
  },

  questSuffix(state) {
    const scene = state.missionScene;
    if (!scene) return '';
    if (scene.phase === 'lightning') return '(1/3 lightning)';
    if (scene.phase === 'shield') return '(2/3 shield)';
    if (scene.phase === 'stasis') return '(3/3 stasis)';
    return '';
  },

  check(state) {
    return state.missionScene?.phase === 'done';
  },

  update(state, dt) {
    const scene = state.missionScene;
    if (!scene) return;

    if (scene.phase === 'lightning') {
      // Once a bolt overlaps the crystal, mark zapped (the crystal
      // disappears in render). Advance once it's marked.
      if (scene.crystal && !scene.crystal.zapped && state.lightningBolt) {
        if (lightningStrikesPoint(state, scene.crystal.x, scene.crystal.y)) {
          scene.crystal.zapped = true;
          burstParticles(state, scene.crystal.x, scene.crystal.y, {
            count: 14, speedMin: 60, speedMax: 200, life: 0.4,
          });
        }
      }
      if (scene.crystal?.zapped) {
        setPhase(state, 'shield');
        scene.fireballRespawnT = 0;
      }
      return;
    }

    if (scene.phase === 'shield') {
      if (!scene.fireball) {
        scene.fireballRespawnT = (scene.fireballRespawnT || 0) - dt;
        if (scene.fireballRespawnT <= 0) scene.fireball = spawnFireball(state);
      } else {
        const f = scene.fireball;
        f.age += dt;
        // Telegraph window — fireball doesn't move yet.
        if (f.age >= FIREBALL_TELEGRAPH) {
          // Hazard motion respects stasis even on the warmup, so an
          // overzealous player can practice stacking spells if they
          // want.
          f.x += f.vx * hazardDt(state, dt);
        }
        if (intersectsPlayer(state, f, FIREBALL_HIT_RADIUS)) {
          if (isShielded(state)) {
            scene.shieldedHits = (scene.shieldedHits || 0) + 1;
            burstParticles(state, f.x, f.y, {
              count: 12, speedMin: 80, speedMax: 200, life: 0.35,
            });
            scene.fireball = null;
            scene.fireballRespawnT = FIREBALL_RESPAWN_DELAY;
          } else {
            // No shield — the fireball passes harmlessly (warmup is
            // forgiving) but still despawns and respawns after a beat
            // so the player gets another try without standing around.
            scene.fireball = null;
            scene.fireballRespawnT = FIREBALL_RESPAWN_DELAY;
          }
        } else if (f.x < -60 || f.x > (state.screenW || 800) + 60) {
          // Flew past — also a "miss"; reset and try again.
          scene.fireball = null;
          scene.fireballRespawnT = FIREBALL_RESPAWN_DELAY;
        }
      }
      if ((scene.shieldedHits || 0) >= 1) {
        setPhase(state, 'stasis');
      }
      return;
    }

    if (scene.phase === 'stasis') {
      if (!scene.shard) {
        scene.shardRespawnT = (scene.shardRespawnT || 0) - dt;
        if (scene.shardRespawnT <= 0) scene.shard = spawnShard(state);
      } else {
        const sh = scene.shard;
        sh.y += sh.vy * hazardDt(state, dt);
        const dodged = Math.abs(state.gx - sh.x) > SHARD_DODGE_PX;
        if (sh.y > torsoY(state)) {
          if (dodged) {
            scene.shardDodged = true;
            scene.shard = null;
          } else if (sh.y > (state.screenH || 600) + 30) {
            // Hit/passed without dodging — respawn for another try.
            scene.shard = null;
            scene.shardRespawnT = SHARD_RESPAWN_DELAY;
          }
        }
      }
      if (scene.shardDodged) {
        setPhase(state, 'done');
      }
    }
  },

  render(ctx, state) {
    const scene = state.missionScene;
    if (!scene) return;
    const now = performance.now() / 1000;
    if (scene.crystal && !scene.crystal.zapped) {
      drawCrystal(ctx, scene.crystal.x, scene.crystal.y, now);
    }
    if (scene.fireball) {
      const launching = scene.fireball.age < FIREBALL_TELEGRAPH;
      drawFireball(ctx, scene.fireball, launching, state);
    }
    if (scene.shard) {
      drawShard(ctx, scene.shard.x, scene.shard.y);
    }
  },
};

export function restartSpellWarmup(state) {
  resetMissionBase(state);
}

// ── Render helpers ────────────────────────────────────────────────────

function drawCrystal(ctx, x, y, now) {
  const r = CRYSTAL_RADIUS;
  const pulse = 1 + 0.12 * Math.sin(now * 5);
  ctx.save();
  ctx.shadowColor = 'rgba(180, 220, 255, 0.85)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(220, 240, 255, 0.95)';
  ctx.beginPath();
  // Diamond shape — clearly a "lightning target", not a collectible.
  ctx.moveTo(x, y - r * pulse);
  ctx.lineTo(x + r * 0.7, y);
  ctx.lineTo(x, y + r * pulse);
  ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawFireball(ctx, f, launching, state) {
  ctx.save();
  if (launching) {
    // Telegraph: dashed red line from fireball's spawn point toward
    // the player so the lane is readable before motion starts.
    ctx.strokeStyle = 'rgba(255, 100, 80, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(state.gx, f.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Fireball body — orange-red sphere with a glowing core.
  ctx.shadowColor = 'rgba(255, 120, 40, 0.85)';
  ctx.shadowBlur = 12;
  const grad = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, FIREBALL_RADIUS);
  grad.addColorStop(0, 'rgba(255, 245, 200, 0.95)');
  grad.addColorStop(0.5, 'rgba(255, 150, 60, 0.95)');
  grad.addColorStop(1, 'rgba(180, 50, 30, 0.85)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(f.x, f.y, FIREBALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShard(ctx, x, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(150, 100, 255, 0.7)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(220, 200, 255, 0.95)';
  ctx.strokeStyle = 'rgba(140, 100, 220, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - SHARD_RADIUS);
  ctx.lineTo(x + SHARD_RADIUS * 0.55, y);
  ctx.lineTo(x, y + SHARD_RADIUS);
  ctx.lineTo(x - SHARD_RADIUS * 0.55, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
