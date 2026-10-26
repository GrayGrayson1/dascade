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

// ---------------------------------------------------------------------------
// Crew links (event rooms): `#crew=<id>.<secret>`, read once and stripped from the address bar
// ---------------------------------------------------------------------------

/** A crew link in the address bar, removed from the URL once read (the secret never reaches server logs). */
export function takeHashCrew(): string | null {
  if (typeof location === 'undefined') return null;
  const match = /(?:^#|&)crew=([A-Za-z0-9_-]{6,24}\.[A-Za-z0-9_-]{22,64})/.exec(location.hash);
  if (!match?.[1]) return null;
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  } catch {
    /* keep the hash */
  }
  return match[1];
}

export function crewLink(code: string, link: string): string {
  return `${location.origin}/room/${code}#crew=${link}`;
}

export interface StoredCrewLink {
  id: string;
  role: string;
  name: string;
  link: string;
}

const CREW_KEY = (code: string) => `dascade:showdown:crew:${code}`;

/**
 * Crew links minted on this device (the server keeps only their hashes, and sends a secret once): kept
 * per room for 24 hours so the producer can copy a link again later.
 */
export function rememberCrewLink(code: string, link: StoredCrewLink): void {
  try {
    const list = storedCrewLinks(code).filter((l) => l.id !== link.id);
    localStorage.setItem(CREW_KEY(code), JSON.stringify({ savedAt: Date.now(), links: [...list, link] }));
  } catch {
    /* storage unavailable */
  }
}

export function storedCrewLinks(code: string): StoredCrewLink[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CREW_KEY(code)) ?? 'null') as { savedAt?: unknown; links?: unknown } | null;
    if (!raw || typeof raw.savedAt !== 'number' || Date.now() - raw.savedAt > PASS_TTL_MS || !Array.isArray(raw.links)) return [];
    return raw.links.filter(
      (l): l is StoredCrewLink =>
        Boolean(l) && typeof l.id === 'string' && typeof l.role === 'string' && typeof l.name === 'string' && typeof l.link === 'string',
    );
  } catch {
    return [];
  }
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
  // Leaving big-screen mode sticks: drop `?screen=1`, or a refresh would switch it straight back on.
  if (!on && typeof location !== 'undefined' && new URLSearchParams(location.search).has('screen')) {
    try {
      const params = new URLSearchParams(location.search);
      params.delete('screen');
      const query = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    } catch {
      /* keep the address */
    }
  }
  version++;
  for (const l of [...listeners]) l();
}

function subscribeScreen(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useScreenMode(code: string | null): boolean {
  useSyncExternalStore(
    subscribeScreen,
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
    // No async clipboard (plain http on a LAN address, or refused): the legacy copy still works in a click.
    return legacyCopy(text);
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus({ preventScroll: true });
  }
}
