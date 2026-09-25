/**
 * Party voting.
 *
 * Tally rule (documented for players in the help text):
 *  1. Votes are tallied when every connected player has voted (after a short lock-in),
 *     when the vote timer ends, or when the host presses "Decide now".
 *     Votes from spectators, disconnected players or for unavailable choices never count.
 *  2. The choice with the most votes wins.
 *  3. Ties, in 'auto' mode: the tied choice with the best party odds wins (a choice with
 *     no check counts as 100%); if the odds are equal, the party leader's (host's) vote
 *     decides; otherwise the server flips a coin (crypto RNG).
 *     In 'host' mode the leader's vote decides first; if the leader did not vote for one
 *     of the tied choices, the host is asked to pick (and the auto rule applies if they
 *     don't answer in time).
 *  4. If nobody votes at all, the 'auto' rule runs across every available choice.
 * The rule that decided is always announced in the log as "Tie broken by …".
 */
import type { Rng } from '@dascade/shared';

export interface VoteOption {
  choiceId: string;
  /** Party success odds (1 when the choice has no check). */
  odds: number;
}

export type TieRule = 'majority' | 'odds' | 'leader' | 'random' | 'host';

export interface TallyInput {
  options: readonly VoteOption[];
  /** voterId → choiceId (only eligible voters should be passed in). */
  votes: Readonly<Record<string, string>>;
  leaderVote?: string | null;
  mode: 'auto' | 'host';
  rng: Rng;
}

export interface TallyResult {
  counts: Record<string, number>;
  /** Total valid votes. */
  total: number;
  topCount: number;
  tied: string[];
  winner: string | null;
  rule: TieRule | null;
  /** Odds of the winning option when decided by odds. */
  odds?: number;
  /** 'host' mode tie that needs the host to pick among `tied`. */
  needsHost: boolean;
  noVotes: boolean;
}

const EPS = 1e-9;

export function countVotes(options: readonly VoteOption[], votes: Readonly<Record<string, string>>): { counts: Record<string, number>; total: number } {
  const counts: Record<string, number> = {};
  for (const o of options) counts[o.choiceId] = 0;
  let total = 0;
  for (const choiceId of Object.values(votes)) {
    if (counts[choiceId] === undefined) continue;
    counts[choiceId] += 1;
    total += 1;
  }
  return { counts, total };
}

/** The automatic tie-break chain: best odds → leader's vote → random. */
export function breakTieAuto(
  tied: readonly string[],
  options: readonly VoteOption[],
  leaderVote: string | null | undefined,
  rng: Rng,
): { winner: string; rule: TieRule; odds?: number } {
  if (tied.length === 1) return { winner: tied[0] as string, rule: 'majority' };
  const oddsOf = (id: string) => options.find((o) => o.choiceId === id)?.odds ?? 0;
  const best = Math.max(...tied.map(oddsOf));
  const byOdds = tied.filter((id) => Math.abs(oddsOf(id) - best) < EPS);
  if (byOdds.length === 1) return { winner: byOdds[0] as string, rule: 'odds', odds: best };
  if (leaderVote && byOdds.includes(leaderVote)) return { winner: leaderVote, rule: 'leader' };
  return { winner: byOdds[rng.int(byOdds.length)] as string, rule: 'random' };
}

export function tallyVotes(input: TallyInput): TallyResult {
  const { options, votes, leaderVote, mode, rng } = input;
  const { counts, total } = countVotes(options, votes);
  const topCount = Math.max(0, ...Object.values(counts));
  const tied = options.map((o) => o.choiceId).filter((id) => counts[id] === topCount);
  const base = { counts, total, topCount, tied, noVotes: total === 0 };
  if (options.length === 0) return { ...base, winner: null, rule: null, needsHost: false };
  if (tied.length === 1) return { ...base, winner: tied[0] as string, rule: 'majority', needsHost: false };

  const validLeader = leaderVote && counts[leaderVote] !== undefined ? leaderVote : null;
  if (mode === 'host' && total > 0) {
    if (validLeader && tied.includes(validLeader)) return { ...base, winner: validLeader, rule: 'leader', needsHost: false };
    return { ...base, winner: null, rule: null, needsHost: true };
  }
  const auto = breakTieAuto(tied, options, validLeader, rng);
  return { ...base, winner: auto.winner, rule: auto.rule, odds: auto.odds, needsHost: false };
}

export function tieRuleText(rule: TieRule | null, odds?: number): string | undefined {
  switch (rule) {
    case 'odds':
      return `Tie broken by best odds (${Math.round((odds ?? 0) * 100)}%)`;
    case 'leader':
      return "Tie broken by the leader's vote";
    case 'random':
      return 'Tie broken by a server coin flip';
    case 'host':
      return 'Tie broken by the host';
    default:
      return undefined;
  }
}
