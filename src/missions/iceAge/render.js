import { effectiveHudHeight } from '../../constants.js';
import {
  ceilingY,
  ICICLE_DANGER_W,
  ICICLE_SHAKE_DURATION,
  SNOW_CHUNK_HITS,
  SNOWMAN_LAYERS,
} from '../iceAge.js';

/**
 * Visual rendering for the Ice Age mission.
 *
 * This file owns every pixel the mission paints — platform tints, the
 * frozen ceiling, the snowman, snow chunks, icicles, danger shadows,
 * ambient flakes, the requirement badge. State and gameplay logic stay
 * in `iceAge.js`; rendering only reads, never mutates.
 */

// ── Shared geometry helpers ─────────────────────────────────────────────

// Two-sine ripple used by both the ceiling rim and platform snow caps.
// Two octaves keep the line organic without burning a per-frame random
// table — pixel positions are stable so frost reads as frozen, not fizzy.
function iceWaveAt(x) {
  return (
    Math.sin(x * 0.085) * 1.6 +
    Math.sin(x * 0.23 + 1.4) * 0.9 +
    Math.sin(x * 0.41) * 0.4
  );
}

// First platform whose top a falling icicle would hit. Used by the
// danger shadow so the warning lands on the platform the player would
// actually need to dodge off, not just the column itself.
function findFirstPlatformBelow(state, x, fromY) {
  let best = null;
  for (const p of state.platforms || []) {
    if (!p || p.x == null) continue;
    if (p.y <= fromY) continue;
    if (x < p.x || x > p.x + p.w) continue;
    if (!best || p.y < best.y) best = p;
  }
  return best;
}

// ── Platform tint + frozen ceiling ──────────────────────────────────────

export function renderIceTint(ctx, state, paused) {
  // Each platform gets the same frosted treatment as the ceiling rim:
  // a snow ridge with a wavy top edge, a soft gradient body, a frost
  // highlight, and a sparse glitter pattern. The wave amplitude is
  // small (≤ 2 px) so the man's foot landing at p.y still reads as
  // grounded — the ridges just hint at uneven snow.
  if (!state.platforms || state.platforms.length === 0) return;
  ctx.save();
  ctx.globalAlpha = paused ? 0.4 : 1;
  const lh = state.lineHeight || 16;
  const bandH = Math.min(lh, 7);

  for (const p of state.platforms || []) {
    if (!p || p.w == null || p.w < 4) continue;
    const x0 = p.x;
    const w = p.w;
    const top = p.y;
    const bottom = p.y + bandH;

    const grad = ctx.createLinearGradient(0, top - 2, 0, bottom);
    grad.addColorStop(0, 'rgba(245, 250, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(190, 220, 240, 0.82)');
    grad.addColorStop(1, 'rgba(140, 185, 220, 0.55)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x0 + w; x += 4) {
      ctx.lineTo(x, top - 1 - iceWaveAt(x));
    }
    ctx.lineTo(x0 + w, bottom);
    ctx.closePath();
    ctx.fill();

    // Frost highlight on the snow ridge.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x0 + w; x += 4) {
      const y = top - 1 - iceWaveAt(x);
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Soft shadow line along the bottom edge for depth.
    ctx.strokeStyle = 'rgba(60, 100, 140, 0.3)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x0 + w, bottom);
    ctx.stroke();

    // Sparse glitter — count scales with width.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    const count = Math.max(1, Math.floor(w / 70));
    for (let i = 0; i < count; i++) {
      const sx = x0 + ((i + 0.5) * (w / count)) + ((i * 53) % 17) - 8;
      const sy = top + 1 + ((i * 31) % Math.max(1, bandH - 2));
      ctx.fillRect(sx, sy, 1, 1);
    }
  }

  ctx.restore();
}

