/**
 * Run statistics — title timestamps and per-mission durations.
 *
 * Centralized so progression.js, debug skip, and any mission that awards
 * a title mid-run (e.g. escapeLava's "lava lucky") all stamp the clock
 * the same way. The end screen reads from these fields to show a
 * mm:ss timeline of the run.
 *
 * State shape:
 *   runStartedAt: number | null      — monotonic ms at first mission enter
 *   runEndedAt:   number | null      — set once when the last mission lands;
 *                                      freezes the end-screen total time
 *   missionStats: { [id]: { enteredAt, completedAt: number | null } }
 *   titles:       { name, missionId, earnedAt }[]
 *   titleBanner:  { name, age } | null — transient award-celebration banner;
 *                                        the renderer reads it, the game
 *                                        loop ages it, `tickTitleBanner`
 *                                        clears it once its lifetime is up.
 *
 * Times come from a monotonic clock so duration math is unaffected by
 * NTP slew or DST. The clock is module-private and overridable via
 * `_setNowForTests` so tests can advance it deterministically.
 */

let _now = defaultNow;

function defaultNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function _setNowForTests(fn) { _now = fn; }
export function _resetNowForTests() { _now = defaultNow; }

export function awardTitle(state, name, missionId) {
  if (!state.titles) state.titles = [];
  state.titles.push({ name, missionId, earnedAt: _now() });
  // Arm a celebratory banner so the renderer can fade in/out the new
  // title. Replacing any in-flight banner is intentional — back-to-back
  // awards always celebrate the latest, not queue up the chain.
  state.titleBanner = { name, age: 0 };
}

// Banner timing — keep in sync with `drawTitleBanner` in render.js.
const TITLE_BANNER_FADE_IN = 0.25;
const TITLE_BANNER_HOLD = 2.2;
const TITLE_BANNER_FADE_OUT = 0.6;
export const TITLE_BANNER_TOTAL = TITLE_BANNER_FADE_IN + TITLE_BANNER_HOLD + TITLE_BANNER_FADE_OUT;

export function tickTitleBanner(state, dt) {
  const b = state.titleBanner;
  if (!b) return;
  b.age += dt;
  if (b.age >= TITLE_BANNER_TOTAL) state.titleBanner = null;
}

export function titleBannerAlpha(banner) {
  if (!banner) return 0;
  const fadeIn = Math.min(1, banner.age / TITLE_BANNER_FADE_IN);
  const fadeOut = banner.age > TITLE_BANNER_FADE_IN + TITLE_BANNER_HOLD
    ? Math.max(0, 1 - (banner.age - TITLE_BANNER_FADE_IN - TITLE_BANNER_HOLD) / TITLE_BANNER_FADE_OUT)
    : 1;
  return fadeIn * fadeOut;
}

export function latestTitle(state) {
  const ts = state.titles;
  if (!Array.isArray(ts) || ts.length === 0) return null;
  return ts[ts.length - 1];
}

export function markMissionEntered(state, missionId) {
  if (!state.missionStats) state.missionStats = {};
  if (state.runStartedAt == null) state.runStartedAt = _now();
  if (!state.missionStats[missionId]) {
    state.missionStats[missionId] = { enteredAt: _now(), completedAt: null };
  }
}

export function markMissionCompleted(state, missionId) {
  if (!state.missionStats) return;
  const stat = state.missionStats[missionId];
  if (stat && stat.completedAt == null) stat.completedAt = _now();
}

export function titleNames(state) {
  return (state.titles || []).map((t) => t.name);
}

export function missionDurationMs(state, missionId) {
  const stat = state.missionStats?.[missionId];
  if (!stat || stat.enteredAt == null || stat.completedAt == null) return null;
  return stat.completedAt - stat.enteredAt;
}

export function markRunEnded(state) {
  if (state.runEndedAt == null) state.runEndedAt = _now();
}

/**
 * Whole-run elapsed time. Returns 0 before the run starts, freezes at
 * `runEndedAt - runStartedAt` once the last mission lands, otherwise
 * keeps ticking from `runStartedAt`. The frozen branch is what the
 * end screen displays so the headline number doesn't keep climbing.
 */
export function totalRunMs(state) {
  if (state.runStartedAt == null) return 0;
  if (state.runEndedAt != null) return state.runEndedAt - state.runStartedAt;
  return _now() - state.runStartedAt;
}

/**
 * Format a millisecond duration as `M:SS`. Negative or null/undefined
 * inputs render as a parchment dash so the end screen can show a
 * placeholder for missions the player skipped or left mid-run.
 */
export function formatMs(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
