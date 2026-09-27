/**
 * Small pure helpers for building `reportOutcome({ placements })` from a game's own standings.
 */

/**
 * Groups an already sorted (best first) list into placement groups: neighbours that `tied`
 * says are equal share a place.
 */
export function groupSorted<T>(sorted: readonly T[], idOf: (item: T) => string, tied: (a: T, b: T) => boolean): string[][] {
  const groups: string[][] = [];
  let prev: T | undefined;
  for (const item of sorted) {
    if (prev === undefined || !tied(prev, item)) groups.push([]);
    groups[groups.length - 1]!.push(idOf(item));
    prev = item;
  }
  return groups;
}

/**
 * Appends players who left mid-match (and aren't placed already) as one last group, so leaving
 * never dodges a result. Empty groups are dropped.
 */
export function withLeaversLast(placements: readonly string[][], leaverIds: Iterable<string>): string[][] {
  const placed = new Set(placements.flat());
  const leavers = [...new Set(leaverIds)].filter((id) => !placed.has(id));
  const out = placements.filter((g) => g.length > 0).map((g) => [...g]);
  if (leavers.length > 0) out.push(leavers);
  return out;
}
