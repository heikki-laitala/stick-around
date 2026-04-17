import { GRAV, JUMP_V, ACCEL, FRIC, MAXV, ROPE_AIM_SPEED, ROPE_FLY_SPEED, ROPE_MAX_LEN, SWING_GRAVITY, SWING_PUMP, SWING_DAMPING, SWING_DAMPING_END, SWING_ANCHOR_DECAY_TIME, SWING_PUMP_FLOOR, AXE_SWING_DURATION, AXE_HIT_FRAME, AXE_REACH, AXE_HIT_RADIUS, MANA_PER_MINE } from './constants.js';
import { lerpPose, IDLE, WALK, JUMP_RISE, JUMP_FALL, LAND, CROUCH, CROUCH_WALK, PRONE, PRONE_CRAWL, SCALE, STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT } from './poses.js';
import { findFloor, findCeiling } from './platforms.js';

/**
 * Update rope state (aiming, flying, swinging).
 * Mutates state.rope, state.gx, state.feetY, state.gvy, state.gvx, state.grounded, state.standingHash.
 */
export function updateRope(state, dt, keys) {
  if (state.ropeCooldown > 0) state.ropeCooldown -= dt;

  if (!state.rope) return;

  if (state.rope.state === 'aiming') {
    if (keys.has('ArrowUp') || keys.has('KeyW')) state.rope.angle -= ROPE_AIM_SPEED * dt;
    if (keys.has('ArrowDown') || keys.has('KeyS')) state.rope.angle += ROPE_AIM_SPEED * dt;
    state.rope.angle = Math.max(-Math.PI * 0.95, Math.min(-Math.PI * 0.05, state.rope.angle));
    state.ropeAngle = state.rope.angle;
  } else if (state.rope.state === 'flying') {
    state.rope.tipX += Math.cos(state.rope.angle) * ROPE_FLY_SPEED * dt;
    state.rope.tipY += Math.sin(state.rope.angle) * ROPE_FLY_SPEED * dt;

    // Check collision with platforms
    let hit = null;
    for (const p of state.platforms) {
      if (state.rope.tipX >= p.x && state.rope.tipX <= p.x + p.w &&
          state.rope.tipY >= p.y && state.rope.tipY <= p.y + state.lineHeight) {
        hit = p;
        break;
      }
    }

    if (hit) {
      state.rope.state = 'swinging';
      state.rope.hitX = state.rope.tipX;
      state.rope.hitY = hit.y;
      state.rope.anchorHash = hit.hash;
      state.rope.ropeLen = Math.max(20, Math.hypot(state.gx - state.rope.hitX, state.feetY - state.rope.hitY));
      state.rope.swingAngle = Math.atan2(state.gx - state.rope.hitX, state.feetY - state.rope.hitY);
      state.rope.swingVel = (state.gvx * Math.cos(state.rope.swingAngle)) / state.rope.ropeLen;
      state.rope.swingTime = 0;
      state.rope.startPlatY = state.feetY;
      state.rope.startPlatHash = state.standingHash;
      state.grounded = false;
      state.standingHash = 0;
    }

    // Cancel if off screen or exceeds max length
    if (state.rope &&
        (state.rope.tipX < 0 || state.rope.tipX > (state.screenW || 800) ||
         state.rope.tipY < 0 || state.rope.tipY > (state.screenH || 600) ||
         Math.hypot(state.rope.tipX - state.gx, state.rope.tipY - state.feetY) > ROPE_MAX_LEN)) {
      state.rope = null;
    }
  } else if (state.rope.state === 'swinging') {
    const gravAcc = -(SWING_GRAVITY / state.rope.ropeLen) * Math.sin(state.rope.swingAngle);
    state.rope.swingVel += gravAcc * dt;

    // Anchor fatigue: the longer the player stays on one anchor, the more the
    // swing decays and the less the pump can feed energy back in.
    const decayT = Math.min(1, state.rope.swingTime / SWING_ANCHOR_DECAY_TIME);
    const effectiveDamping = SWING_DAMPING + (SWING_DAMPING_END - SWING_DAMPING) * decayT;
    const pumpFade = 1 + (SWING_PUMP_FLOOR - 1) * decayT;

    // Pump strength scales inversely with rope length (longer rope = harder to pump)
    const pumpScale = Math.min(1, 120 / state.rope.ropeLen);
    const pump = SWING_PUMP * pumpScale * pumpFade;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) state.rope.swingVel -= pump * dt;
    if (keys.has('KeyD') || keys.has('ArrowRight')) state.rope.swingVel += pump * dt;

    const CLIMB_SPEED = 80;
    const MIN_ROPE_LEN = 20;
    if (keys.has('KeyW') || keys.has('ArrowUp')) state.rope.ropeLen = Math.max(MIN_ROPE_LEN, state.rope.ropeLen - CLIMB_SPEED * dt);
    if (keys.has('KeyS') || keys.has('ArrowDown')) state.rope.ropeLen = Math.min(ROPE_MAX_LEN, state.rope.ropeLen + CLIMB_SPEED * dt);

    // Cap swing velocity to prevent unrealistic spinning
    const MAX_SWING_VEL = 3.0;
    state.rope.swingVel = Math.max(-MAX_SWING_VEL, Math.min(MAX_SWING_VEL, state.rope.swingVel));
    state.rope.swingVel *= effectiveDamping;
    state.rope.swingAngle += state.rope.swingVel * dt;

    const prevY = state.feetY;
    const prevX = state.gx;
    state.gx = state.rope.hitX + Math.sin(state.rope.swingAngle) * state.rope.ropeLen;
    state.feetY = state.rope.hitY + Math.cos(state.rope.swingAngle) * state.rope.ropeLen;
    state.gvy = 0;
    state.gvx = 0;
    state.rope.swingTime += dt;

    // Check if swing crossed through or ended inside any platform
    // Skip only the anchor and the platform the man was standing on
    const bursting = true; // always burst through platforms while swinging
    {
      const minY = Math.min(prevY, state.feetY);
      const maxY = Math.max(prevY, state.feetY);
      const minX = Math.min(prevX, state.gx);
      const maxX = Math.max(prevX, state.gx);

      for (const p of state.platforms) {
        // Check horizontal overlap with swing path
        if (maxX < p.x || minX > p.x + p.w) continue;

        const platTop = p.y;

        // Swing path crossed this platform's top edge (either direction)
        if (minY <= platTop && maxY >= platTop) {
          // Check if already passing through a hole
          if (state.holes && isInHole(state.holes, state.gx, platTop)) continue;

          if (bursting && state.holes && state.particles) {
            // Don't burst the platform the man was standing on
            if (p.hash === state.rope.startPlatHash) continue;
            // Burst through: create hole + particles, keep swinging
            const HOLE_W = 30;
            state.holes.push({ x: state.gx - HOLE_W / 2, y: platTop, w: HOLE_W, age: 0 });
            spawnBurstParticles(state.particles, state.gx, platTop, 12);
            continue;
          }

          // Skip anchor/start platforms for normal landing (not burst)
          if (p.hash === state.rope.anchorHash) continue;
          if (p.hash === state.rope.startPlatHash) continue;

          // Normal landing
          const ceiling = findCeiling(state.platforms, platTop, state.gx, state.lineHeight);
          if (ceiling) {
            const clearance = platTop - (ceiling.y + state.lineHeight);
            if (clearance < PRONE_HEIGHT) continue;
          }
          state.feetY = platTop;
          state.grounded = true;
          state.gvy = 0;
          state.gvx = state.rope.swingVel * state.rope.ropeLen * 0.3;
          state.rope = null;
          break;
        }
      }
    }
  }
}

