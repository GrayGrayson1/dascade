/**
 * How a dropped room connection comes back (session.ts drives it; pure so it can be unit-tested).
 *
 * 1. The SDK's auto-reconnect keeps the same session, so nothing remounts. After a half-open drop it is
 *    parked by the server until the heartbeat ends the old socket (HEARTBEAT_WINDOW_MS), and refused with
 *    close 4003 if that takes longer than the seat reservation (SEAT_RESERVATION_SECONDS).
 * 2. When the SDK can't bring the session back, the client takes its seat back by seat token, once,
 *    for every room that still exists. Event rooms (a Survey Showdown with its preset) do that from
 *    ShowRecovery instead, sooner, as before.
 */
import { HEARTBEAT_WINDOW_MS, RoomCloseCode, SEAT_RESERVATION_SECONDS } from '@dascade/shared';
import type { FriendlyErrorKind } from './errors.ts';

/** Colyseus close codes (see @colyseus/shared-types CloseCode). */
export const CLOSE_CONSENTED = 4000;
export const CLOSE_SERVER_SHUTDOWN = 4001;
/** The server refused a reconnect (e.g. a parked one that waited past the seat reservation). */
export const CLOSE_FAILED_TO_RECONNECT = 4003;
/** MATCHMAKE_EXPIRED: the error a refused reconnect sends just before closing with 4003. */
export const ERROR_RECONNECT_EXPIRED = 524;

/** How often a reconnecting client asks whether its room still exists. */
export const RESTART_PROBE_MS = 5000;

/**
 * Answered probes (the server is reachable and the room still exists) before a reconnecting client
 * stops waiting for the SDK and takes its seat back by token.
 * - Event rooms: 2 (about 10 s), unchanged — their players wait for the show (ShowRecovery).
 * - Every other room: past the point where the server would have answered the parked reconnect
 *   itself (landed within HEARTBEAT_WINDOW_MS, or refused at SEAT_RESERVATION_SECONDS), so the
 *   same-session reconnect always gets its chance first; this is only a safety net.
 */
export function fallbackAfterAnswers(eventRoom: boolean): number {
  if (eventRoom) return 2;
  const serverAnswersByMs = Math.max(HEARTBEAT_WINDOW_MS, SEAT_RESERVATION_SECONDS * 1000);
  return Math.floor(serverAnswersByMs / RESTART_PROBE_MS) + 1;
}

export type CloseOutcome = 'removed' | 'taken_over' | 'server_restarted' | 'dropped';

/** What a room connection closing (after the SDK stopped retrying) means for this player. */
export function classifyClose(code: number, removalNotified: boolean): CloseOutcome {
  if (removalNotified || code === RoomCloseCode.KICKED || code === RoomCloseCode.ROOM_CLOSED) return 'removed';
  // The server closed this session on purpose: the seat was opened in another tab or window.
  if (code === CLOSE_CONSENTED) return 'taken_over';
  if (code === CLOSE_SERVER_SHUTDOWN) return 'server_restarted';
  // A refused reconnect (4003), retries used up, an abnormal close: the seat may still be there.
  return 'dropped';
}

/**
 * Leaving a connection this tab has abandoned (a late auto-reconnect, a superseded join): a consented
 * leave gives the seat up at once, so only consent when the player is no longer headed for that room.
 * Otherwise a reconnect landing just as the seat-token rejoin starts would delete the seat, and the
 * rejoin would seat the player again as a stranger (or a queued spectator).
 */
export function consentToLeave(roomCode: string, headingFor: string | null): boolean {
  return roomCode !== headingFor;
}

/**
 * Whether a room's error deserves a toast. While reconnecting, a refused attempt ("failed to
 * reconnect") is the reconnect screens' business: the seat is taken back by token next.
 */
export function toastsRoomError(status: string, code: number): boolean {
  return status !== 'reconnecting' && code !== ERROR_RECONNECT_EXPIRED;
}

/**
 * A seat rejoin after a drop failed: which notice to show. Anything a retry could fix (no network, the
 * server busy or restarting) stays "Connection lost", which rejoins when the device comes back online;
 * a final answer (room gone, kicked, full, locked, match over) is shown as it is.
 */
export function noticeAfterFailedRejoin(kind: FriendlyErrorKind): FriendlyErrorKind {
  return kind === 'server_unavailable' || kind === 'rate_limited' || kind === 'unknown' ? 'reconnect_failed' : kind;
}
