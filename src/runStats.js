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
 *   missionStats: { [id]: { enteredAt, completedAt: number | null } }
 *   titles:       { name, missionId, earnedAt }[]
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
