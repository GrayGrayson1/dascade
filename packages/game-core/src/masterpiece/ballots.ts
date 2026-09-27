/**
 * Showdown ballots — DASterpiece's voting rules on top of the party kit's VoteBox.
 *
 * Two kit boxes per showdown: one for players, one for the audience (spectators), so audience
 * ballots can never be confused with (or outnumber) player votes.
 *
 * Rules:
 *  - Head-to-head authors cannot vote in their own matchup (they are not in the voter list).
 *  - Nobody can pick their own answer (kit self-vote ban via `ownerOf`).
 *  - Favourite / head-to-head ballots pick exactly one answer; ranked ballots pick
 *    min(MP_LIMITS.rankedPicks, answers the voter may choose) distinct answers, best first.
 *  - One ballot per voter. When vote changes are off, a cast ballot is locked immediately; when
 *    they are on, it can be replaced until the voter locks it (or voting closes).
 *  - Re-sending the exact same ballot is a no-op (idempotent), never a second vote.
 */
import { MP_LIMITS, type MpVoteKind } from '@dascade/shared/games/masterpiece';
import type { PartyVoteReason } from '@dascade/shared/party';
import { VoteBox } from '../party/index.ts';

export interface Ballot {
  voterId: string;
  picks: string[];
  locked: boolean;
  audience: boolean;
}

export interface BallotAnswer {
  id: string;
  authorId: string;
}

export type BallotError = PartyVoteReason | 'wrong_count' | 'no_ballot';

export type CastResult = { ok: true; ballot: Ballot; changed: boolean } | { ok: false; error: BallotError };

export class ShowdownBallots {
  private readonly authorOf = new Map<string, string>();
  private readonly authors = new Set<string>();
  readonly players: VoteBox;
  readonly audience: VoteBox;

  /**
   * @param voters seated players who may vote (head-to-head authors are removed automatically).
   */
  constructor(
    readonly kind: MpVoteKind,
    answers: readonly BallotAnswer[],
    voters: Iterable<string>,
    readonly allowChange: boolean,
  ) {
    for (const a of answers) {
      this.authorOf.set(a.id, a.authorId);
      this.authors.add(a.authorId);
    }
    const options = answers.map((a) => a.id);
    const ownerOf = (id: string) => this.authorOf.get(id);
    const maxChoices = kind === 'ranked' ? MP_LIMITS.rankedPicks : 1;
    const eligible = [...voters].filter((v) => !(kind === 'matchup' && this.authors.has(v)));
    this.players = new VoteBox({ options, voters: eligible, ownerOf, allowChange, maxChoices, requireFullRanking: true });
    this.audience = new VoteBox({ options, voters: null, ownerOf, allowChange, maxChoices, requireFullRanking: true });
  }

  get answerIds(): string[] {
    return [...this.authorOf.keys()];
  }

  isAuthor(playerId: string): boolean {
    return this.authors.has(playerId);
  }

  /** Answer ids written by this player. */
  ownAnswers(playerId: string): string[] {
    return [...this.authorOf].filter(([, author]) => author === playerId).map(([id]) => id);
  }

  /** Whether this voter may vote (head-to-head authors sit out). */
  mayVote(voterId: string, audience: boolean): boolean {
    if (this.kind === 'matchup' && this.authors.has(voterId)) return false;
    return audience || this.players.isEligible(voterId);
  }

  /** A seated player who joined or came back mid-vote. */
  addVoter(voterId: string): void {
    if (this.kind === 'matchup' && this.authors.has(voterId)) return;
    this.players.addVoter(voterId);
  }

  /** A player who left for good: stop waiting for them and drop an unlocked ballot. */
  removeVoter(voterId: string): void {
    this.players.removeVoter(voterId);
  }

  /** Picks a ballot must contain for this voter. */
  picksRequired(voterId: string): number {
    if (this.kind !== 'ranked') return 1;
    const choosable = this.authorOf.size - this.ownAnswers(voterId).length;
    return Math.max(1, Math.min(MP_LIMITS.rankedPicks, choosable));
  }

  cast(voterId: string, picks: readonly string[], audience: boolean): CastResult {
    if (!this.mayVote(voterId, audience)) return { ok: false, error: 'not_eligible' };
    const box = audience ? this.audience : this.players;
    if (!box.isOpen) return { ok: false, error: 'closed' };
    const existing = box.ballot(voterId);
    if (existing && existing.choices.length === picks.length && existing.choices.every((c, i) => c === picks[i])) {
      return { ok: true, ballot: toBallot(voterId, existing.choices, existing.locked, audience), changed: false };
    }
    if (existing && (existing.locked || !this.allowChange)) return { ok: false, error: 'already_locked' };
    if (new Set(picks).size !== picks.length) return { ok: false, error: 'duplicate_choice' };
    for (const pick of picks) {
      const author = this.authorOf.get(pick);
      if (author === undefined) return { ok: false, error: 'unknown_option' };
      if (author === voterId) return { ok: false, error: 'self_vote' };
    }
    // Exact pick count (the kit accepts partial single-choice ballots; DASterpiece wants all picks).
    if (picks.length !== this.picksRequired(voterId)) return { ok: false, error: 'wrong_count' };
    const result = box.cast(voterId, picks);
    if (!result.ok) return { ok: false, error: result.reason };
    const ballot = box.ballot(voterId)!;
    return { ok: true, ballot: toBallot(voterId, ballot.choices, ballot.locked, audience), changed: true };
  }

  /** Locks a voter's ballot (true also when it was already locked). */
  lock(voterId: string, audience: boolean): { ok: true; ballot: Ballot } | { ok: false; error: BallotError } {
    const box = audience ? this.audience : this.players;
    const ballot = box.ballot(voterId);
    if (!ballot) return { ok: false, error: 'no_ballot' };
    if (!ballot.locked && !box.lock(voterId)) return { ok: false, error: 'closed' };
    return { ok: true, ballot: toBallot(voterId, ballot.choices, true, audience) };
  }

  ballotOf(voterId: string, audience: boolean): Ballot | null {
    const b = (audience ? this.audience : this.players).ballot(voterId);
    return b ? toBallot(voterId, b.choices, b.locked, audience) : null;
  }

  /** Closes both boxes (every ballot becomes final). */
  close(): void {
    this.players.close();
    this.audience.close();
  }

  get isOpen(): boolean {
    return this.players.isOpen;
  }

  /** All ballots (players then audience) in tally format. */
  all(): Ballot[] {
    const out: Ballot[] = [];
    for (const id of this.players.votedIds()) {
      const b = this.players.ballot(id)!;
      out.push(toBallot(id, b.choices, b.locked, false));
    }
    for (const id of this.audience.votedIds()) {
      const b = this.audience.ballot(id)!;
      out.push(toBallot(id, b.choices, b.locked, true));
    }
    return out;
  }

  get playerCount(): number {
    return this.players.count;
  }

  get audienceCount(): number {
    return this.audience.count;
  }

  /** Eligible player voters among `present` (for the "votes in" meter). */
  eligibleAmong(present: Iterable<string>): string[] {
    return [...present].filter((id) => this.players.isEligible(id));
  }

  /** Every present eligible player has a locked ballot (and at least one ballot exists). */
  isComplete(present: Iterable<string>): boolean {
    return this.players.isComplete(present);
  }

  pending(present: Iterable<string>): string[] {
    return this.players.pending(present);
  }
}

function toBallot(voterId: string, picks: readonly string[], locked: boolean, audience: boolean): Ballot {
  return { voterId, picks: [...picks], locked, audience };
}
