import { GRAV, HUD_HEIGHT, JUMP_V } from '../constants.js';
import { STANDING_HEIGHT } from '../poses.js';

/**
 * "Escape the rising lava" mission.
 *
 * Lava rises from the bottom of the overlay at a steady rate. The man can
 * stand on the lava surface — he ends up half-submerged and can jump off
 * it to reach higher platforms. Each tick spent with feet in the lava
 * costs one glowing ball (rate-limited by LAVA_HIT_COOLDOWN); a tick
 * fired with zero balls left = GAME OVER.
 *
 * The door is a physics object. It anchors to the topmost identifiable
 * platform at mission start and rides it as the terminal scrolls. If that
 * platform vanishes (line edited away, scrolled off), the door detaches
 * and falls under gravity until it lands on another platform. Hitting
 * lava or falling off-screen requests a mission restart.
 *
 * Win conditions:
 *   - torso overlaps the door rect while it's at rest (normal).
 *   - door lands on the very platform the player is standing on
 *     ("lava lucky" — the door delivers itself to the hero).
 *
 * `restartEscapeLava(state)` resets gameOver and wipes missionScene so the
 * next `advanceMission` tick re-enters the mission from scratch.
 */

const LAVA_RISE_RATE = 7;         // px/sec — tune for desired difficulty
const LAVA_HIT_COOLDOWN = 1.0;    // seconds between burn ticks while in lava
const LAVA_SUBMERGE = STANDING_HEIGHT / 2; // depth the man sinks into the lava surface
const LAVA_JUMP_CLEARANCE = 40;   // extra rise above lava surface on boosted jump
const DOOR_W = 20;
const DOOR_H = 32;
const PRIME_SCORE = 5;            // minimum balls the mission starts/restarts with
const DOOR_INSET_X = 20;          // horizontal offset from anchor platform's left edge

function trackable(p) {
  // hash 0 is "unidentifiable" (used for platforms without a stable line
  // hash); 0xFFFF is the prompt-top border, which we also trust as stable.
  return !!p && typeof p.hash === 'number' && p.hash !== 0;
}

// Door must sit fully inside the terminal text area — below the HUD AND
// below the terminal title bar. state.textOffsetY is the top of the text
// area (the title sits above it). Fall back to HUD_HEIGHT if we don't
// have the terminal metrics yet.
function minDoorTop(state) {
  const y = state?.textOffsetY;
  return typeof y === 'number' && y > 0 ? y : HUD_HEIGHT;
}

function canHostDoor(p, state, doorH) {
  return p.y >= minDoorTop(state) + doorH;
}

function topmostTrackablePlatform(platforms, state, doorH) {
  if (!platforms) return null;
  let top = null;
  for (const p of platforms) {
    if (!trackable(p)) continue;
    if (!canHostDoor(p, state, doorH)) continue;
    if (!top || p.y < top.y) top = p;
  }
  return top;
}

function findPlatformByHash(platforms, hash) {
  if (!platforms || hash == null) return null;
  for (const p of platforms) if (p.hash === hash) return p;
  return null;
}

function horizontallyOverlaps(doorX, doorW, p) {
  return doorX < p.x + p.w && doorX + doorW > p.x;
}

