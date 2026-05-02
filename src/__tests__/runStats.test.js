import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  awardTitle,
  markMissionEntered,
  markMissionCompleted,
  titleNames,
  missionDurationMs,
  _setNowForTests,
  _resetNowForTests,
} from '../runStats.js';

let clock;
beforeEach(() => {
  clock = 1000;
  _setNowForTests(() => clock);
});
afterEach(() => {
  _resetNowForTests();
});

function tick(ms) { clock += ms; }

describe('awardTitle', () => {
  it('appends a title with name, missionId, and earnedAt timestamp', () => {
    const s = {};
    awardTitle(s, 'meteor dodger', 'meteor-shower');
    expect(s.titles).toEqual([
      { name: 'meteor dodger', missionId: 'meteor-shower', earnedAt: 1000 },
    ]);
  });

  it('preserves earnedAt order across multiple awards', () => {
    const s = {};
    awardTitle(s, 'first', 'm1');
    tick(500);
    awardTitle(s, 'second', 'm2');
    expect(s.titles.map((t) => t.earnedAt)).toEqual([1000, 1500]);
  });

  it('initializes the titles array if absent', () => {
    const s = {};
    awardTitle(s, 't', 'm');
    expect(Array.isArray(s.titles)).toBe(true);
  });
});

describe('markMissionEntered', () => {
  it('stamps enteredAt the first time a mission is entered', () => {
    const s = {};
    markMissionEntered(s, 'escape-lava');
    expect(s.missionStats['escape-lava']).toEqual({ enteredAt: 1000, completedAt: null });
  });

  it('sets runStartedAt the first time any mission is entered, then leaves it', () => {
    const s = {};
    markMissionEntered(s, 'collect-balls-5');
    expect(s.runStartedAt).toBe(1000);
    tick(500);
    markMissionEntered(s, 'collect-mines-4');
    expect(s.runStartedAt).toBe(1000);
  });

  it('does not overwrite an already-recorded enteredAt (Shift+R restart preserves the first entry)', () => {
    const s = {};
    markMissionEntered(s, 'meteor-shower');
    tick(2000);
    markMissionEntered(s, 'meteor-shower');
    expect(s.missionStats['meteor-shower'].enteredAt).toBe(1000);
  });
});

describe('markMissionCompleted', () => {
  it('stamps completedAt for an entered mission', () => {
    const s = {};
    markMissionEntered(s, 'escape-lava');
    tick(3000);
    markMissionCompleted(s, 'escape-lava');
    expect(s.missionStats['escape-lava']).toEqual({ enteredAt: 1000, completedAt: 4000 });
  });

  it('is a no-op for a mission that was never entered', () => {
    const s = {};
    markMissionCompleted(s, 'never-entered');
    expect(s.missionStats?.['never-entered']).toBeUndefined();
  });

  it('does not overwrite an existing completedAt', () => {
    const s = {};
    markMissionEntered(s, 'm');
    tick(100);
    markMissionCompleted(s, 'm');
    tick(500);
    markMissionCompleted(s, 'm');
    expect(s.missionStats.m.completedAt).toBe(1100);
  });
});

describe('titleNames', () => {
  it('extracts the name field from each title entry', () => {
    const s = {};
    awardTitle(s, 'one', 'm1');
    awardTitle(s, 'two', 'm2');
    expect(titleNames(s)).toEqual(['one', 'two']);
  });

  it('returns an empty array when titles are absent', () => {
    expect(titleNames({})).toEqual([]);
  });
});

describe('missionDurationMs', () => {
  it('returns the elapsed ms between enteredAt and completedAt', () => {
    const s = {};
    markMissionEntered(s, 'ice-age');
    tick(7500);
    markMissionCompleted(s, 'ice-age');
    expect(missionDurationMs(s, 'ice-age')).toBe(7500);
  });

  it('returns null for a mission still in progress', () => {
    const s = {};
    markMissionEntered(s, 'ice-age');
    expect(missionDurationMs(s, 'ice-age')).toBeNull();
  });

  it('returns null for an unknown mission', () => {
    expect(missionDurationMs({}, 'whatever')).toBeNull();
  });
});
