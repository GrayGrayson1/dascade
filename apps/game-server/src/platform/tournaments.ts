/**
 * Tournament Center plumbing shared by the kiosk room (`TournamentRoom`) and the game rooms it
 * creates for its matches (bound via `BaseGameRoom`).
 *
 * Everything here is IN-PROCESS and server-only:
 *  - match bindings: the kiosk registers a binding under an unguessable one-time key and passes that
 *    key to `matchMaker.handleCreateRoom` (always on this process). The new room consumes it in
 *    onCreate. Clients can't forge a binding: keys never leave the server, expire quickly and work once.
 *  - bound rooms: live match rooms by (tournament code, match id), so the kiosk can push series
 *    updates (next game / decided / closed).
 *  - tournament hosts: live kiosks by code (for match-room callbacks and GET /api/tournaments).
 *  - the outcome listener: every `reportOutcome()` of a bound room is delivered to its kiosk,
 *    which records it idempotently by (matchId, gameNumber).
 *
 * Multi-process note: bindings/hosts are per process; `handleCreateRoom` keeps match rooms on the
 * kiosk's process, so this holds with the Redis driver too (the kiosk process owns its matches).
 */
import { randomId, type GameId, type GameOutcome, type TournamentListing, type TournamentMatchInfo } from '@dascade/shared';
import { log } from '../lib/log.ts';
import { onOutcome, type OutcomeContext } from './hub.ts';

/** Create-option key carrying the one-time binding key (never trusted by itself — it must exist here). */
export const MATCH_BINDING_OPTION = '__dascadeTournamentBinding';

export interface MatchBinding {
  tournamentCode: string;
  matchId: string;
  /** Launch attempt (a relaunched match gets a new attempt). */
  attempt: number;
  gameId: GameId;
  /** Initial public match info (game number, sides, series score). */
  info: TournamentMatchInfo;
  /** ticket → participantId. */
  tickets: Record<string, string>;
  /** Minimum reconnect grace for bound rooms (seconds). */
  reconnectGraceSeconds: number;
}

/** What the kiosk tells a bound match room. */
export interface SeriesUpdate {
  /** next: another game follows (info has the new game number/sides); decided: series over; closed: resolved elsewhere / cancelled. */
  status: 'next' | 'decided' | 'closed';
  info: TournamentMatchInfo;
  /** Human text for 'closed' (why the room is closing). */
  message?: string;
}

/** Implemented by BaseGameRoom for bound rooms. */
export interface BoundMatchRoom {
  roomCode: string;
  attempt: number;
  applySeries(update: SeriesUpdate): void;
}

/** Room status a bound match room reports to its kiosk. */
export interface MatchRoomStatus {
  /** Participants currently connected to the room. */
  present: string[];
  /** In the lobby waiting for players (not playing / not between games). */
  waiting: boolean;
}

/** Implemented by TournamentRoom. */
export interface TournamentHost {
  readonly code: string;
  /** Rate-limit key (ipRateKey) of the address that created it, once its organizer has joined. */
  readonly creatorKey?: string | null;
  listing(): TournamentListing | null;
  matchRoomStatus(matchId: string, roomCode: string, status: MatchRoomStatus): void;
  matchGameStarted(matchId: string, roomCode: string, gameNumber: number): void;
  matchGameOutcome(matchId: string, roomCode: string, gameNumber: number, winnerParticipantId: string | null, reason: string): void;
  matchRoomClosed(matchId: string, roomCode: string): void;
}

const BINDING_TTL_MS = 60_000;
const bindings = new Map<string, { binding: MatchBinding; expires: number }>();
const hosts = new Map<string, TournamentHost>();
const boundRooms = new Map<string, BoundMatchRoom>();

const roomKey = (code: string, matchId: string) => `${code}|${matchId}`;

export function createMatchBinding(binding: MatchBinding): string {
  const now = Date.now();
  for (const [k, v] of bindings) if (v.expires < now) bindings.delete(k);
  const key = randomId(40);
  bindings.set(key, { binding, expires: now + BINDING_TTL_MS });
  return key;
}

/** One-time: returns the binding for a key created on this process, or null. */
export function consumeMatchBinding(key: unknown): MatchBinding | null {
  if (typeof key !== 'string' || key.length !== 40) return null;
  const entry = bindings.get(key);
  if (!entry) return null;
  bindings.delete(key);
  if (entry.expires < Date.now()) return null;
  return entry.binding;
}

export function registerTournament(host: TournamentHost): void {
  hosts.set(host.code, host);
}

export function unregisterTournament(code: string, host: TournamentHost): void {
  if (hosts.get(code) === host) hosts.delete(code);
}

export function getTournament(code: string): TournamentHost | undefined {
  return hosts.get(code);
}

/** Live kiosks on this process (optionally only those matching `filter`). */
export function countTournaments(filter?: (host: TournamentHost) => boolean): number {
  if (!filter) return hosts.size;
  let n = 0;
  for (const host of hosts.values()) if (filter(host)) n++;
  return n;
}

export function listTournaments(): TournamentListing[] {
  const out: TournamentListing[] = [];
  for (const host of hosts.values()) {
    try {
      const listing = host.listing();
      if (listing) out.push(listing);
    } catch (err) {
      log.warn('tournament listing failed', { code: host.code, err: err as Error });
    }
  }
  return out;
}

export function registerBoundRoom(tournamentCode: string, matchId: string, room: BoundMatchRoom): void {
  boundRooms.set(roomKey(tournamentCode, matchId), room);
}

export function unregisterBoundRoom(tournamentCode: string, matchId: string, room: BoundMatchRoom): void {
  if (boundRooms.get(roomKey(tournamentCode, matchId)) === room) boundRooms.delete(roomKey(tournamentCode, matchId));
}

export function getBoundRoom(tournamentCode: string, matchId: string): BoundMatchRoom | undefined {
  return boundRooms.get(roomKey(tournamentCode, matchId));
}

/**
 * The winning participant of a reported game (null = draw), or undefined when the outcome can't be
 * attributed to the match's participants.
 */
export function outcomeWinner(outcome: GameOutcome, info: TournamentMatchInfo): string | null | undefined {
  const byPlayer = new Map(info.participants.filter((p) => p.playerId).map((p) => [p.playerId!, p.participantId]));
  const groups = outcome.placements.map((g) => g.map((id) => byPlayer.get(id)).filter((x): x is string => Boolean(x))).filter((g) => g.length > 0);
  if (groups.length === 0) return undefined;
  const top = groups[0]!;
  if (top.length > 1) return null; // shared first place = draw
  return top[0]!;
}

let installed = false;

/** Deliver bound rooms' game outcomes to their kiosk (installed once per process). */
export function installTournamentOutcomeListener(): void {
  if (installed) return;
  installed = true;
  onOutcome((outcome: GameOutcome, ctx: OutcomeContext) => {
    const info = ctx.tournament;
    if (!info) return;
    const host = hosts.get(info.tournamentCode);
    if (!host) {
      log.warn('tournament outcome for a closed tournament', { code: info.tournamentCode, match: info.matchId });
      return;
    }
    const winner = outcomeWinner(outcome, info);
    if (winner === undefined) {
      log.warn('tournament outcome without participants ignored', { code: info.tournamentCode, match: info.matchId });
      return;
    }
    host.matchGameOutcome(info.matchId, ctx.roomCode, info.gameNumber, winner, outcome.reason ?? '');
  });
}

/** Tests only. */
export function resetTournamentRegistry(): void {
  bindings.clear();
  hosts.clear();
  boundRooms.clear();
}