export function renderIceCeiling(ctx, state, paused) {
  // A continuous frozen rim that spans the terminal text area. Icicles
  // dangle from its bumpy underside, so the ceiling is a real visible
  // surface instead of an implicit line.
  const top = effectiveHudHeight(state.screenW || 800);
  const bottom = ceilingY(state);
  if (bottom <= top) return;
  const x0 = typeof state.textOffsetX === 'number' ? state.textOffsetX : 0;
  const w = typeof state.textWidth === 'number' && state.textWidth > 0
    ? state.textWidth
    : (state.screenW || 800);

  ctx.save();
  ctx.globalAlpha = paused ? 0.45 : 1;

  const grad = ctx.createLinearGradient(0, top, 0, bottom + 4);
  grad.addColorStop(0, 'rgba(140, 185, 220, 0.9)');
  grad.addColorStop(0.55, 'rgba(220, 235, 250, 0.95)');
  grad.addColorStop(1, 'rgba(170, 205, 235, 0.95)');
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x0 + w, top);
  ctx.lineTo(x0 + w, bottom);
  for (let x = x0 + w; x >= x0; x -= 4) {
    ctx.lineTo(x, bottom + iceWaveAt(x));
  }
  ctx.lineTo(x0, bottom);
  ctx.closePath();
  ctx.fill();

  // Bright frost line along the very top edge.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, top + 1);
  ctx.lineTo(x0 + w, top + 1);
  ctx.stroke();

  // Subtle shadow along the underside for depth.
  ctx.strokeStyle = 'rgba(60, 100, 140, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = x0; x <= x0 + w; x += 4) {
    const y = bottom + iceWaveAt(x);
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Sparkle dots scattered through the ice mass — fixed pattern so they
  // don't shimmer wildly each frame.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const sparkleCount = Math.max(8, Math.floor(w / 60));
  for (let i = 0; i < sparkleCount; i++) {
    const sx = x0 + ((i + 0.5) * (w / sparkleCount)) + ((i * 53) % 19) - 9;
    const sy = top + 2 + ((i * 31) % Math.max(1, bottom - top - 4));
    ctx.fillRect(sx, sy, 1, 1);
    ctx.fillRect(sx + 1, sy, 1, 1);
  }

  ctx.restore();
}

// ── Build zone + snowman ────────────────────────────────────────────────

export function renderBuildZone(ctx, scene) {
  const z = scene.buildZone;
  if (!z) return;
  ctx.save();
  // Snow base — soft white pill, sits on the platform like a flat drift.
  const grad = ctx.createLinearGradient(z.x, z.y, z.x, z.y + z.h);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(1, 'rgba(210, 230, 245, 0.85)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(z.x + 6, z.y + z.h);
  ctx.quadraticCurveTo(z.x, z.y + z.h, z.x, z.y + z.h - 4);
  ctx.quadraticCurveTo(z.x, z.y + 2, z.x + z.w * 0.2, z.y);
  ctx.quadraticCurveTo(z.x + z.w / 2, z.y - 2, z.x + z.w * 0.8, z.y);
  ctx.quadraticCurveTo(z.x + z.w, z.y + 2, z.x + z.w, z.y + z.h - 4);
  ctx.quadraticCurveTo(z.x + z.w, z.y + z.h, z.x + z.w - 6, z.y + z.h);
  ctx.closePath();
  ctx.fill();
  // Glint along the front edge.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(z.x + 8, z.y + 4);
  ctx.quadraticCurveTo(z.x + z.w / 2, z.y - 1, z.x + z.w - 8, z.y + 4);
  ctx.stroke();
  ctx.restore();
}

export function renderSnowman(ctx, scene) {
  const z = scene.buildZone;
  if (!z || !scene.builtLayers) return;
  const cx = z.x + z.w / 2;
  const baseY = z.y + 2;                       // sit just above the snow drift
  const radii = [13, 10, 7];                   // base, torso, head
  let bottomY = baseY;

  // Animation timer kicks in once the snowman is finished — the win-hold
  // gets a celebrating snowman instead of a still life.
  const aliveT = scene.winT || 0;
  const alive = aliveT > 0;
  const breathe = alive ? 1 + Math.sin(aliveT * 4.5) * 0.03 : 1;

  ctx.save();
  for (let i = 0; i < scene.builtLayers; i++) {
    const r = radii[i] * breathe;
    const cy = bottomY - r;
    drawSnowBall(ctx, cx, cy, r);
    if (i === 1) drawArms(ctx, cx, cy, r, aliveT);
    if (i === 2) drawFace(ctx, cx, cy, r, aliveT);
    bottomY = cy - r + 2;                      // overlap a hair so seams don't show
  }
  ctx.restore();
}

function drawSnowBall(ctx, cx, cy, r) {
  const grad = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 1, cx, cy, r);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.6, 'rgba(235, 245, 255, 1)');
  grad.addColorStop(1, 'rgba(180, 205, 230, 1)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 150, 180, 0.55)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawArms(ctx, cx, cy, r, aliveT = 0) {
  ctx.save();
  ctx.strokeStyle = 'rgb(95, 60, 30)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  // Mirrored sway — left twig rises while right twig dips.
  const sway = aliveT > 0 ? Math.sin(aliveT * 3.2) * r * 0.45 : 0;
  // Left twig.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy);
  ctx.lineTo(cx - r * 1.9, cy - r * 0.8 - sway);
  ctx.moveTo(cx - r * 1.55, cy - r * 0.6 - sway * 0.7);
  ctx.lineTo(cx - r * 1.9, cy - r * 1.3 - sway);
  ctx.stroke();
  // Right twig — opposite phase.
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, cy);
  ctx.lineTo(cx + r * 1.9, cy - r * 0.8 + sway);
  ctx.moveTo(cx + r * 1.55, cy - r * 0.6 + sway * 0.7);
  ctx.lineTo(cx + r * 1.9, cy - r * 1.3 + sway);
  ctx.stroke();
  ctx.restore();
}

