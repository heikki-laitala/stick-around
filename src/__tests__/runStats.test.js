import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  awardTitle,
  markMissionEntered,
  markMissionCompleted,
  titleNames,
  missionDurationMs,
  tickTitleBanner,
  titleBannerAlpha,
  latestTitle,
  TITLE_BANNER_TOTAL,
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

  it('arms a celebratory banner with the awarded title name and age 0', () => {
    const s = {};
    awardTitle(s, 'lava lucky', 'escape-lava');
    expect(s.titleBanner).toEqual({ name: 'lava lucky', age: 0 });
  });

  it('replaces an in-flight banner so only the latest title is celebrated', () => {
    const s = {};
    awardTitle(s, 'first', 'm1');
    s.titleBanner.age = 0.5;
    awardTitle(s, 'second', 'm2');
    expect(s.titleBanner).toEqual({ name: 'second', age: 0 });
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

describe('tickTitleBanner / titleBannerAlpha', () => {
  it('clears the banner once its lifetime is up', () => {
    const s = {};
    awardTitle(s, 't', 'm');
    tickTitleBanner(s, TITLE_BANNER_TOTAL + 0.01);
    expect(s.titleBanner).toBeNull();
  });

  it('keeps the banner alive within its lifetime and ages it', () => {
    const s = {};
    awardTitle(s, 't', 'm');
    tickTitleBanner(s, 0.1);
    expect(s.titleBanner).not.toBeNull();
    expect(s.titleBanner.age).toBeCloseTo(0.1);
  });

  it('alpha ramps up during fade-in, holds at 1, then ramps down', () => {
    const banner = { name: 't', age: 0 };
    expect(titleBannerAlpha(banner)).toBe(0);
    banner.age = 1.0; // well into hold window
    expect(titleBannerAlpha(banner)).toBe(1);
    banner.age = TITLE_BANNER_TOTAL;
    expect(titleBannerAlpha(banner)).toBe(0);
  });

  it('is a no-op (and returns 0 alpha) when no banner is set', () => {
    expect(titleBannerAlpha(null)).toBe(0);
    const s = {};
    tickTitleBanner(s, 0.1); // does not throw
    expect(s.titleBanner).toBeUndefined();
  });
});

describe('latestTitle', () => {
  it('returns the most-recently awarded title', () => {
    const s = {};
    awardTitle(s, 'first', 'm1');
    tick(100);
    awardTitle(s, 'second', 'm2');
    expect(latestTitle(s)).toMatchObject({ name: 'second', missionId: 'm2' });
  });

  it('returns null when no titles have been earned', () => {
    expect(latestTitle({})).toBeNull();
    expect(latestTitle({ titles: [] })).toBeNull();
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
