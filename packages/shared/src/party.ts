/**
 * DAStravaganza party kit — shared (isomorphic) contract used by every party game
 * (Trivia, DASception, DASterpiece, DASwords, DAS Survey).
 *
 *  - Limits and team palette
 *  - Public view shapes of the kit's synchronized state (PartyRoomState on the server)
 *  - Kit message names + payload schemas (host controls, generic vote / answer payloads)
 *  - Podium / score-reveal shapes
 *
 * Import as `@dascade/shared/party`. Server toolkit: apps/game-server/src/rooms/party/.
 * Pure helpers: @dascade/game-core/party. Client components: apps/web/src/games/_party/.
 */
import { z } from 'zod';
import type { BaseRoomView } from './protocol.ts';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const PARTY_LIMITS = {
  /** Seated players a party room is designed for. */
  maxPlayers: 30,
  minTeams: 2,
  maxTeams: 6,
  /** Default max length for a typed answer / written entry. */
  answerText: 140,
  /** Max options in a generic vote. */
  voteOptions: 40,
  /** Max choices in a ranked ballot. */
  rankedChoices: 5,
  /** Max length of ids travelling in kit payloads (player ids, option ids). */
  id: 64,
} as const;

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface PartyTeamDef {
  id: string;
  name: string;
  /** Team colour (art palette; always paired with the name + icon, never colour alone). */
  color: string;
  /** PixelIcon name from @dascade/ui. */
  icon: string;
}

/** Fixed team palette. Team N uses PARTY_TEAMS[0..N-1]. Names are neutral and office-safe. */
export const PARTY_TEAMS: readonly PartyTeamDef[] = [
  { id: 'volt', name: 'Team Volt', color: '#ffd23f', icon: 'bolt' },
  { id: 'nova', name: 'Team Nova', color: '#ff4fd8', icon: 'star' },
  { id: 'wave', name: 'Team Wave', color: '#22d3ee', icon: 'sparkle' },
  { id: 'grid', name: 'Team Grid', color: '#2de38f', icon: 'joystick' },
  { id: 'flux', name: 'Team Flux', color: '#a78bfa', icon: 'rocket' },
  { id: 'ember', name: 'Team Ember', color: '#ff8a3d', icon: 'heart' },
];

export function partyTeam(id: string): PartyTeamDef | undefined {
  return PARTY_TEAMS.find((t) => t.id === id);
}

/** The first `count` team definitions (clamped to 2…6). */
export function partyTeamsFor(count: number): PartyTeamDef[] {
  const n = Math.max(PARTY_LIMITS.minTeams, Math.min(PARTY_LIMITS.maxTeams, Math.round(count)));
  return PARTY_TEAMS.slice(0, n);
}

export type PartyTeamScoring = 'sum' | 'average';

// ---------------------------------------------------------------------------
// Public (synchronized) state — what `state.toJSON()` looks like for kit fields
// ---------------------------------------------------------------------------

/** Per-seat party status. NEVER contains what someone answered/voted — only that they did. */
export interface PartySeatView {
  /** Has submitted for the current prompt (answer, vote, entry…). */
  answered: boolean;
  /** May act in the current prompt (connected, seated, not eliminated…). */
  eligible: boolean;
  /** Team id in team mode ('' otherwise). */
  teamId: string;
  /** Points gained at the last score reveal. */
  delta: number;
  /** Current place (1-based, ties share a place; 0 = unranked). */
  rank: number;
  /** Place before the last score reveal (for rank-change arrows). */
  prevRank: number;
  /** Consecutive successes (game-defined, e.g. correct answers). */
  streak: number;
}

export interface PartyTeamView {
  id: string;
  name: string;
  color: string;
  icon: string;
  score: number;
  delta: number;
  rank: number;
  prevRank: number;
  /** Seated members. */
  size: number;
}

export interface PartyPublicView extends BaseRoomView {
  /** Game-defined stage inside PLAYING ('idle' between matches). */
  stage: string;
  /** Increments on every stage change (key animations on it). */
  stageSeq: number;
  /** Total length of the current stage timer in ms (0 = untimed). `phaseEndsAt` is the deadline. */
  stageMs: number;
  /** Host paused the timer. */
  paused: boolean;
  /** Remaining ms when paused. */
  pausedMs: number;
  /** Total rounds/questions in the match (0 = unknown). `round` is the current one (1-based). */
  totalRounds: number;
  teamMode: boolean;
  teamScoring: PartyTeamScoring;
  seats: Record<string, PartySeatView>;
  teams: Record<string, PartyTeamView>;
  answeredCount: number;
  eligibleCount: number;
  /** Increments at every score reveal (ScoreReveal animates on change). */
  scoreSeq: number;
  /** JSON PartyPodium once the match ends ('' otherwise). */
  podiumJson: string;
}

