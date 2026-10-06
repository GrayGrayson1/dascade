/**
 * Seasonal themes: October's Halloween Night invite. Pure logic (injectable clock, no DOM, no store);
 * seasonalController.ts wires it to the app and SeasonalHost.tsx / ExitHalloween.tsx render it.
 *
 *   - During October (the device's local date) a player on the arcade floor whose theme isn't Halloween
 *     Night gets a small invite: "Turn on Halloween" switches through the normal animated path and
 *     remembers the previous theme; "Not now" (or exiting Halloween later in October) means no more
 *     invites that season.
 *   - Halloween Night stays in the picker all year. Switched on by the invite, it goes back to the
 *     previous theme after October 31; picked by hand, it stays.
 *
 * Themes are local and presentation-only: nothing here talks to the game server. The record lives in
 * the settings blob (`AppSettings.seasonal`), so it follows a signed-in player's profile.
 */
import type { HalloweenPrefs, HalloweenVia, SeasonalPrefs } from '../app/settings.ts';
import type { ThemePlace } from './types.ts';

export const HALLOWEEN_THEME_ID = 'halloween-night';
export const FALLBACK_THEME_ID = 'delta-neon';
/** QA override key (sessionStorage per tab, localStorage per browser): see seasonalController.ts. */
export const SEASON_QA_KEY = 'dascade:qa:season';

/** Halloween season: October 1 00:00 – October 31 23:59, local time. */
export function inHalloweenSeason(now: Date): boolean {
  return now.getMonth() === 9;
}

/** The season a date belongs to (its calendar year). */
export function seasonYear(now: Date): number {
  return now.getFullYear();
}

/** When a season's invite-activated Halloween ends: November 1, 00:00 local time. */
export function seasonEnd(year: number): Date {
  return new Date(year, 10, 1);
}

export function halloweenOf(prefs: SeasonalPrefs | undefined): HalloweenPrefs {
  return prefs?.halloween ?? {};
}

const withHalloween = (prefs: SeasonalPrefs | undefined, halloween: HalloweenPrefs): SeasonalPrefs => ({ ...prefs, halloween });

/** Invite this player now? Only on the floor, in season, not already haunted, not declined this season. */
export function shouldInvite(prefs: SeasonalPrefs | undefined, now: Date, place: ThemePlace, theme: string): boolean {
  if (place !== 'floor' || theme === HALLOWEEN_THEME_ID || !inHalloweenSeason(now)) return false;
  const h = halloweenOf(prefs);
  return !(h.dismissed && h.year === seasonYear(now));
}

/** Season over for an invite-activated Halloween Night: switch back (picked by hand = stays). */
export function shouldRevert(prefs: SeasonalPrefs | undefined, now: Date, theme: string): boolean {
  if (theme !== HALLOWEEN_THEME_ID) return false;
  const h = halloweenOf(prefs);
  if (h.via !== 'invite' || typeof h.year !== 'number' || !Number.isInteger(h.year)) return false;
  return now.getTime() >= seasonEnd(h.year).getTime() && !inHalloweenSeason(now);
}

/**
 * An invite accepted in an earlier October, seen again in a later one: don't revert (it's Halloween
 * again) — move the record to this season so it reverts after this October instead. null = no change.
 */
export function carryOver(prefs: SeasonalPrefs | undefined, now: Date, theme: string): SeasonalPrefs | null {
  if (theme !== HALLOWEEN_THEME_ID || !inHalloweenSeason(now)) return null;
  const h = halloweenOf(prefs);
  if (h.via !== 'invite' || typeof h.year !== 'number' || h.year >= seasonYear(now)) return null;
  return withHalloween(prefs, { ...h, year: seasonYear(now) });
}

/** The theme "Exit Halloween" / the season's end goes back to. */
export function restoreTarget(prefs: SeasonalPrefs | undefined, exists: (id: string) => boolean): string {
  const prev = halloweenOf(prefs).prev;
  return prev && prev !== HALLOWEEN_THEME_ID && exists(prev) ? prev : FALLBACK_THEME_ID;
}

