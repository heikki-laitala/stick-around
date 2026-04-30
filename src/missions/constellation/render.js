import { effectiveHudHeight } from '../../constants.js';
import { STAR_RADIUS, FLASH_DURATION } from '../constellation.js';

/**
 * Visuals for the Constellation Maker mission — stars, drawn edges,
 * the success/failure flash on each shot, and the target diagram in
 * the corner.
 */

// Target-diagram geometry. Shared so the tutorial banner can sit
// below the diagram without overlapping it on narrow terminals.
const DIAGRAM_PAD_X = 8;
const DIAGRAM_PAD_Y_OFFSET = 6;
const DIAGRAM_BOX_W = 120;
const DIAGRAM_BOX_H = 96;

function findStar(stars, id) {
  if (!Array.isArray(stars)) return null;
  for (const s of stars) if (s.id === id) return s;
  return null;
}

export function drawStars(ctx, stars) {
  if (!Array.isArray(stars) || stars.length === 0) return;
  const t = performance.now() / 1000;
  ctx.save();
  for (const s of stars) {
    const pulse = 1 + 0.18 * Math.sin(t * 2 + s.x * 0.01 + s.y * 0.013);
    const r = STAR_RADIUS * pulse;
    ctx.shadowColor = 'rgba(255, 255, 220, 0.9)';
    ctx.shadowBlur = 14;
    // Outer halo + inner core for a "shining" look.
    ctx.fillStyle = 'rgba(255, 245, 180, 0.85)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 240, 1)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // ID label, small and unobtrusive — helps the player match the
    // diagram against the stars in the sky.
    ctx.fillStyle = 'rgba(255, 240, 180, 0.8)';
    ctx.font = "bold 9px 'Cinzel', serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(s.id, s.x, s.y + r + 2);
  }
  ctx.restore();
}

/**
 * For each undrawn edge, render a short directional stub past the
 * lower star — just enough to whisper "the perch is somewhere down
 * this line." The stub is short on purpose: it tells the player which
 * direction to roughly travel, but they still have to extrapolate
 * the exact perch and walk into it. Without any hint at all, perches
 * are unfindable; with a full perch line, the puzzle solves itself.
 */
const GUIDE_STUB_LENGTH = 28;

