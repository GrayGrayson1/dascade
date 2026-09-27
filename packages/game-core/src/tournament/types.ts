/**
 * Tournament engine data model. Plain JSON (no classes, no Maps) so a tournament can be
 * snapshotted, persisted and restored exactly. Everything a UI may see is mapped to the public
 * views in `@dascade/shared` (tournament.ts) by the server; `identity` never leaves the server.
 */
import type {
  MatchResultKind,
  MatchStatus,
  ParticipantStatus,
  SeedingMethod,
  TournamentAuditEntry,
  TournamentBracket,
  TournamentConfig,
  TournamentEvent,
  TournamentSide,
  TournamentStatus,
} from '@dascade/shared';

export interface EngineParticipant {
  id: string;
  name: string;
  avatar: string;
  /** Rating identity ('u:<account>' | 'g:<guest>'), server-only. Used for duplicate-entry checks and rating seeding. */
  identity: string | null;
  rating: number;
  ratingGames: number;
  provisional: boolean;
  /** Registration order (1-based). */
  entry: number;
  registeredAt: number;
  status: ParticipantStatus;
  checkedIn: boolean;
  /** 1 = top seed; 0 = unseeded. */
  seed: number;
  /** Side held in game 1 of every PLAYED match with sides (colour history, oldest first). */
  sides: TournamentSide[];
  byes: number;
}

/** Where an elimination slot comes from. */
export type SlotSource = { kind: 'seed'; seed: number } | { kind: 'winner' | 'loser'; matchId: string };

export interface EngineGame {
  n: number;
  /** Winner participant id; null = drawn game. */
  winnerId: string | null;
  /** Participant with the `first` side (null for games without sides). */
  firstId: string | null;
  decider: '' | 'sudden_death' | 'armageddon';
  reason: string;
  at: number;
}

export interface EngineMatch {
  id: string;
  bracket: TournamentBracket;
  round: number;
  order: number;
  label: string;
  roundLabel: string;
  /** Elimination slot sources (null for round robin / Swiss, whose slots are fixed at creation). */
  sources: [SlotSource | null, SlotSource | null];
  a: string | null;
  b: string | null;
  status: MatchStatus;
  /** Grand-final reset: played only when the losers-bracket champion wins the grand final. */
  conditional: boolean;
  next: { matchId: string; slot: 0 | 1 } | null;
  loserNext: { matchId: string; slot: 0 | 1 } | null;
  bestOf: number;
  /** A level series goes to deciders (elimination) instead of ending drawn (RR/Swiss). */
  requireWinner: boolean;
  /** Participant with the `first` side in game 1 (null when the game has no sides / not decided yet). */
  firstId: string | null;
  games: EngineGame[];
  winner: string | null;
  loser: string | null;
  draw: boolean;
  resultKind: MatchResultKind | null;
  resultNote: string;
  startedAt: number;
  completedAt: number;
}

export interface TournamentData {
  version: 1;
  config: TournamentConfig;
  status: TournamentStatus;
  paused: boolean;
  participants: EngineParticipant[];
  seedingMethod: SeedingMethod | null;
  matches: EngineMatch[];
  /** Swiss: rounds paired so far. RR/elimination: number of rounds in the schedule. */
  roundsPaired: number;
  totalRounds: number;
  championId: string | null;
  checkInEndsAt: number;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  /** Finished early by the organizer (`end`). */
  endedEarly: boolean;
  audit: TournamentAuditEntry[];
  auditSeq: number;
  entrySeq: number;
}

/** Engine side effects the room turns into toasts/sounds (state stays the source of truth). */
export type EngineEvent = TournamentEvent;

export type TournamentErrorCode = 'wrong_status' | 'not_found' | 'invalid' | 'full' | 'duplicate' | 'not_allowed';

export class TournamentError extends Error {
  readonly code: TournamentErrorCode;
  constructor(code: TournamentErrorCode, message: string) {
    super(message);
    this.name = 'TournamentError';
    this.code = code;
  }
}
