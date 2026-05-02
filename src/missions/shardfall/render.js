import { effectiveHudHeight, hudStripHeight } from '../../constants.js';
import { SHARD_RADIUS, SHARDFALL_GOAL } from '../shardfall.js';

/**
 * Visuals for the Shardfall mission — falling shards, the stasis
 * vignette while the spell is active, and a brief tutorial banner at
 * mission start. The persistent count + timer is shown by the global
 * HUD's `Quest:` line via `questSuffix`, so we don't repeat it here.
 */

// Gold shards are rare bonus drops worth two catches. Drawn warmer
// and a touch larger than common shards so the player notices them
// in their peripheral vision.
const COMMON_PALETTE = {
  glow: 'rgba(180, 220, 255, 0.85)',
  fill: 'rgba(170, 210, 255, 0.85)',
  core: 'rgba(240, 250, 255, 0.95)',
  trail: 'rgba(180, 220, 255, 0.4)',
  scale: 1.1,
  glowBlur: 14,
};
const GOLD_PALETTE = {
  glow: 'rgba(255, 220, 110, 0.95)',
  fill: 'rgba(255, 220, 130, 0.9)',
  core: 'rgba(255, 250, 220, 0.98)',
  trail: 'rgba(255, 220, 130, 0.5)',
  scale: 1.3,
  glowBlur: 18,
};

export function drawShards(ctx, scene) {
  if (!scene?.shards || scene.shards.length === 0) return;
  const t = performance.now() / 1000;
  ctx.save();
  for (const s of scene.shards) {
    const pulse = 1 + 0.18 * Math.sin(t * 4 + s.x * 0.02);
    const pal = s.kind === 'gold' ? GOLD_PALETTE : COMMON_PALETTE;
    // Outer glow.
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = pal.glowBlur * pulse;
    ctx.fillStyle = pal.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, SHARD_RADIUS * pulse * pal.scale, 0, Math.PI * 2);
    ctx.fill();
    // Bright core.
    ctx.shadowBlur = 0;
    ctx.fillStyle = pal.core;
    ctx.beginPath();
    ctx.arc(s.x, s.y, SHARD_RADIUS * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Trailing hairline behind the shard so motion reads cleanly even
    // at slow-mo speed.
    ctx.strokeStyle = pal.trail;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - SHARD_RADIUS);
    ctx.lineTo(s.x, s.y - SHARD_RADIUS - 14);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Stasis vignette + ripple radiating from the caster. Both effects
 * are centred on `(originX, originY)` — typically the player's torso —
 * so the player reads as the source of the time bubble. The vignette
 * "breathes" with a slow sine; an activation punch fades over the
 * first 0.5s. A single cyan ring expands outward and recycles every
 * ~2s, fading as it grows so it reads as a continuous wave.
 */
export function drawStasisVignette(ctx, W, H, age = 0, originX = W / 2, originY = H / 2) {
  const t = Math.max(0, age);
  const punch = Math.exp(-t * 6) * 0.5;
  const breath = 0.85 + 0.15 * Math.sin(t * 3.2);
  const baseAlpha = 0.35 * breath + punch;

  ctx.save();
  // Inner radius small (clear circle around the caster), outer radius
  // far enough to cover any corner of the screen from this origin.
  const inner = 60;
  const cornerDist = Math.max(
    Math.hypot(originX, originY),
    Math.hypot(W - originX, originY),
    Math.hypot(originX, H - originY),
    Math.hypot(W - originX, H - originY),
  );
  const outer = Math.max(inner + 1, cornerDist);
  const grad = ctx.createRadialGradient(originX, originY, inner, originX, originY, outer);
  grad.addColorStop(0, 'rgba(80, 140, 220, 0)');
  grad.addColorStop(1, `rgba(80, 140, 220, ${baseAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const RIPPLE_LIFE = 2.0;
  const phase = (t % RIPPLE_LIFE) / RIPPLE_LIFE;
  const r = phase * cornerDist;
  const ripAlpha = 0.32 * (1 - phase);
  if (ripAlpha > 0.01) {
    ctx.strokeStyle = `rgba(180, 220, 255, ${ripAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(originX, originY, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

const BANNER_HOLD = 5.0;
const BANNER_FADE_IN = 0.4;
const BANNER_FADE_OUT = 1.0;
const BANNER_TOTAL = BANNER_HOLD + BANNER_FADE_IN + BANNER_FADE_OUT;

export function drawShardfallBanner(ctx, scene, screenW, state) {
  const age = scene?.bannerAge;
  if (typeof age !== 'number' || age >= BANNER_TOTAL) return;
  const fadeIn = Math.min(1, age / BANNER_FADE_IN);
  const fadeOut = age > BANNER_FADE_IN + BANNER_HOLD
    ? Math.max(0, 1 - (age - BANNER_FADE_IN - BANNER_HOLD) / BANNER_FADE_OUT)
    : 1;
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0.01) return;

  const cx = screenW / 2;
  // Sit just below the live HUD strip — using state.hudTall when
  // available so the banner doesn't get painted over on a multi-row
  // HUD.
  const hudH = state ? hudStripHeight(state) : effectiveHudHeight(screenW);
  const top = hudH + 8;
  const padX = 18;
  const padY = 10;
  const titleFont = "bold 20px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  const subFont = "13px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  const title = `Catch ${SHARDFALL_GOAL} falling shards`;
  const sub = 'walk under or jump up to grab one — hold 3 or R to cast stasis';

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = titleFont;
  const titleW = ctx.measureText(title).width;
  ctx.font = subFont;
  const subW = ctx.measureText(sub).width;
  const bgW = Math.max(titleW, subW) + padX * 2;
  const bgH = 22 + 18 + padY * 2;

  ctx.fillStyle = `rgba(15, 25, 50, ${0.78 * alpha})`;
  ctx.strokeStyle = `rgba(180, 220, 255, ${0.55 * alpha})`;
  ctx.lineWidth = 1;
  ctx.fillRect(cx - bgW / 2, top, bgW, bgH);
  ctx.strokeRect(cx - bgW / 2, top, bgW, bgH);

  ctx.shadowColor = `rgba(0, 0, 0, ${0.7 * alpha})`;
  ctx.shadowBlur = 4;
  ctx.font = titleFont;
  ctx.fillStyle = `rgba(180, 220, 255, ${0.98 * alpha})`;
  ctx.fillText(title, cx, top + padY);
  ctx.font = subFont;
  ctx.fillStyle = `rgba(220, 230, 240, ${0.92 * alpha})`;
  ctx.fillText(sub, cx, top + padY + 26);
  ctx.restore();
}