// ---------------------------------------------------------------------------
// Transitions (each returns the new prefs; null = nothing to change, so nothing is written)
// ---------------------------------------------------------------------------

/** Halloween Night was switched on: remember how, and what to go back to. */
export function onActivated(prefs: SeasonalPrefs | undefined, a: { via: HalloweenVia; prev: string; year?: number }): SeasonalPrefs {
  const h: HalloweenPrefs = { ...halloweenOf(prefs), via: a.via, prev: a.prev };
  if (a.year !== undefined) h.year = a.year;
  return withHalloween(prefs, h);
}

/**
 * Halloween Night was switched off. In season that also means "no more invites this season";
 * afterwards only the activation is forgotten. `now` null = no clock (QA off): just forget it.
 */
export function onDeactivated(prefs: SeasonalPrefs | undefined, now: Date | null): SeasonalPrefs | null {
  const { via, prev, ...rest } = halloweenOf(prefs);
  if (now && inHalloweenSeason(now)) {
    if (via === undefined && prev === undefined && rest.dismissed && rest.year === seasonYear(now)) return null;
    return withHalloween(prefs, { ...rest, year: seasonYear(now), dismissed: true });
  }
  if (via === undefined && prev === undefined) return null;
  return withHalloween(prefs, rest);
}

/** "Not now": no more invites this season. */
export function onDismissed(prefs: SeasonalPrefs | undefined, now: Date): SeasonalPrefs {
  return withHalloween(prefs, { ...halloweenOf(prefs), year: seasonYear(now), dismissed: true });
}

/** A stale activation while Halloween Night isn't on (e.g. the tab closed before it was cleared). */
export function stripActivation(prefs: SeasonalPrefs | undefined): SeasonalPrefs | null {
  const { via, prev, ...rest } = halloweenOf(prefs);
  if (via === undefined && prev === undefined) return null;
  return withHalloween(prefs, rest);
}

// ---------------------------------------------------------------------------
// QA override (`?season=…`, see seasonalController.ts)
// ---------------------------------------------------------------------------

/** 'off' = no invite and no automatic revert; 'live' = the real clock; a Date = pretend it's then. */
export type SeasonOverride = 'off' | 'live' | Date;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/**
 * `off` | `live` | `halloween` (October 15, 12:00 of `today`'s year) | `YYYY-MM-DD[THH:MM]` (local
 * time, noon when no time is given). Anything else reads as `live`.
 */
export function parseSeasonOverride(raw: string | null | undefined, today: Date = new Date()): SeasonOverride {
  if (typeof raw !== 'string') return 'live';
  const v = raw.trim();
  if (v === 'off') return 'off';
  if (v === 'halloween') return new Date(today.getFullYear(), 9, 15, 12, 0);
  const m = DATE_RE.exec(v);
  if (!m) return 'live';
  const [y, mo, d, h, mi] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] === undefined ? 12 : Number(m[4]),
    m[5] === undefined ? 0 : Number(m[5]),
  ];
  const date = new Date(y, mo - 1, d, h, mi);
  const exact =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
  return exact ? date : 'live';
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/** The part of the settings this feature reads. */
export interface SeasonalSlice {
  theme: string;
  seasonal: SeasonalPrefs | undefined;
}

export interface SeasonalDeps {
  get(): SeasonalSlice;
  update(seasonal: SeasonalPrefs): void;
  /** Settings changes (any path: picker, QA hook, hydrate, the invite, Exit). Returns unsubscribe. */
  subscribe(listener: (next: SeasonalSlice, prev: SeasonalSlice) => void): () => void;
  /** null = QA "off": no invite and no automatic revert (activation bookkeeping still runs). */
  now(): Date | null;
  switchTheme(id: string): Promise<void>;
  hasTheme(id: string): boolean;
  themeName(id: string): string;
  toast(kind: 'success' | 'info', text: string): void;
  /** Phone-sized HUD (no Exit button in it; the theme button opens the sheet that has one). */
  compactHud(): boolean;
  /** Runs a write after the current store update settles (microtask in the app; sync in tests). */
  defer?(fn: () => void): void;
}

