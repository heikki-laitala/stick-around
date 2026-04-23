// Splash screen drawn on the overlay canvas. Echoes the app icon in
// `scripts/gen-icon.py`: fantasy-dusk panel, oversized wizard hat, tiny
// shield with a gold star, raised wooden sword, goofy grin. The bottom
// band is intentionally left as a stub for future keyboard hints.

// Splash fills the entire overlay — matches the terminal + HUD area
// so there's no mismatched "card in the middle of a window" look.
const PANEL_RADIUS = 0;

const COL_BG_TOP = 'rgba(78, 50, 147, 0.82)';
const COL_BG_BOT = 'rgba(255, 140, 120, 0.82)';
const COL_MOUNTAIN = '#3c285a';
const COL_MOON = 'rgba(255, 240, 200, 0.95)';
const COL_MOON_CRATER = 'rgba(255, 225, 170, 0.8)';
const COL_STROKE = '#ffffff';
const COL_OUTLINE = '#1a122e';
const COL_HAT = '#482a96';
const COL_HAT_BRIM = '#341e6e';
const COL_HAT_BAND = '#f0c846';
const COL_STAR = '#ffe65a';
const COL_SHIELD = '#b4becd';
const COL_SHIELD_RIM = '#646e82';
const COL_SWORD_WOOD = '#aa6e37';
const COL_SWORD_GRAIN = '#5a381c';
const COL_SWORD_GUARD = '#d2aa5a';
const COL_TONGUE = '#ff82aa';
const COL_TITLE = '#ffffff';
const COL_SUBTITLE = 'rgba(255, 255, 255, 0.82)';
const COL_META = 'rgba(255, 255, 255, 0.6)';
const COL_HINT = 'rgba(255, 255, 255, 0.72)';
const COL_HINT_KEY_BG = 'rgba(26, 18, 46, 0.5)';

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawStar(ctx, cx, cy, outerR, innerR, fill, outline) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke(); }
}

