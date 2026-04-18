/**
 * Class progression and mission ladder.
 *
 * A mission is a self-contained, declarative object. Simple missions are
 * just `{ id, text, check, rewardRank }`. Richer missions (hazards,
 * custom goals, custom rendering) add optional lifecycle hooks:
 *
 *   onEnter(state)          one-shot setup when this mission becomes active.
 *                           Use it to spawn goal objects (a door), seed
 *                           hazards (rising lava), etc. Scene state lives on
 *                           `state.missionScene` — a fresh {} is created for
 *                           each mission and cleared on exit, so missions
 *                           can't leak state across transitions.
 *
 *   update(state, dt)       per-frame tick while active. Advance hazards,
 *                           check collisions, trigger fail/restart.
 *
 *   render(ctx, state, W, H) per-frame draw for mission-specific visuals.
 *
 *   onExit(state)           teardown when this mission completes. Usually
 *                           unnecessary since missionScene is reset for you;
 *                           use it only if the mission mutated shared
 *                           gameplay state it needs to revert.
 *
 * Completion rules:
 *   check(state)   — the win condition. When it returns true, rewards are
 *                    applied and the ladder advances to the next mission.
 *   rewardRank?    — replaces state.rank.
 *   rewardTitle?   — appended to state.titles (titles stack).
 *   unlocks?       — string[] added to state.unlocks. Gameplay / render
 *                    code branches on these via `hasUnlock(state, flag)`.
 *
 * Adding a simple mission = append one object. Adding a scene-driven
 * mission = append one object that carries its own onEnter/update/render.
 * Callers (main.js game loop, render.js) invoke the hooks via
 * `tickActiveMission` and `renderActiveMission` — they never need to know
 * which mission is active.
 */

export const INITIAL_RANK = 'novice pauper';

export const MISSIONS = [
  {
    id: 'collect-balls-5',
    text: 'Collect 5 glowing balls',
    check: (s) => (s.score || 0) >= 5,
    rewardRank: 'apprentice pauper',
  },
  {
    id: 'collect-mines-4',
    text: 'Collect 4 mana mines',
    check: (s) => (s.minesMined || 0) >= 4,
    rewardRank: 'journeyman pauper',
  },
];

const ALL_DONE_MISSION = 'All missions complete!';

/**
 * Fresh progression fields. Spread into the game's state object at init.
 * main.js doesn't need to know the internal shape.
 */
export function initialProgression() {
  return {
    rank: INITIAL_RANK,
    titles: [],
    missionIdx: 0,
    mission: MISSIONS[0]?.text ?? ALL_DONE_MISSION,
    nextMission: MISSIONS[1]?.text ?? null,
    unlocks: new Set(),
    completedMissionIds: new Set(),
    currentMissionId: null,   // set once onEnter has fired for the active mission
    missionScene: null,       // per-mission scratchpad — cleared on transitions
  };
}

export function displayClass(state) {
  const rank = state.rank || INITIAL_RANK;
  const titles = state.titles || [];
  return titles.length ? `${rank} / ${titles.join(' / ')}` : rank;
}

export function getActiveMission(state) {
  return MISSIONS[state.missionIdx] || null;
}

export function hasUnlock(state, unlock) {
  return !!(state.unlocks && state.unlocks.has(unlock));
}

export function hasCompleted(state, missionId) {
  return !!(state.completedMissionIds && state.completedMissionIds.has(missionId));
}

/**
 * Walk the ladder, completing every mission whose check passes right now.
 * Also guarantees that the currently-active mission has had its onEnter
 * hook fired exactly once — so main.js just calls this each frame and the
 * mission lifecycle takes care of itself.
 */
export function advanceMission(state) {
  ensureFields(state);
  ensureEntered(state);

  while (state.missionIdx < MISSIONS.length && MISSIONS[state.missionIdx].check(state)) {
    const m = MISSIONS[state.missionIdx];
    if (m.rewardRank) state.rank = m.rewardRank;
    if (m.rewardTitle) state.titles.push(m.rewardTitle);
    if (m.unlocks) for (const u of m.unlocks) state.unlocks.add(u);
    state.completedMissionIds.add(m.id);

    m.onExit?.(state);
    state.missionScene = null;
    state.currentMissionId = null;

    state.missionIdx += 1;
    ensureEntered(state);
  }

  state.mission = state.missionIdx < MISSIONS.length
    ? MISSIONS[state.missionIdx].text
    : ALL_DONE_MISSION;
  state.nextMission = MISSIONS[state.missionIdx + 1]?.text ?? null;
}

/**
 * Per-frame tick for the active mission's `update` hook (if any). Call
 * from the main game loop after gameplay updates, before rendering.
 */
export function tickActiveMission(state, dt) {
  const m = getActiveMission(state);
  m?.update?.(state, dt);
}

/**
 * Per-frame draw for the active mission's `render` hook (if any). Call
 * from render.js at the layer the mission should paint on (e.g. between
 * world and HUD).
 */
export function renderActiveMission(ctx, state, W, H) {
  const m = getActiveMission(state);
  m?.render?.(ctx, state, W, H);
}

function ensureFields(state) {
  if (!state.unlocks) state.unlocks = new Set();
  if (!state.completedMissionIds) state.completedMissionIds = new Set();
  if (!state.titles) state.titles = [];
  if (state.missionIdx == null) state.missionIdx = 0;
}

function ensureEntered(state) {
  const m = MISSIONS[state.missionIdx];
  if (!m) return;
  if (state.currentMissionId === m.id) return;
  state.missionScene = {};
  state.currentMissionId = m.id;
  m.onEnter?.(state);
}
