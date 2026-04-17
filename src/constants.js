// Game physics
export const GRAV = 800;
export const JUMP_V = 180;
export const ACCEL = 800;
export const FRIC = 0.88;
export const MAXV = 250;

// Overlay layout
// Extra strip above the terminal window reserved for the HUD. Must stay in
// sync with HUD_HEIGHT in src-tauri/src/lib.rs.
export const HUD_HEIGHT = 32;

// Rope
export const ROPE_AIM_SPEED = 2.0;
export const ROPE_FLY_SPEED = 400;
export const ROPE_MAX_LEN = 400;
export const SWING_GRAVITY = 800;
export const SWING_PUMP = 6.0;
export const SWING_DAMPING = 0.99;
export const SWING_DAMPING_END = 0.93;
export const SWING_ANCHOR_DECAY_TIME = 24.0;
export const SWING_PUMP_FLOOR = 0.25;
export const ROPE_COOLDOWN = 0.3;