function drawFace(ctx, cx, cy, r, aliveT = 0) {
  ctx.save();
  // Eye blink: closed for a fraction of every cycle so the face reads as
  // alive without the eyes constantly disappearing.
  const eyeY = cy - r * 0.2;
  const blinkPhase = aliveT > 0 ? aliveT % 1.7 : 1;
  const blinking = blinkPhase < 0.13;
  if (blinking) {
    ctx.strokeStyle = 'rgb(30, 30, 35)';
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, eyeY); ctx.lineTo(cx - r * 0.2, eyeY);
    ctx.moveTo(cx + r * 0.2, eyeY);  ctx.lineTo(cx + r * 0.55, eyeY);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgb(30, 30, 35)';
    ctx.beginPath(); ctx.arc(cx - r * 0.38, eyeY, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + r * 0.38, eyeY, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  // Carrot nose.
  ctx.fillStyle = 'rgb(240, 130, 40)';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.18, cy + r * 0.05);
  ctx.lineTo(cx + r * 0.55, cy + r * 0.18);
  ctx.lineTo(cx - r * 0.18, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 80, 20, 0.7)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  // Coal smile — three dots curving up. Smile widens slightly during the
  // alive state.
  ctx.fillStyle = 'rgb(30, 30, 35)';
  const smileSpread = aliveT > 0 ? 0.36 : 0.32;
  const smileLift = aliveT > 0 ? Math.sin(aliveT * 2.2) * r * 0.05 : 0;
  for (let i = -1; i <= 1; i++) {
    const sx = cx + i * r * smileSpread;
    const sy = cy + r * 0.55 + Math.abs(i) * r * 0.1 - smileLift;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Snow chunks + icicles ───────────────────────────────────────────────

export function renderSnowChunks(ctx, scene) {
  if (!scene.snowChunks) return;
  ctx.save();
  for (const c of scene.snowChunks) {
    const intact = c.hits / SNOW_CHUNK_HITS;
    const r = 8 * (0.6 + 0.4 * intact);
    const grad = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, 1, c.x, c.y, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.7, 'rgba(220, 235, 250, 1)');
    grad.addColorStop(1, 'rgba(160, 195, 225, 1)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Sparkle accent — three tiny crosses, scaled to remaining intact mass.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 0.8;
    const sparkles = [
      [c.x - r * 0.45, c.y - r * 0.55],
      [c.x + r * 0.55, c.y - r * 0.2],
      [c.x - r * 0.1, c.y + r * 0.55],
    ];
    for (const [sx, sy] of sparkles) {
      ctx.beginPath();
      ctx.moveTo(sx - 1.5, sy); ctx.lineTo(sx + 1.5, sy);
      ctx.moveTo(sx, sy - 1.5); ctx.lineTo(sx, sy + 1.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function renderIcicle(ctx, ic) {
  const x = ic.x, y = ic.y;
  const w = ic.w, h = ic.h;
  ctx.save();

  if (ic.state === 'falling') {
    // Soft blue glow trail behind the icicle so its motion reads at speed.
    const trail = ctx.createLinearGradient(x, y - h * 1.2, x, y);
    trail.addColorStop(0, 'rgba(160, 220, 255, 0)');
    trail.addColorStop(1, 'rgba(160, 220, 255, 0.4)');
    ctx.fillStyle = trail;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.3, y - h * 1.2);
    ctx.lineTo(x + w * 0.3, y - h * 1.2);
    ctx.lineTo(x + w * 0.5, y);
    ctx.lineTo(x - w * 0.5, y);
    ctx.closePath();
    ctx.fill();
  }

  // Icicle body — narrowing crystal with a highlight ridge down the middle.
  const body = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y);
  if (ic.state === 'shaking') {
    // Warning tint as the icicle works itself loose. Pulses red as the
    // shake intensity climbs so the last beat before drop is unmistakable.
    const intensity = Math.min(1, (ic.shakeT || 0) / ICICLE_SHAKE_DURATION);
    const warm = 0.4 + 0.6 * intensity;
    body.addColorStop(0, `rgba(${200 + 50 * warm}, ${150 - 80 * intensity}, ${180 - 130 * intensity}, 0.95)`);
    body.addColorStop(0.5, `rgba(255, ${220 - 90 * intensity}, ${230 - 130 * intensity}, 1)`);
    body.addColorStop(1, `rgba(${180 + 60 * warm}, ${130 - 70 * intensity}, ${170 - 130 * intensity}, 0.95)`);
  } else {
    body.addColorStop(0, 'rgba(150, 200, 240, 0.95)');
    body.addColorStop(0.5, 'rgba(230, 245, 255, 1)');
    body.addColorStop(1, 'rgba(110, 170, 220, 0.95)');
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.lineTo(x + w * 0.15, y - h * 0.2);
  ctx.lineTo(x, y);
  ctx.lineTo(x - w * 0.15, y - h * 0.2);
  ctx.closePath();
  ctx.fill();
  // Highlight stripe.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.1, y - h * 0.95);
  ctx.lineTo(x, y - h * 0.05);
  ctx.stroke();
  ctx.restore();
}

export function renderIcicleDangerShadows(ctx, state, scene, paused) {
  if (!scene.icicles) return;
  ctx.save();
  for (const ic of scene.icicles) {
    if (ic.state !== 'shaking') continue;
    const target = findFirstPlatformBelow(state, ic.anchorX, ic.y);
    if (!target) continue;
    // Shadow pulses with the same intensity ramp as the icicle's warning
    // tint so the two reads are synchronized.
    const intensity = Math.min(1, (ic.shakeT || 0) / ICICLE_SHAKE_DURATION);
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ic.shakeT * 18));
    ctx.globalAlpha = (paused ? 0.3 : 1) * intensity * pulse * 0.85;

    const cx = ic.anchorX;
    const cy = target.y - 1;
    const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, ICICLE_DANGER_W * 0.7);
    grad.addColorStop(0, 'rgba(255, 80, 110, 0.85)');
    grad.addColorStop(0.6, 'rgba(220, 110, 160, 0.55)');
    grad.addColorStop(1, 'rgba(220, 110, 160, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ICICLE_DANGER_W * 0.7, 4 + 2 * intensity, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Ambient + HUD ───────────────────────────────────────────────────────

export function renderSnowFlakes(ctx, scene, paused) {
  if (!scene.snowFlakes) return;
  ctx.save();
  ctx.globalAlpha = paused ? 0.3 : 1;
  ctx.fillStyle = 'rgba(245, 250, 255, 1)';
  for (const f of scene.snowFlakes) {
    ctx.globalAlpha = (paused ? 0.3 : 1) * f.alpha;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function renderRequirementBadge(ctx, scene, screenW) {
  const built = scene.builtLayers || 0;
  ctx.save();
  ctx.font = "bold 16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  if (built >= SNOWMAN_LAYERS) {
    ctx.fillStyle = 'rgba(255, 240, 200, 0.98)';
    ctx.fillText('Snowman complete!', screenW / 2, effectiveHudHeight(screenW) + 4);
  } else {
    const haves = scene.snowballsCollected || 0;
    ctx.fillStyle = 'rgba(220, 240, 255, 0.95)';
    ctx.fillText(`snowman ${built} / ${SNOWMAN_LAYERS}  •  carrying ${haves}`, screenW / 2, effectiveHudHeight(screenW) + 4);
  }
  ctx.restore();
}
