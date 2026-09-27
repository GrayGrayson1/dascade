/**
 * The app-wide jukebox engine singleton (contract §3). Lives at module scope, outside React, so
 * playback survives every route change; the UI (apps/web/src/jukebox/) only calls this API and
 * reads `useJukebox`. `installJukebox()` is called once from `installAudio()` at boot.
 */
import { JUKEBOX_MANIFEST_URL } from '@dascade/shared/jukebox';
import { useApp } from '../../app/store.ts';
import { mixer } from '../mixer.ts';
import { createJukeboxEngine, type JukeboxEngine, type MediaSessionLike } from './core.ts';
import { installRoomDj } from './roomDj.ts';
import { useJukebox } from './store.ts';

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function fetchManifest(): Promise<unknown> {
  const res = await fetch(JUKEBOX_MANIFEST_URL, { cache: 'no-cache', credentials: 'same-origin' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return (await res.json()) as unknown;
}

const mediaSession: MediaSessionLike | null = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;

export const jukebox: JukeboxEngine = createJukeboxEngine({
  store: useJukebox,
  mixer,
  createElement: () => new Audio(),
  fetchManifest,
  storage: localStorageOrNull(),
  settings: {
    get: () => useApp.getState().settings,
    update: (patch) => useApp.getState().updateSettings(patch),
    subscribe: (cb) =>
      useApp.subscribe((s, prev) => {
        if (s.settings !== prev.settings) cb();
      }),
  },
  now: () => performance.now(),
  timers: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  },
  random: Math.random,
  mediaSession,
  createMetadata: typeof MediaMetadata === 'function' ? (init) => new MediaMetadata(init) : null,
  notify: (message) => useApp.getState().toast('warning', message),
});

/**
 * Gesture events that grant user activation (pointerdown alone doesn't on touch Safari: pointerup/
 * touchend/click do). Listened to for the page lifetime (installed once) so a restored or
 * autoplay-blocked jukebox resumes inside a real gesture.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
let installed = false;

export function installJukebox(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  jukebox.init();
  const onGesture = (e: Event) => {
    if (e.type === 'keydown' && (e as KeyboardEvent).key === 'Escape') return; // Esc isn't an activation
    jukebox.unlock();
  };
  for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
  window.addEventListener('pagehide', () => jukebox.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') jukebox.flush();
  });
  installRoomDj(jukebox);
  // Dev: the jukebox Vite plugin announces music-folder changes (no full reload).
  if (import.meta.hot) import.meta.hot.on('dascade:jukebox', () => jukebox.reloadLibrary());
  // QA / E2E introspection (same pattern as window.__DASCADE__).
  window.__DASCADE_AUDIO__ = { jukebox, store: useJukebox, mixer };
}

declare global {
  interface Window {
    __DASCADE_AUDIO__?: { jukebox: JukeboxEngine; store: typeof useJukebox; mixer: typeof mixer };
  }
}
