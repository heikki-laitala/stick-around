/**
 * Class progression and mission ladder.
 *
 * Scaffolding only for now — advanceMission is NOT yet wired into the game
 * loop. main.js sets state.rank once at startup, and the HUD reads it.
 * Hooking the ladder up to actual gameplay rewards will happen later.
 *
 * Rank (e.g. 'novice pauper') is the base title and is replaced as the
 * player advances through energy thresholds. Themed missions grant a
 * Title (e.g. 'twin dueller') which is appended to the display string as
 * 'rank / title / title'. Titles stack; ranks replace.
 */

export const INITIAL_RANK = 'novice pauper';

export const MISSIONS = [
  { text: 'Collect 10 glowing balls',  check: (s) => (s.score || 0) >= 10,        rewardRank:  'apprentice pauper' },
  { text: 'Defeat evil twin',          check: (s) => (s.twinsDefeated || 0) >= 1, rewardTitle: 'twin dueller' },
  { text: 'Collect 50 glowing balls',  check: (s) => (s.score || 0) >= 50,        rewardRank:  'journeyman pauper' },
  { text: 'Collect 100 glowing balls', check: (s) => (s.score || 0) >= 100,       rewardRank:  'master pauper' },
  { text: 'Collect 200 glowing balls', check: (s) => (s.score || 0) >= 200,       rewardRank:  'grandmaster pauper' },
];

const ALL_DONE_MISSION = 'All missions complete!';

/**
 * Render the combined class string shown in the HUD: rank plus any earned
 * titles, joined by ' / '.
 */
export function displayClass(state) {
  const rank = state.rank || INITIAL_RANK;
  const titles = state.titles || [];
  return titles.length ? `${rank} / ${titles.join(' / ')}` : rank;
}

/**
 * Advance through any missions whose check() currently passes, updating
 * state.missionIdx, state.rank, state.titles, and state.mission in place.
 */
export function advanceMission(state) {
  while (state.missionIdx < MISSIONS.length && MISSIONS[state.missionIdx].check(state)) {
    const m = MISSIONS[state.missionIdx];
    if (m.rewardRank) state.rank = m.rewardRank;
    if (m.rewardTitle) {
      if (!state.titles) state.titles = [];
      state.titles.push(m.rewardTitle);
    }
    state.missionIdx += 1;
  }
  state.mission = state.missionIdx < MISSIONS.length
    ? MISSIONS[state.missionIdx].text
    : ALL_DONE_MISSION;
}
