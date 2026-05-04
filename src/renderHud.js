/**
 * HUD rendering — the opaque strip across the top of the overlay that
 * shows the player's counters (balls/mana), selected spell, class, and
 * the current/next quest. Styled like a dark-wood/parchment RPG panel
 * with gold trim, a serif typeface, and canvas-drawn fantasy icons
 * rather than Unicode dingbats.
 *
 * When single-row content won't fit the available width, the HUD grows
 * to `HUD_HEIGHT_TALL` and splits into two rows (icons on top, quest on
 * bottom). `hudNeedsTwoRows` makes that decision by measuring the real
 * content; the render loop pushes the result into `state.hudTall` and
 * forwards it to the Rust overlay so the reserved strip resizes to match.
 */

import { HUD_HEIGHT, HUD_HEIGHT_TALL } from './constants.js';
import { displayClass, getActiveMission } from './progression.js';
import { isShielded, selectedSpell, canCastSelected } from './spells.js';

const CLOSE_BTN_MARGIN = 6;

const HUD_FONT = "bold 13px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
const HUD_PARCHMENT = 'rgba(230, 215, 170, 0.95)';
const HUD_GOLD = 'rgba(190, 155, 85, 0.9)';

// Single-row layout x-coordinates — kept in sync between the measurement
// helper and the renderer below so the "does it fit?" check matches what
// will actually be drawn.
const CLASS_LABEL_X = 278;
const SINGLE_ROW_MISSION_X = 460;
const MISSION_RIGHT_PAD = 12;
const MIN_MISSION_WIDTH = 40;

// Two-row HUD vertical anchor: the icon row sits TWO_ROW_INSET px from
// the top of the strip, and the mission row sits the same distance up
// from the bottom. Tuned for HUD_HEIGHT_TALL — wider numbers crowd the
// gold trim, smaller ones swim in the middle of the panel.
const TWO_ROW_INSET = 15;
// Vertical clip box around the mission text on a two-row HUD (so a
// long quest fades behind the gold trim instead of bleeding past it).
const MISSION_CLIP_INSET = 12;
const MISSION_CLIP_HEIGHT = 24;
// Separator half-height — each tick is 2 × this px tall, centered on
// the row midline. Matches the visual gap between adjacent HUD columns.
const SEPARATOR_HALF = 9;

/**
 * True when the single-row HUD layout would clip — i.e. the class label
 * already overruns the mission slot, or the remaining space to the left
 * of the close button isn't enough for the current quest text. Pure
 * function of the canvas context, game state, and screen width.
 */
export function hudNeedsTwoRows(ctx, state, screenW) {
  const prevFont = ctx.font;
  ctx.font = HUD_FONT;
  let needs = false;
  const classW = ctx.measureText(displayClass(state)).width;
  const classEndX = CLASS_LABEL_X + classW;
  if (classEndX + 14 > SINGLE_ROW_MISSION_X) {
    needs = true;
  } else {
    const closeBtn = getCloseButtonRect(screenW);
    const available = closeBtn.x - SINGLE_ROW_MISSION_X - MISSION_RIGHT_PAD;
    if (available < MIN_MISSION_WIDTH) {
      needs = true;
    } else if (state.mission) {
      const active = getActiveMission(state);
      const suffix = active?.questSuffix?.(state);
      const label = suffix
        ? `Quest: ${state.mission} ${suffix}`
        : `Quest: ${state.mission}`;
      const questW = ctx.measureText(label).width;
      if (questW > available) needs = true;
    }
  }
  ctx.font = prevFont;
  return needs;
}

