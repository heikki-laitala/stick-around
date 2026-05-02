import { SCALE, STANDING_HEIGHT, CROUCH_HEIGHT, PRONE_HEIGHT, torsoY } from './poses.js';
import { AXE_SWING_DURATION, AXE_HIT_FRAME, MANA_MINE_HITS } from './constants.js';
import { renderActiveMission } from './progression.js';
import {
  isShielded, shieldFadeAlpha, isLightningAiming, isLightningActive,
  LIGHTNING_BEAM_WIDTH, LIGHTNING_RANGE,
} from './spells.js';
import { renderHUD } from './renderHud.js';
import { drawShieldAura } from './renderShield.js';
import { drawStasisVignette } from './missions/shardfall/render.js';
import { hudStripHeight } from './constants.js';
import { renderSplash } from './renderSplash.js';
import { IS_LINUX } from './platform-info.js';

// Re-export HUD helpers so existing `import { ... } from './render.js'`
// callers (main.js, tests) keep working without plumbing updates.
export { getCloseButtonRect, isInCloseButton } from './renderHud.js';

function drawLimb(ctx, ax, ay, bx, by) {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

const MISSION_TOAST_FADE_IN = 0.4;
const MISSION_TOAST_HOLD = 3.6;
const MISSION_TOAST_FADE_OUT = 1.0;
const MISSION_TOAST_TOTAL = MISSION_TOAST_FADE_IN + MISSION_TOAST_HOLD + MISSION_TOAST_FADE_OUT;

/**
 * Mission-entry banner. Each time `ensureEntered` activates a new
 * mission, progression sets `state.missionToast = { age, text,
 * subtitle? }`. The renderer fades that in below the HUD strip,
 * holds it long enough to read, then fades it out. Per-mission
 * `subtitle` lets a mission tack a one-line hint underneath without
 * needing a bespoke render function.
 */
function drawMissionToast(ctx, state, screenW) {
  const t = state.missionToast;
  if (!t || typeof t.age !== 'number' || t.age >= MISSION_TOAST_TOTAL) return;
  const fadeIn = Math.min(1, t.age / MISSION_TOAST_FADE_IN);
  const fadeOut = t.age > MISSION_TOAST_FADE_IN + MISSION_TOAST_HOLD
    ? Math.max(0, 1 - (t.age - MISSION_TOAST_FADE_IN - MISSION_TOAST_HOLD) / MISSION_TOAST_FADE_OUT)
    : 1;
  const alpha = fadeIn * fadeOut;
  if (alpha <= 0.01) return;

  const cx = screenW / 2;
  const top = hudStripHeight(state) + 8;
  const padX = 18;
  const padY = 10;
  const titleFont = "bold 20px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";
  const subFont = "13px 'Cinzel', 'Trajan Pro', 'Palatino', 'Georgia', serif";

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.font = titleFont;
  const titleW = ctx.measureText(t.text || '').width;
  let subW = 0;
  if (t.subtitle) {
    ctx.font = subFont;
    subW = ctx.measureText(t.subtitle).width;
  }
  const bgW = Math.max(titleW, subW) + padX * 2;
  const bgH = (t.subtitle ? 22 + 18 : 22) + padY * 2;

  ctx.fillStyle = `rgba(15, 25, 50, ${0.78 * alpha})`;
  ctx.strokeStyle = `rgba(220, 230, 240, ${0.55 * alpha})`;
  ctx.lineWidth = 1;
  ctx.fillRect(cx - bgW / 2, top, bgW, bgH);
  ctx.strokeRect(cx - bgW / 2, top, bgW, bgH);

  ctx.shadowColor = `rgba(0, 0, 0, ${0.7 * alpha})`;
  ctx.shadowBlur = 4;
  ctx.font = titleFont;
  ctx.fillStyle = `rgba(240, 230, 180, ${0.98 * alpha})`;
  ctx.fillText(t.text || '', cx, top + padY);
  if (t.subtitle) {
    ctx.font = subFont;
    ctx.fillStyle = `rgba(220, 230, 240, ${0.92 * alpha})`;
    ctx.fillText(t.subtitle, cx, top + padY + 26);
  }
  ctx.restore();
}

/**
 * Render the full game frame: rope, stick man, debug overlays.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state - Full game state
 * @param {number} screenW
 * @param {number} screenH
 */
export function render(ctx, state, screenW, screenH) {
  if (IS_LINUX) {
    // WebKit2GTK on XWayland leaves stale pixels in the canvas backing
    // buffer after ctx.clearRect — visible as the splash bleeding
    // through once the HUD draws on top. Using a 'copy' composite
    // forces the browser to fully replace destination pixels with the
    // (transparent) source, which the buggy path does respect.
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, screenW, screenH);
    ctx.restore();
  } else {
    ctx.clearRect(0, 0, screenW, screenH);
  }

  if (state.splashActive) {
    renderSplash(ctx, state, screenW, screenH);
    return;
  }

  if (!state.hasSpawned) {
    // Linux: render debug overlay even pre-spawn so the user can press V
    // to inspect why the man hasn't appeared yet (AT-SPI failures, missing
    // prompt detection, etc.). macOS/Windows keep the original
    // post-spawn-only gate.
    if (IS_LINUX && state.DEBUG_PLATFORMS) renderPlatformOverlay(ctx, state, screenH);
    // Linux passive mode shrinks the overlay to the HUD strip; the strip
    // is the only thing on screen for the user to look at, so always
    // paint the HUD on Linux even when blurred. macOS/Windows keep the
    // original gate so a blurred overlay window stays visually empty.
    if (state.overlayActive || IS_LINUX) renderHUD(ctx, state, screenW);
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

  // Caster get-up — while a spell is being wielded (lightning aim/live
  // or shield up) the stick man dons a pointy wizard hat. For lightning
  // he also holds a wand, which doubles as the bolt origin so the cast
  // visually erupts from the tip instead of his head.
  const wandEngaged = isLightningAiming(state) || isLightningActive(state);
  const hatEngaged = wandEngaged || isShielded(state);
  if (hatEngaged) drawWizardHat(ctx, head.x, head.y, hr, fl);
  if (wandEngaged) {
    const hand = state.faceR ? rh : lh;
    const aimAngle = state.lightningAim
      ? state.lightningAim.angle
      : (state.lightningBolt ? state.lightningBolt.angle : -Math.PI / 2);
    drawWand(ctx, hand.x, hand.y, aimAngle);
  }

  // Shield aura — layered magical dome with bubble gradient, two
  // counter-rotating hex rings (outer + inner) for depth, a rune tick
  // band, crackling energy arcs that skitter along the rim, and a
  // crescent specular highlight. Fades in over 0.2s so activation
  // doesn't pop on harshly.
  if (isShielded(state)) {
    const crownY = head.y - 5 * s;
    const shieldCY = (crownY + state.feetY) / 2;
    const shieldR = (state.feetY - crownY) / 2 + 22;
    drawShieldAura(ctx, state.gx, shieldCY, shieldR, shieldFadeAlpha(state));
  }

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

  // Mission-specific visuals (rising lava, goal door, etc.) draw above the
  // world but beneath HUD and debug overlays.
  renderActiveMission(ctx, state, screenW, screenH);

  // Lightning aim ray and live bolts draw on top of meteors so the
  // player can see the bolt stabbing through hazards it's about to
  // vaporise. The aim/bolt originates at the wand tip so a casual
  // viewer reads "wand shoots lightning" — not "head emits lightning".
  if (state.lightningAim) {
    const hand = state.faceR ? rh : lh;
    const tip = wandTip(hand.x, hand.y, state.lightningAim.angle);
    drawLightningAim(ctx, tip.x, tip.y, state.lightningAim.angle);
  }
  if (state.lightningBolt) drawLightningBolt(ctx, state.lightningBolt);

  // Stasis vignette + ripple radiate from the player's torso whenever
  // the spell is engaged — drawn here (not from the active mission)
  // so the visual works regardless of which mission the player is in.
  if (state.stasisActive) {
    drawStasisVignette(ctx, screenW, screenH, state.stasisAge || 0, state.gx, torsoY(state));
  }

  drawMissionToast(ctx, state, screenW);

  if (state.DEBUG_PLATFORMS) renderPlatformOverlay(ctx, state, screenH);

  // See the no-spawn branch above: Linux's strip is the only visual
  // surface in passive mode, so keep the HUD rendered there.
  if (state.overlayActive || IS_LINUX) renderHUD(ctx, state, screenW);
}

const WAND_LENGTH = 14;
const WAND_TIP_RADIUS = 2.2;

// Wand tip in world coords given a hand position and an aim angle.
// Kept in one place so aim/bolt/visual all sample the same point.
export function wandTip(handX, handY, angle) {
  return {
    x: handX + Math.cos(angle) * WAND_LENGTH,
    y: handY + Math.sin(angle) * WAND_LENGTH,
  };
}

// Hat dimensions in screen pixels — sized against the drawn stick man
// (~32px tall), not the pea-sized headR, so the hat actually reads on
// screen instead of melting into the head dot.
const HAT_BRIM_W = 6;     // half-brim width
const HAT_BRIM_H = 1.5;   // brim thickness (ellipse minor axis)
const HAT_CONE_H = 10;    // cone height above the brim
const HAT_CONE_BASE = 4.5;// cone's half-width where it meets the brim

function drawWizardHat(ctx, headX, headY, headR, fl) {
  // Slight backward tilt so the hat looks perched and the droopy tip
  // flops toward the facing direction.
  const tilt = -0.18 * fl;
  ctx.save();
  ctx.translate(headX, headY - headR * 0.3);
  ctx.rotate(tilt);

  // Cone body with a droopy tip that flops forward. Bezier from the
  // base-left up over the crown and back down to base-right, with the
  // tip hooked in the facing direction.
  const tipX = HAT_CONE_BASE * 0.55 * fl;
  const tipY = -HAT_CONE_H;
  ctx.fillStyle = '#2d1b4e';
  ctx.strokeStyle = '#4a2d7a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-HAT_CONE_BASE, 0);
  ctx.bezierCurveTo(
    -HAT_CONE_BASE * 0.6, -HAT_CONE_H * 0.4,
    -HAT_CONE_BASE * 0.1, -HAT_CONE_H * 0.8,
    tipX, tipY,
  );
  // Flop hook at the tip — pinch inward so the point droops instead of
  // stabbing straight up.
  ctx.quadraticCurveTo(
    tipX + 5 * fl, tipY + 2,
    tipX + 2 * fl, tipY + 5,
  );
  ctx.bezierCurveTo(
    HAT_CONE_BASE * 0.3, -HAT_CONE_H * 0.55,
    HAT_CONE_BASE * 0.7, -HAT_CONE_H * 0.2,
    HAT_CONE_BASE, 0,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Brim — wide, squashed ellipse.
  ctx.fillStyle = '#1a0e2a';
  ctx.beginPath();
  ctx.ellipse(0, 0, HAT_BRIM_W, HAT_BRIM_H, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a2d7a';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Gold band with a square buckle sitting just above the brim.
  ctx.fillStyle = '#d9a73a';
  ctx.fillRect(-HAT_CONE_BASE * 0.95, -HAT_BRIM_H * 0.85, HAT_CONE_BASE * 1.9, HAT_BRIM_H * 0.9);
  ctx.fillStyle = '#2d1b4e';
  ctx.fillRect(-1.4, -HAT_BRIM_H * 0.85, 2.8, HAT_BRIM_H * 0.9);
  ctx.strokeStyle = '#ffd866';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(-1.4, -HAT_BRIM_H * 0.85, 2.8, HAT_BRIM_H * 0.9);

  // Sprinkle of little stars on the cone — gives it that enchanted look.
  ctx.shadowColor = 'rgba(255, 216, 102, 0.9)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffd866';
  drawStar(ctx,  HAT_CONE_BASE * 0.1 * fl, -HAT_CONE_H * 0.55, 1.6);
  drawStar(ctx, -HAT_CONE_BASE * 0.15 * fl, -HAT_CONE_H * 0.78, 1.1);
  drawStar(ctx,  HAT_CONE_BASE * 0.3 * fl, -HAT_CONE_H * 0.3, 1.0);
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawWand(ctx, handX, handY, angle) {
  const tip = wandTip(handX, handY, angle);
  ctx.save();
  // Haft — dark wood.
  ctx.strokeStyle = '#3a2819';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  // Glowing crystal at the tip.
  ctx.shadowColor = 'rgba(180, 220, 255, 0.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(220, 240, 255, 0.95)';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, WAND_TIP_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLightningAim(ctx, ox, oy, angle) {
  const len = 260;
  const ex = ox + Math.cos(angle) * len;
  const ey = oy + Math.sin(angle) * len;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.75)';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(180, 220, 255, 0.5)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // Faint halo at the origin so the caster reads as powering up.
  ctx.fillStyle = 'rgba(200, 230, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(ox, oy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLightningBolt(ctx, bolt) {
  // The bolt's ray direction + perpendicular normal. Offsets from zig[]
  // are applied along the normal to draw the jagged shape.
  const cos = Math.cos(bolt.angle);
  const sin = Math.sin(bolt.angle);
  const nx = -sin;
  const ny = cos;
  const zig = bolt.zig || [];
  const n = Math.max(2, zig.length);
  const alpha = Math.max(0, Math.min(1, bolt.life / bolt.maxLife));

  // Outer glow — thick soft blue stroke, drawn once along the zigzag.
  const points = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const along = t * LIGHTNING_RANGE;
    const off = zig[i] || 0;
    const px = bolt.x + cos * along + nx * off;
    const py = bolt.y + sin * along + ny * off;
    points.push([px, py]);
  }

  ctx.save();
  // Glow halo.
  ctx.strokeStyle = `rgba(160, 200, 255, ${0.35 * alpha})`;
  ctx.lineWidth = LIGHTNING_BEAM_WIDTH * 0.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(130, 180, 255, 0.9)';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  // Mid-brightness core.
  ctx.strokeStyle = `rgba(200, 230, 255, ${0.95 * alpha})`;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();

  // Bright white inner strand.
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();
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

/**
 * Render all platforms as visible rectangles with posture/clearance info.
 */
function renderPlatformOverlay(ctx, state, screenH) {
  const lh = state.lineHeight;

  if (state.footerArea) {
    ctx.fillStyle = 'rgba(0, 200, 50, 0.15)';
    ctx.fillRect(state.footerArea.x, state.footerArea.y, state.footerArea.w, state.footerArea.h);
    ctx.strokeStyle = 'rgba(0, 200, 50, 0.6)';
    ctx.lineWidth = 2;
    // Inset stroke by 1 so lineWidth=2 (which draws ±1 around the path)
    // stays entirely inside the fill rect. Without inset, the bottom
    // stroke bleeds 1 px into the row below.
    ctx.strokeRect(state.footerArea.x + 1, state.footerArea.y + 1, state.footerArea.w - 2, state.footerArea.h - 2);
    ctx.fillStyle = 'rgba(0, 200, 50, 0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('FOOTER', state.footerArea.x + 4, state.footerArea.y + 12);
  }
  if (state.promptArea) {
    ctx.fillStyle = 'rgba(0, 100, 255, 0.15)';
    ctx.fillRect(state.promptArea.x, state.promptArea.y, state.promptArea.w, state.promptArea.h);
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.promptArea.x + 1, state.promptArea.y + 1, state.promptArea.w - 2, state.promptArea.h - 2);
    ctx.fillStyle = 'rgba(0, 100, 255, 0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('PROMPT', state.promptArea.x + 4, state.promptArea.y + 12);
  }
  if (!state.footerArea && !state.promptArea && screenH != null) {
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)';
    ctx.font = '12px monospace';
    ctx.fillText('NO PROMPT DETECTED', 10, screenH - 10);
  }

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

