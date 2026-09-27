import { normalizeRoomCode } from '@dascade/shared';

/** The room code a `/room/<code>` pathname points at (normalized), or null for any other path. */
export function roomCodeFromPath(pathname: string): string | null {
  const match = /^\/room\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  let segment = match[1];
  try {
    segment = decodeURIComponent(segment);
  } catch {
    /* keep the raw segment */
  }
  return normalizeRoomCode(segment);
}

export interface SessionPeek {
  code: string | null;
  hasRoom: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'lost';
}

/** The session holds a room, or is connecting / reconnecting to one. */
function holdsRoom(session: SessionPeek): boolean {
  return session.hasRoom || session.status === 'connecting' || session.status === 'reconnecting';
}

/**
 * Whether the room screen for `code`, having unmounted, should leave the room: yes when the player
 * navigated off the room screens (browser / Android Back, a link, an error screen's "Back to arcade")
 * while the session still holds — or is still connecting to — this room. No when a room screen is
 * still showing: the same room (StrictMode's dev remount) or another room, whose screen takes over
 * (see shouldLeaveBeforeResolving). No when the session already moved on to another room.
 */
export function shouldLeaveOnExit(code: string, pathname: string, session: SessionPeek): boolean {
  if (roomCodeFromPath(pathname) !== null) return false;
  if (session.code !== code) return false;
  return holdsRoom(session);
}

/**
 * Whether the room screen, about to resolve `code`, must first leave the room the session holds:
 * the player opened another room's link (or went Back to one) while still in a room. Room → room hops
 * that join first (create, tournament matches, "Back to tournament") already hold `code`.
 */
export function shouldLeaveBeforeResolving(code: string, session: SessionPeek): boolean {
  return session.code !== code && holdsRoom(session);
}
