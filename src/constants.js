// Game physics
export const GRAV = 800;
export const JUMP_V = 230;
export const ACCEL = 800;
export const FRIC = 0.88;
export const MAXV = 250;

// Overlay layout
// Extra strip above the terminal window reserved for the HUD. Narrow
// terminals use the taller strip so HUD items can wrap onto two rows
// without being squeezed off-screen by the quest text. Must stay in sync
// with the HUD_HEIGHT / HUD_HEIGHT_TALL / HUD_NARROW_THRESHOLD constants
// in src-tauri/src/lib.rs.
export const HUD_HEIGHT = 32;
export const HUD_HEIGHT_TALL = 60;
export const HUD_NARROW_THRESHOLD = 720;

export function effectiveHudHeight(screenW) {
  return typeof screenW === 'number' && screenW < HUD_NARROW_THRESHOLD
    ? HUD_HEIGHT_TALL
    : HUD_HEIGHT;
}

export function isNarrowHud(screenW) {
  return typeof screenW === 'number' && screenW < HUD_NARROW_THRESHOLD;
}

// Rope
export const ROPE_AIM_SPEED = 2.0;
export const ROPE_FLY_SPEED = 400;
export const ROPE_MAX_LEN = 400;
export const SWING_GRAVITY = 800;
export const SWING_PUMP = 8.0;
export const SWING_DAMPING = 0.993;
export const SWING_DAMPING_END = 0.95;
export const SWING_ANCHOR_DECAY_TIME = 24.0;
export const SWING_PUMP_FLOOR = 0.25;
export const ROPE_COOLDOWN = 0.1;

// Mana mines
export const MANA_MINE_HITS = 3;
export const MANA_MINE_LIFETIME = 30;
export const MANA_MINE_MAX = 2;
export const MANA_MINE_SPAWN_INTERVAL = 8;
export const MANA_MINE_MIN_DIST = 80;
export const MANA_PER_MINE = 1;

// Axe swing
export const AXE_SWING_DURATION = 0.35;
export const AXE_HIT_FRAME = 0.5;
export const AXE_REACH = 28;
export const AXE_HIT_RADIUS = 22;