/**
 * Update horizontal/vertical movement, gravity, collision.
 * Skipped when swinging on rope.
 * Mutates state.gx, state.feetY, state.gvx, state.gvy, state.grounded, state.standingHash, etc.
 */
export function updateMovement(state, dt, keys, screenW, screenH) {
  if (state.rope && state.rope.state === 'swinging') return;

  const aiming = state.rope && state.rope.state === 'aiming';
  const left = !aiming && (keys.has('KeyA') || keys.has('ArrowLeft'));
  const right = !aiming && (keys.has('KeyD') || keys.has('ArrowRight'));
  const jump = !aiming && (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Space'));

  if (state.dropThrough > 0) state.dropThrough -= dt;

  // Horizontal movement — slower when crouching, much slower when prone
  const speedMul = state.posture === 'prone' ? 0.25 : state.posture === 'crouching' ? 0.6 : 1;
  const accel = ACCEL * speedMul;
  const maxv = MAXV * speedMul;
  if (left) { state.gvx -= accel * dt; state.faceR = false; }
  if (right) { state.gvx += accel * dt; state.faceR = true; }
  if (!left && !right) { state.gvx *= Math.pow(FRIC, dt * 60); if (Math.abs(state.gvx) < 1) state.gvx = 0; }
  state.gvx = Math.max(-maxv, Math.min(maxv, state.gvx));

  // Jump
  // If in prompt/footer area, give a strong jump to escape back to prompt top
  // If crouching/prone under ceiling, burst a hole and jump through
  const inFooterArea = state.promptArea && state.feetY >= state.promptArea.y;
  if (jump && state.grounded) {
    // Remember launch platform so we don't burst through it
    state._launchPlatY = state.feetY;
    // Crouch burst takes priority over footer escape: when crouching under a ceiling,
    // we must punch through it before any footer-escape jump can clear the prompt area.
    const crouchCeiling = (state.posture === 'crouching' && state.holes && state.particles)
      ? findCeiling(state.platforms, state.feetY, state.gx, state.lineHeight)
      : null;
    // Just enough overshoot to clear the top edge of a ceiling platform.
    const CEIL_CLEAR_OVERSHOOT = 6;
    if (crouchCeiling) {
      const HOLE_W = 30;
      state.holes.push({ x: state.gx - HOLE_W / 2, y: crouchCeiling.y, w: HOLE_W, age: 0 });
      spawnBurstParticles(state.particles, state.gx, crouchCeiling.y + state.lineHeight, 12);
      const dist = state.feetY - crouchCeiling.y + CEIL_CLEAR_OVERSHOOT;
      state.gvy = -Math.sqrt(2 * GRAV * dist);
      state.grounded = false; state.standingHash = 0; state.landT = 0;
    } else if (inFooterArea && state.posture !== 'prone') {
      const dist = state.feetY - state.promptArea.y + 40;
      state.gvy = -Math.max(JUMP_V, Math.sqrt(2 * GRAV * dist));
      state.grounded = false; state.standingHash = 0; state.landT = 0;
    } else if (state.posture === 'standing') {
      // Check for ceiling platform to burst through — boost jump to clear it
      const ceiling = findCeiling(state.platforms, state.feetY, state.gx, state.lineHeight);
      if (ceiling && state.holes && state.particles) {
        const dist = state.feetY - ceiling.y + CEIL_CLEAR_OVERSHOOT;
        state.gvy = -Math.max(JUMP_V, Math.sqrt(2 * GRAV * dist));
      } else {
        state.gvy = -JUMP_V;
      }
      state.grounded = false; state.standingHash = 0; state.landT = 0;
    }
  }

  // Gravity
  if (!state.grounded) state.gvy += GRAV * dt;

  // Apply velocity
  const prevFeetY = state.feetY;
  state.feetY += state.gvy * dt;

  // Burst through platforms when jumping upward (standing or crouching)
  if (state.gvy < 0 && state.holes && state.particles && state.posture !== 'prone') {
    for (const p of state.platforms) {
      if (state.gx < p.x || state.gx > p.x + p.w) continue;
      // Skip the platform we launched from
      if (state._launchPlatY != null && Math.abs(p.y - state._launchPlatY) < 2) continue;
      const platTop = p.y;
      // Feet crossed upward through a platform top
      if (prevFeetY >= platTop && state.feetY < platTop) {
        if (isInHole(state.holes, state.gx, platTop)) continue;
        const HOLE_W = 30;
        state.holes.push({ x: state.gx - HOLE_W / 2, y: platTop, w: HOLE_W, age: 0 });
        spawnBurstParticles(state.particles, state.gx, platTop + state.lineHeight, 12);
        break; // Only burst one platform per frame
      }
    }
  }

  // Clear launch platform tracking on landing
  if (state.grounded) state._launchPlatY = null;

  // Platform collision (one-way, from above)
  if (state.gvy >= 0 && state.dropThrough <= 0) {
    const floor = findFloor(state.platforms, prevFeetY - 1, state.gx, screenH);
    if (floor !== null && state.feetY >= floor.y && prevFeetY <= floor.y + 4) {
      // Fall through holes
      if (state.holes && isInHole(state.holes, state.gx, floor.y)) {
        // don't land — fall through the hole
      } else {
        // Don't land if ceiling makes the gap too tight even for prone
        const ceiling = findCeiling(state.platforms, floor.y, state.gx, state.lineHeight);
        const clearance = ceiling ? floor.y - (ceiling.y + state.lineHeight) : Infinity;
        if (clearance >= PRONE_HEIGHT) {
          if (state.gvy > 100) state.landT = 0.15;
          state.feetY = floor.y;
          state.gvy = 0;
          state.grounded = true;
          state.standingHash = floor.hash || 0;
        }
      }
    }
  }

  // Absolute floor
  if (state.feetY > screenH) {
    state.feetY = screenH - state.lineHeight;
    state.gvy = 0;
    state.standingHash = 0;
    state.grounded = true;
  }

  // Check platform still exists beneath (walked off edge)
  if (state.grounded) {
    const floor = findFloor(state.platforms, state.feetY - 1, state.gx, screenH);
    if (floor === null || Math.abs(state.feetY - floor.y) > 2) {
      state.grounded = false;
      state.standingHash = 0;
    } else {
      state.standingHash = floor.hash || 0;
    }
  }

  // Horizontal position + wrap
  // Check if destination has enough clearance for current posture
  if (state.grounded && state.gvx !== 0) {
    const nextX = state.gx + state.gvx * dt;
    const ceiling = findCeiling(state.platforms, state.feetY, nextX, state.lineHeight);
    if (ceiling) {
      const clearance = state.feetY - (ceiling.y + state.lineHeight);
      const minHeight = state.posture === 'prone' ? PRONE_HEIGHT : CROUCH_HEIGHT;
      if (clearance < minHeight) {
        state.gvx = 0; // Block movement — too tight
      }
    }
  }
  state.gx += state.gvx * dt;
  if (state.gx < -20) state.gx = screenW;
  if (state.gx > screenW + 20) state.gx = -20;
}

/**
 * Update posture based on ceiling clearance.
 * Auto-crouches when standing won't fit. Respects manual prone (proneRequested).
 * Mutates state.posture.
 */
export function updatePosture(state) {
  if (!state.grounded) return;

  // If user manually requested prone, stay prone
  if (state.proneRequested) {
    state.posture = 'prone';
    return;
  }

  const ceiling = findCeiling(state.platforms, state.feetY, state.gx, state.lineHeight);
  if (!ceiling) {
    state.posture = 'standing';
    return;
  }

  const clearance = state.feetY - (ceiling.y + state.lineHeight);

  if (clearance >= STANDING_HEIGHT) {
    state.posture = 'standing';
  } else if (clearance >= CROUCH_HEIGHT) {
    state.posture = 'crouching';
  } else if (clearance >= PRONE_HEIGHT) {
    // Too tight for crouch — stay/go prone
    state.posture = 'prone';
  } else {
    // Extremely tight — prone is the best option
    state.posture = 'prone';
  }
}

/**
 * Update current pose based on state (grounded, velocity, rope, posture, etc.).
 * Mutates state.curPose, state.walkPh, state.landT.
 */
export function updatePose(state, dt) {
  let target;
  if (state.rope && state.rope.state === 'swinging') {
    target = JUMP_RISE;
  } else if (!state.grounded) {
    const t = Math.max(0, Math.min(1, (-state.gvy + JUMP_V) / (JUMP_V * 2)));
    target = lerpPose(JUMP_FALL, JUMP_RISE, t);
  } else if (state.landT > 0) {
    target = lerpPose(IDLE, LAND, state.landT / 0.15);
    state.landT -= dt;
  } else if (state.posture === 'prone') {
    if (Math.abs(state.gvx) > 5) {
      state.walkPh += Math.abs(state.gvx) * dt * 0.006;
      if (state.walkPh >= 1) state.walkPh -= 1;
      const n = PRONE_CRAWL.length, raw = state.walkPh * n;
      const i = Math.floor(raw) % n, f = raw - Math.floor(raw);
      target = lerpPose(PRONE_CRAWL[i], PRONE_CRAWL[(i + 1) % n], f);
    } else {
      target = PRONE;
    }
  } else if (state.posture === 'crouching') {
    if (Math.abs(state.gvx) > 5) {
      state.walkPh += Math.abs(state.gvx) * dt * 0.008;
      if (state.walkPh >= 1) state.walkPh -= 1;
      const n = CROUCH_WALK.length, raw = state.walkPh * n;
      const i = Math.floor(raw) % n, f = raw - Math.floor(raw);
      target = lerpPose(CROUCH_WALK[i], CROUCH_WALK[(i + 1) % n], f);
    } else {
      target = CROUCH;
    }
  } else if (Math.abs(state.gvx) > 5) {
    state.walkPh += Math.abs(state.gvx) * dt * 0.008;
    if (state.walkPh >= 1) state.walkPh -= 1;
    const n = WALK.length, raw = state.walkPh * n;
    const i = Math.floor(raw) % n, f = raw - Math.floor(raw);
    target = lerpPose(WALK[i], WALK[(i + 1) % n], f);
  } else {
    target = IDLE;
  }

  state.curPose = lerpPose(state.curPose, target, Math.min(1, dt * 12));
}

/**
 * Reset player to spawn position.
 * Mutates state: clears velocity, rope, posture, and moves to prompt area.
 */
export function resetPlayer(state) {
  state.gvx = 0;
  state.gvy = 0;
  state.grounded = true;
  state.standingHash = 0;
  state.rope = null;
  state.ropeCooldown = 0;
  state.posture = 'standing';
  state.proneRequested = false;
  state.landT = 0;
  state.walkPh = 0;
  state.curPose = JSON.parse(JSON.stringify(IDLE));

  if (state.promptArea) {
    state.gx = state.textOffsetX + state.textWidth - 20 * SCALE - 20;
    state.feetY = state.promptArea.y;
    state.faceR = false;
  }
}

/**
 * Check if a position falls inside a hole on a given platform y.
 */
export function isInHole(holes, x, platY) {
  for (const h of holes) {
    if (Math.abs(h.y - platY) < 2 && x >= h.x && x <= h.x + h.w) return true;
  }
  return false;
}

/**
 * Spawn burst debris particles at a position.
 */
export function spawnBurstParticles(particles, x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60, // bias upward
      life: 0.4 + Math.random() * 0.4,
      maxLife: 0.8,
    });
  }
}

