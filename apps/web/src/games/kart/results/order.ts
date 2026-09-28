/** Pure ordering helpers for results, podiums and Grand Prix standings (unit tested). */
import { KART_RACERS, type KartGpEntryView, type KartRacerId, type KartRacerView } from '@dascade/shared/games/kart';

export interface RacerRow {
  id: string;
  r: KartRacerView;
}

/** Finishers by finish order, then everyone else by race position; DNFs last. */
export function classify(racers: Record<string, KartRacerView>): RacerRow[] {
  return Object.entries(racers ?? {})
    .map(([id, r]) => ({ id, r }))
    .sort((a, b) => {
      const af = a.r.finishOrder > 0;
      const bf = b.r.finishOrder > 0;
      if (af && bf) return a.r.finishOrder - b.r.finishOrder;
      if (af !== bf) return af ? -1 : 1;
      if (a.r.dnf !== b.r.dnf) return a.r.dnf ? 1 : -1;
      return (a.r.position || 99) - (b.r.position || 99);
    });
}

export interface GpRow {
  id: string;
  e: KartGpEntryView;
  rank: number;
  /** Points scored in the latest round. */
  gained: number;
  /** Rank before the latest round (0 = not ranked then). */
  prevRank: number;
}

function cmpPlaces(a: number[], b: number[]): number {
  // Tie-break: more wins, then more 2nds, … (0 = DNF never counts).
  for (let place = 1; place <= 30; place++) {
    const ca = a.filter((p) => p === place).length;
    const cb = b.filter((p) => p === place).length;
    if (ca !== cb) return cb - ca;
  }
  return 0;
}

function rankRows(
  entries: Array<[string, KartGpEntryView]>,
  pointsOf: (e: KartGpEntryView) => number,
  placesOf: (e: KartGpEntryView) => number[],
): Map<string, number> {
  const sorted = [...entries].sort(
    (a, b) => pointsOf(b[1]) - pointsOf(a[1]) || cmpPlaces(placesOf(a[1]), placesOf(b[1])) || a[1].name.localeCompare(b[1].name),
  );
  const ranks = new Map<string, number>();
  let rank = 0;
  let prev: [string, KartGpEntryView] | null = null;
  sorted.forEach((row, i) => {
    if (!prev || pointsOf(prev[1]) !== pointsOf(row[1]) || cmpPlaces(placesOf(prev[1]), placesOf(row[1])) !== 0) rank = i + 1;
    ranks.set(row[0], rank);
    prev = row;
  });
  return ranks;
}

/**
 * Grand Prix standings after `round` races (1-based). `points` per place comes from the shared table.
 */
export function gpStandings(gp: Record<string, KartGpEntryView>, round: number, pointsTable: readonly number[]): GpRow[] {
  const entries = Object.entries(gp ?? {});
  const idx = Math.max(0, round - 1);
  const gainedOf = (e: KartGpEntryView) => {
    const place = e.places[idx] ?? 0;
    return place > 0 ? (pointsTable[place - 1] ?? 0) : 0;
  };
  const now = rankRows(
    entries,
    (e) => e.points,
    (e) => e.places.slice(0, idx + 1),
  );
  const before =
    round > 1
      ? rankRows(
          entries,
          (e) => e.points - gainedOf(e),
          (e) => e.places.slice(0, idx),
        )
      : new Map<string, number>();
  return entries
    .map(([id, e]) => ({ id, e, rank: now.get(id) ?? 0, gained: gainedOf(e), prevRank: before.get(id) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.e.name.localeCompare(b.e.name));
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;

/** Time-trial medal from the best lap vs the track's par lap. */
export function medalFor(bestLapMs: number, parLapMs: number): Medal {
  if (!bestLapMs || !parLapMs) return null;
  if (bestLapMs <= parLapMs) return 'gold';
  if (bestLapMs <= parLapMs * 1.07) return 'silver';
  if (bestLapMs <= parLapMs * 1.16) return 'bronze';
  return null;
}

/** Second line under a racer's name: the racer they drive, "CPU" for bots (never the name twice). */
export function racerSubtitle(name: string, racer: KartRacerId, bot: boolean): string {
  const racerName = KART_RACERS[racer]?.name ?? racer;
  if (bot) return racerName === name ? 'CPU' : `CPU · ${racerName}`;
  return racerName;
}
