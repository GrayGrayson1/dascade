/**
 * Swiss pairing — FIDE Dutch system, simplified and solved exactly with maximum-weight matching
 * (the approach used by modern pairing engines such as bbpPairings).
 *
 * Round 1: seed order, top half v bottom half (1 v N/2+1, 2 v N/2+2 …); colour of board 1 by lot,
 * then alternating down the boards. An odd player out (lowest seed) gets the bye.
 *
 * Later rounds: players are ranked by points, then seed. Every possible pair gets an integer weight
 * built from strictly tiered penalties, so the matching optimizes them lexicographically:
 *   1. maximum number of pairs (maxCardinality);
 *   2. no rematches (and no second bye) unless unavoidable;
 *   3. no pair of players who both MUST get the same side (3 in a row / imbalance > 1) unless unavoidable;
 *   4. minimal score differences (sum of squared point gaps) — players meet their own score group,
 *      and the bye goes to the lowest score group;
 *   5. side preferences honoured (strong preferences before mild ones);
 *   6. Dutch shape inside a score group (top half v bottom half), lowest-ranked player gets the bye.
 * Sides are then allocated: absolute > strong > mild preference; equal preferences → the higher
 * ranked player gets theirs; no history at all → lot.
 */
import type { Rng, TournamentSide } from '@dascade/shared';
import { maxWeightMatching, type WeightedEdge } from './matching.ts';

export interface SwissPlayer {
  id: string;
  /** Match points (halves allowed). */
  points: number;
  seed: number;
  opponents: readonly string[];
  byes: number;
  /** Side held in game 1 of each played match (oldest first). */
  sides: readonly TournamentSide[];
}

export interface SwissPair {
  /** Higher-ranked player. */
  a: string;
  b: string;
  /** Player with the `first` side (null when the game has no sides). */
  firstId: string | null;
}

export interface SwissPairing {
  pairs: SwissPair[];
  bye: string | null;
  /** Unavoidable compromises, for the audit log ("rematch", "same side three times"). */
  compromises: string[];
}

const C_DUTCH = 1;
const C_PREF = 2 ** 11;
const C_SCORE = 2 ** 18;
const C_COLOUR = 2 ** 34;
const C_REMATCH = 2 ** 40;
const BASE = 2 ** 46;
const DUTCH_CAP = 60;

export interface ColourPreference {
  want: TournamentSide | null;
  /** 3 absolute, 2 strong, 1 mild, 0 none. */
  strength: 0 | 1 | 2 | 3;
}

const opposite = (s: TournamentSide): TournamentSide => (s === 'first' ? 'second' : 'first');

export function colourPreference(sides: readonly TournamentSide[]): ColourPreference {
  if (sides.length === 0) return { want: null, strength: 0 };
  const firsts = sides.filter((s) => s === 'first').length;
  const diff = firsts - (sides.length - firsts);
  const last = sides[sides.length - 1]!;
  const last2 = sides.length >= 2 ? sides[sides.length - 2] : undefined;
  if (last === last2) return { want: opposite(last), strength: 3 };
  if (diff <= -2) return { want: 'first', strength: 3 };
  if (diff >= 2) return { want: 'second', strength: 3 };
  if (diff === -1) return { want: 'first', strength: 2 };
  if (diff === 1) return { want: 'second', strength: 2 };
  return { want: opposite(last), strength: 1 };
}

/** Rank for pairing purposes: points (desc), then seed (asc). */
export function pairingOrder(players: readonly SwissPlayer[]): SwissPlayer[] {
  return [...players].sort((x, y) => y.points - x.points || x.seed - y.seed);
}

export function pairSwissRound(players: readonly SwissPlayer[], round: number, opts: { sides: boolean; rng: Rng }): SwissPairing {
  if (players.length === 0) return { pairs: [], bye: null, compromises: [] };
  if (players.length === 1) return { pairs: [], bye: players[0]!.id, compromises: [] };
  const firstRound = round <= 1 && players.every((p) => p.opponents.length === 0 && p.byes === 0);
  return firstRound ? pairFirstRound(players, opts) : pairByMatching(players, opts);
}

function pairFirstRound(players: readonly SwissPlayer[], opts: { sides: boolean; rng: Rng }): SwissPairing {
  const bySeed = [...players].sort((x, y) => x.seed - y.seed);
  const bye = bySeed.length % 2 === 1 ? bySeed.pop()!.id : null;
  const half = bySeed.length / 2;
  const lot = opts.rng.int(2);
  const pairs: SwissPair[] = [];
  for (let i = 0; i < half; i++) {
    const a = bySeed[i]!;
    const b = bySeed[i + half]!;
    const topFirst = (i + lot) % 2 === 0;
    pairs.push({ a: a.id, b: b.id, firstId: opts.sides ? (topFirst ? a.id : b.id) : null });
  }
  return { pairs, bye, compromises: [] };
}

