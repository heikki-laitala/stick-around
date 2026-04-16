export function lerp(a, b, t) { return a + (b - a) * t; }

export function lerpPose(a, b, t) {
  const r = {};
  for (const k of Object.keys(a)) r[k] = { x: lerp(a[k].x, b[k].x, t), y: lerp(a[k].y, b[k].y, t) };
  return r;
}

export function p(hd, nk, hp, ls, rs, le, re, lh, rh, lhp, rhp, lk, rk, lf, rf) {
  return { head: hd, neck: nk, hip: hp, lsh: ls, rsh: rs, lel: le, rel: re, lh, rh, lhip: lhp, rhip: rhp, lk, rk, lf, rf };
}

export const IDLE = p(
  { x: 0, y: -48 }, { x: 0, y: -36 }, { x: 0, y: 0 },
  { x: -8, y: -33 }, { x: 8, y: -33 }, { x: -14, y: -18 }, { x: 14, y: -18 },
  { x: -12, y: -4 }, { x: 12, y: -4 }, { x: -5, y: 2 }, { x: 5, y: 2 },
  { x: -8, y: 22 }, { x: 8, y: 22 }, { x: -10, y: 44 }, { x: 10, y: 44 }
);

export const WALK = [
  p(
    { x: 6, y: -45 }, { x: 5, y: -33 }, { x: 0, y: 3 },
    { x: -5, y: -30 }, { x: 12, y: -30 }, { x: 6, y: -16 }, { x: -4, y: -18 },
    { x: 10, y: -4 }, { x: -10, y: -6 }, { x: -4, y: 4 }, { x: 5, y: 5 },
    { x: -14, y: 20 }, { x: 16, y: 24 }, { x: -8, y: 44 }, { x: 22, y: 44 }
  ),
  p(
    { x: 3, y: -50 }, { x: 2, y: -38 }, { x: 0, y: -2 },
    { x: -8, y: -35 }, { x: 8, y: -35 }, { x: -4, y: -20 }, { x: 4, y: -20 },
    { x: -2, y: -6 }, { x: 2, y: -6 }, { x: -3, y: 0 }, { x: 3, y: 0 },
    { x: -2, y: 20 }, { x: 2, y: 20 }, { x: -2, y: 44 }, { x: 2, y: 44 }
  ),
  p(
    { x: 6, y: -45 }, { x: 5, y: -33 }, { x: 0, y: 3 },
    { x: -5, y: -30 }, { x: 12, y: -30 }, { x: -4, y: -18 }, { x: 6, y: -16 },
    { x: -10, y: -6 }, { x: 10, y: -4 }, { x: -4, y: 5 }, { x: 5, y: 4 },
    { x: 16, y: 24 }, { x: -14, y: 20 }, { x: 22, y: 44 }, { x: -8, y: 44 }
  ),
  p(
    { x: 3, y: -50 }, { x: 2, y: -38 }, { x: 0, y: -2 },
    { x: -8, y: -35 }, { x: 8, y: -35 }, { x: 4, y: -20 }, { x: -4, y: -20 },
    { x: 2, y: -6 }, { x: -2, y: -6 }, { x: -3, y: 0 }, { x: 3, y: 0 },
    { x: 2, y: 20 }, { x: -2, y: 20 }, { x: 2, y: 44 }, { x: -2, y: 44 }
  ),
];

export const JUMP_RISE = p(
  { x: 0, y: -54 }, { x: 0, y: -42 }, { x: 0, y: 0 },
  { x: -8, y: -39 }, { x: 8, y: -39 }, { x: -16, y: -48 }, { x: 16, y: -48 },
  { x: -22, y: -56 }, { x: 22, y: -56 }, { x: -5, y: 2 }, { x: 5, y: 2 },
  { x: -10, y: 14 }, { x: 10, y: 14 }, { x: -6, y: 28 }, { x: 6, y: 28 }
);

export const JUMP_FALL = p(
  { x: 0, y: -46 }, { x: 0, y: -34 }, { x: 0, y: 0 },
  { x: -8, y: -31 }, { x: 8, y: -31 }, { x: -18, y: -24 }, { x: 18, y: -24 },
  { x: -24, y: -16 }, { x: 24, y: -16 }, { x: -5, y: 2 }, { x: 5, y: 2 },
  { x: -8, y: 12 }, { x: 8, y: 12 }, { x: -14, y: 28 }, { x: 14, y: 28 }
);

export const LAND = p(
  { x: 0, y: -36 }, { x: 0, y: -26 }, { x: 0, y: 6 },
  { x: -8, y: -23 }, { x: 8, y: -23 }, { x: -16, y: -12 }, { x: 16, y: -12 },
  { x: -18, y: -2 }, { x: 18, y: -2 }, { x: -6, y: 8 }, { x: 6, y: 8 },
  { x: -16, y: 24 }, { x: 16, y: 24 }, { x: -18, y: 44 }, { x: 18, y: 44 }
);

// Crouch: hunched over, knees bent, head low
export const CROUCH = p(
  { x: 2, y: -15 }, { x: 2, y: -10 }, { x: 0, y: 10 },
  { x: -8, y: -8 }, { x: 8, y: -8 }, { x: -14, y: 2 }, { x: 14, y: 2 },
  { x: -12, y: 10 }, { x: 12, y: 10 }, { x: -8, y: 12 }, { x: 8, y: 12 },
  { x: -14, y: 30 }, { x: 14, y: 30 }, { x: -12, y: 44 }, { x: 12, y: 44 }
);

