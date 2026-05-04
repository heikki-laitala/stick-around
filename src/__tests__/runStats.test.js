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
  formatMs,
  totalRunMs,
  markRunEnded,
  computeFadeAlpha,
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

describe('computeFadeAlpha', () => {
  it('ramps up from 0 to 1 during the fade-in window', () => {
    expect(computeFadeAlpha(0, 0.4, 3.6, 1.0)).toBe(0);
    expect(computeFadeAlpha(0.2, 0.4, 3.6, 1.0)).toBeCloseTo(0.5);
    expect(computeFadeAlpha(0.4, 0.4, 3.6, 1.0)).toBe(1);
  });

  it('holds at 1 throughout the hold window', () => {
    expect(computeFadeAlpha(1.0, 0.4, 3.6, 1.0)).toBe(1);
    expect(computeFadeAlpha(3.9, 0.4, 3.6, 1.0)).toBe(1);
  });

  it('ramps down from 1 to 0 during the fade-out window', () => {
    expect(computeFadeAlpha(4.0, 0.4, 3.6, 1.0)).toBeCloseTo(1);    // start of fade-out
    expect(computeFadeAlpha(4.5, 0.4, 3.6, 1.0)).toBeCloseTo(0.5);
    expect(computeFadeAlpha(5.0, 0.4, 3.6, 1.0)).toBe(0);
  });

  it('returns 0 past the total lifetime', () => {
    expect(computeFadeAlpha(10, 0.4, 3.6, 1.0)).toBe(0);
  });
});

describe('formatMs', () => {
  it('formats sub-minute durations as 0:SS', () => {
    expect(formatMs(0)).toBe('0:00');
    expect(formatMs(7_000)).toBe('0:07');
    expect(formatMs(59_999)).toBe('0:59');
  });

  it('formats minute-plus durations as M:SS', () => {
    expect(formatMs(60_000)).toBe('1:00');
    expect(formatMs(125_000)).toBe('2:05');
    expect(formatMs(3_600_000)).toBe('60:00');
  });

  it('renders null / undefined / negative as a placeholder dash', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(undefined)).toBe('—');
    expect(formatMs(-1)).toBe('—');
  });
});

describe('totalRunMs / markRunEnded', () => {
  it('returns 0 when the run has not started', () => {
    expect(totalRunMs({})).toBe(0);
  });

  it('returns now - runStartedAt while the run is in progress', () => {
    const s = {};
    markMissionEntered(s, 'm1');
    tick(2500);
    expect(totalRunMs(s)).toBe(2500);
  });

  it('freezes at runEndedAt - runStartedAt once markRunEnded is called', () => {
    const s = {};
    markMissionEntered(s, 'm1');
    tick(1500);
    markRunEnded(s);
    tick(10_000); // post-end idle should not extend the displayed total
    expect(totalRunMs(s)).toBe(1500);
  });

  it('markRunEnded does not overwrite an earlier end timestamp', () => {
    const s = {};
    markMissionEntered(s, 'm1');
    tick(1000);
    markRunEnded(s);
    tick(500);
    markRunEnded(s);
    expect(s.runEndedAt).toBe(2000);
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
