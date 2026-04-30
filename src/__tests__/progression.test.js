import { describe, it, expect } from 'vitest';
import {
  MISSIONS,
  FIXED_MISSION_COUNT,
  advanceMission,
  debugSkipMission,
  displayClass,
  initialProgression,
  hasUnlock,
  hasCompleted,
  tickActiveMission,
  renderActiveMission,
  getActiveMission,
  INITIAL_RANK,
} from '../progression.js';

function makeState(overrides = {}) {
  return {
    score: 0,
    minesMined: 0,
    ...initialProgression(),
    ...overrides,
  };
}

// Tests that push a synthesized mission rely on it being the last one
// reached by completeRealMissions. With the random tail order, that's not
// guaranteed — pin the most-recent push to the end of the play order so
// the assertions stay deterministic.
function pinLatestMissionLast(s) {
  const last = MISSIONS.length - 1;
  s.missionOrder = [...s.missionOrder.filter((i) => i !== last), last];
}

/**
 * Walk `advanceMission` all the way past every real mission by supplying
 * whatever each one demands (counters for simple checks, scene flags for
 * stateful ones like escape-lava). Stops at the first mission whose check
 * we don't know how to satisfy — which is where freshly-pushed test
 * missions live.
 */
function completeRealMissions(s) {
  s.score = Math.max(s.score || 0, 10_000);
  s.minesMined = Math.max(s.minesMined || 0, 10_000);
  for (let guard = 0; guard < 100; guard++) {
    advanceMission(s);
    const m = getActiveMission(s);
    if (!m) return;
    if (m.id === 'escape-lava' && s.missionScene) {
      s.missionScene.reachedDoor = true;
      continue;
    }
    if (m.id === 'dodge-meteors' && s.missionScene) {
      s.missionScene.survived = true;
      continue;
    }
    if (m.id === 'alone-in-dark' && s.missionScene) {
      // Test states don't carry platforms, so seedItems returns []. Force a
      // completed inventory so the check passes and the ladder advances.
      s.missionScene.items = [{ kind: 'key', picked: true }];
      continue;
    }
    if (m.id === 'ice-age' && s.missionScene) {
      // Skip past the snowman build + the win-hold by stamping both fields.
      s.missionScene.builtLayers = 3;
      s.missionScene.winT = 999;
      continue;
    }
    if (m.id === 'evil-twin' && s.missionScene) {
      // Bypass the live ball-pickup loop by stamping the goal counter.
      s.missionScene.ballsCollected = 5;
      continue;
    }
    if (m.id === 'constellation' && s.missionScene) {
      // Skip past the constellation by marking every edge drawn.
      for (const e of s.missionScene.edges || []) e.drawn = true;
      continue;
    }
    return; // landed on something we don't know how to auto-satisfy
  }
}