export function renderHUD(ctx, state, screenW) {
  const twoRow = !!state.hudTall;
  const hudH = twoRow ? HUD_HEIGHT_TALL : HUD_HEIGHT;

  // Panel background: dark aged wood with vertical gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, hudH);
  grad.addColorStop(0, 'rgb(26, 22, 16)');
  grad.addColorStop(1, 'rgb(38, 32, 24)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, screenW, hudH);

  // Gold bottom trim: 2px band + 1px highlight.
  ctx.fillStyle = HUD_GOLD;
  ctx.fillRect(0, hudH - 2, screenW, 2);
  ctx.fillStyle = 'rgba(235, 205, 135, 0.45)';
  ctx.fillRect(0, hudH - 3, screenW, 1);

  ctx.font = HUD_FONT;
  ctx.textBaseline = 'alphabetic';
  // Row centers: single-row HUDs render everything on one midline; two-row
  // HUDs put icons/counters on the top row and the quest text on the bottom.
  const row1Y = twoRow ? TWO_ROW_INSET : hudH / 2;
  const row2Y = twoRow ? hudH - TWO_ROW_INSET : hudH / 2;
  const ref = ctx.measureText('M0');
  const capOff = (ref.actualBoundingBoxAscent - ref.actualBoundingBoxDescent) / 2;
  const row1TextY = row1Y + capOff;
  const row2TextY = row2Y + capOff;
  const ICON = 7;

  // Glowing balls — same palette as the in-world collectibles, pulsing
  const pulse = 1 + 0.12 * Math.sin(performance.now() / 250);
  drawGlowingBallIcon(ctx, 14, row1Y, ICON, pulse);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 220, 50, 0.8)';
  ctx.shadowBlur = 6 + 4 * (pulse - 1) / 0.12; // track the pulse
  ctx.fillStyle = 'rgba(255, 240, 170, 0.98)';
  ctx.fillText(`${state.score || 0}`, 28, row1TextY);
  ctx.restore();
  drawSeparator(ctx, 70, row1Y);

  // Mana — blue potion flask
  drawPotionIcon(ctx, 84, row1Y, ICON, 'rgb(90, 160, 255)');
  ctx.fillStyle = HUD_PARCHMENT;
  ctx.fillText(`${Math.floor(state.mana || 0)}`, 98, row1TextY);
  drawSeparator(ctx, 140, row1Y);

  // Spells — sparkle/star icon; selected spell name shown next to it.
  // Greyed when the player doesn't have enough mana to cast; pulses blue
  // while a shield is active.
  const spellName = selectedSpell(state) || '—';
  const castable = canCastSelected(state);
  const shielded = isShielded(state);
  const sparkleColor = shielded
    ? `rgba(120, 210, 255, ${0.85 + 0.15 * Math.sin(performance.now() / 160)})`
    : castable ? 'rgb(200, 180, 255)' : 'rgba(160, 155, 180, 0.5)';
  drawSparkleIcon(ctx, 154, row1Y, ICON, sparkleColor);
  ctx.fillStyle = shielded
    ? 'rgba(180, 225, 255, 0.98)'
    : castable ? HUD_PARCHMENT : 'rgba(180, 170, 160, 0.55)';
  const spellM = ctx.measureText(spellName);
  const spellY = row1Y + (spellM.actualBoundingBoxAscent - spellM.actualBoundingBoxDescent) / 2;
  ctx.fillText(spellName, 168, spellY);
  drawSeparator(ctx, 250, row1Y);

  // Class — small crown
  drawCrownIcon(ctx, 264, row1Y, ICON, 'rgb(230, 190, 100)');
  ctx.fillStyle = 'rgba(240, 210, 165, 0.95)';
  ctx.fillText(displayClass(state), 278, row1TextY);

  // Quest + Next (flexible — clipped to space before close button on a
  // single row, or stretched across the full bottom row on a tall HUD).
  // Current quest uses the parchment-green; next quest is dimmer so it
  // reads as a preview, not a competing goal.
  const closeBtn = getCloseButtonRect(screenW);
  const missionX = twoRow ? 14 : SINGLE_ROW_MISSION_X;
  const missionMaxW = twoRow
    ? screenW - missionX - MISSION_RIGHT_PAD
    : closeBtn.x - missionX - MISSION_RIGHT_PAD;
  const missionTextY = twoRow ? row2TextY : row1TextY;
  if (missionMaxW > 40 && state.mission) {
    ctx.save();
    ctx.beginPath();
    const clipY = twoRow ? row2Y - MISSION_CLIP_INSET : 0;
    const clipH = twoRow ? MISSION_CLIP_HEIGHT : hudH;
    ctx.rect(missionX, clipY, missionMaxW, clipH);
    ctx.clip();
    ctx.fillStyle = 'rgba(195, 230, 180, 0.95)';
    const active = getActiveMission(state);
    const suffix = active?.questSuffix?.(state);
    const questLabel = suffix
      ? `Quest: ${state.mission} ${suffix}`
      : `Quest: ${state.mission}`;
    ctx.fillText(questLabel, missionX, missionTextY);
    if (state.nextMission) {
      const questW = ctx.measureText(questLabel).width;
      const nextX = missionX + questW + 14;
      if (nextX < missionX + missionMaxW - 40) {
        ctx.fillStyle = 'rgba(195, 230, 180, 0.45)';
        ctx.fillText(`Next: ${state.nextMission}`, nextX, missionTextY);
      }
    }
    ctx.restore();
  }

  // Close button
  const hover = isInCloseButton(state.mouseX || -1, state.mouseY || -1, screenW);
  drawCloseButton(ctx, closeBtn, hover);
}

