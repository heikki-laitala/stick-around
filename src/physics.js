import { GRAV, JUMP_V, ACCEL, FRIC, MAXV, ROPE_AIM_SPEED, ROPE_FLY_SPEED, ROPE_MAX_LEN, SWING_GRAVITY, SWING_PUMP, SWING_DAMPING } from './constants.js';
import { lerpPose, IDLE, WALK, JUMP_RISE, JUMP_FALL, LAND, CROUCH, CROUCH_WALK, PRONE, PRONE_CRAWL, STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT } from './poses.js';
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

    if (keys.has('KeyA') || keys.has('ArrowLeft')) state.rope.swingVel -= SWING_PUMP * dt;
    if (keys.has('KeyD') || keys.has('ArrowRight')) state.rope.swingVel += SWING_PUMP * dt;

    const CLIMB_SPEED = 80;
    const MIN_ROPE_LEN = 20;
    if (keys.has('KeyW') || keys.has('ArrowUp')) state.rope.ropeLen = Math.max(MIN_ROPE_LEN, state.rope.ropeLen - CLIMB_SPEED * dt);
    if (keys.has('KeyS') || keys.has('ArrowDown')) state.rope.ropeLen = Math.min(ROPE_MAX_LEN, state.rope.ropeLen + CLIMB_SPEED * dt);

    state.rope.swingVel *= SWING_DAMPING;
    state.rope.swingAngle += state.rope.swingVel * dt;

    state.gx = state.rope.hitX + Math.sin(state.rope.swingAngle) * state.rope.ropeLen;
    state.feetY = state.rope.hitY + Math.cos(state.rope.swingAngle) * state.rope.ropeLen;
    state.gvy = 0;
    state.gvx = 0;
    state.rope.swingTime += dt;

    if (state.rope.swingTime > 0.3) {
      for (const p of state.platforms) {
        if (Math.abs(p.y - state.rope.startPlatY) < 2) continue;
        if (state.feetY >= p.y && state.feetY <= p.y + state.lineHeight * 0.5 &&
            state.gx >= p.x && state.gx <= p.x + p.w) {
          state.feetY = p.y;
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

  // Horizontal movement
  if (left) { state.gvx -= ACCEL * dt; state.faceR = false; }
  if (right) { state.gvx += ACCEL * dt; state.faceR = true; }
  if (!left && !right) { state.gvx *= Math.pow(FRIC, dt * 60); if (Math.abs(state.gvx) < 1) state.gvx = 0; }
  state.gvx = Math.max(-MAXV, Math.min(MAXV, state.gvx));

  // Jump (blocked when crouching/prone under a ceiling)
  // If in prompt/footer area, give an extra-strong jump to escape
  const inFooterArea = state.promptArea && state.feetY >= state.promptArea.y;
  if (jump && state.grounded && (state.posture === 'standing' || inFooterArea)) {
    state.gvy = inFooterArea ? -JUMP_V * 1.15 : -JUMP_V;
    state.grounded = false; state.standingHash = 0; state.landT = 0;
  }

  // Gravity
  if (!state.grounded) state.gvy += GRAV * dt;

  // Apply velocity
  const prevFeetY = state.feetY;
  state.feetY += state.gvy * dt;

  // Platform collision (one-way, from above)
  if (state.gvy >= 0 && state.dropThrough <= 0) {
    const floor = findFloor(state.platforms, prevFeetY - 1, state.gx, screenH);
    if (floor !== null && state.feetY >= floor.y && prevFeetY <= floor.y + 4) {
      if (state.gvy > 100) state.landT = 0.15;
      state.feetY = floor.y;
      state.gvy = 0;
      state.grounded = true;
      state.standingHash = floor.hash || 0;
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
 * Auto-crouches when standing won't fit. Keeps prone if already prone.
 * Mutates state.posture.
 */
export function updatePosture(state) {
  if (!state.grounded) return;

  const ceiling = findCeiling(state.platforms, state.feetY, state.gx, state.lineHeight);
  if (!ceiling) {
    // No ceiling — return to standing (unless prone was intentional and ceiling returns)
    state.posture = 'standing';
    return;
  }

  const clearance = state.feetY - (ceiling.y + state.lineHeight);

  if (clearance >= STANDING_HEIGHT) {
    state.posture = 'standing';
  } else if (clearance >= CROUCH_HEIGHT) {
    // Auto-crouch
    state.posture = 'crouching';
  } else if (state.posture === 'prone' && clearance >= PRONE_HEIGHT) {
    // Keep prone (was set by button press)
    state.posture = 'prone';
  } else {
    // Too tight for standing, auto-crouch is the best we can do automatically
    state.posture = 'crouching';
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
