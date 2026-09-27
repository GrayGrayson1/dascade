/**
 * DASterpiece scoring. Every rule here is documented in the in-game rules drawer.
 *
 * Per showdown (all points × the round multiplier):
 *  - Vote points: favourite / head-to-head: MP_POINTS.vote per player vote.
 *    Ranked: MP_POINTS.ranked[0..2] for a gold / silver / bronze pick.
 *  - Winner bonus (MP_POINTS.win): every answer tied for the most vote points (must be > 0).
 *  - Sweep bonus (MP_POINTS.sweep, "It's a DASterpiece!"): the answer got every player ballot that
 *    was allowed to pick it (as the gold pick in ranked), with at least MP_POINTS.sweepMinVotes.
 *  - Audience bonus (MP_POINTS.audience): the answer(s) with the most audience first picks (≥ 1).
 *    Audience ballots never add vote points, so a big crowd cannot outvote the players.
 *  - Walkover (MP_POINTS.walkover): an answer whose rivals never answered — no vote is held.
 */
import { MP_POINTS, type MpAward, type MpVoteKind } from '@dascade/shared/games/masterpiece';
import type { Ballot, BallotAnswer } from './ballots.ts';

export interface AnswerTally {
  id: string;
  authorId: string;
  /** Player ballots that picked this answer (any rank). */
  votes: number;
  /** Ranked: gold picks (favourite / head-to-head: same as votes). */
  firsts: number;
  /** Vote points before bonuses and multiplier. */
  votePoints: number;
  audienceVotes: number;
  winner: boolean;
  sweep: boolean;
  audiencePick: boolean;
  /** Total points awarded (with bonuses and multiplier). */
  points: number;
}

export function tallyShowdown(kind: MpVoteKind, answers: readonly BallotAnswer[], ballots: readonly Ballot[], multiplier = 1): AnswerTally[] {
  const tallies = new Map<string, AnswerTally>(
    answers.map((a) => [
      a.id,
      { id: a.id, authorId: a.authorId, votes: 0, firsts: 0, votePoints: 0, audienceVotes: 0, winner: false, sweep: false, audiencePick: false, points: 0 },
    ]),
  );
  const playerBallots = ballots.filter((b) => !b.audience);
  for (const ballot of ballots) {
    ballot.picks.forEach((pick, rank) => {
      const t = tallies.get(pick);
      if (!t || t.authorId === ballot.voterId) return; // never count a self-pick, whatever the caller did
      if (ballot.audience) {
        if (rank === 0) t.audienceVotes++;
        return;
      }
      t.votes++;
      if (rank === 0) t.firsts++;
      t.votePoints += kind === 'ranked' ? (MP_POINTS.ranked[rank] ?? 0) : rank === 0 ? MP_POINTS.vote : 0;
    });
  }
  const list = [...tallies.values()];
  const topPoints = Math.max(0, ...list.map((t) => t.votePoints));
  const topAudience = Math.max(0, ...list.map((t) => t.audienceVotes));
  for (const t of list) {
    t.winner = topPoints > 0 && t.votePoints === topPoints;
    const couldPick = playerBallots.filter((b) => b.voterId !== t.authorId).length;
    const sweepCount = kind === 'ranked' ? t.firsts : t.votes;
    t.sweep = couldPick >= MP_POINTS.sweepMinVotes && sweepCount === couldPick;
    t.audiencePick = topAudience > 0 && t.audienceVotes === topAudience;
    const raw = t.votePoints + (t.winner ? MP_POINTS.win : 0) + (t.sweep ? MP_POINTS.sweep : 0) + (t.audiencePick ? MP_POINTS.audience : 0);
    t.points = raw * multiplier;
  }
  return list;
}

export function walkoverPoints(multiplier = 1): number {
  return MP_POINTS.walkover * multiplier;
}

export interface WriterStats {
  id: string;
  name: string;
  joinOrder: number;
  votes: number;
  sweeps: number;
  audiencePicks: number;
  wins: number;
  /** Answers submitted and the total ms they took from the start of writing. */
  submitted: number;
  required: number;
  submitMs: number;
}

export function emptyStats(id: string, name: string, joinOrder: number): WriterStats {
  return { id, name, joinOrder, votes: 0, sweeps: 0, audiencePicks: 0, wins: 0, submitted: 0, required: 0, submitMs: 0 };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * End-of-match awards. Each needs a positive stat; ties go to the earlier joiner (deterministic).
 *  - crowd: most player votes received · sweeper: most sweeps · audience: most audience picks
 *  - consistent: most showdowns won · quick: fastest average answer (answered every prompt)
 */
export function computeAwards(stats: readonly WriterStats[]): MpAward[] {
  const awards: MpAward[] = [];
  const best = (value: (s: WriterStats) => number, lowest = false, eligible: (s: WriterStats) => boolean = () => true) =>
    stats
      .filter((s) => eligible(s) && value(s) > 0 && Number.isFinite(value(s)))
      .sort((a, b) => (lowest ? value(a) - value(b) : value(b) - value(a)) || a.joinOrder - b.joinOrder)[0];
  const crowd = best((s) => s.votes);
  if (crowd) awards.push({ id: 'crowd', playerId: crowd.id, name: crowd.name, value: plural(crowd.votes, 'vote') });
  const sweeper = best((s) => s.sweeps);
  if (sweeper) awards.push({ id: 'sweeper', playerId: sweeper.id, name: sweeper.name, value: plural(sweeper.sweeps, 'sweep') });
  const consistent = best((s) => s.wins);
  if (consistent) awards.push({ id: 'consistent', playerId: consistent.id, name: consistent.name, value: plural(consistent.wins, 'showdown') + ' won' });
  const audience = best((s) => s.audiencePicks);
  if (audience) awards.push({ id: 'audience', playerId: audience.id, name: audience.name, value: plural(audience.audiencePicks, 'audience pick') });
  const quick = best(
    (s) => (s.submitted > 0 ? s.submitMs / s.submitted : 0),
    true,
    (s) => s.required > 0 && s.submitted >= s.required,
  );
  if (quick) awards.push({ id: 'quick', playerId: quick.id, name: quick.name, value: `${(quick.submitMs / quick.submitted / 1000).toFixed(1)}s per answer` });
  return awards;
}
