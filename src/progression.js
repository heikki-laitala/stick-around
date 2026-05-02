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

import { ALONE_IN_DARK_MISSION } from './missions/aloneInDark.js';
import { ESCAPE_LAVA_MISSION } from './missions/escapeLava.js';
import { EVIL_TWIN_MISSION } from './missions/evilTwin.js';
import { ICE_AGE_MISSION } from './missions/iceAge.js';
import { METEOR_SHOWER_MISSION } from './missions/meteorShower.js';
import { SHARDFALL_MISSION } from './missions/shardfall.js';

export const INITIAL_RANK = 'novice pauper';

export const MISSIONS = [
  {
    id: 'collect-balls-5',
    text: 'Collect 5 glowing balls',
    subtitle: 'walk into a glowing ball to grab it',
    // Stamp the running score on entry so the check requires *5 fresh*
    // balls from this point on. Without the baseline, Shift+R restart
    // would keep the score the player had before the restart and the
    // mission would resume mid-progress — same baseline pattern as
    // collect-mines-4 below.
    onEnter(state) {
      state.scoreAtMissionStart = state.score || 0;
    },
    questSuffix(s) {
      const fresh = (s.score || 0) - (s.scoreAtMissionStart || 0);
      return `(${Math.min(5, Math.max(0, fresh))}/5)`;
    },
    check: (s) => (s.score || 0) - (s.scoreAtMissionStart || 0) >= 5,
    rewardRank: 'apprentice pauper',
  },
  {
    id: 'collect-mines-4',
    text: 'Collect 4 mana mines',
    subtitle: 'press F next to a mana crystal to mine it',
    // Stamp the running mine count when this mission opens so the
    // check requires *4 fresh* mines from this point on. Without
    // the baseline, mining mana incidentally during mission 1 (which
    // only tracks ball score) would auto-complete mission 2 on the
    // same advance call as mission 1 and skip the mission entirely.
    onEnter(state) {
      state.minesMinedAtMissionStart = state.minesMined || 0;
    },
    questSuffix(s) {
      const fresh = (s.minesMined || 0) - (s.minesMinedAtMissionStart || 0);
      return `(${Math.min(4, Math.max(0, fresh))}/4)`;
    },
    check: (s) => (s.minesMined || 0) - (s.minesMinedAtMissionStart || 0) >= 4,
    rewardRank: 'journeyman pauper',
  },
  ESCAPE_LAVA_MISSION,
  METEOR_SHOWER_MISSION,
  ALONE_IN_DARK_MISSION,
  ICE_AGE_MISSION,
  EVIL_TWIN_MISSION,
  SHARDFALL_MISSION,
];

// The first two missions are fixed-order tutorials (collect balls, then
// collect mines). Everything past that is shuffled per session so the
// player gets a fresh ladder each run without ever repeating a mission
// they've already played in this run.
export const FIXED_MISSION_COUNT = 2;

const ALL_DONE_MISSION = 'All missions complete!';

/**
 * Build a per-session play order. Fixed prefix (`FIXED_MISSION_COUNT`
 * entries) is preserved; everything past that is Fisher-Yates shuffled so
 * each run sees the variable missions in a different sequence. Returns a
 * permutation of every index in MISSIONS.
 */
// Pinned-finale mission id. Pulled out of the random tail and
// appended at the very end so the play order always builds up to
// this mission as the climactic finish.
const FINALE_MISSION_ID = 'evil-twin';
// Eligible "third mission" candidates — one of these always plays
// right after the fixed warm-up so the early run has a coherent
// shape: warm-ups → environmental hazard mission → variable tail.
const EARLY_PICK_IDS = ['escape-lava', 'ice-age'];

function removeFromArray(arr, value) {
  const at = arr.indexOf(value);
  if (at >= 0) arr.splice(at, 1);
}

function defaultMissionOrder() {
  const order = [];
  const fixed = Math.min(FIXED_MISSION_COUNT, MISSIONS.length);
  for (let i = 0; i < fixed; i++) order.push(i);
  const tail = [];
  for (let i = fixed; i < MISSIONS.length; i++) tail.push(i);

  // Pin the finale at the end of the play order.
  const finaleMissionIdx = MISSIONS.findIndex((m) => m.id === FINALE_MISSION_ID);
  if (finaleMissionIdx >= 0) removeFromArray(tail, finaleMissionIdx);

  // Pick one of the early-candidate missions to lead the variable tail.
  // The other (if any) folds back into the random middle.
  const earlyCandidates = EARLY_PICK_IDS
    .map((id) => MISSIONS.findIndex((m) => m.id === id))
    .filter((idx) => idx >= 0 && tail.includes(idx));
  let earlyPicked = -1;
  if (earlyCandidates.length > 0) {
    earlyPicked = earlyCandidates[Math.floor(Math.random() * earlyCandidates.length)];
    removeFromArray(tail, earlyPicked);
  }

  // Shuffle the remaining middle.
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }

  const result = [...order];
  if (earlyPicked >= 0) result.push(earlyPicked);
  result.push(...tail);
  if (finaleMissionIdx >= 0) result.push(finaleMissionIdx);
  return result;
}

/**
 * Fresh progression fields. Spread into the game's state object at init.
 * main.js doesn't need to know the internal shape.
 */
export function initialProgression() {
  const missionOrder = defaultMissionOrder();
  return {
    rank: INITIAL_RANK,
    titles: [],
    missionIdx: 0,
    missionOrder,             // play order — fixed prefix, shuffled tail
    mission: MISSIONS[missionOrder[0]]?.text ?? ALL_DONE_MISSION,
    nextMission: MISSIONS[missionOrder[1]]?.text ?? null,
    unlocks: new Set(),
    completedMissionIds: new Set(),
    currentMissionId: null,   // set once onEnter has fired for the active mission
    missionScene: null,       // per-mission scratchpad — cleared on transitions
  };
}