export const ESCAPE_LAVA_MISSION = {
  id: 'escape-lava',
  text: 'Escape the rising lava to the door',
  rewardRank: 'master pauper',
  unlocks: ['lava-scorch'],

  onEnter(state) {
    const screenH = state.screenH || 600;
    const scene = state.missionScene;
    scene.lavaY = screenH + 40;
    scene.invulnTimer = 0;
    scene.reachedDoor = false;
    scene.requestRestart = false;
    scene.luckyBestowed = false;
    scene.wasOnLava = false;
    scene.doorW = DOOR_W;
    scene.doorH = DOOR_H;
    scene.doorVy = 0;

    const anchor = topmostTrackablePlatform(state.platforms, state, DOOR_H);
    if (anchor) {
      scene.doorX = anchor.x + DOOR_INSET_X;
      scene.doorY = anchor.y - DOOR_H;
      scene.doorAnchorHash = anchor.hash;
      scene.doorAnchorOffsetX = DOOR_INSET_X;
    } else {
      // Nothing to anchor to — float just inside the terminal text area and
      // let the physics step on the next frame pull the door down until
      // something catches it.
      scene.doorX = 30;
      scene.doorY = minDoorTop(state) + 4;
      scene.doorAnchorHash = null;
      scene.doorAnchorOffsetX = 0;
    }

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

    updateDoorPhysics(state, scene, dt);
    if (scene.requestRestart) return;

    // Win condition: man's torso overlaps the door rect.
    const torsoY = state.feetY - STANDING_HEIGHT / 2;
    if (state.gx >= scene.doorX && state.gx <= scene.doorX + scene.doorW &&
        torsoY >= scene.doorY && torsoY <= scene.doorY + scene.doorH) {
      scene.reachedDoor = true;
      return;
    }

    // Lava surface acts as a burning platform. Park the man half-submerged
    // so the upper body stays visible and he can jump off to escape.
    // Skip the clamp when he's rising (gvy<0) so jumps aren't re-grounded.
    const onLavaFalling = state.feetY >= scene.lavaY && state.gvy >= 0;
    if (onLavaFalling) {
      state.feetY = scene.lavaY + LAVA_SUBMERGE;
      state.gvy = 0;
      state.grounded = true;
      state.standingHash = 0;

      if (scene.invulnTimer <= 0) {
        if ((state.score || 0) <= 0) {
          state.gameOver = true;
          state.gvx = 0;
          state.gvy = 0;
          return;
        }
        state.score -= 1;
        scene.invulnTimer = LAVA_HIT_COOLDOWN;
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
    }

    // Lava launch boost: if the man was parked on lava last frame and has
    // just jumped (gvy<0 this frame), override the normal JUMP_V with a
    // distance-based velocity that clears the lava surface by
    // LAVA_JUMP_CLEARANCE — same formula as the footer escape jump.
    if (scene.wasOnLava && !onLavaFalling && state.gvy < 0) {
      const dist = (state.feetY - scene.lavaY) + LAVA_JUMP_CLEARANCE;
      state.gvy = -Math.max(JUMP_V, Math.sqrt(2 * GRAV * dist));
    }
    scene.wasOnLava = onLavaFalling;
  },

  render(ctx, state, W, H) {
    const scene = state.missionScene;
    if (!scene) return;

    // While the overlay is deactivated (Escape pressed to return focus to
    // the terminal), fade the lava way down so the user can read terminal
    // content through it. The mission is also paused in main.js, so the
    // faded lava isn't a live hazard.
    const paused = state.overlayActive === false;
    ctx.save();
    ctx.globalAlpha = paused ? 0.2 : 1;
    renderLava(ctx, scene.lavaY, W, H);
    ctx.restore();

    renderDoor(ctx, scene.doorX, scene.doorY, scene.doorW, scene.doorH);
    if (state.gameOver) renderGameOver(ctx, W, H);
  },
};

function updateDoorPhysics(state, scene, dt) {
  if (scene.doorAnchorHash != null) {
    const anchor = findPlatformByHash(state.platforms, scene.doorAnchorHash);
    if (anchor) {
      scene.doorX = anchor.x + scene.doorAnchorOffsetX;
      scene.doorY = anchor.y - scene.doorH;
      scene.doorVy = 0;
      return;
    }
    // Anchor gone — detach, start falling from wherever we were.
    scene.doorAnchorHash = null;
    scene.doorVy = 0;
  }

  // Free-fall.
  scene.doorVy += GRAV * dt;
  const bottomBefore = scene.doorY + scene.doorH;
  scene.doorY += scene.doorVy * dt;
  const bottomAfter = scene.doorY + scene.doorH;

  // Into lava — unrecoverable; mission must restart.
  if (bottomAfter >= scene.lavaY) {
    scene.requestRestart = true;
    return;
  }
  // Off the bottom of the screen with nothing catching it.
  const screenH = state.screenH || 9999;
  if (scene.doorY > screenH) {
    scene.requestRestart = true;
    return;
  }

  // Collide with the highest platform whose top edge was crossed this step.
  // Skip platforms that would push the door above the terminal text area —
  // keep falling until we find a platform low enough to host a fully
  // visible door.
  let landing = null;
  for (const p of state.platforms || []) {
    if (!horizontallyOverlaps(scene.doorX, scene.doorW, p)) continue;
    if (!canHostDoor(p, state, scene.doorH)) continue;
    if (bottomBefore <= p.y && bottomAfter >= p.y) {
      if (!landing || p.y < landing.y) landing = p;
    }
  }
  if (landing) {
    scene.doorY = landing.y - scene.doorH;
    scene.doorVy = 0;
    if (trackable(landing)) {
      scene.doorAnchorHash = landing.hash;
      scene.doorAnchorOffsetX = scene.doorX - landing.x;
    } else {
      scene.doorAnchorHash = null; // not a stable identity — will fall again next frame
    }
    // "Lava lucky": the door touched down on the player's own platform.
    if (
      state.grounded &&
      state.standingHash &&
      landing.hash === state.standingHash &&
      !scene.luckyBestowed
    ) {
      scene.luckyBestowed = true;
      if (!state.titles) state.titles = [];
      if (!state.titles.includes('lava lucky')) state.titles.push('lava lucky');
      scene.reachedDoor = true;
    }
  }
}

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
