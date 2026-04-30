// Game physics
export const GRAV = 800;
export const JUMP_V = 230;
export const ACCEL = 800;
export const FRIC = 0.88;
// Ice-age missions swap dry friction for this near-1 multiplier so the
// man slides almost frictionlessly when no input is held. Same per-frame
// rule as FRIC (raised to dt*60), just much closer to 1 — sliding-with-
// momentum that takes a couple of seconds to coast to a stop.
export const ICE_FRIC = 0.997;
export const MAXV = 250;

// Overlay layout
// Extra strip above the terminal window reserved for the HUD. The tall
// strip fits two rows so HUD items don't get clipped off the right edge.
// The decision between short/tall is made dynamically in the renderer by
// measuring whether the HUD content fits on a single row; the width
// threshold below is only used as the initial guess before the first
// measurement (and by mission code that doesn't have `state.hudTall`
// handy yet). Must stay in sync with the matching constants in
// src-tauri/src/lib.rs.
export const HUD_HEIGHT = 32;
export const HUD_HEIGHT_TALL = 60;
export const HUD_NARROW_THRESHOLD = 720;

/**
 * Runtime HUD strip height for a given game state. Reads `state.hudTall`,
 * which the render loop keeps in sync with what actually fits on one row.
 */
export function hudStripHeight(state) {
  return state && state.hudTall ? HUD_HEIGHT_TALL : HUD_HEIGHT;
}

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
