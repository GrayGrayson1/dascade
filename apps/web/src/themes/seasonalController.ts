/**
 * The app's seasonal controller instance (see seasonal.ts) wired to the settings store, the theme
 * switcher and toasts — plus the QA date override, same idea as the claw machine's `?clawSeed=`:
 *
 *   ?season=off            no invite and no automatic revert (every e2e context starts like this:
 *                          playwright.config.ts seeds localStorage['dascade:qa:season'] = 'off')
 *   ?season=live           the real clock (overrides a stored 'off')
 *   ?season=halloween      pretend it's October 15
 *   ?season=2026-10-31T23:58   pretend it's then (local time; noon when no time is given)
 *
 * The URL value is copied to sessionStorage, so it survives full navigations in that tab; precedence
 * is URL › sessionStorage › localStorage › the real clock.
 */
import { getTheme, hasTheme } from '@dascade/ui';
import { useApp, type AppSettings } from '../app/store.ts';
import { switchTheme } from './controller.ts';
import { SEASON_QA_KEY, createSeasonalController, parseSeasonOverride, type SeasonOverride, type SeasonalSlice } from './seasonal.ts';

let urlRead = false;

function storage(kind: 'sessionStorage' | 'localStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null; // storage disabled (privacy mode, sandboxed frame)
  }
}

function overrideRaw(): string | null {
  if (!urlRead && typeof location !== 'undefined') {
    urlRead = true;
    try {
      const fromUrl = new URLSearchParams(location.search).get('season');
      if (fromUrl !== null) storage('sessionStorage')?.setItem(SEASON_QA_KEY, fromUrl);
    } catch {
      /* storage unavailable: the URL value just isn't remembered */
    }
  }
  try {
    const session = storage('sessionStorage')?.getItem(SEASON_QA_KEY);
    if (session != null) return session;
    return storage('localStorage')?.getItem(SEASON_QA_KEY) ?? null;
  } catch {
    return null;
  }
}

function override(): SeasonOverride {
  return parseSeasonOverride(overrideRaw());
}

/** "Now" for the seasonal invite: the QA date when one is set, null when QA turned it off. */
export function seasonNow(): Date | null {
  const o = override();
  return o === 'off' ? null : o === 'live' ? new Date() : o;
}

/** "Now" for seasonal visuals (e.g. Halloween Night's haunting): the QA date when one is set, else the clock. */
export function seasonClock(): Date {
  const o = override();
  return o instanceof Date ? o : new Date();
}

/** Where the floor HUD has no room for the Exit button (seasonal.css hides it with the same query). */
const COMPACT_HUD_QUERY = '(max-width: 1023px), (max-height: 540px)';

const slice = (s: AppSettings): SeasonalSlice => ({ theme: s.theme, seasonal: s.seasonal });

export const seasonal = createSeasonalController({
  get: () => slice(useApp.getState().settings),
  update: (prefs) => useApp.getState().updateSettings({ seasonal: prefs }),
  subscribe: (listener) =>
    useApp.subscribe((state, prev) => {
      if (state.settings !== prev.settings) listener(slice(state.settings), slice(prev.settings));
    }),
  now: seasonNow,
  switchTheme: (id) => switchTheme(id),
  hasTheme: (id) => hasTheme(id),
  themeName: (id) => getTheme(id).name,
  toast: (kind, text) => {
    useApp.getState().toast(kind, text);
  },
  compactHud: () => typeof matchMedia === 'function' && matchMedia(COMPACT_HUD_QUERY).matches,
});

let installed = false;

/** Call once at startup (main.tsx). */
export function installSeasonal(): void {
  if (installed) return;
  installed = true;
  seasonal.install();
  // Tidy a stale record once the stored copy is in (a remote one may arrive later than the local one).
  if (useApp.getState().settingsReady) seasonal.normalize();
  else {
    const stop = useApp.subscribe((state) => {
      if (!state.settingsReady) return;
      stop();
      seasonal.normalize();
    });
  }
}