/**
 * Begin an axe swing. No-op if already swinging, airborne, on a rope, or
 * not upright (crouched/prone). Returns true if the swing was started.
 */
export function startAxeSwing(state) {
  if (state.axeSwing) return false;
  if (!state.grounded) return false;
  if (state.rope) return false;
  if (state.posture && state.posture !== 'standing') return false;
  state.axeSwing = { t: 0, hit: false };
  return true;
}

/**
 * Advance the active axe swing. At the apex frame (AXE_HIT_FRAME * duration)
 * resolve a single hit against the nearest mana mine within reach: decrement
 * its hits, emit chip particles, and if the mine is depleted award
 * MANA_PER_MINE to state.mana and remove the mine. Swing clears itself when
 * the full duration elapses.
 */
export function updateAxeSwing(state, dt) {
  if (!state.axeSwing) return;
  state.axeSwing.t += dt;

  const apex = AXE_SWING_DURATION * AXE_HIT_FRAME;
  if (!state.axeSwing.hit && state.axeSwing.t >= apex) {
    state.axeSwing.hit = true;
    resolveAxeHit(state);
  }

  if (state.axeSwing.t >= AXE_SWING_DURATION) {
    state.axeSwing = null;
  }
}

function resolveAxeHit(state) {
  if (!state.manaMines || state.manaMines.length === 0) return;
  const dir = state.faceR ? 1 : -1;
  const hx = state.gx + dir * AXE_REACH;
  const hy = state.feetY - 10;

  for (let i = state.manaMines.length - 1; i >= 0; i--) {
    const m = state.manaMines[i];
    if (Math.hypot(m.x - hx, m.y - hy) < AXE_HIT_RADIUS) {
      m.hits -= 1;
      if (state.particles) {
        for (let j = 0; j < 5; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 30 + Math.random() * 60;
          state.particles.push({
            x: m.x, y: m.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 30,
            life: 0.3,
            maxLife: 0.3,
          });
        }
      }
      if (m.hits <= 0) {
        state.mana = (state.mana || 0) + MANA_PER_MINE;
        state.manaMines.splice(i, 1);
      }
      return; // one hit per swing
    }
  }
}

/**
 * Update particle positions and remove expired ones.
 * Mutates the array in place.
 */
export function updateParticles(particles, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt; // gravity on particles
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