function missionAt(state, idx) {
  if (idx < 0) return null;
  const order = state.missionOrder;
  if (!order || idx >= order.length) return null;
  return MISSIONS[order[idx]] || null;
}

export function displayClass(state) {
  const rank = state.rank || INITIAL_RANK;
  const titles = state.titles || [];
  return titles.length ? `${rank} / ${titles.join(' / ')}` : rank;
}

export function getActiveMission(state) {
  return missionAt(state, state.missionIdx);
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

  while (state.missionIdx < state.missionOrder.length) {
    const m = missionAt(state, state.missionIdx);
    if (!m || !m.check(state)) break;
    if (m.rewardRank) state.rank = m.rewardRank;
    if (m.rewardTitle) state.titles.push(m.rewardTitle);
    if (m.unlocks) for (const u of m.unlocks) state.unlocks.add(u);
    state.completedMissionIds.add(m.id);

    m.onExit?.(state);
    state.missionScene = null;
    state.currentMissionId = null;
    state.waterArea = null;

    state.missionIdx += 1;
    ensureEntered(state);                        // fires the next mission's entry banner
  }

  state.mission = missionAt(state, state.missionIdx)?.text ?? ALL_DONE_MISSION;
  state.nextMission = missionAt(state, state.missionIdx + 1)?.text ?? null;
}

/**
 * Debug-only: force the current mission to complete, applying its rewards
 * and firing onExit, then advance to the next mission. Used from a hidden
 * key binding to play-test higher-level missions without satisfying their
 * actual conditions.
 */
export function debugSkipMission(state) {
  ensureFields(state);
  ensureEntered(state);
  // When already past the end, cycle back to the first mission, reshuffle
  // the variable tail, and clear progress so the ladder plays through
  // again with a fresh order. Counters (score, minesMined) are zeroed so
  // simple check-missions don't auto-complete.
  if (state.missionIdx >= state.missionOrder.length) {
    state.missionIdx = 0;
    state.missionOrder = defaultMissionOrder();
    state.rank = INITIAL_RANK;
    state.titles = [];
    state.unlocks = new Set();
    state.completedMissionIds = new Set();
    state.missionScene = null;
    state.currentMissionId = null;
    state.waterArea = null;
    state.score = 0;
    state.minesMined = 0;
    advanceMission(state);
    return;
  }
  const m = missionAt(state, state.missionIdx);
  if (!m) return;
  if (m.rewardRank) state.rank = m.rewardRank;
  if (m.rewardTitle) state.titles.push(m.rewardTitle);
  if (m.unlocks) for (const u of m.unlocks) state.unlocks.add(u);
  state.completedMissionIds.add(m.id);
  m.onExit?.(state);
  state.missionScene = null;
  state.currentMissionId = null;
  state.waterArea = null;
  state.missionIdx += 1;
  // Fire onEnter for the next mission (if any) and refresh the HUD fields.
  advanceMission(state);
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

/**
 * Reset the currently-active mission to a fresh run. Clears gameOver and
 * wipes missionScene so the next `advanceMission` tick fires onEnter
 * again. Mission-agnostic — missions' individual restart helpers all do
 * the same thing; this is the one that main.js should call.
 */
export function restartActiveMission(state) {
  state.gameOver = false;
  state.currentMissionId = null;
  state.missionScene = null;
  state.waterArea = null;
  // Clear transient world state so the world genuinely resets:
  // collectibles + mana mines respawn fresh, holes in platforms heal,
  // particles fade, in-flight spells are dropped. The mission's
  // onEnter then reseeds whatever it owns inside the new scene.
  if (Array.isArray(state.collectibles)) state.collectibles.length = 0;
  if (Array.isArray(state.manaMines)) state.manaMines.length = 0;
  if (Array.isArray(state.particles)) state.particles.length = 0;
  if (Array.isArray(state.holes)) state.holes.length = 0;
  state.lightningAim = null;
  state.lightningBolt = null;
  state.shieldActive = false;
  state.stasisActive = false;
  state.stasisAge = 0;
}

function ensureFields(state) {
  if (!state.unlocks) state.unlocks = new Set();
  if (!state.completedMissionIds) state.completedMissionIds = new Set();
  if (!state.titles) state.titles = [];
  if (state.missionIdx == null) state.missionIdx = 0;
  if (!Array.isArray(state.missionOrder)) {
    state.missionOrder = defaultMissionOrder();
  } else {
    // Pick up missions registered after the order was built — primarily a
    // test-time concern, since MISSIONS is a module constant in production.
    // Append at the tail so already-played indices keep their position.
    const present = new Set(state.missionOrder);
    for (let i = 0; i < MISSIONS.length; i++) {
      if (!present.has(i)) state.missionOrder.push(i);
    }
  }
}

function ensureEntered(state) {
  const m = missionAt(state, state.missionIdx);
  if (!m) return;
  if (state.currentMissionId === m.id) return;
  state.missionScene = {};
  state.currentMissionId = m.id;
  m.onEnter?.(state);
  // Generic mission-entry banner — fades in/holds/out so the player
  // always gets clear feedback when the active quest changes. Per-
  // mission `subtitle` lets a mission tack a hint underneath (e.g.
  // shardfall's binding reminder); when omitted, only the title shows.
  state.missionToast = {
    age: 0,
    text: m.text,
    subtitle: m.subtitle || null,
  };
}
