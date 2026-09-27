/**
 * Team assignment and team scoring.
 *
 *  - assignTeams(): fresh random split — shuffle with the injected Rng, deal round-robin, so team
 *    sizes never differ by more than one.
 *  - balanceTeams(): keep existing assignments where possible; newcomers go to the smallest team
 *    (ties → earliest team in `teamIds`); then, while the largest team has 2+ more members than the
 *    smallest, move the most recently listed member of the largest team (the latest joiner) over.
 *  - teamTotals(): 'sum' adds member scores; 'average' is the rounded mean (fair for uneven teams).
 *    Empty teams score 0.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';

export type TeamAssignment = Map<string, string>;

export function assignTeams(playerIds: readonly string[], teamIds: readonly string[], rng: Rng): TeamAssignment {
  if (teamIds.length === 0) throw new RangeError('assignTeams needs at least one team');
  const order = shuffleInPlace([...playerIds], rng);
  // Rotate the starting team too, so team 1 isn't always the bigger one.
  const offset = rng.int(teamIds.length);
  const out: TeamAssignment = new Map();
  order.forEach((id, i) => out.set(id, teamIds[(i + offset) % teamIds.length] as string));
  return out;
}

export function teamSizes(
  assignment: ReadonlyMap<string, string>,
  teamIds: readonly string[],
  among?: readonly string[],
): Map<string, number> {
  const sizes = new Map(teamIds.map((t) => [t, 0]));
  const pool = among ?? [...assignment.keys()];
  for (const id of pool) {
    const t = assignment.get(id);
    if (t !== undefined && sizes.has(t)) sizes.set(t, (sizes.get(t) ?? 0) + 1);
  }
  return sizes;
}

/** The team with the fewest members among `among` (ties → earliest in teamIds). */
export function smallestTeam(assignment: ReadonlyMap<string, string>, teamIds: readonly string[], among?: readonly string[]): string {
  const sizes = teamSizes(assignment, teamIds, among);
  let best = teamIds[0] as string;
  for (const t of teamIds) if ((sizes.get(t) ?? 0) < (sizes.get(best) ?? 0)) best = t;
  return best;
}

/**
 * Rebalance for the current roster (`playerIds`, in join order). Keeps assignments that are still
 * valid, places newcomers, and evens out sizes (max − min ≤ 1). Returns a NEW map with exactly
 * the players in `playerIds`.
 */
export function balanceTeams(
  current: ReadonlyMap<string, string>,
  playerIds: readonly string[],
  teamIds: readonly string[],
): TeamAssignment {
  if (teamIds.length === 0) throw new RangeError('balanceTeams needs at least one team');
  const valid = new Set(teamIds);
  const out: TeamAssignment = new Map();
  for (const id of playerIds) {
    const t = current.get(id);
    if (t !== undefined && valid.has(t)) out.set(id, t);
  }
  for (const id of playerIds) {
    if (!out.has(id))
      out.set(
        id,
        smallestTeam(
          out,
          teamIds,
          playerIds.filter((p) => out.has(p)),
        ),
      );
  }
  for (let guard = 0; guard < playerIds.length; guard++) {
    const sizes = teamSizes(out, teamIds, playerIds);
    let big = teamIds[0] as string;
    let small = teamIds[0] as string;
    for (const t of teamIds) {
      if ((sizes.get(t) ?? 0) > (sizes.get(big) ?? 0)) big = t;
      if ((sizes.get(t) ?? 0) < (sizes.get(small) ?? 0)) small = t;
    }
    if ((sizes.get(big) ?? 0) - (sizes.get(small) ?? 0) <= 1) break;
    const mover = [...playerIds].reverse().find((p) => out.get(p) === big);
    if (!mover) break;
    out.set(mover, small);
  }
  return out;
}

export type TeamScoring = 'sum' | 'average';

export function teamTotals(
  scores: Readonly<Record<string, number>>,
  assignment: ReadonlyMap<string, string>,
  teamIds: readonly string[],
  mode: TeamScoring = 'sum',
): Record<string, number> {
  const sums = new Map(teamIds.map((t) => [t, 0]));
  const counts = new Map(teamIds.map((t) => [t, 0]));
  for (const [pid, tid] of assignment) {
    if (!sums.has(tid)) continue;
    sums.set(tid, (sums.get(tid) ?? 0) + (scores[pid] ?? 0));
    counts.set(tid, (counts.get(tid) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const t of teamIds) {
    const n = counts.get(t) ?? 0;
    out[t] = mode === 'average' ? (n > 0 ? Math.round((sums.get(t) ?? 0) / n) : 0) : (sums.get(t) ?? 0);
  }
  return out;
}
