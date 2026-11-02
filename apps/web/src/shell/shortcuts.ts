/**
 * Keyboard shortcuts for the whole arcade (C12), mounted once in App.tsx:
 *
 *   ?    opens Help (the current game's page in a room or on its title screen, else DASCADE basics)
 *   M    mutes or unmutes everything (the same switch as Settings → Sound → Mute everything)
 *   Esc  goes back on title screens and in the Tournament Center (useEscapeBack, per screen),
 *        and closes pop-ups (the native dialog does that)
 *
 * They never fire while you type (a field, a text area, a select or editable text), with Ctrl, Cmd
 * or Alt held, on a held-down key, while a pop-up is open, or when something else already handled the
 * key. During a match (countdown, play, intermission) the game owns the keyboard: Tic-Tac-Toe uses M
 * for a medium piece, and the racers read raw key state, so the global keys stand aside until the
 * results.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { isGameId, type Phase } from '@dascade/shared';
import { useApp } from '../app/store.ts';
// Type only (erased in the build): see `session` below.
import type * as SessionModule from '../net/session.ts';

export type ShortcutAction = 'help' | 'mute';

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'defaultPrevented'>;

/** The phases where a game is being played and its own keys come first. */
const MATCH_PHASES: ReadonlySet<Phase> = new Set(['COUNTDOWN', 'PLAYING', 'INTERMISSION']);

/** The key's target is somewhere you type: a field, a text area, a select or editable text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Which shortcut a key press means, or null. Pure: the caller says whether you're typing, whether a
 * pop-up is open and whether a match is on.
 */
export function shortcutFor(
  e: KeyLike,
  ctx: { typing: boolean; modalOpen: boolean; inMatch: boolean },
): ShortcutAction | null {
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (ctx.typing || ctx.modalOpen || ctx.inMatch) return null;
  if (e.key === '?') return 'help';
  if (e.key === 'm' || e.key === 'M') return 'mute';
  return null;
}

/** The Help page for where you are: the room's game, a title screen's game, the Tournament Center, or basics. */
export function helpTopicFor(pathname: string, roomGameId: string | null): string | null {
  if (pathname.startsWith('/room/') && roomGameId) return roomGameId;
  const play = /^\/play\/([^/?#]+)/.exec(pathname)?.[1];
  if (play && isGameId(play)) return play;
  if (pathname === '/tournaments' || pathname.startsWith('/tournaments/')) return 'tournament';
  return null;
}

/** A pop-up is open: the app's modals, or any other open dialog (a lobby's confirm, the QR invite). */
export function popupOpen(): boolean {
  return useApp.getState().modal !== null || (typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null);
}

/** What the keys read from the session: whether you're in a room, its phase and its game. */
export type SessionLike = Pick<typeof SessionModule, 'useSessionStore' | 'getStateSnapshot'>;

/**
 * net/session.ts, and the Colyseus SDK behind it, stays out of the landing page: it loads with a room.
 * So this file never imports it statically. Off /room/ paths no match can be on and the help topic
 * comes from the URL; on /room/ paths the session is read through this reference, loaded as soon as
 * the path starts with /room/ (RoomScreen has loaded the module by then, so it resolves at once).
 */
let session: SessionLike | null = null;
let sessionLoad: Promise<void> | null = null;

function loadSession(): void {
  sessionLoad ??= import('../net/session.ts').then(
    (m) => {
      session = m;
    },
    () => {
      sessionLoad = null; // a failed chunk load: try again on the next room path
    },
  );
}

const isRoomPath = (pathname: string) => pathname.startsWith('/room/');

/**
 * A match is being played on this screen. Off /room/ paths there's none. On a room path, until the
 * session has loaded, assume there is one, so the keys stand aside rather than guess.
 */
export function matchOn(pathname: string, mod: SessionLike | null = session): boolean {
  if (!isRoomPath(pathname)) return false;
  if (!mod) return true;
  if (!mod.useSessionStore.getState().code) return false;
  const phase = mod.getStateSnapshot<{ phase?: Phase }>()?.phase;
  return phase !== undefined && MATCH_PHASES.has(phase);
}

/** "M": flips Mute everything, and says so (the key gives no other sign). */
export function toggleMute(): void {
  const { settings, updateSettings, toast } = useApp.getState();
  const muted = !settings.muted;
  updateSettings({ muted });
  toast('info', muted ? 'Sound off. Press M to turn it back on.' : 'Sound on.', 2500);
}

/** The global ? and M keys. Mount once, inside the router. */
export function useGlobalShortcuts(): void {
  const { pathname } = useLocation();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
    if (isRoomPath(pathname)) loadSession();
  }, [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e, { typing: isTypingTarget(e.target), modalOpen: popupOpen(), inMatch: matchOn(path.current) });
      if (!action) return;
      e.preventDefault();
      const roomGameId = isRoomPath(path.current) ? (session?.useSessionStore.getState().gameId ?? null) : null;
      if (action === 'help') useApp.getState().openModal('help', helpTopicFor(path.current, roomGameId));
      else toggleMute();
    };
    // Bubble phase on window: a page element's own key handler runs first and can claim the key.
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The component form of useGlobalShortcuts, for App.tsx. */
export function GlobalShortcuts(): null {
  useGlobalShortcuts();
  return null;
}

/**
 * Esc goes back on this screen (a title screen, the Tournament Center), like its Back button. Not
 * while typing (Esc in a field is the field's), not while a pop-up is open (Esc closes it), not on a
 * key something else already handled.
 */
export function useEscapeBack(onBack: () => void, enabled = true): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  }, [onBack]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || popupOpen() || isTypingTarget(e.target)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