export const CROUCH_WALK = [
  p(
    { x: 4, y: -13 }, { x: 3, y: -8 }, { x: 0, y: 12 },
    { x: -6, y: -6 }, { x: 10, y: -6 }, { x: -12, y: 4 }, { x: 12, y: 0 },
    { x: -10, y: 12 }, { x: 14, y: 8 }, { x: -6, y: 14 }, { x: 8, y: 14 },
    { x: -18, y: 28 }, { x: 18, y: 32 }, { x: -12, y: 44 }, { x: 22, y: 44 }
  ),
  p(
    { x: 2, y: -16 }, { x: 2, y: -11 }, { x: 0, y: 10 },
    { x: -8, y: -9 }, { x: 8, y: -9 }, { x: -14, y: 2 }, { x: 14, y: 2 },
    { x: -12, y: 10 }, { x: 12, y: 10 }, { x: -8, y: 12 }, { x: 8, y: 12 },
    { x: -6, y: 30 }, { x: 6, y: 30 }, { x: -4, y: 44 }, { x: 4, y: 44 }
  ),
  p(
    { x: 4, y: -13 }, { x: 3, y: -8 }, { x: 0, y: 12 },
    { x: -6, y: -6 }, { x: 10, y: -6 }, { x: 12, y: 0 }, { x: -12, y: 4 },
    { x: 14, y: 8 }, { x: -10, y: 12 }, { x: -6, y: 14 }, { x: 8, y: 14 },
    { x: 18, y: 32 }, { x: -18, y: 28 }, { x: 22, y: 44 }, { x: -12, y: 44 }
  ),
  p(
    { x: 2, y: -16 }, { x: 2, y: -11 }, { x: 0, y: 10 },
    { x: -8, y: -9 }, { x: 8, y: -9 }, { x: 14, y: 2 }, { x: -14, y: 2 },
    { x: 12, y: 10 }, { x: -12, y: 10 }, { x: -8, y: 12 }, { x: 8, y: 12 },
    { x: 6, y: 30 }, { x: -6, y: 30 }, { x: 4, y: 44 }, { x: -4, y: 44 }
  ),
];

// Prone: lying flat face-down, head in facing direction
// Positive x = forward (head), negative x = behind (feet)
export const PRONE = p(
  { x: 32, y: 32 }, { x: 24, y: 36 }, { x: 0, y: 38 },         // head, neck, hip
  { x: 20, y: 34 }, { x: 16, y: 38 }, { x: 10, y: 42 }, { x: 8, y: 42 },  // shoulders, elbows
  { x: 18, y: 44 }, { x: 14, y: 44 }, { x: -4, y: 38 }, { x: -8, y: 38 },  // hands, hips
  { x: -16, y: 36 }, { x: -20, y: 36 }, { x: -28, y: 40 }, { x: -32, y: 40 } // knees, feet
);

// Prone crawl: alternating elbow-knee army crawl
export const PRONE_CRAWL = [
  // Frame 1: left arm forward, right knee up
  p(
    { x: 32, y: 30 }, { x: 24, y: 34 }, { x: 0, y: 38 },
    { x: 20, y: 32 }, { x: 16, y: 36 }, { x: 14, y: 38 }, { x: 6, y: 42 },
    { x: 22, y: 42 }, { x: 10, y: 44 }, { x: -4, y: 38 }, { x: -8, y: 38 },
    { x: -14, y: 34 }, { x: -22, y: 38 }, { x: -24, y: 40 }, { x: -34, y: 42 }
  ),
  // Frame 2: neutral
  p(
    { x: 32, y: 32 }, { x: 24, y: 36 }, { x: 0, y: 38 },
    { x: 20, y: 34 }, { x: 16, y: 38 }, { x: 10, y: 42 }, { x: 8, y: 42 },
    { x: 18, y: 44 }, { x: 14, y: 44 }, { x: -4, y: 38 }, { x: -8, y: 38 },
    { x: -16, y: 36 }, { x: -20, y: 36 }, { x: -28, y: 40 }, { x: -32, y: 40 }
  ),
  // Frame 3: right arm forward, left knee up
  p(
    { x: 32, y: 30 }, { x: 24, y: 34 }, { x: 0, y: 38 },
    { x: 20, y: 36 }, { x: 16, y: 32 }, { x: 6, y: 42 }, { x: 14, y: 38 },
    { x: 10, y: 44 }, { x: 22, y: 42 }, { x: -4, y: 38 }, { x: -8, y: 38 },
    { x: -22, y: 38 }, { x: -14, y: 34 }, { x: -34, y: 42 }, { x: -24, y: 40 }
  ),
  // Frame 4: neutral
  p(
    { x: 32, y: 32 }, { x: 24, y: 36 }, { x: 0, y: 38 },
    { x: 20, y: 34 }, { x: 16, y: 38 }, { x: 10, y: 42 }, { x: 8, y: 42 },
    { x: 18, y: 44 }, { x: 14, y: 44 }, { x: -4, y: 38 }, { x: -8, y: 38 },
    { x: -16, y: 36 }, { x: -20, y: 36 }, { x: -28, y: 40 }, { x: -32, y: 40 }
  ),
];

export const SCALE = 0.35;

// Posture heights in screen pixels (used for ceiling collision)
// Standing: head y=-48, feet y=44 → (44-(-48)) * SCALE
export const STANDING_HEIGHT = (44 - (-48)) * SCALE; // ~32px
// Crouch: head y=-15 → (44-(-15)) * SCALE
export const CROUCH_HEIGHT = (44 - (-15)) * SCALE; // ~21px
// Prone: head y=32 → (44-30) * SCALE (use lowest crawl head y for safety)
export const PRONE_HEIGHT = (44 - 30) * SCALE; // ~5px
