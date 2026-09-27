/**
 * VoteBox — private-until-reveal voting for party games.
 *
 * Ballots stay inside the box (server memory) until the caller reveals the tally. Rules, all
 * enforced here so every game behaves the same:
 *  - Only eligible voters may vote (`voters`; omit/null = anyone).
 *  - Self-votes are refused when `ownerOf(option)` lists the voter (unless `allowSelfVote`).
 *  - Unknown options are refused; `null` = abstain (only when `allowAbstain`).
 *  - One ballot per voter: re-votes are refused ('already_locked') unless `allowChange`, in which
 *    case the latest ballot counts until the voter `lock()`s or the box `close()`s.
 *  - Ranked ballots (`maxChoices` > 1): distinct options in preference order, scored with Borda
 *    points (first choice = maxChoices points, then maxChoices-1, …). Single-choice ballots score
 *    1 point per vote, so `points === votes`.
 *
 * Tie rules for `winners()` (deterministic and documented):
 *  - 'share'  — every option tied on top wins (default).
 *  - 'none'   — a tie on top means no winner (e.g. "no elimination on a tied vote").
 *  - 'first'  — the tied option that appears first in `options` wins (authoring order).
 *  - 'random' — one tied option chosen with the supplied Rng (server passes its crypto rng).
 * Ranking is by points, then (tie) by first-choice votes, before the tie rule applies.
 * An option needs at least one point to win; with no votes there is no winner.
 */
import type { Rng } from '@dascade/shared';
import type { PartyVoteReason } from '@dascade/shared/party';

export type VoteTieRule = 'share' | 'none' | 'first' | 'random';

export interface VoteBoxOptions {
  /** Option ids, in display/authoring order. */
  options: readonly string[];
  /** Eligible voter ids (null/omitted = anyone). */
  voters?: Iterable<string> | null;
  /** Owner(s) of an option — used to refuse self-votes. */
  ownerOf?: (optionId: string) => string | readonly string[] | null | undefined;
  allowSelfVote?: boolean;
  allowChange?: boolean;
  allowAbstain?: boolean;
  /** 1 = single choice (default). >1 = ranked ballot of up to this many distinct options. */
  maxChoices?: number;
  /** Ranked ballots must rank exactly `maxChoices` options (capped by the options available to the voter). */
  requireFullRanking?: boolean;
}

export type VoteResult = { ok: true; changed: boolean } | { ok: false; reason: PartyVoteReason };

export interface Ballot {
  voter: string;
  /** Empty array = abstain. */
  choices: string[];
  locked: boolean;
  at: number;
}

export interface OptionTally {
  optionId: string;
  /** First-choice votes. */
  votes: number;
  /** Borda points (equals `votes` for single-choice ballots). */
  points: number;
  /** Voters who put this option first. Only expose after the reveal. */
  voters: string[];
}

export interface VoteTally {
  /** Options sorted by points desc, then first-choice votes desc, then authoring order. */
  options: OptionTally[];
  /** Ballots cast (including abstentions). */
  cast: number;
  abstained: number;
}

export class VoteBox {
  readonly options: readonly string[];
  readonly maxChoices: number;
  private readonly optionSet: Set<string>;
  private readonly ballots = new Map<string, Ballot>();
  private voters: Set<string> | null;
  private open = true;

  constructor(private readonly opts: VoteBoxOptions) {
    this.options = [...opts.options];
    this.optionSet = new Set(this.options);
    this.maxChoices = Math.max(1, Math.floor(opts.maxChoices ?? 1));
    this.voters = opts.voters ? new Set(opts.voters) : null;
  }

  get isOpen(): boolean {
    return this.open;
  }

  isEligible(voter: string): boolean {
    return this.voters === null || this.voters.has(voter);
  }

  addVoter(voter: string): void {
    this.voters?.add(voter);
  }

  removeVoter(voter: string): void {
    if (this.voters === null) this.voters = new Set([...this.ballots.keys()].filter((v) => v !== voter));
    else this.voters.delete(voter);
  }

  /** Alias of addVoter (PartyCollector interface). */
  addEligible(voter: string): void {
    this.addVoter(voter);
  }

  /** Alias of removeVoter (PartyCollector interface). */
  removeEligible(voter: string): void {
    this.removeVoter(voter);
  }

  /** Options this voter may pick (everything except their own entries unless self-votes are allowed). */
  optionsFor(voter: string): string[] {
    return this.options.filter((o) => this.opts.allowSelfVote || !this.owns(voter, o));
  }

  owns(voter: string, optionId: string): boolean {
    const owner = this.opts.ownerOf?.(optionId);
    if (!owner) return false;
    return typeof owner === 'string' ? owner === voter : owner.includes(voter);
  }

