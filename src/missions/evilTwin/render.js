import { SCALE } from '../../poses.js';
import { effectiveHudHeight } from '../../constants.js';
import {
  EVIL_TWIN_GOAL_BALLS,
  EVIL_TWIN_INITIAL_LIVES,
  EVIL_TWIN_MANA_ORB_LIFETIME,
  TWIN_BOLT_BEAM_WIDTH,
  TWIN_BOLT_RANGE,
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

/**
 * Telegraph line for the twin's incoming bolt. Pulsing dashed red
 * stripe from the casting hand toward the player so the hit zone is
 * legible during the charge phase.
 */
export function drawTwinLightningAim(ctx, aim) {
  const ox = aim.originX;
  const oy = aim.originY;
  const len = 280;
  const ex = ox + Math.cos(aim.angle) * len;
  const ey = oy + Math.sin(aim.angle) * len;
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(255, 90, 110, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(255, 60, 90, 0.6)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 120, 140, 0.85)';
  ctx.beginPath();
  ctx.arc(ox, oy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Live bolt — same jagged-stack rendering as the player's lightning,
 * just in a hot crimson palette. Three-strand layout (glow, core,
 * inner strand) keeps it visually meaty over the player's blue bolt.
 */
export function drawTwinLightningBolt(ctx, bolt) {
  const cos = Math.cos(bolt.angle);
  const sin = Math.sin(bolt.angle);
  const nx = -sin;
  const ny = cos;
  const zig = bolt.zig || [];
  const n = Math.max(2, zig.length);
  const alpha = Math.max(0, Math.min(1, bolt.life / bolt.maxLife));

  const points = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const along = t * TWIN_BOLT_RANGE;
    const off = zig[i] || 0;
    const px = bolt.x + cos * along + nx * off;
    const py = bolt.y + sin * along + ny * off;
    points.push([px, py]);
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Glow halo.
  ctx.strokeStyle = `rgba(255, 90, 110, ${0.35 * alpha})`;
  ctx.lineWidth = TWIN_BOLT_BEAM_WIDTH * 0.9;
  ctx.shadowColor = 'rgba(255, 70, 100, 0.9)';
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  // Mid-brightness core.
  ctx.strokeStyle = `rgba(255, 160, 180, ${0.95 * alpha})`;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  // Bright inner strand.
  ctx.strokeStyle = `rgba(255, 235, 240, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();
}

/**
 * Brief scorch streaks left on each platform a twin bolt crossed.
 * Fade from a bright red core to nothing over the scorch's lifetime so
 * the player can read where danger zones just were without leaving
 * permanent terrain damage.
 */
export function drawScorches(ctx, scorches) {
  if (!Array.isArray(scorches) || scorches.length === 0) return;
  ctx.save();
  for (const sc of scorches) {
    const t = Math.max(0, Math.min(1, 1 - (sc.age / sc.maxAge)));
    if (t <= 0) continue;
    const halfW = 14;
    const grad = ctx.createLinearGradient(sc.x - halfW, sc.y, sc.x + halfW, sc.y);
    grad.addColorStop(0, `rgba(255, 80, 100, 0)`);
    grad.addColorStop(0.5, `rgba(255, 90, 110, ${0.85 * t})`);
    grad.addColorStop(1, `rgba(255, 80, 100, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(sc.x - halfW, sc.y - 1, halfW * 2, 2);
    // Faint smolder above the line — small radial tint that lifts as the
    // mark ages, suggesting heat dissipating off the platform.
    const lift = (1 - t) * 4;
    const halo = ctx.createRadialGradient(sc.x, sc.y - lift, 1, sc.x, sc.y - lift, 9);
    halo.addColorStop(0, `rgba(255, 160, 90, ${0.5 * t})`);
    halo.addColorStop(1, `rgba(255, 160, 90, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y - lift, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Walk-over mana orbs — same shape as the yellow glowing balls but in
 * an icy blue palette so they read instantly as "mana, not score".
 * Pulse + fade-in/fade-out match the glowing-ball polish so it feels
 * like the same family of pickups.
 */
export function drawManaOrbs(ctx, orbs) {
  if (!Array.isArray(orbs) || orbs.length === 0) return;
  ctx.save();
  for (const orb of orbs) {
    const fadeIn = Math.min(1, orb.age * 2);
    const fadeOut = orb.age > EVIL_TWIN_MANA_ORB_LIFETIME - 3
      ? Math.max(0, 1 - (orb.age - (EVIL_TWIN_MANA_ORB_LIFETIME - 3)) / 3)
      : 1;
    const alpha = fadeIn * fadeOut;
    if (alpha <= 0) continue;
    const expiring = orb.age > EVIL_TWIN_MANA_ORB_LIFETIME - 3;
    const pulse = 1 + 0.2 * Math.sin(orb.age * (expiring ? 12 : 4));
    const r = 4 * pulse;
    const orbY = orb.y - r - 2;
    ctx.shadowColor = `rgba(120, 180, 255, ${0.7 * alpha})`;
    ctx.shadowBlur = 12;
    ctx.fillStyle = `rgba(110, 170, 250, ${0.92 * alpha})`;
    ctx.beginPath();
    ctx.arc(orb.x, orbY, r, 0, Math.PI * 2);
    ctx.fill();
    // Bright inner core — slightly cyan to read as a different orb than
    // the warm glowing-ball core.
    ctx.fillStyle = `rgba(220, 240, 255, ${0.85 * alpha})`;
    ctx.beginPath();
    ctx.arc(orb.x, orbY, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
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
