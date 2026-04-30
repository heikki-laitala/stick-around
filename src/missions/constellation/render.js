import { effectiveHudHeight } from '../../constants.js';
import { STAR_RADIUS, FLASH_DURATION } from '../constellation.js';

/**
 * Visuals for the Constellation Maker mission — stars, drawn edges,
 * the success/failure flash on each shot, and the target diagram in
 * the corner.
 */

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
  const padX = 8;
  const padY = effectiveHudHeight(screenW) + 6;
  const boxW = 120;
  const boxH = 96;
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
  // dot so each star is identifiable against the in-world stars.
  ctx.font = "bold 9px 'Cinzel', serif";
  ctx.textBaseline = 'middle';
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
    ctx.textAlign = 'left';
    ctx.fillText(s.id, p.x + 6, p.y);
  }
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
