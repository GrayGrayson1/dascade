/**
 * Day vote tally ("Disconnect vote").
 *
 * Rules (also shown in the in-game rules drawer):
 *  - Every online player may vote once for another online player (never themselves), or
 *    "Skip" when skipping is enabled. Votes are private until the reveal and can't be changed.
 *  - A Sudo vote counts twice (once per game, never on Skip).
 *  - Players who don't vote in time abstain; abstentions count for nothing.
 *  - The player with the most votes is disconnected — unless Skip has at least as many votes
 *    (Skip wins ties), or nobody voted for a player at all.
 *  - A tie between players: with the 'runoff' rule, one runoff vote between the tied players
 *    (a tie again → nobody is disconnected); with the 'none' rule, nobody is disconnected.
 */
import type { DeceptionVoteLine } from '@dascade/shared/games/deception';

export interface CastVote {
  target: string | 'skip';
  sudo: boolean;
}

export interface VoteInput {
  /** Players allowed to vote (online players). */
  voters: ReadonlySet<string>;
  /** Players who can be voted for (online players, or the runoff pair). */
  candidates: ReadonlySet<string>;
  votes: ReadonlyMap<string, CastVote>;
  allowSkip: boolean;
  tieRule: 'runoff' | 'none';
  /** This is already the runoff (a second tie means nobody is disconnected). */
  isRunoff: boolean;
}

export type VoteOutcomeKind = 'disconnected' | 'tie' | 'skipped' | 'no_votes' | 'runoff';

export interface VoteOutcome {
  outcome: VoteOutcomeKind;
  /** Disconnected player (outcome 'disconnected'). */
  playerId?: string;
  /** Tied players (outcomes 'tie' and 'runoff'). */
  tied?: string[];
  /** Counted votes in cast order (invalid and abstained votes excluded). */
  lines: DeceptionVoteLine[];
  /** Totals, highest first; ties ordered with players before Skip, then by id. */
  tally: Array<{ target: string | 'skip'; votes: number }>;
  abstained: number;
  /** A Sudo vote was counted. */
  sudo: boolean;
}

export function tallyVotes(input: VoteInput): VoteOutcome {
  const lines: DeceptionVoteLine[] = [];
  const totals = new Map<string, number>();
  let skip = 0;
  let sudo = false;
  for (const [voter, vote] of input.votes) {
    if (!input.voters.has(voter)) continue;
    if (vote.target === 'skip') {
      if (!input.allowSkip) continue;
      skip++;
      lines.push({ voterId: voter, target: 'skip', weight: 1 });
      continue;
    }
    if (vote.target === voter || !input.candidates.has(vote.target)) continue;
    const weight = vote.sudo ? 2 : 1;
    if (vote.sudo) sudo = true;
    totals.set(vote.target, (totals.get(vote.target) ?? 0) + weight);
    lines.push({ voterId: voter, target: vote.target, weight });
  }
  const abstained = [...input.voters].filter((v) => !lines.some((l) => l.voterId === v)).length;
  const tally: VoteOutcome['tally'] = [...totals].map(([target, votes]) => ({ target, votes }));
  if (skip > 0) tally.push({ target: 'skip', votes: skip });
  tally.sort((a, b) => b.votes - a.votes || Number(a.target === 'skip') - Number(b.target === 'skip') || (a.target < b.target ? -1 : 1));

  const base = { lines, tally, abstained, sudo };
  const top = totals.size ? Math.max(...totals.values()) : 0;
  if (top === 0) return { ...base, outcome: skip > 0 ? 'skipped' : 'no_votes' };
  if (skip >= top) return { ...base, outcome: 'skipped' };
  const tied = [...totals]
    .filter(([, n]) => n === top)
    .map(([id]) => id)
    .sort();
  if (tied.length === 1) return { ...base, outcome: 'disconnected', playerId: tied[0] as string };
  if (input.tieRule === 'runoff' && !input.isRunoff) return { ...base, outcome: 'runoff', tied };
  return { ...base, outcome: 'tie', tied };
}
