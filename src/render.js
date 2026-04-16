import { SCALE, STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT } from './poses.js';

function drawLimb(ctx, ax, ay, bx, by) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

/**
 * Render the full game frame: rope, stick man, debug overlays.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state - Full game state
 * @param {number} screenW
 * @param {number} screenH
 */
export function render(ctx, state, screenW, screenH) {
  ctx.clearRect(0, 0, screenW, screenH);

  if (!state.hasSpawned) {
    if (state.DEBUG_DRAW) renderDebugOverlays(ctx, state, screenH);
    return;
  }

  const ox = state.gx;
  const oy = state.feetY;
  const s = SCALE;
  const fl = state.faceR ? 1 : -1;

  const j = (name) => ({
    x: ox + state.curPose[name].x * s * fl,
    y: oy + (state.curPose[name].y - 44) * s,
  });

  const head = j('head'), neck = j('neck'), hip = j('hip');
  const lsh = j('lsh'), rsh = j('rsh'), lel = j('lel'), rel = j('rel');
  const lh = j('lh'), rh = j('rh');
  const lhip = j('lhip'), rhip = j('rhip');
  const lk = j('lk'), rk = j('rk'), lf = j('lf'), rf = j('rf');

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Rope
  if (state.rope) {
    const handPos = state.faceR ? rh : lh;
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(255, 200, 50, 0.3)';
    ctx.shadowBlur = 4;

    if (state.rope.state === 'aiming') {
      const aimLen = 40;
      const endX = handPos.x + Math.cos(state.rope.angle) * aimLen;
      const endY = handPos.y + Math.sin(state.rope.angle) * aimLen;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(handPos.x, handPos.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(endX, endY, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
      ctx.fill();
    } else if (state.rope.state === 'flying') {
      ctx.strokeStyle = 'rgba(255, 200, 50, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(handPos.x, handPos.y);
      ctx.lineTo(state.rope.tipX, state.rope.tipY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(state.rope.tipX, state.rope.tipY, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
      ctx.fill();
    } else if (state.rope.state === 'swinging') {
      ctx.beginPath();
      ctx.moveTo(handPos.x, handPos.y);
      ctx.lineTo(state.rope.hitX, state.rope.hitY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(state.rope.hitX, state.rope.hitY, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }

  // Stick man
  ctx.shadowColor = 'rgba(0, 220, 255, 0.4)';
  ctx.shadowBlur = 6;

  const color = 'rgba(0, 220, 255, 0.95)';
  ctx.strokeStyle = color;

  ctx.lineWidth = 2;
  drawLimb(ctx, neck.x, neck.y, hip.x, hip.y);

  ctx.lineWidth = 1.5;
  drawLimb(ctx, lsh.x, lsh.y, rsh.x, rsh.y);

  ctx.lineWidth = 1.5;
  drawLimb(ctx, lsh.x, lsh.y, lel.x, lel.y);
  drawLimb(ctx, lel.x, lel.y, lh.x, lh.y);
  drawLimb(ctx, rsh.x, rsh.y, rel.x, rel.y);
  drawLimb(ctx, rel.x, rel.y, rh.x, rh.y);

  drawLimb(ctx, lhip.x, lhip.y, lk.x, lk.y);
  drawLimb(ctx, lk.x, lk.y, lf.x, lf.y);
  drawLimb(ctx, rhip.x, rhip.y, rk.x, rk.y);
  drawLimb(ctx, rk.x, rk.y, rf.x, rf.y);

  const hr = 5 * s;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  if (state.DEBUG_PLATFORMS) renderPlatformOverlay(ctx, state);
  if (state.DEBUG_DRAW) renderDebugOverlays(ctx, state, screenH);
}

/**
 * Render all platforms as visible rectangles with posture/clearance info.
 */
function renderPlatformOverlay(ctx, state) {
  const lh = state.lineHeight;

  // Draw every platform
  for (let i = 0; i < state.platforms.length; i++) {
    const p = state.platforms[i];
    // Fill
    ctx.fillStyle = 'rgba(255, 100, 50, 0.2)';
    ctx.fillRect(p.x, p.y, p.w, lh);
    // Border
    ctx.strokeStyle = 'rgba(255, 100, 50, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x, p.y, p.w, lh);
    // Index label
    ctx.fillStyle = 'rgba(255, 100, 50, 0.7)';
    ctx.font = '8px monospace';
    ctx.fillText(`${i}`, p.x + 2, p.y + lh - 2);
  }

  // Draw man's posture bounding box
  if (state.hasSpawned) {
    const posture = state.posture || 'standing';
    const heights = { standing: STANDING_HEIGHT, crouching: CROUCH_HEIGHT, prone: PRONE_HEIGHT };
    const h = heights[posture] || STANDING_HEIGHT;
    const boxTop = state.feetY - h;
    const boxW = 12;

    // Posture box
    ctx.fillStyle = 'rgba(0, 220, 255, 0.15)';
    ctx.fillRect(state.gx - boxW / 2, boxTop, boxW, h);
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(state.gx - boxW / 2, boxTop, boxW, h);

    // Label
    ctx.fillStyle = 'rgba(0, 220, 255, 0.9)';
    ctx.font = '8px monospace';
    ctx.fillText(posture, state.gx + 8, boxTop + 8);
    ctx.fillText(`h=${h.toFixed(1)}`, state.gx + 8, boxTop + 18);
  }
}

/**
 * Render debug overlays: prompt/footer boxes, debug text.
 */
export function renderDebugOverlays(ctx, state, screenH) {
  if (state.footerArea) {
    ctx.fillStyle = 'rgba(0, 200, 50, 0.15)';
    ctx.fillRect(state.footerArea.x, state.footerArea.y, state.footerArea.w, state.footerArea.h);
    ctx.strokeStyle = 'rgba(0, 200, 50, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.footerArea.x, state.footerArea.y, state.footerArea.w, state.footerArea.h);
    ctx.fillStyle = 'rgba(0, 200, 50, 0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('FOOTER', state.footerArea.x + 4, state.footerArea.y + 12);
  }
  if (state.promptArea) {
    ctx.fillStyle = 'rgba(0, 100, 255, 0.15)';
    ctx.fillRect(state.promptArea.x, state.promptArea.y, state.promptArea.w, state.promptArea.h);
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.promptArea.x, state.promptArea.y, state.promptArea.w, state.promptArea.h);
    ctx.fillStyle = 'rgba(0, 100, 255, 0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('PROMPT', state.promptArea.x + 4, state.promptArea.y + 12);
  }
  if (!state.footerArea && !state.promptArea) {
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.font = '12px monospace';
    ctx.fillText('NO PROMPT DETECTED', 10, screenH - 10);
  }
  if (state.lastDebugLines && state.lastDebugLines.length > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    const dbgH = state.lastDebugLines.length * 14 + 20;
    ctx.fillRect(0, 0, 600, dbgH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = '11px monospace';
    ctx.fillText(`footer: ${state.lastFooterLine}  input: ${state.lastInputLine}`, 10, 14);
    for (let i = 0; i < state.lastDebugLines.length; i++) {
      ctx.fillText(state.lastDebugLines[i], 10, 28 + i * 14);
    }
  }
}
