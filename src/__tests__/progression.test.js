import { describe, it, expect } from 'vitest';
import { MISSIONS, advanceMission, displayClass, INITIAL_RANK } from '../progression.js';

function makeState(overrides = {}) {
  return {
    score: 0,
    twinsDefeated: 0,
    rank: INITIAL_RANK,
    titles: [],
    missionIdx: 0,
    mission: MISSIONS[0].text,
    ...overrides,
  };
}

function firstRankMissionIdx() {
  return MISSIONS.findIndex((m) => m.rewardRank);
}

function firstTitleMissionIdx() {
  return MISSIONS.findIndex((m) => m.rewardTitle);
}

describe('progression', () => {
  it('starts every state as novice pauper with mission 0 and no titles', () => {
    expect(INITIAL_RANK).toBe('novice pauper');
    const s = makeState();
    expect(s.rank).toBe('novice pauper');
    expect(s.titles).toEqual([]);
    expect(s.missionIdx).toBe(0);
  });

  it('does not advance when mission check is not satisfied', () => {
    const s = makeState();
    advanceMission(s);
    expect(s.rank).toBe(INITIAL_RANK);
    expect(s.titles).toEqual([]);
    expect(s.missionIdx).toBe(0);
    expect(s.mission).toBe(MISSIONS[0].text);
  });

  it('advances rank when a rank mission passes — titles untouched', () => {
    const idx = firstRankMissionIdx();
    const mission = MISSIONS[idx];
    // Build a state that satisfies only this one mission's check.
    const s = makeState({ score: 10, missionIdx: idx });
    advanceMission(s);
    expect(s.rank).toBe(mission.rewardRank);
    expect(s.titles).toEqual([]);
    expect(s.missionIdx).toBe(idx + 1);
  });

  it('appends a title when a themed mission passes — rank untouched', () => {
    const idx = firstTitleMissionIdx();
    const mission = MISSIONS[idx];
    const s = makeState({ missionIdx: idx, twinsDefeated: 1 });
    advanceMission(s);
    expect(s.rank).toBe(INITIAL_RANK);
    expect(s.titles).toEqual([mission.rewardTitle]);
    expect(s.missionIdx).toBe(idx + 1);
  });

  it('caps at the final rank when every mission is complete', () => {
    const s = makeState({ score: 10_000, twinsDefeated: 10 });
    advanceMission(s);
    expect(s.missionIdx).toBe(MISSIONS.length);
    const lastRankMission = [...MISSIONS].reverse().find((m) => m.rewardRank);
    expect(s.rank).toBe(lastRankMission.rewardRank);
    expect(s.mission).toMatch(/complete/i);
  });

  it('is idempotent — calling advance again with the same state is a no-op', () => {
    const s = makeState({ score: 10_000, twinsDefeated: 10 });
    advanceMission(s);
    const snapshot = { ...s, titles: [...s.titles] };
    advanceMission(s);
    expect(s.rank).toBe(snapshot.rank);
    expect(s.titles).toEqual(snapshot.titles);
    expect(s.missionIdx).toBe(snapshot.missionIdx);
    expect(s.mission).toBe(snapshot.mission);
  });
});

describe('displayClass', () => {
  it('returns just the rank when no titles are earned', () => {
    const s = makeState();
    expect(displayClass(s)).toBe('novice pauper');
  });

  it('appends a single title after a slash', () => {
    const s = makeState({ titles: ['twin dueller'] });
    expect(displayClass(s)).toBe('novice pauper / twin dueller');
  });

  it('appends multiple titles separated by slashes', () => {
    const s = makeState({ titles: ['twin dueller', 'dragon slayer'] });
    expect(displayClass(s)).toBe('novice pauper / twin dueller / dragon slayer');
  });

  it('tolerates missing rank/titles fields', () => {
    expect(displayClass({})).toBe(INITIAL_RANK);
  });
});
