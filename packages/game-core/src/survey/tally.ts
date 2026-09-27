/**
 * Anonymous tallies: votes → counts, shares, leaders and rank slots. Inputs are option indices
 * only (never player ids), so nothing here can leak who picked what.
 */
import { roundPercent, type SurveyRankSlot } from '@dascade/shared/games/survey';

/** Votes per option. Out-of-range votes are ignored (the room validates before recording). */
export function countVotes(votes: Iterable<number>, optionCount: number): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const v of votes) {
    if (Number.isInteger(v) && v >= 0 && v < optionCount) counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

/** Share per option in percent, rounded to one decimal. All zeros when nobody voted. */
export function sharePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.map((c) => (total > 0 ? roundPercent((c * 100) / total) : 0));
}

/**
 * The leading option(s). Several indices = a tie for the lead; every tied leader counts as
 * "the majority" for scoring. Empty when nobody voted.
 */
export function leaders(counts: readonly number[]): number[] {
  const max = Math.max(0, ...counts);
  if (max === 0) return [];
  return counts.flatMap((c, i) => (c === max ? [i] : []));
}

/**
 * Final ordering by votes (most first). Options with equal votes share a rank range lo..hi
 * (1-based, standard "tied for 2nd–3rd"); within a tie, the question's own order is kept for
 * display only — it never affects scoring.
 */
export function rankSlots(counts: readonly number[]): SurveyRankSlot[] {
  const order = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c || a.i - b.i);
  const slots: SurveyRankSlot[] = [];
  let pos = 0;
  while (pos < order.length) {
    let end = pos;
    while (end + 1 < order.length && order[end + 1]!.c === order[pos]!.c) end++;
    for (let k = pos; k <= end; k++) slots.push({ option: order[k]!.i, lo: pos + 1, hi: end + 1 });
    pos = end + 1;
  }
  return slots;
}

/** Top share and the margin to the runner-up (both in percent, one decimal). */
export function spread(counts: readonly number[]): { top: number; margin: number } {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return { top: 0, margin: 0 };
  const sorted = [...counts].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  return { top: roundPercent((top * 100) / total), margin: roundPercent(((top - second) * 100) / total) };
}
