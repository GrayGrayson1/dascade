/**
 * Bracket and schedule structures.
 *
 * Elimination brackets are a DAG of matches whose slots come from seeds or from the winner/loser
 * of earlier matches (`SlotSource`). Results are resolved into slots by the engine, so any change
 * (a result, a DQ, an override) re-derives the bracket instead of hand-editing it.
 *
 * - Single elimination: bracket size = next power of two; standard seeding (1 v P, 2 v P-1 … arranged
 *   so seeds 1 and 2 can only meet in the final); byes are the missing bottom seeds, so the top seeds
 *   get them.
 * - Double elimination: winners bracket + losers bracket with 2(k-1) rounds for P = 2^k. Odd losers
 *   rounds consolidate, even rounds take the drop-ins from the winners bracket; drop-in order is
 *   reversed / half-swapped on alternate rounds so players don't immediately meet again. Grand final:
 *   winners champion (slot a) v losers champion (slot b), plus an optional conditional reset.
 * - Round robin: circle method with Berger-table colours (each player's sides differ by at most one).
 */
import type { TournamentBracket } from '@dascade/shared';
import type { EngineMatch, SlotSource } from './types.ts';

export function bracketSize(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/** Seeds (1-based) in bracket position order, e.g. 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s) => [s, next + 1 - s]);
  }
  return order;
}

interface MatchInit {
  id: string;
  bracket: TournamentBracket;
  round: number;
  order: number;
  roundLabel: string;
  label: string;
  sources: [SlotSource | null, SlotSource | null];
  bestOf: number;
  requireWinner: boolean;
  conditional?: boolean;
  a?: string | null;
  b?: string | null;
}

export function newMatch(init: MatchInit): EngineMatch {
  return {
    id: init.id,
    bracket: init.bracket,
    round: init.round,
    order: init.order,
    label: init.label,
    roundLabel: init.roundLabel,
    sources: init.sources,
    a: init.a ?? null,
    b: init.b ?? null,
    status: 'WAITING',
    conditional: init.conditional ?? false,
    next: null,
    loserNext: null,
    bestOf: init.bestOf,
    requireWinner: init.requireWinner,
    firstId: null,
    games: [],
    winner: null,
    loser: null,
    draw: false,
    resultKind: null,
    resultNote: '',
    startedAt: 0,
    completedAt: 0,
  };
}

function matchLabel(roundLabel: string, order: number, count: number): string {
  return count > 1 ? `${roundLabel} · Match ${order + 1}` : roundLabel;
}

function eliminationRoundLabel(round: number, rounds: number, prefix: '' | 'Winners'): string {
  const fromEnd = rounds - round;
  const names = ['final', 'semifinal', 'quarterfinal'];
  if (prefix === '') {
    if (fromEnd < names.length) return capitalize(names[fromEnd]!);
    return `Round of ${2 ** (fromEnd + 1)}`;
  }
  if (fromEnd < names.length) return `Winners ${names[fromEnd]}`;
  return `Winners round ${round}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fill `next` / `loserNext` from the slot sources. */
export function linkMatches(matches: EngineMatch[]): EngineMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const m of matches) {
    m.sources.forEach((src, slot) => {
      if (!src || src.kind === 'seed') return;
      const from = byId.get(src.matchId);
      if (!from) throw new Error(`unknown source ${src.matchId}`);
      if (m.conditional) return; // the reset re-uses the grand final's pair; no connector
      if (src.kind === 'winner') from.next = { matchId: m.id, slot: slot as 0 | 1 };
      else from.loserNext = { matchId: m.id, slot: slot as 0 | 1 };
    });
  }
  return matches;
}

function winnersBracket(size: number, bestOf: number, prefix: '' | 'Winners'): EngineMatch[] {
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const matches: EngineMatch[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const roundLabel = eliminationRoundLabel(r, rounds, prefix);
    for (let i = 0; i < count; i++) {
      const sources: [SlotSource, SlotSource] =
        r === 1
          ? [
              { kind: 'seed', seed: order[2 * i]! },
              { kind: 'seed', seed: order[2 * i + 1]! },
            ]
          : [
              { kind: 'winner', matchId: `W${r - 1}-${2 * i + 1}` },
              { kind: 'winner', matchId: `W${r - 1}-${2 * i + 2}` },
            ];
      matches.push(
        newMatch({
          id: `W${r}-${i + 1}`,
          bracket: 'winners',
          round: r,
          order: i,
          roundLabel,
          label: matchLabel(roundLabel, i, count),
          sources,
          bestOf,
          requireWinner: true,
        }),
      );
    }
  }
  return matches;
}