function pairByMatching(players: readonly SwissPlayer[], opts: { sides: boolean; rng: Rng }): SwissPairing {
  const ranked = pairingOrder(players);
  const n = ranked.length;
  const prefs = ranked.map((p) => (opts.sides ? colourPreference(p.sides) : { want: null, strength: 0 as const }));
  // Score groups (positions inside each group, in rank order).
  const groupPos: number[] = [];
  const groupSize: number[] = [];
  let start = 0;
  for (let i = 0; i <= n; i++) {
    if (i === n || ranked[i]!.points !== ranked[start]!.points) {
      for (let j = start; j < i; j++) {
        groupPos[j] = j - start;
        groupSize[j] = i - start;
      }
      start = i;
    }
  }
  const halfPoints = (p: SwissPlayer) => Math.round(p.points * 2);

  const edges: WeightedEdge[] = [];
  const penalties = new Map<string, { rematch: boolean; colour: boolean }>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pi = ranked[i]!;
      const pj = ranked[j]!;
      const rematch = pi.opponents.includes(pj.id);
      const ci = prefs[i]!;
      const cj = prefs[j]!;
      const colourClash = opts.sides && ci.strength === 3 && cj.strength === 3 && ci.want === cj.want;
      let prefCost = 0;
      if (opts.sides && ci.want && cj.want && ci.want === cj.want && !colourClash) prefCost = Math.min(2, Math.min(ci.strength, cj.strength));
      const d = Math.abs(halfPoints(pi) - halfPoints(pj));
      let dutch: number;
      if (d === 0) dutch = Math.abs(groupPos[j]! - groupPos[i]! - Math.floor(groupSize[i]! / 2));
      else dutch = groupSize[i]! - 1 - groupPos[i]! + groupPos[j]!;
      dutch = Math.min(DUTCH_CAP, dutch);
      const penalty = (rematch ? C_REMATCH : 0) + (colourClash ? C_COLOUR : 0) + d * d * C_SCORE + prefCost * C_PREF + dutch * C_DUTCH;
      edges.push([i, j, BASE - penalty]);
      penalties.set(`${i}-${j}`, { rematch, colour: colourClash });
    }
  }
  const dummy = n;
  if (n % 2 === 1) {
    for (let i = 0; i < n; i++) {
      const p = ranked[i]!;
      const penalty = (p.byes > 0 ? C_REMATCH : 0) + halfPoints(p) * 64 * C_SCORE + Math.min(DUTCH_CAP, n - 1 - i) * C_DUTCH;
      edges.push([i, dummy, BASE - penalty]);
    }
  }
  const mate = maxWeightMatching(edges, true);

  const pairs: SwissPair[] = [];
  const compromises: string[] = [];
  let bye: string | null = null;
  for (let i = 0; i < n; i++) {
    const j = mate[i] ?? -1;
    if (j === dummy) {
      bye = ranked[i]!.id;
      if (ranked[i]!.byes > 0) compromises.push(`${ranked[i]!.id} receives a second bye (no other pairing possible)`);
      continue;
    }
    if (j < 0) {
      // Cannot happen with a complete graph, but never drop a player silently.
      bye ??= ranked[i]!.id;
      continue;
    }
    if (j < i) continue;
    const flags = penalties.get(`${i}-${j}`)!;
    if (flags.rematch) compromises.push(`rematch ${ranked[i]!.id} v ${ranked[j]!.id} (unavoidable)`);
    if (flags.colour) compromises.push(`${ranked[i]!.id} v ${ranked[j]!.id}: one player repeats a side (unavoidable)`);
    pairs.push({ a: ranked[i]!.id, b: ranked[j]!.id, firstId: opts.sides ? allocateFirst(ranked[i]!, prefs[i]!, ranked[j]!, prefs[j]!, opts.rng) : null });
  }
  // Board order: best pair first.
  const rankIndex = new Map(ranked.map((p, i) => [p.id, i]));
  pairs.sort((x, y) => Math.min(rankIndex.get(x.a)!, rankIndex.get(x.b)!) - Math.min(rankIndex.get(y.a)!, rankIndex.get(y.b)!));
  return { pairs, bye, compromises };
}

/** a is the higher-ranked player. */
function allocateFirst(a: SwissPlayer, pa: ColourPreference, b: SwissPlayer, pb: ColourPreference, rng: Rng): string {
  if (pa.want && pb.want && pa.want !== pb.want) return pa.want === 'first' ? a.id : b.id;
  if (pa.want && !pb.want) return pa.want === 'first' ? a.id : b.id;
  if (pb.want && !pa.want) return pb.want === 'first' ? b.id : a.id;
  if (pa.want && pb.want) {
    // Same preference: the stronger one wins it; equal strength → the higher-ranked player.
    const winner = pb.strength > pa.strength ? { p: b, want: pb.want } : { p: a, want: pa.want };
    const other = winner.p === a ? b : a;
    return winner.want === 'first' ? winner.p.id : other.id;
  }
  return rng.int(2) === 0 ? a.id : b.id;
}