function drawSeparator(ctx, x, rowY = HUD_HEIGHT / 2) {
  ctx.strokeStyle = 'rgba(190, 155, 85, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Tick centered on the row (full height = 2 × SEPARATOR_HALF px) —
  // matches the visual span between adjacent column rows in the
  // single-row HUD.
  ctx.moveTo(x + 0.5, rowY - SEPARATOR_HALF);
  ctx.lineTo(x + 0.5, rowY + SEPARATOR_HALF);
  ctx.stroke();
}

function drawGlowingBallIcon(ctx, cx, cy, s, pulse = 1) {
  const r = s * 0.85 * pulse;
  ctx.save();
  ctx.shadowColor = 'rgba(255, 220, 50, 0.75)';
  ctx.shadowBlur = 8 + 4 * (pulse - 1) / 0.12;
  ctx.fillStyle = 'rgba(255, 220, 50, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255, 255, 200, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPotionIcon(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(0, -s * 0.05); // visual bounds [cy-0.9s, cy+s] → shift up to center
  // Flask body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.35, cy - s * 0.55);
  ctx.lineTo(cx - s * 0.35, cy - s * 0.1);
  ctx.bezierCurveTo(cx - s * 0.95, cy + s * 0.1, cx - s * 0.95, cy + s, cx, cy + s);
  ctx.bezierCurveTo(cx + s * 0.95, cy + s, cx + s * 0.95, cy + s * 0.1, cx + s * 0.35, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.35, cy - s * 0.55);
  ctx.closePath();
  ctx.fill();
  // Cork
  ctx.fillStyle = 'rgb(130, 90, 50)';
  ctx.fillRect(cx - s * 0.4, cy - s * 0.9, s * 0.8, s * 0.35);
  // Shine
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.3, cy + s * 0.25, s * 0.15, s * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCrownIcon(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(0, s * 0.2); // visual bounds [cy-0.95s, cy+0.55s] → shift down to center
  // Three-peak crown
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.55);
  ctx.lineTo(cx - s, cy - s * 0.25);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.1);
  ctx.lineTo(cx, cy - s * 0.95);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.1);
  ctx.lineTo(cx + s, cy - s * 0.25);
  ctx.lineTo(cx + s, cy + s * 0.55);
  ctx.closePath();
  ctx.fill();
  // Base band
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(cx - s, cy + s * 0.25, s * 2, s * 0.3);
  // Center gem
  ctx.fillStyle = 'rgb(220, 80, 110)';
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.05, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSparkleIcon(ctx, cx, cy, s, color) {
  // Four-pointed sparkle with a small center glow. Reads clearly as
  // "magic" at tiny sizes without the clutter of a wand or scroll.
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx, cy + s);
  ctx.moveTo(cx - s, cy);
  ctx.lineTo(cx + s, cy);
  ctx.moveTo(cx - s * 0.55, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.55, cy + s * 0.55);
  ctx.moveTo(cx - s * 0.55, cy + s * 0.55);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.55);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloseButton(ctx, btn, hover) {
  const r = 4;
  // Body
  ctx.fillStyle = hover ? 'rgba(240, 100, 100, 0.95)' : 'rgba(200, 60, 60, 0.85)';
  roundRect(ctx, btn.x, btn.y, btn.w, btn.h, r);
  ctx.fill();
  // Subtle border
  ctx.strokeStyle = hover ? 'rgba(255, 180, 180, 0.9)' : 'rgba(140, 40, 40, 0.9)';
  ctx.lineWidth = 1;
  roundRect(ctx, btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1, r);
  ctx.stroke();
  // X icon (two crossed lines)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const pad = 6;
  ctx.beginPath();
  ctx.moveTo(btn.x + pad, btn.y + pad);
  ctx.lineTo(btn.x + btn.w - pad, btn.y + btn.h - pad);
  ctx.moveTo(btn.x + btn.w - pad, btn.y + pad);
  ctx.lineTo(btn.x + pad, btn.y + btn.h - pad);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Bounds of the HUD close button (square, top-right of the HUD strip,
 * inset by CLOSE_BTN_MARGIN on all visible sides).
 */
export function getCloseButtonRect(screenW) {
  // Size is fixed at the single-row HUD height so a tall HUD doesn't puff the
  // close button into an oversized slab. Position stays top-right — on a tall
  // two-row HUD that means it sits on the top row next to the icons.
  const size = HUD_HEIGHT - 2 * CLOSE_BTN_MARGIN;
  return {
    x: screenW - size - CLOSE_BTN_MARGIN,
    y: CLOSE_BTN_MARGIN,
    w: size,
    h: size,
  };
}

/**
 * True if the given (x, y) lies inside the close button rect.
 */
export function isInCloseButton(x, y, screenW) {
  const b = getCloseButtonRect(screenW);
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}
