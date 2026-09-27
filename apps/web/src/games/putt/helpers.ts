/** Client-side presentation helpers (never decide anything: the server owns scores). */
import { formatToPar, type GolferView, type PuttPublicState } from '@dascade/shared/games/putt';
import { getHole, type HoleDef } from '@dascade/game-core/putt';

export interface Row {
  id: string;
  g: GolferView;
  toPar: number;
  thru: number;
}

export function holeAt(state: Pick<PuttPublicState, 'route'>, index: number): HoleDef | null {
  const n = state.route?.[index];
  if (!n) return null;
  try {
    return getHole(n);
  } catch {
    return null;
  }
}

export function currentHole(state: Pick<PuttPublicState, 'route' | 'holeIndex'>): HoleDef | null {
  return holeAt(state, Math.min(state.holeIndex, Math.max(0, (state.route?.length ?? 1) - 1)));
}

export function thruOf(g: GolferView, regulation: number): number {
  let n = 0;
  for (let i = 0; i < regulation; i++) if ((g.card?.[i] ?? 0) > 0) n++;
  return n;
}

/** Leaderboard order: to par over finished holes, then total, then play order; retired last. */
export function rows(state: PuttPublicState): Row[] {
  return Object.entries(state.golfers ?? {})
    .map(([id, g]) => ({ id, g, toPar: g.total - g.parPlayed, thru: thruOf(g, state.regulation) }))
    .sort((a, b) => Number(a.g.retired) - Number(b.g.retired) || a.toPar - b.toPar || a.g.total - b.g.total || a.g.order - b.g.order);
}

/** Final places (1-based, ties share) — winners (incl. playoff) come from the server. */
export function finalPlaces(state: PuttPublicState): Array<Row & { place: number }> {
  const list = rows(state);
  const winners = new Set(state.winners ?? []);
  list.sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)) || Number(a.g.retired) - Number(b.g.retired) || a.g.total - b.g.total || a.g.order - b.g.order);
  const out: Array<Row & { place: number }> = [];
  list.forEach((r, i) => {
    const prev = out[i - 1];
    const tie = prev && !r.g.retired && !prev.g.retired && winners.has(prev.id) === winners.has(r.id) && prev.g.total === r.g.total;
    out.push({ ...r, place: tie ? prev.place : i + 1 });
  });
  return out;
}

export { formatToPar };

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Tone class for a hole score relative to par (always paired with a text label). */
export function scoreTone(strokes: number, par: number): 'ace' | 'under' | 'par' | 'over' | 'none' {
  if (strokes <= 0) return 'none';
  if (strokes === 1) return 'ace';
  if (strokes < par) return 'under';
  if (strokes === par) return 'par';
  return 'over';
}