export interface SeasonalController {
  /** Starts recording how Halloween Night gets switched on/off. Returns a disposer. */
  install(): () => void;
  /** Forgets a stale activation once the stored copy is in (run after hydrate). */
  normalize(): void;
  /** "Turn on Halloween". */
  accept(): Promise<void>;
  /** "Not now". */
  dismiss(): void;
  /** "Exit Halloween": back to the remembered theme. Resolves with the theme it went to. */
  exit(): Promise<string>;
  /** Where "Exit Halloween" would go now. */
  exitTarget(): string;
  /** After October: an invite-activated Halloween Night goes back to the previous theme (once). */
  checkSeasonEnd(): Promise<void>;
}

export function createSeasonalController(d: SeasonalDeps): SeasonalController {
  const defer = d.defer ?? ((fn: () => void) => queueMicrotask(fn));
  /** Set by accept() while its switch runs: the activation it causes came from the invite. */
  let pending: { via: HalloweenVia; year?: number } | null = null;
  let checking = false;

  const onChange = (next: SeasonalSlice, prev: SeasonalSlice) => {
    if (next.theme === prev.theme) return;
    if (next.theme === HALLOWEEN_THEME_ID) {
      // The record arrived together with the theme (hydrate from another device): it already says how.
      if (next.seasonal !== prev.seasonal && halloweenOf(next.seasonal).via) return;
      const how = pending ?? { via: 'picker' as const };
      pending = null;
      const from = prev.theme;
      defer(() => {
        const cur = d.get();
        if (cur.theme !== HALLOWEEN_THEME_ID) return; // switched away again meanwhile
        d.update(onActivated(cur.seasonal, { via: how.via, prev: from, year: how.year }));
      });
    } else if (prev.theme === HALLOWEEN_THEME_ID) {
      defer(() => {
        const cur = d.get();
        if (cur.theme === HALLOWEEN_THEME_ID) return; // switched back meanwhile
        const updated = onDeactivated(cur.seasonal, d.now());
        if (updated) d.update(updated);
      });
    }
  };

  const exitTarget = () => restoreTarget(d.get().seasonal, d.hasTheme);

  return {
    install: () => d.subscribe(onChange),

    normalize() {
      const cur = d.get();
      if (cur.theme === HALLOWEEN_THEME_ID) return;
      const updated = stripActivation(cur.seasonal);
      if (updated) d.update(updated);
    },

    async accept() {
      const now = d.now();
      pending = { via: 'invite', year: now ? seasonYear(now) : undefined };
      try {
        await d.switchTheme(HALLOWEEN_THEME_ID);
      } finally {
        pending = null;
      }
      if (d.get().theme !== HALLOWEEN_THEME_ID) return;
      d.toast(
        'success',
        d.compactHud()
          ? 'Halloween Night is on! 🎃 Switch back any time from the theme button.'
          : 'Halloween Night is on! 🎃 Exit any time with the pumpkin button next to Themes.',
      );
    },

    dismiss() {
      d.update(onDismissed(d.get().seasonal, d.now() ?? new Date()));
      d.toast('info', 'No problem — Halloween Night is waiting in Themes whenever you want it.');
    },

    async exit() {
      const target = exitTarget();
      await d.switchTheme(target);
      d.toast('success', `Back to ${d.themeName(target)}. Halloween Night stays in Themes if you miss it. 🎃`);
      return target;
    },

    exitTarget,

    async checkSeasonEnd() {
      if (checking) return;
      const now = d.now();
      if (!now) return;
      checking = true;
      try {
        const cur = d.get();
        const carried = carryOver(cur.seasonal, now, cur.theme);
        if (carried) {
          d.update(carried);
          return;
        }
        if (!shouldRevert(cur.seasonal, now, cur.theme)) return;
        const target = restoreTarget(cur.seasonal, d.hasTheme);
        await d.switchTheme(target);
        d.toast('info', `Halloween’s over — the arcade is back to ${d.themeName(target)}.`);
      } finally {
        checking = false;
      }
    },
  };
}
