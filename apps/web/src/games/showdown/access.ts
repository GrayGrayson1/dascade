/**
 * Presenter pass + big-screen mode on this device.
 *
 * - The presenter pass arrives privately from the server. We keep it per room in this browser so the
 *   presenter can come back (a crashed tab, a new tab) and copy a presenter link for another device:
 *   `/room/<code>#presenter=<pass>` — a fragment, so the pass never reaches server logs. Opening it
 *   claims the role and strips the fragment from the address bar.
 * - Big-screen mode is a per-tab choice (`?screen=1` on the room link, or the toggle in the lobby).
 */
import { useSyncExternalStore } from 'react';

const PASS_KEY = (code: string) => `dascade:showdown:pass:${code}`;
const PASS_TTL_MS = 24 * 3600_000;

export function rememberPass(code: string, pass: string): void {
  try {
    localStorage.setItem(PASS_KEY(code), JSON.stringify({ pass, savedAt: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

export function forgetPass(code: string): void {
  try {
    localStorage.removeItem(PASS_KEY(code));
  } catch {
    /* storage unavailable */
  }
}

export function storedPass(code: string): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PASS_KEY(code)) ?? 'null') as { pass?: unknown; savedAt?: unknown } | null;
    if (!raw || typeof raw.pass !== 'string' || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > PASS_TTL_MS) return null;
    return raw.pass;
  } catch {
    return null;
  }
}

/** A presenter pass in the address bar (`#presenter=…`), removed from the URL once read. */
export function takeHashPass(): string | null {
  if (typeof location === 'undefined') return null;
  const match = /(?:^#|&)presenter=([A-Za-z0-9_-]{8,64})/.exec(location.hash);
  if (!match?.[1]) return null;
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  } catch {
    /* keep the hash */
  }
  return match[1];
}

export function presenterLink(code: string, pass: string): string {
  return `${location.origin}/room/${code}#presenter=${pass}`;
}

export function screenLink(code: string): string {
  return `${location.origin}/room/${code}?screen=1`;
}

// ---------------------------------------------------------------------------
// Big-screen mode (per tab)
// ---------------------------------------------------------------------------

const SCREEN_KEY = (code: string) => `dascade:showdown:screen:${code}`;
const listeners = new Set<() => void>();
let version = 0;
const memory = new Map<string, boolean>();

function readScreen(code: string): boolean {
  if (memory.has(code)) return memory.get(code)!;
  let on: boolean;
  try {
    on = new URLSearchParams(location.search).get('screen') === '1' || sessionStorage.getItem(SCREEN_KEY(code)) === '1';
  } catch {
    on = false;
  }
  memory.set(code, on);
  return on;
}

export function setScreenMode(code: string, on: boolean): void {
  memory.set(code, on);
  try {
    if (on) sessionStorage.setItem(SCREEN_KEY(code), '1');
    else sessionStorage.removeItem(SCREEN_KEY(code));
  } catch {
    /* storage unavailable: lasts until reload */
  }
  version++;
  for (const l of [...listeners]) l();
}

export function useScreenMode(code: string | null): boolean {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
  return code ? readScreen(code) : false;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