describe('initialProgression', () => {
  it('starts every state as novice pauper with mission 0 and empty unlocks', () => {
    expect(INITIAL_RANK).toBe('novice pauper');
    const s = makeState();
    expect(s.rank).toBe('novice pauper');
    expect(s.titles).toEqual([]);
    expect(s.missionIdx).toBe(0);
    expect(s.mission).toBe(MISSIONS[0].text);
    expect(s.unlocks.size).toBe(0);
    expect(s.completedMissionIds.size).toBe(0);
  });

  it('pins the fixed-prefix missions to the start of the play order', () => {
    const s = makeState();
    for (let i = 0; i < FIXED_MISSION_COUNT; i++) {
      expect(s.missionOrder[i]).toBe(i);
    }
  });

  it('produces a permutation of every mission index — no dupes, no gaps', () => {
    const s = makeState();
    expect(s.missionOrder.length).toBe(MISSIONS.length);
    const seen = new Set(s.missionOrder);
    expect(seen.size).toBe(MISSIONS.length);
    for (let i = 0; i < MISSIONS.length; i++) expect(seen.has(i)).toBe(true);
  });

  it('shuffles the variable tail across runs (statistical — at least one differs)', () => {
    if (MISSIONS.length - FIXED_MISSION_COUNT < 2) return;       // not enough variance to shuffle
    let differs = false;
    const baseline = makeState().missionOrder.slice(FIXED_MISSION_COUNT).join(',');
    for (let attempt = 0; attempt < 30 && !differs; attempt++) {
      const tail = makeState().missionOrder.slice(FIXED_MISSION_COUNT).join(',');
      if (tail !== baseline) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('MISSIONS', () => {
  it('has a unique id on every mission', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBeTruthy();
  });
});

describe('advanceMission', () => {
  it('does not advance when the check is not satisfied', () => {
    const s = makeState();
    advanceMission(s);
    expect(s.rank).toBe(INITIAL_RANK);
    expect(s.missionIdx).toBe(0);
    expect(s.mission).toBe(MISSIONS[0].text);
  });

  it('completes the first mission and advances to the second', () => {
    const s = makeState({ score: 5 });
    advanceMission(s);
    expect(s.missionIdx).toBe(1);
    expect(s.rank).toBe(MISSIONS[0].rewardRank);
    expect(s.mission).toBe(MISSIONS[1].text);
    expect(hasCompleted(s, MISSIONS[0].id)).toBe(true);
  });

  it('exposes the upcoming mission via state.nextMission (null at the end)', () => {
    const s = makeState();
    expect(s.nextMission).toBe(MISSIONS[1].text);
    const s2 = makeState({ score: 5 });
    advanceMission(s2);
    expect(s2.mission).toBe(MISSIONS[1].text);
    // After mission 0 completes, nextMission previews whatever the play
    // order has at index 2 (random per session, beyond the fixed prefix).
    expect(s2.nextMission).toBe(MISSIONS[s2.missionOrder[2]]?.text ?? null);
    const s3 = makeState();
    completeRealMissions(s3);
    expect(s3.nextMission).toBeNull();
  });

  it('records title rewards in state.titles', () => {
    // Synthesize a one-off mission to exercise the title path without
    // coupling to a specific in-ladder entry.
    const titleMission = { id: 'test-title', text: 't', check: () => true, rewardTitle: 'legend' };
    const s = makeState();
    MISSIONS.push(titleMission);
    pinLatestMissionLast(s);
    try {
      completeRealMissions(s);
      expect(s.titles).toContain('legend');
      expect(hasCompleted(s, 'test-title')).toBe(true);
    } finally {
      MISSIONS.pop();
    }
  });

  it('adds unlocks to state.unlocks when a mission grants them', () => {
    const unlockMission = {
      id: 'test-unlock',
      text: 'u',
      check: () => true,
      unlocks: ['dark-mode', 'rain'],
    };
    const s = makeState();
    MISSIONS.push(unlockMission);
    pinLatestMissionLast(s);
    try {
      completeRealMissions(s);
      expect(hasUnlock(s, 'dark-mode')).toBe(true);
      expect(hasUnlock(s, 'rain')).toBe(true);
      expect(hasUnlock(s, 'nope')).toBe(false);
    } finally {
      MISSIONS.pop();
    }
  });

  it('caps at the final rank when every mission is complete', () => {
    const s = makeState();
    completeRealMissions(s);
    expect(s.missionIdx).toBe(MISSIONS.length);
    const lastRankMission = [...MISSIONS].reverse().find((m) => m.rewardRank);
    expect(s.rank).toBe(lastRankMission.rewardRank);
    expect(s.mission).toMatch(/complete/i);
  });

  it('is idempotent — calling advance again with the same state is a no-op', () => {
    const s = makeState();
    completeRealMissions(s);
    const snapshot = {
      rank: s.rank,
      titles: [...s.titles],
      missionIdx: s.missionIdx,
      mission: s.mission,
      unlocks: new Set(s.unlocks),
      completedMissionIds: new Set(s.completedMissionIds),
    };
    advanceMission(s);
    expect(s.rank).toBe(snapshot.rank);
    expect(s.titles).toEqual(snapshot.titles);
    expect(s.missionIdx).toBe(snapshot.missionIdx);
    expect(s.mission).toBe(snapshot.mission);
    expect([...s.unlocks]).toEqual([...snapshot.unlocks]);
    expect([...s.completedMissionIds]).toEqual([...snapshot.completedMissionIds]);
  });

  it('lazily initializes progression fields if missing (safe for legacy states)', () => {
    const s = { score: 5, minesMined: 0 };
    advanceMission(s);
    expect(s.missionIdx).toBe(1);
    expect(s.unlocks).toBeInstanceOf(Set);
    expect(s.completedMissionIds).toBeInstanceOf(Set);
    expect(s.titles).toEqual([]);
  });
});

describe('mission lifecycle hooks', () => {
  function withMission(mission, fn) {
    MISSIONS.push(mission);
    // Hand the inner test a state factory so each one runs with the
    // synthesized mission pinned to the tail of the play order. Without
    // this, the random tail can put the test mission anywhere from
    // position 2 onward, which breaks tests that assume completeRealMissions
    // lands on it last.
    const buildState = (overrides = {}) => {
      const s = makeState(overrides);
      pinLatestMissionLast(s);
      return s;
    };
    try { fn(buildState); } finally { MISSIONS.pop(); }
  }

  it('calls onEnter exactly once when the mission becomes active', () => {
    let enters = 0;
    withMission(
      {
        id: 'hook-enter',
        text: 'e',
        check: () => false,
        onEnter: () => { enters += 1; },
      },
      (buildState) => {
        const s = buildState();
        completeRealMissions(s); // walks past real missions, enters the test mission
        expect(enters).toBe(1);
        advanceMission(s); // re-advance: check still false, no re-enter
        expect(enters).toBe(1);
      },
    );
  });

  it('initializes missionScene to a fresh object and clears it on exit', () => {
    withMission(
      {
        id: 'hook-scene',
        text: 's',
        check: (s) => !!s.missionScene?.won,
        onEnter: (s) => { s.missionScene.lavaY = 100; },
      },
      (buildState) => {
        const s = buildState();
        completeRealMissions(s);
        expect(s.missionScene).toEqual({ lavaY: 100 });
        s.missionScene.won = true;
        advanceMission(s);
        expect(s.missionScene).toBeNull();
      },
    );
  });

  it('tickActiveMission forwards dt to the active mission update', () => {
    let accum = 0;
    withMission(
      {
        id: 'hook-tick',
        text: 't',
        check: () => false,
        update: (_s, dt) => { accum += dt; },
      },
      (buildState) => {
        const s = buildState();
        completeRealMissions(s);
        tickActiveMission(s, 0.016);
        tickActiveMission(s, 0.016);
        expect(accum).toBeCloseTo(0.032, 5);
      },
    );
  });

  it('renderActiveMission forwards ctx and dimensions to the active mission render', () => {
    const calls = [];
    withMission(
      {
        id: 'hook-render',
        text: 'r',
        check: () => false,
        render: (ctx, _s, W, H) => { calls.push({ ctx, W, H }); },
      },
      (buildState) => {
        const s = buildState();
        completeRealMissions(s);
        const fakeCtx = { id: 'ctx' };
        renderActiveMission(fakeCtx, s, 800, 600);
        expect(calls).toEqual([{ ctx: fakeCtx, W: 800, H: 600 }]);
      },
    );
  });

  it('calls onExit when the mission completes', () => {
    let exits = 0;
    withMission(
      {
        id: 'hook-exit',
        text: 'x',
        check: (s) => !!s.missionScene?.won,
        onExit: () => { exits += 1; },
      },
      (buildState) => {
        const s = buildState();
        completeRealMissions(s);
        expect(exits).toBe(0);
        s.missionScene.won = true;
        advanceMission(s);
        expect(exits).toBe(1);
      },
    );
  });

  it('getActiveMission returns null when all missions are done', () => {
    const s = makeState();
    completeRealMissions(s);
    expect(getActiveMission(s)).toBeNull();
  });

  it('tick/render hooks are safe no-ops when no mission is active', () => {
    const s = makeState();
    completeRealMissions(s);
    expect(() => tickActiveMission(s, 0.016)).not.toThrow();
    expect(() => renderActiveMission({}, s, 800, 600)).not.toThrow();
  });
});

describe('debugSkipMission', () => {
  it('completes the current mission, applies its rewards, and advances', () => {
    const s = makeState();
    debugSkipMission(s);
    expect(s.missionIdx).toBe(1);
    expect(s.rank).toBe(MISSIONS[0].rewardRank);
    expect(hasCompleted(s, MISSIONS[0].id)).toBe(true);
    expect(s.mission).toBe(MISSIONS[1].text);
  });

  it('walks through every mission in the ladder', () => {
    const s = makeState();
    for (let i = 0; i < MISSIONS.length; i++) debugSkipMission(s);
    expect(s.missionIdx).toBe(MISSIONS.length);
    expect(s.mission).toMatch(/complete/i);
  });

  it('cycles back to the first mission once every mission is complete', () => {
    const s = makeState();
    for (let i = 0; i < MISSIONS.length; i++) debugSkipMission(s);
    expect(s.missionIdx).toBe(MISSIONS.length);
    debugSkipMission(s);
    expect(s.missionIdx).toBe(0);
    expect(s.mission).toBe(MISSIONS[0].text);
    expect(s.rank).toBe(INITIAL_RANK);
    expect(s.completedMissionIds.size).toBe(0);
  });
});

describe('hasUnlock / hasCompleted', () => {
  it('hasUnlock returns false on a state with no unlocks field', () => {
    expect(hasUnlock({}, 'anything')).toBe(false);
  });
  it('hasCompleted returns false on a state with no completedMissionIds field', () => {
    expect(hasCompleted({}, 'anything')).toBe(false);
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