  /** Cast a ballot. `choice` = option id, ordered ids (ranked), or null to abstain. */
  cast(voter: string, choice: string | readonly string[] | null, now: number = Date.now()): VoteResult {
    if (!this.open) return { ok: false, reason: 'closed' };
    if (!this.isEligible(voter)) return { ok: false, reason: 'not_eligible' };
    const existing = this.ballots.get(voter);
    if (existing && (existing.locked || !this.opts.allowChange)) return { ok: false, reason: 'already_locked' };

    let choices: string[];
    if (choice === null) {
      if (!this.opts.allowAbstain) return { ok: false, reason: 'abstain_not_allowed' };
      choices = [];
    } else {
      choices = typeof choice === 'string' ? [choice] : [...choice];
      if (choices.length === 0) {
        if (!this.opts.allowAbstain) return { ok: false, reason: 'abstain_not_allowed' };
      }
      if (choices.length > this.maxChoices) return { ok: false, reason: 'too_many_choices' };
      if (new Set(choices).size !== choices.length) return { ok: false, reason: 'duplicate_choice' };
      for (const c of choices) {
        if (!this.optionSet.has(c)) return { ok: false, reason: 'unknown_option' };
        if (!this.opts.allowSelfVote && this.owns(voter, c)) return { ok: false, reason: 'self_vote' };
      }
      if (this.opts.requireFullRanking && this.maxChoices > 1) {
        const need = Math.min(this.maxChoices, this.optionsFor(voter).length);
        if (choices.length < need) return { ok: false, reason: 'invalid' };
      }
    }
    const locked = !this.opts.allowChange;
    this.ballots.set(voter, { voter, choices, locked, at: now });
    return { ok: true, changed: Boolean(existing) };
  }

  lock(voter: string): boolean {
    if (!this.open) return false;
    const b = this.ballots.get(voter);
    if (!b || b.locked) return false;
    b.locked = true;
    return true;
  }

  close(): void {
    this.open = false;
    for (const b of this.ballots.values()) b.locked = true;
  }

  hasVoted(voter: string): boolean {
    return this.ballots.has(voter);
  }

  ballot(voter: string): Ballot | undefined {
    return this.ballots.get(voter);
  }

  get count(): number {
    return this.ballots.size;
  }

  votedIds(): string[] {
    return [...this.ballots.keys()];
  }

  pending(present?: Iterable<string>): string[] {
    const presentSet = present ? new Set(present) : null;
    const pool = this.voters ? [...this.voters] : presentSet ? [...presentSet] : [];
    return pool.filter((id) => (!presentSet || presentSet.has(id)) && !this.ballots.get(id)?.locked);
  }

  isComplete(present?: Iterable<string>): boolean {
    return this.count > 0 && this.pending(present).length === 0;
  }

  tally(): VoteTally {
    const rows = new Map<string, OptionTally>(this.options.map((o) => [o, { optionId: o, votes: 0, points: 0, voters: [] }]));
    let abstained = 0;
    for (const b of this.ballots.values()) {
      if (b.choices.length === 0) {
        abstained++;
        continue;
      }
      b.choices.forEach((c, i) => {
        const row = rows.get(c);
        if (!row) return;
        row.points += this.maxChoices - i;
        if (i === 0) {
          row.votes += 1;
          row.voters.push(b.voter);
        }
      });
    }
    const order = new Map(this.options.map((o, i) => [o, i]));
    const options = [...rows.values()].sort(
      (a, b) => b.points - a.points || b.votes - a.votes || (order.get(a.optionId) ?? 0) - (order.get(b.optionId) ?? 0),
    );
    return { options, cast: this.ballots.size, abstained };
  }

  /** Winning option ids under a tie rule (see module doc). */
  winners(rule: VoteTieRule = 'share', rng?: Rng): string[] {
    return pickWinners(this.tally(), rule, rng);
  }
}

/** Applies a tie rule to a tally (exported for games that tally themselves). */
export function pickWinners(tally: VoteTally, rule: VoteTieRule = 'share', rng?: Rng): string[] {
  const top = tally.options[0];
  if (!top || top.points <= 0) return [];
  const tied = tally.options.filter((o) => o.points === top.points && o.votes === top.votes).map((o) => o.optionId);
  if (tied.length === 1) return tied;
  switch (rule) {
    case 'share':
      return tied;
    case 'none':
      return [];
    case 'first':
      return [tied[0] as string];
    case 'random': {
      if (!rng) throw new Error("pickWinners: the 'random' tie rule needs an Rng");
      return [tied[rng.int(tied.length)] as string];
    }
  }
}
