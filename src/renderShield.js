/**
 * Shield aura rendering — a layered magical dome that wraps the man
 * while `isShielded(state)` is true. Self-contained: all visual math
 * lives here and the caller only needs to hand over a center, radius,
 * and fade-in alpha.
 *
 * Layers, from back to front: radial-gradient bubble, double rim,
 * outer hex ring (10 cells, clockwise), inner hex ring (6 cells,
 * counter-clockwise), rune tick band, four channels of crackling
 * energy arcs along the rim, and a crescent specular highlight to
 * sell the 3D sphere look.
 */

// Deterministic 0..1 for integer seeds — cheap shader-style PRNG so
// crackles can pick positions without allocating per-frame state.
function shieldNoise(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawHex(ctx, cx, cy, radius, rot) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = rot + (k / 6) * Math.PI * 2;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
}

export function drawShieldAura(ctx, cx, cy, baseR, alpha) {
  if (alpha <= 0) return;
  const now = performance.now();
  const pulse = 1 + 0.025 * Math.sin(now / 170);
  const r = baseR * pulse;

  ctx.save();

  // Soft bubble — radial gradient with a bright rim so the dome reads
  // as a glass sphere rather than a flat tinted disc.
  const grad = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
  grad.addColorStop(0, 'rgba(120, 200, 255, 0)');
  grad.addColorStop(0.72, `rgba(120, 200, 255, ${0.16 * alpha})`);
  grad.addColorStop(1, `rgba(195, 240, 255, ${0.48 * alpha})`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Double rim — outer sharp line + inner glow for a layered glass look.
  ctx.shadowColor = `rgba(140, 215, 255, ${alpha})`;
  ctx.shadowBlur = 9;
  ctx.strokeStyle = `rgba(200, 240, 255, ${0.65 * alpha})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(160, 220, 255, ${0.35 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2);
  ctx.stroke();

  // Outer hex ring — 10 cells orbiting slowly clockwise, flat faces out.
  ctx.strokeStyle = `rgba(150, 225, 255, ${0.55 * alpha})`;
  ctx.lineWidth = 1;
  ctx.shadowColor = `rgba(100, 200, 255, ${0.55 * alpha})`;
  ctx.shadowBlur = 5;
  const outerRot = now / 1800;
  const outerHexR = r * 0.2;
  const outerCount = 10;
  for (let i = 0; i < outerCount; i++) {
    const theta = outerRot + (i / outerCount) * Math.PI * 2;
    const hx = cx + Math.cos(theta) * (r - outerHexR * 0.55);
    const hy = cy + Math.sin(theta) * (r - outerHexR * 0.55);
    drawHex(ctx, hx, hy, outerHexR, theta);
  }

  // Inner hex ring — 6 smaller cells counter-rotating for depth.
  ctx.strokeStyle = `rgba(170, 230, 255, ${0.4 * alpha})`;
  const innerRot = -now / 2400;
  const innerHexR = r * 0.13;
  const innerCount = 6;
  for (let i = 0; i < innerCount; i++) {
    const theta = innerRot + (i / innerCount) * Math.PI * 2;
    const hx = cx + Math.cos(theta) * (r * 0.45);
    const hy = cy + Math.sin(theta) * (r * 0.45);
    drawHex(ctx, hx, hy, innerHexR, theta);
  }

  // Rune tick band — thin circle at r*0.82 with 16 counter-rotating ticks.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(200, 240, 255, ${0.4 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  const tickRot = -now / 1100;
  ctx.strokeStyle = `rgba(220, 245, 255, ${0.7 * alpha})`;
  ctx.lineWidth = 1.2;
  const tickCount = 16;
  for (let i = 0; i < tickCount; i++) {
    const theta = tickRot + (i / tickCount) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(theta) * r * 0.79, cy + Math.sin(theta) * r * 0.79);
    ctx.lineTo(cx + Math.cos(theta) * r * 0.87, cy + Math.sin(theta) * r * 0.87);
    ctx.stroke();
  }

  // Crackling energy arcs — four independent cycle channels. Each
  // channel is visible briefly at the start of its cycle, then dark,
  // so at any moment you see 0-2 crackles flickering along the rim.
  // Positions and jitter are seeded from the cycle index so the arcs
  // are stable within a cycle but different across cycles.
  const channels = 4;
  for (let i = 0; i < channels; i++) {
    const cycleMs = 360 + i * 97;
    const phase = (now % cycleMs) / cycleMs;
    if (phase > 0.2) continue;
    const crackleAlpha = (1 - phase / 0.2) * alpha;
    const cycleIdx = Math.floor(now / cycleMs);
    const seed = cycleIdx * 131 + i * 257;
    const ang = shieldNoise(seed) * Math.PI * 2;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const tx = -sinA;
    const ty = cosA;
    const anchorX = cx + cosA * r;
    const anchorY = cy + sinA * r;
    const segLen = r * 0.45;
    const segCount = 7;
    ctx.strokeStyle = `rgba(230, 250, 255, ${0.95 * crackleAlpha})`;
    ctx.shadowColor = `rgba(170, 220, 255, ${crackleAlpha})`;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let k = 0; k <= segCount; k++) {
      const t = k / segCount - 0.5;
      const jRad = (shieldNoise(seed + k * 7) - 0.5) * r * 0.09;
      const jTan = (shieldNoise(seed + k * 13) - 0.5) * r * 0.02;
      const px = anchorX + tx * (segLen * t + jTan) + cosA * jRad;
      const py = anchorY + ty * (segLen * t + jTan) + sinA * jRad;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Crescent specular — bright arc upper-left. Cements the 3D sphere
  // illusion by placing a consistent "lit from above-left" highlight.
  ctx.strokeStyle = `rgba(240, 252, 255, ${0.85 * alpha})`;
  ctx.lineWidth = 1.7;
  ctx.shadowColor = `rgba(180, 230, 255, ${alpha})`;
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 1.12, Math.PI * 1.48);
  ctx.stroke();

  ctx.restore();
}
