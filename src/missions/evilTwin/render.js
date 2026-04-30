import { SCALE } from '../../poses.js';
import { effectiveHudHeight } from '../../constants.js';
import {
  EVIL_TWIN_GOAL_BALLS,
  EVIL_TWIN_INITIAL_LIVES,
} from '../evilTwin.js';

/**
 * Visual rendering for the Evil Twin mission. The twin is just a
 * second instance of the player skeleton, drawn from a buffered
 * snapshot in a dark/red palette so it reads as the player's shadow,
 * not another character.
 */

function drawLimb(ctx, ax, ay, bx, by) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function jointPos(snap, name) {
  const fl = snap.faceR ? 1 : -1;
  const j = snap.curPose?.[name];
  if (!j) return null;
  return {
    x: snap.gx + j.x * SCALE * fl,
    y: snap.feetY + (j.y - 44) * SCALE,
  };
}

/**
 * Draw the shadow twin from a buffered snapshot. The skeleton mirrors
 * the player's drawing path (head, torso, arms, legs) with a deep red
 * stroke and a pulsing crimson glow, so it reads as a hostile echo of
 * the player's last few seconds.
 */
export function drawShadowTwin(ctx, snap, paused = false) {
  if (!snap || !snap.curPose) return;
  const head = jointPos(snap, 'head');
  const neck = jointPos(snap, 'neck');
  const hip = jointPos(snap, 'hip');
  const lsh = jointPos(snap, 'lsh');
  const rsh = jointPos(snap, 'rsh');
  const lel = jointPos(snap, 'lel');
  const rel = jointPos(snap, 'rel');
  const lh = jointPos(snap, 'lh');
  const rh = jointPos(snap, 'rh');
  const lhip = jointPos(snap, 'lhip');
  const rhip = jointPos(snap, 'rhip');
  const lk = jointPos(snap, 'lk');
  const rk = jointPos(snap, 'rk');
  const lf = jointPos(snap, 'lf');
  const rf = jointPos(snap, 'rf');
  if (!head || !hip) return;

  ctx.save();
  ctx.globalAlpha = paused ? 0.35 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255, 60, 90, 0.6)';
  ctx.shadowBlur = 9;
  ctx.strokeStyle = 'rgba(40, 10, 30, 0.95)';

  ctx.lineWidth = 2;
  drawLimb(ctx, neck.x, neck.y, hip.x, hip.y);

  ctx.lineWidth = 1.5;
  drawLimb(ctx, lsh.x, lsh.y, rsh.x, rsh.y);
  drawLimb(ctx, lsh.x, lsh.y, lel.x, lel.y);
  drawLimb(ctx, lel.x, lel.y, lh.x, lh.y);
  drawLimb(ctx, rsh.x, rsh.y, rel.x, rel.y);
  drawLimb(ctx, rel.x, rel.y, rh.x, rh.y);

  drawLimb(ctx, lhip.x, lhip.y, lk.x, lk.y);
  drawLimb(ctx, lk.x, lk.y, lf.x, lf.y);
  drawLimb(ctx, rhip.x, rhip.y, rk.x, rk.y);
  drawLimb(ctx, rk.x, rk.y, rf.x, rf.y);

  // Head matches the player's size and palette weight — same dot, just a
  // dark crimson fill so the twin reads as a hostile echo without a
  // bigger silhouette than the live man.
  const headR = 5 * SCALE;
  ctx.fillStyle = 'rgba(180, 30, 60, 0.95)';
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fill();

  // Replay the rope. Drawn from whichever hand carried it on the player.
  // Same line shape per state as the live render, just in the twin palette
  // so the player can see where they swung a few seconds back.
  if (snap.rope) {
    const handPos = snap.faceR ? rh : lh;
    if (handPos) drawTwinRope(ctx, snap.rope, handPos);
  }

  ctx.restore();
}

function drawTwinRope(ctx, rope, handPos) {
  ctx.save();
  ctx.strokeStyle = 'rgba(220, 60, 80, 0.85)';
  ctx.fillStyle = 'rgba(220, 60, 80, 0.85)';
  ctx.shadowColor = 'rgba(255, 60, 90, 0.4)';
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1.5;

  if (rope.state === 'aiming') {
    const aimLen = 40;
    const endX = handPos.x + Math.cos(rope.angle) * aimLen;
    const endY = handPos.y + Math.sin(rope.angle) * aimLen;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(handPos.x, handPos.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(endX, endY, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (rope.state === 'flying') {
    ctx.beginPath();
    ctx.moveTo(handPos.x, handPos.y);
    ctx.lineTo(rope.tipX, rope.tipY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rope.tipX, rope.tipY, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (rope.state === 'swinging') {
    ctx.beginPath();
    ctx.moveTo(handPos.x, handPos.y);
    ctx.lineTo(rope.hitX, rope.hitY);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rope.hitX, rope.hitY, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function renderEvilTwinHud(ctx, scene, screenW) {
  const balls = scene.ballsCollected || 0;
  const lives = scene.lives ?? EVIL_TWIN_INITIAL_LIVES;
  ctx.save();
  ctx.font = "bold 16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = balls >= EVIL_TWIN_GOAL_BALLS
    ? 'rgba(255, 240, 200, 0.98)'
    : 'rgba(255, 200, 215, 0.95)';
  ctx.fillText(
    `twin ${balls}/${EVIL_TWIN_GOAL_BALLS}  •  lives ${Math.max(0, lives)}`,
    screenW / 2,
    effectiveHudHeight(screenW) + 4,
  );
  ctx.restore();
}
