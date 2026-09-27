/**
 * Party scoring helpers: bonuses, standings with ties, podium/placements, closest-number wins.
 * All pure and deterministic; results are integers.
 */

// ---------------------------------------------------------------------------
// Bonuses
// ---------------------------------------------------------------------------

/**
 * Linear speed bonus: `maxBonus` for an instant answer, falling to 0 at the end of the window.
 * Answers at/after the window (or negative inputs) get 0. Rounded to an integer.
 */
export function speedBonus(elapsedMs: number, windowMs: number, maxBonus: number): number {
  if (!(windowMs > 0) || !(maxBonus > 0) || !Number.isFinite(elapsedMs)) return 0;
  const left = 1 - Math.max(0, elapsedMs) / windowMs;
  if (left <= 0) return 0;
  return Math.round(maxBonus * Math.min(1, left));
}

/**
 * Streak bonus for the `streak`-th consecutive success (streak 1 = no bonus yet):
 * (streak − 1) × perStep, capped at `cap`.
 */
export function streakBonus(streak: number, perStep: number, cap: number): number {
  if (streak <= 1 || perStep <= 0) return 0;
  return Math.round(Math.min(cap, (Math.floor(streak) - 1) * perStep));
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface RankInput<T = unknown> {
  id: string;
  score: number;
  /** Secondary key when scores tie but you still want a stable display order (e.g. join order). Does NOT break place ties. */
  order?: number;
  item?: T;
}

export interface Standing<T = unknown> {
  id: string;
  score: number;
  /** Competition ranking ("1224"): tied scores share a place, the next place skips. */
  place: number;
  /** Shares its place with someone else. */
  tied: boolean;
  item: T | undefined;
}

/** Ranks entries by score (desc, or asc with lowerIsBetter). Ties share a place. */
export function rankStandings<T>(entries: readonly RankInput<T>[], opts: { lowerIsBetter?: boolean } = {}): Standing<T>[] {
  const dir = opts.lowerIsBetter ? 1 : -1;
  const sorted = [...entries].sort(
    (a, b) => dir * (a.score - b.score) || (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const out: Standing<T>[] = [];
  sorted.forEach((e, i) => {
    const prev = out[i - 1];
    const place = prev && prev.score === e.score ? prev.place : i + 1;
    out.push({ id: e.id, score: e.score, place, tied: false, item: e.item });
  });
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    s.tied = out[i - 1]?.place === s.place || out[i + 1]?.place === s.place;
  }
  return out;
}

/** Placement groups for `reportOutcome({ placements })`: ids grouped by place, best first. */
export function placementGroups(standings: readonly Pick<Standing, 'id' | 'place'>[]): string[][] {
  const groups: string[][] = [];
  let lastPlace = -1;
  for (const s of standings) {
    if (s.place !== lastPlace) {
      groups.push([]);
      lastPlace = s.place;
    }
    groups[groups.length - 1]!.push(s.id);
  }
  return groups;
}

/** Entries on the podium: everyone whose place ≤ `places` (ties included, so it may exceed `places`). */
export function podium<T>(standings: readonly Standing<T>[], places = 3): Standing<T>[] {
  return standings.filter((s) => s.place <= places);
}

/** Map of id → place (for prevRank/rank arrows). */
export function placesById(standings: readonly Pick<Standing, 'id' | 'place'>[]): Map<string, number> {
  return new Map(standings.map((s) => [s.id, s.place]));
}

/** Sum score deltas into a score table (returns a new object). Unknown ids start at 0. */
export function applyDeltas(scores: Readonly<Record<string, number>>, deltas: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...scores };
  for (const [id, d] of Object.entries(deltas)) out[id] = (out[id] ?? 0) + d;
  return out;
}

// ---------------------------------------------------------------------------
// Closest number
// ---------------------------------------------------------------------------

export interface NumberGuess {
  id: string;
  value: number;
}

export interface ClosestResult {
  /** Every guess at the minimum distance (ties share the win). Empty when there are no guesses. */
  winners: string[];
  /** The winning distance (Infinity with no guesses). */
  distance: number;
  /** All guesses with distance and competition rank (1 = closest). */
  ranked: Array<NumberGuess & { distance: number; rank: number; exact: boolean }>;
}

/**
 * Closest-number-wins. Fair tie handling: every guess at the minimum absolute distance wins —
 * whether over or under, and regardless of answer time. Non-finite guesses are ignored.
 * `epsilon` treats floating-point noise as equal (default 1e-9 × scale).
 */
export function closestWins(guesses: readonly NumberGuess[], target: number, opts: { epsilon?: number } = {}): ClosestResult {
  const valid = guesses.filter((g) => Number.isFinite(g.value));
  const eps = opts.epsilon ?? Math.max(1e-9, Math.abs(target) * 1e-12);
  const withDistance = valid.map((g) => ({ ...g, distance: Math.abs(g.value - target) }));
  withDistance.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
  const ranked: ClosestResult['ranked'] = [];
  withDistance.forEach((g, i) => {
    const prev = ranked[i - 1];
    const rank = prev && Math.abs(prev.distance - g.distance) <= eps ? prev.rank : i + 1;
    ranked.push({ ...g, rank, exact: g.distance <= eps });
  });
  const best = ranked[0];
  if (!best) return { winners: [], distance: Infinity, ranked };
  return { winners: ranked.filter((g) => g.rank === 1).map((g) => g.id), distance: best.distance, ranked };
}

/** Whether `value` lies within `share` (e.g. 0.1 = 10 %) of `target`. For a target of 0, within `share` absolute. */
export function withinShare(value: number, target: number, share: number): boolean {
  const scale = Math.abs(target) > 0 ? Math.abs(target) : 1;
  return Math.abs(value - target) <= scale * share + 1e-9;
}