export function drawGuideLines(ctx, scene) {
  if (!scene?.edges || !scene?.stars) return;
  const t = performance.now() / 1000;
  ctx.save();
  for (const edge of scene.edges) {
    if (edge.drawn) continue;
    const sa = findStar(scene.stars, edge.a);
    const sb = findStar(scene.stars, edge.b);
    if (!sa || !sb) continue;
    const upper = sa.y <= sb.y ? sa : sb;
    const lower = sa.y <= sb.y ? sb : sa;
    const dx = lower.x - upper.x;
    const dy = lower.y - upper.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const ex = lower.x + ux * GUIDE_STUB_LENGTH;
    const ey = lower.y + uy * GUIDE_STUB_LENGTH;
    const pulse = 0.5 + 0.25 * Math.sin(t * 1.6 + lower.x * 0.012);
    ctx.shadowColor = 'rgba(255, 230, 160, 0.4)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = `rgba(255, 230, 160, ${0.35 * pulse})`;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(lower.x, lower.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

export function drawEdges(ctx, scene) {
  if (!scene?.edges || !scene?.stars) return;
  ctx.save();
  for (const edge of scene.edges) {
    if (!edge.drawn) continue;
    const a = findStar(scene.stars, edge.a);
    const b = findStar(scene.stars, edge.b);
    if (!a || !b) continue;
    // Glowing gold line — the constellation literally lights up as it's
    // traced.
    ctx.shadowColor = 'rgba(255, 220, 90, 0.9)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(255, 230, 130, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Thin bright core inside the glow.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Cascade-pulse the stars one-by-one (id order), then bloom the whole
 * shape into a unified shimmer with a "constellation complete" flourish
 * underneath. Plays in real time off `scene.celebration.age` so the
 * mission's update loop can advance it however it wants.
 */
export function drawCelebration(ctx, scene) {
  const c = scene?.celebration;
  if (!c) return;
  const t = c.age;
  const stars = scene.stars || [];
  const edges = scene.edges || [];
  if (stars.length === 0) return;
  ctx.save();

  // Cascade the stars at ~130ms apart. Each pulse rises fast, holds,
  // then trails off — the shape lights up as the wave passes.
  const STAGGER = 0.13;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const elapsed = t - i * STAGGER;
    if (elapsed <= 0) continue;
    const peak = elapsed < 0.35
      ? elapsed / 0.35
      : Math.max(0, 1 - (elapsed - 0.35) / 1.0);
    if (peak <= 0) continue;
    ctx.shadowColor = 'rgba(255, 240, 160, 0.95)';
    ctx.shadowBlur = 28 * peak;
    ctx.fillStyle = `rgba(255, 250, 220, ${0.7 * peak})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4 + 14 * peak, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Whole-shape shimmer once the cascade has reached every star.
  const shimmerStart = stars.length * STAGGER;
  if (t > shimmerStart) {
    const localT = t - shimmerStart;
    const fadeIn = Math.min(1, localT / 0.3);
    const fadeOut = Math.max(0, 1 - Math.max(0, localT - 0.7) / 0.4);
    const intensity = fadeIn * fadeOut;
    if (intensity > 0) {
      ctx.shadowColor = 'rgba(255, 240, 200, 1)';
      ctx.shadowBlur = 24 * intensity;
      ctx.strokeStyle = `rgba(255, 250, 210, ${0.9 * intensity})`;
      ctx.lineWidth = 2.4;
      for (const edge of edges) {
        if (!edge.drawn) continue;
        const a = stars.find((s) => s.id === edge.a);
        const b = stars.find((s) => s.id === edge.b);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  // Fanfare text under the constellation, fading in slightly before
  // the shimmer peaks so it reads as part of the same moment.
  const textStart = shimmerStart - 0.1;
  if (t > textStart) {
    const localT = t - textStart;
    const fadeIn = Math.min(1, localT / 0.25);
    const fadeOut = Math.max(0, 1 - Math.max(0, localT - 1.0) / 0.4);
    const alpha = fadeIn * fadeOut;
    if (alpha > 0) {
      let cx = 0;
      let maxY = -Infinity;
      for (const s of stars) {
        cx += s.x;
        if (s.y > maxY) maxY = s.y;
      }
      cx /= stars.length;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = `rgba(255, 240, 180, ${alpha})`;
      ctx.font = "bold 22px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('constellation complete', cx, maxY + 56);
    }
  }

  ctx.restore();
}

export function drawShotFlash(ctx, scene) {
  const f = scene?.flash;
  if (!f) return;
  // A "miss" had fewer than 2 stars on the ray — nothing to draw.
  if (f.missed) return;
  const a = f.from;
  const b = f.to;
  if (!a || !b) return;
  const fade = Math.max(0, 1 - f.age / FLASH_DURATION);
  ctx.save();
  if (f.success) {
    // Gold burst pulse along the new edge — sits on top of the
    // permanent line so it briefly brightens the connection.
    ctx.shadowColor = 'rgba(255, 240, 140, 0.9)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255, 240, 200, ${0.95 * fade})`;
    ctx.lineWidth = 3;
  } else {
    // Red rejection — a wrong pair was just hit.
    ctx.shadowColor = 'rgba(255, 90, 110, 0.85)';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = `rgba(255, 110, 130, ${0.9 * fade})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Tiny graph in the top-left of the screen showing the target
 * constellation. Drawn edges glow; remaining edges are dim. Lets the
 * player check progress at a glance without scanning the sky.
 */
export function drawTargetDiagram(ctx, scene, screenW) {
  if (!scene?.edges || !scene?.stars) return;
  const padX = DIAGRAM_PAD_X;
  const padY = effectiveHudHeight(screenW) + DIAGRAM_PAD_Y_OFFSET;
  const boxW = DIAGRAM_BOX_W;
  const boxH = DIAGRAM_BOX_H;
  ctx.save();
  // Background panel — soft dark blue to read like a star chart.
  ctx.fillStyle = 'rgba(15, 20, 40, 0.7)';
  ctx.strokeStyle = 'rgba(255, 240, 180, 0.5)';
  ctx.lineWidth = 1;
  ctx.fillRect(padX, padY, boxW, boxH);
  ctx.strokeRect(padX, padY, boxW, boxH);
  // Compute the bounding box of the star positions so we can map them
  // proportionally into the diagram.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of scene.stars) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  const range = (a, b) => Math.max(1, b - a);
  // Generous inner padding so the topmost / bottommost stars don't
  // sit on the box border and get visually swallowed by it.
  const innerPad = 14;
  const project = (s) => ({
    x: padX + innerPad + ((s.x - minX) / range(minX, maxX)) * (boxW - innerPad * 2),
    y: padY + innerPad + ((s.y - minY) / range(minY, maxY)) * (boxH - innerPad * 2),
  });
  // Edges
  for (const edge of scene.edges) {
    const a = findStar(scene.stars, edge.a);
    const b = findStar(scene.stars, edge.b);
    if (!a || !b) continue;
    const pa = project(a);
    const pb = project(b);
    ctx.strokeStyle = edge.drawn
      ? 'rgba(255, 230, 130, 0.95)'
      : 'rgba(255, 240, 180, 0.25)';
    ctx.lineWidth = edge.drawn ? 1.8 : 1.0;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  // Star dots on top of the edges, with a dark halo so they read on
  // top of the line bundle, plus an id label tucked just outside the
  // dot so each star is identifiable against the in-world stars. The
  // label is anchored to whichever side of the dot has more room
  // inside the box, so the rightmost star's label never spills past
  // the right border.
  ctx.font = "bold 9px 'Cinzel', serif";
  ctx.textBaseline = 'middle';
  const midX = padX + boxW / 2;
  for (const s of scene.stars) {
    const p = project(s);
    ctx.fillStyle = 'rgba(15, 20, 40, 0.95)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 220, 0.98)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 240, 180, 0.9)';
    const labelLeft = p.x > midX;
    ctx.textAlign = labelLeft ? 'right' : 'left';
    ctx.fillText(s.id, p.x + (labelLeft ? -6 : 6), p.y);
  }
  ctx.restore();
}

/**
 * Brief onboarding hint at the top of the play area: tells the player
 * what the goal is and which key fires the bolt. Fades in fast, holds
 * for a few seconds, then fades out — long enough to read once,
 * short enough to stay out of the way for repeat runs.
 */
const BANNER_HOLD = 5.0;
const BANNER_FADE_IN = 0.4;
const BANNER_FADE_OUT = 1.0;
const BANNER_TOTAL = BANNER_HOLD + BANNER_FADE_IN + BANNER_FADE_OUT;

export function drawTutorialBanner(ctx, scene, screenW) {
  const age = scene?.bannerAge;
  if (typeof age !== 'number' || age >= BANNER_TOTAL) return;
  const fadeIn = Math.min(1, age / BANNER_FADE_IN);
  const fadeOut = age > BANNER_FADE_IN + BANNER_HOLD
    ? Math.max(0, 1 - (age - BANNER_FADE_IN - BANNER_HOLD) / BANNER_FADE_OUT)
    : 1;
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0.01) return;

  const cx = screenW / 2;
  // Sit just below the target diagram in the upper-left so the banner
  // never overlaps it on narrow terminals.
  const diagramBottom = effectiveHudHeight(screenW) + DIAGRAM_PAD_Y_OFFSET + DIAGRAM_BOX_H;
  const top = diagramBottom + 8;
  const padX = 18;
  const padY = 10;
  const titleFont = "bold 20px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  const subFont = "13px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  const title = 'Trace the constellation';
  const sub = 'stand where two target stars line up overhead — hold 2 to fire lightning';

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = titleFont;
  const titleW = ctx.measureText(title).width;
  ctx.font = subFont;
  const subW = ctx.measureText(sub).width;
  const bgW = Math.max(titleW, subW) + padX * 2;
  const bgH = 22 + 18 + padY * 2;

  ctx.fillStyle = `rgba(15, 20, 40, ${0.78 * alpha})`;
  ctx.strokeStyle = `rgba(255, 240, 180, ${0.55 * alpha})`;
  ctx.lineWidth = 1;
  ctx.fillRect(cx - bgW / 2, top, bgW, bgH);
  ctx.strokeRect(cx - bgW / 2, top, bgW, bgH);

  ctx.shadowColor = `rgba(0, 0, 0, ${0.7 * alpha})`;
  ctx.shadowBlur = 4;
  ctx.font = titleFont;
  ctx.fillStyle = `rgba(255, 240, 180, ${0.98 * alpha})`;
  ctx.fillText(title, cx, top + padY);
  ctx.font = subFont;
  ctx.fillStyle = `rgba(220, 215, 200, ${0.92 * alpha})`;
  ctx.fillText(sub, cx, top + padY + 26);
  ctx.restore();
}

export function renderConstellationHud(ctx, scene, screenW) {
  const drawn = (scene.edges || []).filter((e) => e.drawn).length;
  const total = scene.edges?.length || 0;
  const left = Math.max(0, scene.timeLeft || 0);
  const urgent = left < 15;
  ctx.save();
  ctx.font = "bold 16px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = urgent
    ? `rgba(255, ${160 + Math.round(40 * Math.sin(left * 12))}, 110, 0.98)`
    : 'rgba(255, 240, 180, 0.95)';
  ctx.fillText(
    `constellation ${drawn}/${total}  •  ${left.toFixed(1)}s`,
    screenW / 2,
    effectiveHudHeight(screenW) + 4,
  );
  ctx.restore();
}