export function buildSingleElimination(n: number, bestOf: number): EngineMatch[] {
  return linkMatches(winnersBracket(bracketSize(n), bestOf, ''));
}

/** Permutation of drop-in positions for losers round 2m (reverse on odd m, half swap on even m). */
function dropInIndex(i: number, count: number, m: number): number {
  if (count <= 1) return i;
  if (m % 2 === 1) return count - 1 - i;
  return (i + count / 2) % count;
}

export function buildDoubleElimination(n: number, bestOf: number, grandFinalReset: boolean): EngineMatch[] {
  const size = bracketSize(n);
  const k = Math.log2(size);
  const matches = winnersBracket(size, bestOf, 'Winners');
  const wbFinal = `W${k}-1`;
  const lbRounds = 2 * (k - 1);
  let lbCount = size / 4;
  for (let j = 1; j <= lbRounds; j++) {
    if (j > 1 && j % 2 === 1) lbCount /= 2;
    const roundLabel = j === lbRounds ? 'Losers final' : `Losers round ${j}`;
    for (let i = 0; i < lbCount; i++) {
      let sources: [SlotSource, SlotSource];
      if (j === 1) {
        sources = [
          { kind: 'loser', matchId: `W1-${2 * i + 1}` },
          { kind: 'loser', matchId: `W1-${2 * i + 2}` },
        ];
      } else if (j % 2 === 0) {
        const m = j / 2;
        sources = [
          { kind: 'winner', matchId: `L${j - 1}-${i + 1}` },
          { kind: 'loser', matchId: `W${m + 1}-${dropInIndex(i, lbCount, m) + 1}` },
        ];
      } else {
        sources = [
          { kind: 'winner', matchId: `L${j - 1}-${2 * i + 1}` },
          { kind: 'winner', matchId: `L${j - 1}-${2 * i + 2}` },
        ];
      }
      matches.push(
        newMatch({
          id: `L${j}-${i + 1}`,
          bracket: 'losers',
          round: j,
          order: i,
          roundLabel,
          label: matchLabel(roundLabel, i, lbCount),
          sources,
          bestOf,
          requireWinner: true,
        }),
      );
    }
  }
  const lbChampion: SlotSource = lbRounds > 0 ? { kind: 'winner', matchId: `L${lbRounds}-1` } : { kind: 'loser', matchId: wbFinal };
  matches.push(
    newMatch({
      id: 'GF',
      bracket: 'grand_final',
      round: 1,
      order: 0,
      roundLabel: 'Grand final',
      label: 'Grand final',
      sources: [{ kind: 'winner', matchId: wbFinal }, lbChampion],
      bestOf,
      requireWinner: true,
    }),
  );
  if (grandFinalReset) {
    matches.push(
      newMatch({
        id: 'GF2',
        bracket: 'grand_final_reset',
        round: 1,
        order: 0,
        roundLabel: 'Grand final reset',
        label: 'Grand final reset',
        sources: [
          { kind: 'winner', matchId: 'GF' },
          { kind: 'loser', matchId: 'GF' },
        ],
        bestOf,
        requireWinner: true,
        conditional: true,
      }),
    );
  }
  return linkMatches(matches);
}

export type RoundRobinPairing = { first: string; second: string } | { bye: string };

/**
 * Berger-table round robin. `ids` in seed order. Returns one list of pairings per round.
 * With an odd field every player sits out (bye) exactly once.
 */
export function roundRobinSchedule(ids: readonly string[]): RoundRobinPairing[][] {
  if (ids.length < 2) return [];
  const players: (string | null)[] = [...ids];
  if (players.length % 2 === 1) players.push(null);
  const n = players.length;
  const fixed = players[n - 1]!;
  const rotating = players.slice(0, n - 1);
  const rounds: RoundRobinPairing[][] = [];
  for (let r = 0; r < n - 1; r++) {
    const s = (r * (n / 2)) % (n - 1);
    const pairings: RoundRobinPairing[] = [];
    const push = (first: string | null, second: string | null) => {
      if (first && second) pairings.push({ first, second });
      else if (first) pairings.push({ bye: first });
      else if (second) pairings.push({ bye: second });
    };
    const p0 = rotating[s] ?? null;
    if (r % 2 === 0) push(p0, fixed);
    else push(fixed, p0);
    for (let b = 1; b < n / 2; b++) {
      push(rotating[(s + b) % (n - 1)] ?? null, rotating[(s - b + (n - 1)) % (n - 1)] ?? null);
    }
    // Byes last, boards in order.
    pairings.sort((x, y) => Number('bye' in x) - Number('bye' in y));
    rounds.push(pairings);
  }
  return rounds;
}