function drawLimb(ctx, ax, ay, bx, by, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

// Draw the hero centred at `(cx, cy)` at roughly `scale` (1.0 = 220px tall).
function drawHero(ctx, cx, cy, scale) {
  const s = scale;
  const headR = 34 * s;
  const headX = cx;
  const headY = cy - 50 * s;
  const neckX = cx;
  const neckY = cy - 10 * s;
  const hipX = cx;
  const hipY = cy + 50 * s;
  const stroke = 10 * s;

  // Shield (behind torso, on the left).
  const shCx = cx - 60 * s;
  const shCy = hipY + 2 * s;
  const shR = 30 * s;
  ctx.fillStyle = COL_SHIELD;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(shCx, shCy, shR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = COL_SHIELD_RIM;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(shCx, shCy, shR - 7 * s, 0, Math.PI * 2);
  ctx.stroke();
  drawStar(ctx, shCx, shCy, 13 * s, 5 * s, COL_STAR, COL_OUTLINE);

  // Torso + limbs.
  drawLimb(ctx, neckX, neckY, hipX, hipY, COL_STROKE, stroke);

  // Left arm (shield hand).
  const lShX = cx - 11 * s, lShY = neckY + 7 * s;
  const lElX = cx - 45 * s, lElY = neckY + 35 * s;
  const lHaX = shCx + 5 * s, lHaY = shCy - 5 * s;
  drawLimb(ctx, lShX, lShY, lElX, lElY, COL_STROKE, stroke);
  drawLimb(ctx, lElX, lElY, lHaX, lHaY, COL_STROKE, stroke);

  // Right arm raised high — grips the sword.
  const rShX = cx + 11 * s, rShY = neckY + 7 * s;
  const rElX = cx + 55 * s, rElY = neckY - 28 * s;
  const rHaX = cx + 90 * s, rHaY = cy - 100 * s;
  drawLimb(ctx, rShX, rShY, rElX, rElY, COL_STROKE, stroke);
  drawLimb(ctx, rElX, rElY, rHaX, rHaY, COL_STROKE, stroke);

  // Legs.
  const lHipX = cx - 4 * s, lHipY = hipY;
  const lKnX = cx - 22 * s, lKnY = cy + 90 * s;
  const lFtX = cx - 28 * s, lFtY = cy + 135 * s;
  const rHipX = cx + 4 * s, rHipY = hipY;
  const rKnX = cx + 22 * s, rKnY = cy + 90 * s;
  const rFtX = cx + 30 * s, rFtY = cy + 135 * s;
  drawLimb(ctx, lHipX, lHipY, lKnX, lKnY, COL_STROKE, stroke);
  drawLimb(ctx, lKnX, lKnY, lFtX, lFtY, COL_STROKE, stroke);
  drawLimb(ctx, rHipX, rHipY, rKnX, rKnY, COL_STROKE, stroke);
  drawLimb(ctx, rKnX, rKnY, rFtX, rFtY, COL_STROKE, stroke);

  // Head.
  ctx.fillStyle = COL_STROKE;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Face — wink left eye, open right eye, cartoon grin with tongue.
  ctx.fillStyle = COL_OUTLINE;
  ctx.beginPath();
  ctx.arc(headX - 12 * s, headY - 4 * s, 3.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.arc(headX + 12 * s, headY - 4 * s, 7 * s, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // Mouth.
  ctx.fillStyle = COL_OUTLINE;
  ctx.beginPath();
  ctx.arc(headX, headY + 11 * s, 12 * s, 0, Math.PI);
  ctx.fill();
  // Tongue.
  ctx.fillStyle = COL_TONGUE;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.ellipse(headX + 5 * s, headY + 17 * s, 6 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wizard hat — brim first, then cone, then band + tiny star.
  const brimY = headY - headR + 2 * s;
  ctx.fillStyle = COL_HAT_BRIM;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.ellipse(headX, brimY, 55 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const tipX = headX - 35 * s;
  const tipY = headY - 115 * s;
  ctx.fillStyle = COL_HAT;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(headX - 46 * s, brimY - 2 * s);
  ctx.lineTo(headX + 52 * s, brimY - 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Gold band near the base of the cone.
  ctx.fillStyle = COL_HAT_BAND;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(headX - 42 * s, brimY - 4 * s);
  ctx.lineTo(headX + 48 * s, brimY - 4 * s);
  ctx.lineTo(headX + 40 * s, brimY - 13 * s);
  ctx.lineTo(headX - 36 * s, brimY - 13 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  drawStar(ctx, tipX + 13 * s, tipY + 28 * s, 6.5 * s, 2.6 * s, COL_STAR, COL_OUTLINE);

  // Wooden sword — cross-guard + angled blade to upper-right sparkles.
  const guardX = rHaX, guardY = rHaY;
  ctx.strokeStyle = COL_SWORD_GUARD;
  ctx.lineCap = 'round';
  ctx.lineWidth = 6 * s;
  ctx.beginPath();
  ctx.moveTo(guardX - 13 * s, guardY + 8 * s);
  ctx.lineTo(guardX + 13 * s, guardY - 8 * s);
  ctx.stroke();

  const swTipX = cx + 135 * s;
  const swTipY = cy - 170 * s;
  const dx = swTipX - guardX;
  const dy = swTipY - guardY;
  const len = Math.hypot(dx, dy);
  const nxNorm = -dy / len;
  const nyNorm = dx / len;
  const halfW = 7 * s;
  ctx.fillStyle = COL_SWORD_WOOD;
  ctx.strokeStyle = COL_OUTLINE;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(guardX + nxNorm * halfW, guardY + nyNorm * halfW);
  ctx.lineTo(guardX - nxNorm * halfW, guardY - nyNorm * halfW);
  ctx.lineTo(swTipX - nxNorm * 1.5 * s, swTipY - nyNorm * 1.5 * s);
  ctx.lineTo(swTipX + nxNorm * 1.5 * s, swTipY + nyNorm * 1.5 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = COL_SWORD_GRAIN;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(guardX, guardY);
  ctx.lineTo(swTipX, swTipY);
  ctx.stroke();

  // Sparkles near the tip.
  ctx.fillStyle = '#fffce0';
  for (const [sx, sy, sr] of [
    [swTipX - 4 * s, swTipY - 6 * s, 3 * s],
    [swTipX + 6 * s, swTipY + 4 * s, 2 * s],
    [swTipX - 10 * s, swTipY + 2 * s, 1.6 * s],
  ]) {
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawKeyHint(ctx, x, y, key, label, fontPx) {
  // Both the pill and the adjoining label share baseline `y`. The pill's
  // top/bottom are offset from the baseline so its vertical centre sits
  // on the text's visual centre line, not somewhere floating above it.
  const keyPadX = Math.max(5, fontPx * 0.55);
  const pillTop = y - fontPx * 0.95;
  const pillBottom = y + fontPx * 0.3;
  const keyH = pillBottom - pillTop;
  ctx.font = `600 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const keyW = ctx.measureText(key).width + keyPadX * 2;
  roundedRectPath(ctx, x, pillTop, keyW, keyH, fontPx * 0.3);
  ctx.fillStyle = COL_HINT_KEY_BG;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = COL_HINT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(key, x + keyPadX, y);

  ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillStyle = COL_HINT;
  ctx.fillText(label, x + keyW + fontPx * 0.6, y);
  return x + keyW + fontPx * 0.8 + ctx.measureText(label).width;
}

export function renderSplash(ctx, state, screenW, screenH) {
  const x = 0, y = 0, w = screenW, h = screenH;
  if (w < 80 || h < 60) return;
  // Scale everything from panel height so the layout is proportional
  // regardless of terminal dimensions.
  const u = h / 460;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Fantasy dusk gradient.
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, COL_BG_TOP);
  grad.addColorStop(1, COL_BG_BOT);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Moon (upper-right quadrant).
  const moonR = 52 * u;
  const moonCx = x + w - moonR - 40 * u;
  const moonCy = y + moonR + 30 * u;
  ctx.fillStyle = COL_MOON;
  ctx.beginPath();
  ctx.arc(moonCx, moonCy, moonR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COL_MOON_CRATER;
  ctx.beginPath();
  ctx.arc(moonCx - 20 * u, moonCy - 18 * u, 12 * u, 0, Math.PI * 2);
  ctx.arc(moonCx + 16 * u, moonCy + 18 * u, 8 * u, 0, Math.PI * 2);
  ctx.fill();

  // Mountain silhouettes along the horizon.
  const horizon = y + h * 0.78;
  const peak = 55 * u;
  ctx.fillStyle = COL_MOUNTAIN;
  ctx.beginPath();
  ctx.moveTo(x, horizon);
  ctx.lineTo(x + w * 0.18, horizon - peak * 1.1);
  ctx.lineTo(x + w * 0.32, horizon - peak * 0.18);
  ctx.lineTo(x + w * 0.48, horizon - peak);
  ctx.lineTo(x + w * 0.66, horizon - peak * 0.22);
  ctx.lineTo(x + w * 0.82, horizon - peak * 0.87);
  ctx.lineTo(x + w, horizon - peak * 0.27);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();

  // Hero on the left third of the panel, scaled to panel height.
  const heroCx = x + w * 0.24;
  const heroCy = y + h * 0.56;
  const heroScale = Math.min(1.0, h / 460, (w * 0.42) / 260);
  drawHero(ctx, heroCx, heroCy, heroScale);

  // Title block on the right side of the panel.
  const textX = x + w * 0.48;
  const titleSize = Math.min(60, w * 0.08, h * 0.14);
  const titleY1 = y + h * 0.28;
  const titleY2 = titleY1 + titleSize * 1.0;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COL_TITLE;
  ctx.font = `800 ${titleSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillText('STICK', textX, titleY1);
  ctx.fillText('AROUND', textX, titleY2);

  const subSize = Math.max(11, titleSize * 0.32);
  ctx.font = `${subSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.fillStyle = COL_SUBTITLE;
  ctx.fillText('by Heikki Laitala', textX, titleY2 + subSize * 1.6);

  const metaSize = Math.max(10, titleSize * 0.26);
  ctx.font = `${metaSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = COL_META;
  ctx.fillText(state.version || '', textX, titleY2 + subSize * 1.6 + metaSize * 1.6);

  // Footer hint band along the bottom of the panel.
  const hintFont = Math.max(10, h * 0.032);
  const hintY = y + h - hintFont * 1.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.05, hintY - hintFont * 1.6);
  ctx.lineTo(x + w * 0.95, hintY - hintFont * 1.6);
  ctx.stroke();

  // Measure both hints and centre them as a single row with a gap.
  const keyPadX = Math.max(5, hintFont * 0.55);
  ctx.font = `600 ${hintFont}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const anyKeyW = ctx.measureText('Any key').width + keyPadX * 2;
  const escKeyW = ctx.measureText('Esc').width + keyPadX * 2;
  ctx.font = `${hintFont}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const beginW = ctx.measureText('begin').width;
  const releaseW = ctx.measureText('release focus').width;
  const gap = hintFont * 2;
  const leftW = anyKeyW + hintFont * 0.6 + beginW;
  const rightW = escKeyW + hintFont * 0.6 + releaseW;
  const rowW = leftW + gap + rightW;
  const rowX = x + (w - rowW) / 2;
  drawKeyHint(ctx, rowX, hintY, 'Any key', 'begin', hintFont);
  drawKeyHint(ctx, rowX + leftW + gap, hintY, 'Esc', 'release focus', hintFont);

  ctx.restore();
}
