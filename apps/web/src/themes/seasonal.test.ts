import { describe, expect, it } from 'vitest';
import { getTheme } from '@dascade/ui';
import type { SeasonalPrefs } from '../app/settings.ts';
import type { ThemePlace } from './types.ts';
import {
  FALLBACK_THEME_ID,
  HALLOWEEN_THEME_ID,
  carryOver,
  createSeasonalController,
  inHalloweenSeason,
  onActivated,
  onDeactivated,
  onDismissed,
  parseSeasonOverride,
  restoreTarget,
  seasonEnd,
  shouldInvite,
  shouldRevert,
  stripActivation,
  type SeasonalSlice,
} from './seasonal.ts';

const HN = HALLOWEEN_THEME_ID;
/** Local-time dates (new Date(y, monthIndex, d, h, m)), so the tests pass in any timezone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const OCT15 = at(2026, 10, 15);

describe('the season', () => {
  it('is October, local time, edge to edge', () => {
    expect(inHalloweenSeason(at(2026, 9, 30, 23, 59))).toBe(false);
    expect(inHalloweenSeason(at(2026, 10, 1, 0, 0))).toBe(true);
    expect(inHalloweenSeason(at(2026, 10, 31, 23, 59))).toBe(true);
    expect(inHalloweenSeason(at(2026, 11, 1, 0, 0))).toBe(false);
    expect(inHalloweenSeason(at(2027, 10, 15))).toBe(true);
    expect(seasonEnd(2026).getTime()).toBe(at(2026, 11, 1, 0, 0).getTime());
  });

  it('the theme id matches the registered Halloween Night theme', () => {
    expect(getTheme(HN).id).toBe(HN);
    expect(getTheme(HN).name).toBe('Halloween Night');
  });
});

describe('shouldInvite', () => {
  it('invites on the floor, in season, when not already haunted', () => {
    expect(shouldInvite(undefined, OCT15, 'floor', 'delta-neon')).toBe(true);
    expect(shouldInvite({ halloween: {} }, OCT15, 'floor', 'neon-noir')).toBe(true);
  });

  it('never anywhere but the floor', () => {
    for (const place of ['cabinet', 'entry', 'lobby', 'game', 'tournament', 'other'] as ThemePlace[]) {
      expect(shouldInvite(undefined, OCT15, place, 'delta-neon'), place).toBe(false);
    }
  });

  it('not when already on Halloween Night, out of season, or declined this season', () => {
    expect(shouldInvite(undefined, OCT15, 'floor', HN)).toBe(false);
    expect(shouldInvite(undefined, at(2026, 11, 2), 'floor', 'delta-neon')).toBe(false);
    expect(shouldInvite(undefined, at(2026, 9, 30), 'floor', 'delta-neon')).toBe(false);
    expect(shouldInvite({ halloween: { year: 2026, dismissed: true } }, OCT15, 'floor', 'delta-neon')).toBe(false);
  });

  it('a decline from last year does not count this year', () => {
    expect(shouldInvite({ halloween: { year: 2025, dismissed: true } }, OCT15, 'floor', 'delta-neon')).toBe(true);
  });
});

describe('shouldRevert', () => {
  const invited: SeasonalPrefs = { halloween: { via: 'invite', year: 2026, prev: 'neon-noir' } };
  it('reverts an invite-activated Halloween Night from November 1', () => {
    expect(shouldRevert(invited, at(2026, 11, 1, 0, 0), HN)).toBe(true);
    expect(shouldRevert(invited, at(2027, 3, 4), HN)).toBe(true);
  });

  it('not before the season ends, not for a hand-picked one, not when off Halloween', () => {
    expect(shouldRevert(invited, at(2026, 10, 31, 23, 59), HN)).toBe(false);
    expect(shouldRevert({ halloween: { via: 'picker', year: 2026 } }, at(2026, 11, 3), HN)).toBe(false);
    expect(shouldRevert(invited, at(2026, 11, 3), 'neon-noir')).toBe(false);
  });

  it('not without a year, nor for a future year (clock went back)', () => {
    expect(shouldRevert({ halloween: { via: 'invite' } }, at(2026, 11, 3), HN)).toBe(false);
    expect(shouldRevert({ halloween: { via: 'invite', year: 2027 } }, at(2026, 11, 3), HN)).toBe(false);
  });

  it('a later October carries an old invite over instead of reverting', () => {
    const old: SeasonalPrefs = { halloween: { via: 'invite', year: 2026, prev: 'lan-party' } };
    expect(shouldRevert(old, at(2027, 10, 15), HN)).toBe(false);
    const carried = carryOver(old, at(2027, 10, 15), HN);
    expect(carried).toEqual({ halloween: { via: 'invite', year: 2027, prev: 'lan-party' } });
    expect(shouldRevert(carried!, at(2027, 11, 1, 0, 1), HN)).toBe(true);
    // Nothing to carry: this season, a picker, out of season, off Halloween.
    expect(carryOver(carried!, at(2027, 10, 20), HN)).toBeNull();
    expect(carryOver({ halloween: { via: 'picker', year: 2026 } }, at(2027, 10, 15), HN)).toBeNull();
    expect(carryOver(old, at(2027, 11, 2), HN)).toBeNull();
    expect(carryOver(old, at(2027, 10, 15), 'neon-noir')).toBeNull();
  });
});

describe('restoreTarget', () => {
  const exists = (id: string) => ['delta-neon', 'neon-noir', HN].includes(id);
  it('goes back to the remembered theme when it still exists', () => {
    expect(restoreTarget({ halloween: { prev: 'neon-noir' } }, exists)).toBe('neon-noir');
  });
  it('falls back to Delta Neon: removed, missing, or Halloween itself', () => {
    expect(restoreTarget({ halloween: { prev: 'retired-theme' } }, exists)).toBe(FALLBACK_THEME_ID);
    expect(restoreTarget(undefined, exists)).toBe(FALLBACK_THEME_ID);
    expect(restoreTarget({ halloween: { prev: HN } }, exists)).toBe(FALLBACK_THEME_ID);
  });
});

describe('transitions', () => {
  it('onActivated remembers how and where from, keeping other seasons', () => {
    const out = onActivated(
      { christmas: { a: 1 }, halloween: { year: 2025, dismissed: true } },
      { via: 'invite', prev: 'lan-party', year: 2026 },
    );
    expect(out).toEqual({ christmas: { a: 1 }, halloween: { year: 2026, dismissed: true, via: 'invite', prev: 'lan-party' } });
    expect(onActivated(undefined, { via: 'picker', prev: 'delta-neon' })).toEqual({ halloween: { via: 'picker', prev: 'delta-neon' } });
  });

  it('onDeactivated in season: no more invites this season', () => {
    expect(onDeactivated({ halloween: { via: 'invite', year: 2026, prev: 'x' } }, OCT15)).toEqual({
      halloween: { year: 2026, dismissed: true },
    });
    // Already recorded: nothing to write.
    expect(onDeactivated({ halloween: { year: 2026, dismissed: true } }, OCT15)).toBeNull();
  });

  it('onDeactivated out of season (or without a clock) only forgets the activation', () => {
    expect(onDeactivated({ halloween: { via: 'invite', year: 2026, prev: 'x' } }, at(2026, 11, 2))).toEqual({ halloween: { year: 2026 } });
    expect(onDeactivated({ halloween: { via: 'picker', prev: 'x' } }, null)).toEqual({ halloween: {} });
    expect(onDeactivated({ halloween: { year: 2026 } }, at(2026, 11, 2))).toBeNull();
  });

  it('onDismissed records this season', () => {
    expect(onDismissed(undefined, OCT15)).toEqual({ halloween: { year: 2026, dismissed: true } });
  });

  it('stripActivation forgets a stale activation (null when there is none)', () => {
    expect(stripActivation({ halloween: { via: 'invite', prev: 'x', year: 2026 } })).toEqual({ halloween: { year: 2026 } });
    expect(stripActivation({ halloween: { year: 2026 } })).toBeNull();
    expect(stripActivation(undefined)).toBeNull();
  });
});

describe('parseSeasonOverride', () => {
  const today = at(2026, 3, 9);
  it('reads off / live / halloween', () => {
    expect(parseSeasonOverride('off', today)).toBe('off');
    expect(parseSeasonOverride('live', today)).toBe('live');
    expect(parseSeasonOverride('halloween', today)).toEqual(at(2026, 10, 15, 12, 0));
  });

  it('reads local dates (noon by default) and date-times', () => {
    expect(parseSeasonOverride('2026-10-31', today)).toEqual(at(2026, 10, 31, 12, 0));
    expect(parseSeasonOverride('2026-10-31T23:58', today)).toEqual(at(2026, 10, 31, 23, 58));
  });

  it('anything else is the live clock', () => {
    for (const junk of [null, undefined, '', 'tomorrow', '2026-13-01', '2026-02-30', '2026-10-31T25:00', '2026-10-31 12:00']) {
      expect(parseSeasonOverride(junk, today), String(junk)).toBe('live');
    }
  });
});

// ---------------------------------------------------------------------------
function harness(init: { theme?: string; seasonal?: SeasonalPrefs; now?: Date | null; retarget?: string } = {}) {
  let state: SeasonalSlice = { theme: init.theme ?? 'delta-neon', seasonal: init.seasonal };
  let now: Date | null = init.now === undefined ? OCT15 : init.now;
  const listeners = new Set<(next: SeasonalSlice, prev: SeasonalSlice) => void>();
  const set = (patch: Partial<SeasonalSlice>) => {
    const prev = state;
    state = { ...state, ...patch };
    for (const l of [...listeners]) l(state, prev);
  };
  const toasts: string[] = [];
  const switched: string[] = [];
  const known = new Set(['delta-neon', 'neon-noir', 'lan-party', HN]);
  const ctrl = createSeasonalController({
    get: () => state,
    update: (seasonal) => set({ seasonal }),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    now: () => now,
    // A switch can be retargeted by the switcher (another pick during the transition).
    switchTheme: async (id) => {
      switched.push(id);
      set({ theme: init.retarget && id === HN ? init.retarget : id });
    },
    hasTheme: (id) => known.has(id),
    themeName: (id) => id.toUpperCase(),
    toast: (_kind, text) => toasts.push(text),
    compactHud: () => false,
    defer: (fn) => fn(),
  });
  const dispose = ctrl.install();
  return {
    ctrl,
    dispose,
    set,
    toasts,
    switched,
    get: () => state,
    halloween: () => state.seasonal?.halloween,
    setNow: (d: Date | null) => {
      now = d;
    },
  };
}

describe('seasonal controller', () => {
  it('a manual switch to Halloween Night is recorded as the picker, with the theme it came from', () => {
    const h = harness({ theme: 'neon-noir' });
    h.set({ theme: HN });
    expect(h.halloween()).toEqual({ via: 'picker', prev: 'neon-noir' });
  });

  it('accept(): recorded as the invite for this season, with a toast', async () => {
    const h = harness({ theme: 'lan-party' });
    await h.ctrl.accept();
    expect(h.switched).toEqual([HN]);
    expect(h.halloween()).toEqual({ via: 'invite', year: 2026, prev: 'lan-party' });
    expect(h.toasts.at(-1)).toMatch(/Halloween Night is on!/);
  });

  it('accept(): a retargeted switch leaves no pending invite behind', async () => {
    const h = harness({ theme: 'delta-neon', retarget: 'neon-noir' });
    await h.ctrl.accept();
    expect(h.get().theme).toBe('neon-noir');
    expect(h.toasts).toEqual([]);
    h.set({ theme: HN });
    expect(h.halloween()).toMatchObject({ via: 'picker', prev: 'neon-noir' });
  });

  it('a record that arrives with the theme (hydrate from another device) is kept', () => {
    const h = harness({ theme: 'delta-neon' });
    const remote = { halloween: { via: 'invite' as const, year: 2026, prev: 'lan-party' } };
    h.set({ theme: HN, seasonal: remote });
    expect(h.get().seasonal).toBe(remote);
  });

  it('leaving Halloween Night in October: no more invites this season', () => {
    const h = harness({ theme: 'neon-noir' });
    h.set({ theme: HN });
    h.set({ theme: 'neon-noir' });
    expect(h.halloween()).toEqual({ year: 2026, dismissed: true });
    expect(shouldInvite(h.get().seasonal, OCT15, 'floor', 'neon-noir')).toBe(false);
  });

  it('dismiss(): declined for this season, with a friendly toast', () => {
    const h = harness();
    h.ctrl.dismiss();
    expect(h.halloween()).toEqual({ year: 2026, dismissed: true });
    expect(h.toasts.at(-1)).toMatch(/waiting in Themes/);
  });

  it('exit(): back to the remembered theme (Delta Neon when it is gone)', async () => {
    const h = harness({ theme: HN, seasonal: { halloween: { via: 'picker', prev: 'neon-noir' } } });
    expect(h.ctrl.exitTarget()).toBe('neon-noir');
    expect(await h.ctrl.exit()).toBe('neon-noir');
    expect(h.get().theme).toBe('neon-noir');
    expect(h.toasts.at(-1)).toMatch(/^Back to NEON-NOIR\./);
    const g = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'retired' } } });
    expect(await g.ctrl.exit()).toBe('delta-neon');
  });

  it('checkSeasonEnd(): reverts an invite-activated Halloween Night once October is over', async () => {
    const h = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'neon-noir' } }, now: at(2026, 11, 1, 0, 1) });
    await h.ctrl.checkSeasonEnd();
    expect(h.switched).toEqual(['neon-noir']);
    expect(h.toasts.at(-1)).toBe('Halloween’s over — the arcade is back to NEON-NOIR.');
    expect(h.halloween()).toEqual({ year: 2026 });
  });

  it('checkSeasonEnd(): unknown previous theme → Delta Neon; a hand-picked one stays', async () => {
    const gone = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'retired' } }, now: at(2026, 11, 5) });
    await gone.ctrl.checkSeasonEnd();
    expect(gone.switched).toEqual(['delta-neon']);
    const picked = harness({ theme: HN, seasonal: { halloween: { via: 'picker', prev: 'neon-noir' } }, now: at(2026, 11, 5) });
    await picked.ctrl.checkSeasonEnd();
    expect(picked.switched).toEqual([]);
    expect(picked.toasts).toEqual([]);
  });

  it('checkSeasonEnd(): runs once at a time', async () => {
    const h = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'neon-noir' } }, now: at(2026, 11, 2) });
    await Promise.all([h.ctrl.checkSeasonEnd(), h.ctrl.checkSeasonEnd()]);
    expect(h.switched).toEqual(['neon-noir']);
  });

  it('checkSeasonEnd(): a later October moves an old invite to this season instead', async () => {
    const h = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2025, prev: 'lan-party' } }, now: OCT15 });
    await h.ctrl.checkSeasonEnd();
    expect(h.switched).toEqual([]);
    expect(h.halloween()).toEqual({ via: 'invite', year: 2026, prev: 'lan-party' });
  });

  it('QA "off" (no clock): no revert, but activations are still recorded', async () => {
    const h = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2020, prev: 'neon-noir' } }, now: null });
    await h.ctrl.checkSeasonEnd();
    expect(h.switched).toEqual([]);
    const g = harness({ theme: 'neon-noir', now: null });
    g.set({ theme: HN });
    expect(g.halloween()).toEqual({ via: 'picker', prev: 'neon-noir' });
    g.set({ theme: 'neon-noir' });
    expect(g.halloween()).toEqual({});
  });

  it('normalize(): forgets a stale activation while Halloween Night is off', () => {
    const h = harness({ theme: 'neon-noir', seasonal: { halloween: { via: 'invite', year: 2026, prev: 'x' } } });
    h.ctrl.normalize();
    expect(h.halloween()).toEqual({ year: 2026 });
    const on = harness({ theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'x' } } });
    on.ctrl.normalize();
    expect(on.halloween()).toEqual({ via: 'invite', year: 2026, prev: 'x' });
  });

  it('dispose() stops recording', () => {
    const h = harness({ theme: 'neon-noir' });
    h.dispose();
    h.set({ theme: HN });
    expect(h.halloween()).toBeUndefined();
  });
});
