import { JoinErrorCode } from '@dascade/shared';

export type FriendlyErrorKind =
  | 'server_unavailable'
  | 'server_restarted'
  | 'not_found'
  | 'invalid_code'
  | 'room_full'
  | 'room_locked'
  | 'kicked'
  | 'match_ended'
  | 'rate_limited'
  | 'reconnect_failed'
  | 'unknown';

export interface FriendlyError {
  kind: FriendlyErrorKind;
  title: string;
  message: string;
  /** Whether "Try again" makes sense. */
  retryable: boolean;
}

export const ERRORS: Record<FriendlyErrorKind, Omit<FriendlyError, 'kind'>> = {
  server_unavailable: {
    title: 'The arcade is offline',
    message: 'We couldn’t reach the DASCADE game server. Check your connection — or the server may be restarting.',
    retryable: true,
  },
  server_restarted: {
    title: 'The arcade restarted',
    message: 'The game server restarted, which closed this room. Start a new game from the arcade — your name and settings are saved.',
    retryable: false,
  },
  not_found: {
    title: 'Room not found',
    message: 'No room is using that code. It may have closed when everyone left — double-check the code or start a new game.',
    retryable: false,
  },
  invalid_code: {
    title: 'That code doesn’t look right',
    message: 'Room codes are 5 characters, like K7QXM.',
    retryable: false,
  },
  room_full: { title: 'Room is full', message: 'Every seat is taken and spectating is turned off.', retryable: true },
  room_locked: { title: 'Room is locked', message: 'The host has locked this room to new players.', retryable: true },
  kicked: { title: 'Removed from room', message: 'The host removed you from this room.', retryable: false },
  match_ended: { title: 'Match already ended', message: 'That room has closed. Start a new game from the arcade.', retryable: false },
  rate_limited: { title: 'Slow down a sec', message: 'Too many attempts in a short time. Wait a moment and try again.', retryable: true },
  reconnect_failed: {
    title: 'Connection lost',
    message: 'We couldn’t reconnect you to the room automatically.',
    retryable: true,
  },
  unknown: { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.', retryable: true },
};

export function friendly(kind: FriendlyErrorKind, message?: string): FriendlyError {
  const base = ERRORS[kind];
  return { kind, ...base, message: message ?? base.message };
}

/** Map a Colyseus matchmaking / connection error to a friendly error. */
export function toFriendlyError(err: unknown): FriendlyError {
  const e = err as { code?: number; message?: string; name?: string } | undefined;
  const code = e?.code;
  const msg = String(e?.message ?? '');
  switch (code) {
    case JoinErrorCode.ROOM_LOCKED:
      return friendly('room_locked');
    case JoinErrorCode.ROOM_FULL:
      return friendly('room_full');
    case JoinErrorCode.KICKED:
      return friendly('kicked');
    case JoinErrorCode.NOT_FOUND:
      return friendly('not_found');
    case JoinErrorCode.MATCH_ENDED:
      return friendly('match_ended');
    case JoinErrorCode.RATE_LIMITED:
      return friendly('rate_limited', msg || undefined);
    case 522: // MATCHMAKE_INVALID_ROOM_ID
      if (/locked/i.test(msg)) return friendly('room_full', 'This room is full or locked right now.');
      return friendly('not_found');
    case 524: // MATCHMAKE_EXPIRED
      return friendly('reconnect_failed');
  }
  if (/fetch|network|ECONNREFUSED|Failed to|NetworkError|Load failed|timed? ?out/i.test(msg) || e?.name === 'TypeError') {
    return friendly('server_unavailable');
  }
  return friendly('unknown');
}