// ---------------------------------------------------------------------------
// Podium
// ---------------------------------------------------------------------------

export interface PartyPodiumEntry {
  id: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  /** 1-based competition place (1, 2, 2, 4…). */
  place: number;
  teamId: string;
}

export interface PartyPodiumTeam {
  id: string;
  name: string;
  color: string;
  icon: string;
  score: number;
  place: number;
  size: number;
}

export interface PartyPodium {
  players: PartyPodiumEntry[];
  /** Team standings in team mode (null in free-for-all). */
  teams: PartyPodiumTeam[] | null;
  /** Winning player ids (several when tied). In team mode: members of the winning team(s). */
  winnerIds: string[];
  winningTeamIds: string[];
  /** Game-specific extras (awards, stats), small and JSON-safe. */
  extras?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const PARTY_MSG = {
  /**
   * client → server (host only): { action: 'pause' | 'resume' | 'skip', stageSeq? }. A skip that
   * names a `stageSeq` other than the current one is ignored, so a double tap or a resent message
   * can never skip two stages (the kit's HostBar always sends it).
   */
  host: 'party:host',
} as const;

export const PARTY_HOST_ACTIONS = ['pause', 'resume', 'skip'] as const;
export type PartyHostAction = (typeof PARTY_HOST_ACTIONS)[number];

const lazy = <T>(build: () => T): T => build();

export const PartyHostSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    action: z.enum(PARTY_HOST_ACTIONS),
    /** The stage the host is looking at (`stageSeq`); stale skips are ignored. */
    stageSeq: z.number().int().min(0).max(0xffffffff).optional(),
  }),
);
export type PartyHostPayload = z.infer<typeof PartyHostSchema>;

/** Generic single-choice vote: an option id, or null to abstain. Include the prompt `seq` to drop stale votes. */
export const PartyVoteSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    seq: z.number().int().min(0).max(1_000_000),
    choice: z.string().min(1).max(PARTY_LIMITS.id).nullable(),
  }),
);
export type PartyVotePayload = z.infer<typeof PartyVoteSchema>;

/** Ranked ballot: distinct option ids in preference order. */
export const PartyRankedVoteSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    seq: z.number().int().min(0).max(1_000_000),
    choices: z.array(z.string().min(1).max(PARTY_LIMITS.id)).min(1).max(PARTY_LIMITS.rankedChoices),
  }),
);
export type PartyRankedVotePayload = z.infer<typeof PartyRankedVoteSchema>;

/** Generic typed answer / written entry. */
export const PartyTextAnswerSchema = /* @__PURE__ */ lazy(() =>
  z.object({
    seq: z.number().int().min(0).max(1_000_000),
    text: z
      .string()
      .min(1)
      .max(PARTY_LIMITS.answerText * 2),
  }),
);
export type PartyTextAnswerPayload = z.infer<typeof PartyTextAnswerSchema>;

/** Generic "lock in what I submitted" (for games that allow changes until lock). */
export const PartyLockSchema = /* @__PURE__ */ lazy(() => z.object({ seq: z.number().int().min(0).max(1_000_000) }));
export type PartyLockPayload = z.infer<typeof PartyLockSchema>;

// ---------------------------------------------------------------------------
// Rejection reasons shared by the kit's answer/vote helpers (map them to sys:error text)
// ---------------------------------------------------------------------------

export type PartySubmitReason = 'closed' | 'not_eligible' | 'already_locked' | 'invalid' | 'stale';
export type PartyVoteReason =
  PartySubmitReason | 'self_vote' | 'unknown_option' | 'abstain_not_allowed' | 'duplicate_choice' | 'too_many_choices';

export const PARTY_REASON_TEXT: Record<PartyVoteReason, string> = {
  closed: 'Time is up — answers are closed.',
  not_eligible: 'You can’t answer this one.',
  already_locked: 'You already locked in.',
  invalid: 'That answer could not be understood.',
  stale: 'That was for an earlier question.',
  self_vote: 'You can’t vote for your own entry.',
  unknown_option: 'That option doesn’t exist.',
  abstain_not_allowed: 'Pick one of the options.',
  duplicate_choice: 'Pick each option only once.',
  too_many_choices: 'That’s too many choices.',
};
