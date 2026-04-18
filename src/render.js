import { SCALE, STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT } from './poses.js';
import { findCeiling } from './platforms.js';
import { HUD_HEIGHT, AXE_SWING_DURATION, AXE_HIT_FRAME, MANA_MINE_HITS } from './constants.js';
import { displayClass } from './progression.js';

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
    if (state.overlayActive) renderHUD(ctx, state, screenW);
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

  let head = j('head'), neck = j('neck');
  const hip = j('hip');
  let lsh = j('lsh'), rsh = j('rsh'), lel = j('lel'), rel = j('rel');
  let lh = j('lh'), rh = j('rh');
  const lhip = j('lhip'), rhip = j('rhip');
  const lk = j('lk'), rk = j('rk'), lf = j('lf'), rf = j('rf');

  // Torso lean during an axe swing — windup back, drive forward through
  // impact, ease back to rest. Applied as a rotation of the upper-body
  // joints around the hip so the legs stay planted.
  if (state.axeSwing) {
    const dirLean = state.faceR ? 1 : -1;
    const p = Math.min(1, state.axeSwing.t / AXE_SWING_DURATION);
    const chop = p <= AXE_HIT_FRAME;
    const t = chop ? p / AXE_HIT_FRAME : (p - AXE_HIT_FRAME) / (1 - AXE_HIT_FRAME);
    const eased = chop ? t * t : 1 - (1 - t) * (1 - t);
    const windupLean = state.posture === 'prone' ? -0.12 : -0.22;
    const impactLean = state.posture === 'prone' ? 0.18 : 0.48;
    const leanAngle = (chop
      ? windupLean + (impactLean - windupLean) * eased
      : impactLean + (0 - impactLean) * eased) * dirLean;
    const cos = Math.cos(leanAngle);
    const sin = Math.sin(leanAngle);
    const rot = (pt) => {
      const dx = pt.x - hip.x;
      const dy = pt.y - hip.y;
      return { x: hip.x + dx * cos - dy * sin, y: hip.y + dx * sin + dy * cos };
    };
    head = rot(head);
    neck = rot(neck);
    lsh = rot(lsh);
    rsh = rot(rsh);
    lel = rot(lel);
    rel = rot(rel);
    lh = rot(lh);
    rh = rot(rh);
  }

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

  const swingActive = !!state.axeSwing;
  // The axe rides whichever arm was forward at swing start (frozen in
  // state.axeSwing.armR). The other arm draws from its static pose.
  const useRh = swingActive ? state.axeSwing.armR : true;
  ctx.lineWidth = 1.5;
  if (!swingActive || useRh) {
    drawLimb(ctx, lsh.x, lsh.y, lel.x, lel.y);
    drawLimb(ctx, lel.x, lel.y, lh.x, lh.y);
  }
  if (!swingActive || !useRh) {
    drawLimb(ctx, rsh.x, rsh.y, rel.x, rel.y);
    drawLimb(ctx, rel.x, rel.y, rh.x, rh.y);
  }

  drawLimb(ctx, lhip.x, lhip.y, lk.x, lk.y);
  drawLimb(ctx, lk.x, lk.y, lf.x, lf.y);
  drawLimb(ctx, rhip.x, rhip.y, rk.x, rk.y);
  drawLimb(ctx, rk.x, rk.y, rf.x, rf.y);

  // Axe swing — animated lead arm + a bearded viking-style axe head.
  // The arm windspups back on phase 1 (chop), snaps to the impact pose
  // at AXE_HIT_FRAME, then eases back toward rest on phase 2 (recover).
  if (swingActive) {
    const leadShoulder = useRh ? rsh : lsh;
    const leadHand = useRh ? rh : lh;
    const dir = state.faceR ? 1 : -1;
    const isProne = state.posture === 'prone';
    const progress = Math.min(1, state.axeSwing.t / AXE_SWING_DURATION);

    const chopPhase = progress <= AXE_HIT_FRAME;
    const phaseT = chopPhase
      ? progress / AXE_HIT_FRAME
      : (progress - AXE_HIT_FRAME) / (1 - AXE_HIT_FRAME);
    // Ease-in for the chop (slow windup, fast snap to impact).
    // Ease-out for recovery (quick release, gentle return).
    const eased = chopPhase
      ? phaseT * phaseT
      : 1 - (1 - phaseT) * (1 - phaseT);

    // Hand offsets from the natural rest position, mirrored by facing.
    // Sized to the drawn man (~32px tall at SCALE=0.35), not raw pose units.
    const windupOff = isProne ? { x: -3, y: -4 } : { x: -7, y: -13 };
    const impactOff = isProne ? { x: 5, y: 2 } : { x: 7, y: 4 };
    const targetOff = chopPhase ? impactOff : { x: 0, y: 0 };
    const fromOff = chopPhase ? windupOff : impactOff;
    const handOffX = fromOff.x + (targetOff.x - fromOff.x) * eased;
    const handOffY = fromOff.y + (targetOff.y - fromOff.y) * eased;

    const swingHandX = leadHand.x + handOffX * dir;
    const swingHandY = leadHand.y + handOffY;

    // Elbow = midpoint with an outward bend, stronger during windup.
    const dx = swingHandX - leadShoulder.x;
    const dy = swingHandY - leadShoulder.y;
    const len = Math.hypot(dx, dy) || 1;
    const bendAmt = chopPhase ? 2.2 * (1 - eased) : 1 * (1 - eased);
    const elbowX = (leadShoulder.x + swingHandX) / 2 + (-dy / len) * bendAmt * dir;
    const elbowY = (leadShoulder.y + swingHandY) / 2 + (dx / len) * bendAmt * dir;

    // Axe angle: start up-and-back, accelerate through impact, then ease
    // toward a neutral carry angle so the recovery looks intentional.
    const startAngle = isProne ? -Math.PI / 2 : -Math.PI * 3 / 4;
    const endAngle = isProne ? 0 : Math.PI / 3;
    const neutralAngle = isProne ? Math.PI / 6 : Math.PI / 4;
    const angleFrom = chopPhase ? startAngle : endAngle;
    const angleTo = chopPhase ? endAngle : neutralAngle;
    const angle = angleFrom + (angleTo - angleFrom) * eased;

    // Draw the swinging arm on top of the body in the stick-man color.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    drawLimb(ctx, leadShoulder.x, leadShoulder.y, elbowX, elbowY);
    drawLimb(ctx, elbowX, elbowY, swingHandX, swingHandY);

    // Draw the axe pivoting on the new hand position.
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.translate(swingHandX, swingHandY);
    if (!state.faceR) ctx.scale(-1, 1);
    ctx.rotate(angle);

    const scale = isProne ? 0.85 : 1;
    const handleLen = 12 * scale;

    // Wooden handle — slightly thicker so it reads as a haft, not a twig.
    ctx.strokeStyle = '#6b4a2e';
    ctx.lineWidth = 2 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2 * scale, 0);
    ctx.lineTo(handleLen, 0);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Pommel knob at the butt of the handle.
    ctx.fillStyle = '#4a3320';
    ctx.beginPath();
    ctx.arc(-2 * scale, 0, 1.3 * scale, 0, Math.PI * 2);
    ctx.fill();

    const hx = handleLen;
    // Head slightly larger than the handle's reference scale — big enough
    // to read as the dominant element without ballooning into a blocky
    // shape that looks like a small building.
    const hs = scale * 1.15;

    // Viking bearded axe: deliberately asymmetric around the handle. A
    // symmetric head reads as a shovel/spade — the long beard drooping
    // below the handle axis is what unmistakably says "axe".
    //
    //   handle ──┬──╮
    //            │   ╲___
    //            │       ╲  cutting edge
    //            │       ╱
    //            │      ╱   beard (deep hook below the handle)
    //            │    ╱
    //            │  ╱
    //             ╲╱
    ctx.fillStyle = '#b8bec5';
    ctx.strokeStyle = '#2e343c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx - 2 * hs, -2.2 * hs);                                     // top-back (small upper lobe)
    ctx.lineTo(hx + 1.5 * hs, -3 * hs);                                     // top-front
    ctx.quadraticCurveTo(hx + 4.5 * hs, -1.8 * hs, hx + 5.8 * hs, 0.3 * hs);// cutting edge upper tip
    ctx.quadraticCurveTo(hx + 5.2 * hs, 4 * hs, hx + 2.5 * hs, 6.8 * hs);   // cutting edge sweeps down
    ctx.quadraticCurveTo(hx - 0.5 * hs, 8 * hs, hx - 2.5 * hs, 6 * hs);     // beard hook curving under
    ctx.quadraticCurveTo(hx - 2.8 * hs, 3 * hs, hx - 2 * hs, -2.2 * hs);    // back edge up to top
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Beveled inner face — lighter wedge along the cutting edge arc, from
    // the neck out to the edge. Gives the blade depth and suggests a
    // forged edge bevel.
    ctx.fillStyle = 'rgba(240, 243, 247, 0.5)';
    ctx.beginPath();
    ctx.moveTo(hx + 1.2 * hs, -2 * hs);
    ctx.quadraticCurveTo(hx + 3.6 * hs, -0.8 * hs, hx + 4.6 * hs, 0.5 * hs);
    ctx.quadraticCurveTo(hx + 4.2 * hs, 3.3 * hs, hx + 2 * hs, 5.5 * hs);
    ctx.quadraticCurveTo(hx + 0 * hs, 5 * hs, hx - 0.5 * hs, 3 * hs);
    ctx.quadraticCurveTo(hx - 0.2 * hs, 0.5 * hs, hx + 1.2 * hs, -2 * hs);
    ctx.closePath();
    ctx.fill();

    // Polished cutting edge highlight — bright stroke along the outer arc.
    ctx.strokeStyle = '#f4f6f9';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(hx + 1.5 * hs, -3 * hs);
    ctx.quadraticCurveTo(hx + 4.5 * hs, -1.8 * hs, hx + 5.8 * hs, 0.3 * hs);
    ctx.quadraticCurveTo(hx + 5.2 * hs, 4 * hs, hx + 2.5 * hs, 6.8 * hs);
    ctx.quadraticCurveTo(hx - 0.5 * hs, 8 * hs, hx - 2.5 * hs, 6 * hs);
    ctx.stroke();

    // Dark eye where the handle passes through the head.
    ctx.fillStyle = '#2a1f14';
    ctx.beginPath();
    ctx.ellipse(hx - 1 * hs, 0, 0.9 * hs, 1.3 * hs, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Brief impact flash just after the apex. A soft radial glow at the
    // cutting edge — earlier versions used two diverging spark lines, but
    // those read as pitchfork tines, so we go with a ring+burst instead.
    const flashT = (progress - AXE_HIT_FRAME) / 0.12;
    if (flashT >= 0 && flashT <= 1) {
      const alpha = 0.7 * (1 - flashT);
      const growR = 2.5 + 4 * flashT;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.translate(swingHandX, swingHandY);
      if (!state.faceR) ctx.scale(-1, 1);
      ctx.rotate(endAngle);
      const tipX = handleLen + 5.5 * hs;
      ctx.fillStyle = `rgba(255, 245, 200, ${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(tipX, 0, growR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 245, 200, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(tipX, 0, growR * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Restore body shadow for subsequent draws.
    ctx.shadowColor = 'rgba(0, 220, 255, 0.4)';
    ctx.shadowBlur = 6;
  }

  const hr = 5 * s;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head.x, head.y, hr, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Mana mines — blue crystal outcrops on platforms
  if (state.manaMines) {
    for (const m of state.manaMines) {
      drawManaMine(ctx, m);
    }
  }

  // Collectibles — glowing orbs with pulse
  if (state.collectibles) {
    for (const c of state.collectibles) {
      const fadeIn = Math.min(1, c.age * 2);
      const fadeOut = c.age > 7 ? Math.max(0, 1 - (c.age - 7) / 3) : 1;
      const alpha = fadeIn * fadeOut;
      const pulse = 1 + 0.2 * Math.sin(c.age * (c.age > 7 ? 12 : 4)); // faster pulse when expiring
      const r = 4 * pulse;

      ctx.shadowColor = `rgba(255, 220, 50, ${0.6 * alpha})`;
      ctx.shadowBlur = 10;
      const orbY = c.y - r - 2; // sit on top of platform surface
      ctx.fillStyle = `rgba(255, 220, 50, ${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(c.x, orbY, r, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.fillStyle = `rgba(255, 255, 200, ${0.8 * alpha})`;
      ctx.beginPath();
      ctx.arc(c.x, orbY, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Holes — glowing gap edges
  if (state.holes) {
    for (const h of state.holes) {
      const fade = Math.max(0, 1 - h.age / 8);
      // Dark gap
      ctx.fillStyle = `rgba(0, 0, 0, ${0.8 * fade})`;
      ctx.fillRect(h.x, h.y, h.w, state.lineHeight);
      // Glowing edges
      ctx.shadowColor = `rgba(255, 150, 50, ${0.6 * fade})`;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = `rgba(255, 150, 50, ${0.8 * fade})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x, h.y + state.lineHeight);
      ctx.moveTo(h.x + h.w, h.y);
      ctx.lineTo(h.x + h.w, h.y + state.lineHeight);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  // Burst particles
  if (state.particles) {
    for (const p of state.particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `rgba(255, ${100 + Math.floor(Math.random() * 100)}, 50, ${alpha})`;
      ctx.shadowColor = `rgba(255, 150, 50, ${alpha * 0.5})`;
      ctx.shadowBlur = 3;
      const size = 1 + alpha * 2;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.shadowBlur = 0;
  }

  if (state.DEBUG_PLATFORMS) renderPlatformOverlay(ctx, state);
  if (state.DEBUG_DRAW) renderDebugOverlays(ctx, state, screenH);

  if (state.overlayActive) renderHUD(ctx, state, screenW);
}

const CLOSE_BTN_MARGIN = 6;

const HUD_FONT = "bold 13px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
const HUD_PARCHMENT = 'rgba(230, 215, 170, 0.95)';
const HUD_GOLD = 'rgba(190, 155, 85, 0.9)';

/**
 * Render the opaque HUD strip across the top of the overlay — styled like
 * a dark-wood/parchment RPG panel with gold trim, a serif typeface, and
 * canvas-drawn fantasy icons instead of Unicode dingbats.
 */
function renderHUD(ctx, state, screenW) {
  // Panel background: dark aged wood with vertical gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, HUD_HEIGHT);
  grad.addColorStop(0, 'rgb(26, 22, 16)');
  grad.addColorStop(1, 'rgb(38, 32, 24)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, screenW, HUD_HEIGHT);

  // Gold bottom trim: 2px band + 1px highlight.
  ctx.fillStyle = HUD_GOLD;
  ctx.fillRect(0, HUD_HEIGHT - 2, screenW, 2);
  ctx.fillStyle = 'rgba(235, 205, 135, 0.45)';
  ctx.fillRect(0, HUD_HEIGHT - 3, screenW, 1);

  ctx.font = HUD_FONT;
  ctx.textBaseline = 'alphabetic';
  const y = HUD_HEIGHT / 2;
  // Baseline Y that centers cap-height glyphs (digits, "M"-height caps) at y.
  const ref = ctx.measureText('M0');
  const textY = y + (ref.actualBoundingBoxAscent - ref.actualBoundingBoxDescent) / 2;
  const ICON = 7;

  // Glowing balls — same palette as the in-world collectibles, pulsing
  const pulse = 1 + 0.12 * Math.sin(performance.now() / 250);
  drawGlowingBallIcon(ctx, 14, y, ICON, pulse);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 220, 50, 0.8)';
  ctx.shadowBlur = 6 + 4 * (pulse - 1) / 0.12; // track the pulse
  ctx.fillStyle = 'rgba(255, 240, 170, 0.98)';
  ctx.fillText(`${state.score || 0}`, 28, textY);
  ctx.restore();
  drawSeparator(ctx, 70);

  // Mana — blue potion flask
  drawPotionIcon(ctx, 84, y, ICON, 'rgb(90, 160, 255)');
  ctx.fillStyle = HUD_PARCHMENT;
  ctx.fillText(`${state.mana || 0}`, 98, textY);
  drawSeparator(ctx, 140);

  // Inventory — leather pouch
  // Inventory items are lowercase words (e.g. "bottle") whose visual bounds
  // differ from cap-height text — measure this string specifically so it
  // sits on the same visual midline as its pouch icon.
  drawPouchIcon(ctx, 154, y, ICON, 'rgb(150, 100, 55)');
  const activeItem = (state.inventory && state.inventory[state.inventoryIdx]) || '—';
  ctx.fillStyle = HUD_PARCHMENT;
  const itemM = ctx.measureText(activeItem);
  const itemY = y + (itemM.actualBoundingBoxAscent - itemM.actualBoundingBoxDescent) / 2;
  ctx.fillText(activeItem, 168, itemY);
  drawSeparator(ctx, 260);

  // Class — small crown
  drawCrownIcon(ctx, 274, y, ICON, 'rgb(230, 190, 100)');
  ctx.fillStyle = 'rgba(240, 210, 165, 0.95)';
  ctx.fillText(displayClass(state), 288, textY);

  // Quest (flexible — clipped to space before close button)
  const closeBtn = getCloseButtonRect(screenW);
  const missionX = 480;
  const missionMaxW = closeBtn.x - missionX - 12;
  if (missionMaxW > 40 && state.mission) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(missionX, 0, missionMaxW, HUD_HEIGHT);
    ctx.clip();
    ctx.fillStyle = 'rgba(195, 230, 180, 0.95)';
    ctx.fillText(`Quest: ${state.mission}`, missionX, textY);
    ctx.restore();
  }

  // Close button
  const hover = isInCloseButton(state.mouseX || -1, state.mouseY || -1, screenW);
  drawCloseButton(ctx, closeBtn, hover);
}

function drawManaMine(ctx, m) {
  const fadeIn = Math.min(1, m.age * 2);
  const alpha = fadeIn;
  const healthScale = Math.max(0.55, m.hits / MANA_MINE_HITS);
  const b = 8 * healthScale;

  ctx.save();
  ctx.shadowColor = `rgba(120, 130, 255, ${0.6 * alpha})`;
  ctx.shadowBlur = 10;

  // Crystal cluster (polygon sitting on the platform at m.y)
  ctx.fillStyle = `rgba(130, 120, 235, ${0.92 * alpha})`;
  ctx.beginPath();
  ctx.moveTo(m.x - b,         m.y);
  ctx.lineTo(m.x - b * 0.5,   m.y - b * 1.6);
  ctx.lineTo(m.x + b * 0.15,  m.y - b * 2.0);
  ctx.lineTo(m.x + b * 0.7,   m.y - b * 1.3);
  ctx.lineTo(m.x + b,         m.y);
  ctx.closePath();
  ctx.fill();

  // Inner highlight facet
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(200, 200, 255, ${0.7 * alpha})`;
  ctx.beginPath();
  ctx.moveTo(m.x - b * 0.2, m.y - b * 0.2);
  ctx.lineTo(m.x + b * 0.05, m.y - b * 1.5);
  ctx.lineTo(m.x + b * 0.3, m.y - b * 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawSeparator(ctx, x) {
  ctx.strokeStyle = 'rgba(190, 155, 85, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 7);
  ctx.lineTo(x + 0.5, HUD_HEIGHT - 7);
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

function drawPouchIcon(ctx, cx, cy, s, color) {
  ctx.save();
  ctx.translate(0, -s * 0.275); // visual bounds [cy-0.45s, cy+s] → shift up to center
  // Sack body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.75, cy - s * 0.2);
  ctx.bezierCurveTo(cx - s * 1.0, cy + s * 1.0, cx + s * 1.0, cy + s * 1.0, cx + s * 0.75, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.45, cy - s * 0.45);
  ctx.lineTo(cx - s * 0.45, cy - s * 0.45);
  ctx.closePath();
  ctx.fill();
  // Drawstring band
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(cx - s * 0.55, cy - s * 0.45, s * 1.1, s * 0.2);
  // Coin highlight
  ctx.fillStyle = 'rgba(240, 200, 90, 0.9)';
  ctx.beginPath();
  ctx.arc(cx + s * 0.1, cy + s * 0.3, s * 0.18, 0, Math.PI * 2);
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

    // Show ceiling detection — fixed position top-left
    const ceiling = findCeiling(state.platforms, state.feetY, state.gx, state.lineHeight);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, 300, 50);
    ctx.fillStyle = 'rgba(255, 255, 0, 0.95)';
    ctx.font = '11px monospace';
    ctx.fillText(`pos: x=${state.gx.toFixed(0)} feetY=${state.feetY.toFixed(0)} posture=${posture}`, 4, 14);
    if (ceiling) {
      const clearance = state.feetY - (ceiling.y + state.lineHeight);
      ctx.fillText(`ceiling: y=${ceiling.y.toFixed(0)} bottom=${(ceiling.y+state.lineHeight).toFixed(0)} cl=${clearance.toFixed(0)}`, 4, 28);
      ctx.fillText(`ceil x=${ceiling.x.toFixed(0)}..${(ceiling.x+ceiling.w).toFixed(0)}`, 4, 42);
    } else {
      ctx.fillText('ceiling: NONE', 4, 28);
    }
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
