/**
 * Independent cross-checks for the Hold'em engine: a second, differently built
 * seven-card evaluator, and multi-way pot/odd-chip/button scenarios written from
 * the rulebook rather than from the implementation.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng, shuffleInPlace } from '@dascade/shared';
import { cardToCode, createDeck, parseCard } from '../cards/index.ts';
import { compareHands, evaluateBest, HandCategory } from './evaluator.ts';
import { applyAction, dealNextStreet, legalActions, playerAt, resolveShowdown, startHand, type HandState } from './hand.ts';
import { buildPots, settlePots } from './pots.ts';
import { blindSeats, moveButton } from './table.ts';

/** Reference evaluator: works on all seven cards at once (no 5-card combinations). */
function reference(codes: string[]): number[] {
  const cards = codes.map(parseCard);
  const bySuit = new Map<string, number[]>();
  const counts = new Map<number, number>();
  for (const c of cards) {
    bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c.rank]);
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const straightHigh = (ranks: number[]): number => {
    const set = new Set(ranks);
    if (set.has(14)) set.add(1);
    for (let hi = 14; hi >= 5; hi--) {
      let ok = true;
      for (let r = hi; r > hi - 5; r--) if (!set.has(r)) ok = false;
      if (ok) return hi;
    }
    return 0;
  };
  const desc = (xs: number[]) => [...xs].sort((a, b) => b - a);
  const flushSuit = [...bySuit.entries()].find(([, rs]) => rs.length >= 5);
  if (flushSuit) {
    const sf = straightHigh(flushSuit[1]);
    if (sf) return [8, sf];
  }
  const ranksBy = (n: number) => desc([...counts.entries()].filter(([, c]) => c >= n).map(([r]) => r));
  const quads = ranksBy(4);
  if (quads.length) {
    const q = quads[0]!;
    return [7, q, desc(cards.map((c) => c.rank).filter((r) => r !== q))[0]!];
  }
  const trips = ranksBy(3);
  if (trips.length) {
    const t = trips[0]!;
    const pairFor = desc([...counts.entries()].filter(([r, c]) => r !== t && c >= 2).map(([r]) => r));
    if (pairFor.length) return [6, t, pairFor[0]!];
  }
  if (flushSuit) return [5, ...desc(flushSuit[1]).slice(0, 5)];
  const st = straightHigh(cards.map((c) => c.rank));
  if (st) return [4, st];
  const all = desc(cards.map((c) => c.rank));
  if (trips.length) {
    const t = trips[0]!;
    return [3, t, ...all.filter((r) => r !== t).slice(0, 2)];
  }
  const pairs = ranksBy(2);
  if (pairs.length >= 2) {
    const [a, b] = pairs as [number, number];
    return [2, a, b, all.filter((r) => r !== a && r !== b)[0]!];
  }
  if (pairs.length === 1) {
    const p = pairs[0]!;
    return [1, p, ...all.filter((r) => r !== p).slice(0, 3)];
  }
  return [0, ...all.slice(0, 5)];
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

describe('evaluator vs an independent reference', () => {
  it('agrees on category and on every head-to-head result for 40,000 random boards', () => {
    const rng = createSeededRng('ref-eval');
    const deck = createDeck().map(cardToCode);
    for (let n = 0; n < 40_000; n++) {
      shuffleInPlace(deck, rng);
      const board = deck.slice(0, 5);
      const a = [deck[5]!, deck[6]!, ...board];
      const b = [deck[7]!, deck[8]!, ...board];
      const ea = evaluateBest(a);
      const eb = evaluateBest(b);
      const ra = reference(a);
      const rb = reference(b);
      expect(ea.category).toBe(ra[0]);
      expect(Math.sign(compareHands(ea, eb))).toBe(cmp(ra, rb));
    }
  });

  it('handles the classic traps', () => {
    const ev = (s: string) => evaluateBest(s.split(' '));
    // Steel wheel beats a six-high straight but loses to a 6-high straight flush.
    expect(ev('5s 4s 3s 2s As Kd Qd').category).toBe(HandCategory.StraightFlush);
    expect(compareHands(ev('5s 4s 3s 2s As Kd Qd'), ev('6h 5d 4c 3s 2h Kd Qd'))).toBeGreaterThan(0);
    expect(compareHands(ev('5s 4s 3s 2s As Kd Qd'), ev('6s 5s 4s 3s 2s Kd Qd'))).toBeLessThan(0);
    // Two trips make the best full house; three pairs keep the best kicker (the third pair's rank counts).
    expect(ev('Ks Kd Kc 7s 7d 7c 2h').description).toBe('Full House, Kings over Sevens');
    expect(ev('As Ad Kc Kd Qs Qd 2h').ranks).toEqual([14, 13, 12]);
    // Counterfeited two pair: board pairs beat the hole pair, the kicker decides.
    expect(compareHands(ev('3s 3d Ks Kd Qh Qc 9s'), ev('Ah 2c Ks Kd Qh Qc 9s'))).toBeLessThan(0);
    // Board plays for both: exact tie.
    expect(compareHands(ev('2s 3d As Ks Qs Js Ts'), ev('4h 5c As Ks Qs Js Ts'))).toBe(0);
    // Flush vs flush: the sixth suited card never plays.
    expect(compareHands(ev('2s 3d Ks Qs 9s 7s 5s'), ev('4s 3c Ks Qs 9s 7s 5s'))).toBe(0);
    expect(compareHands(ev('6s 3d Ks Qs 9s 7s 5s'), ev('4s 3c Ks Qs 9s 7s 5s'))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

function rigged(stacks: Record<number, number>, button: number, holes: Record<number, [string, string]>, board: string[], tableSize = 6): HandState {
  const seats = Object.keys(stacks).map(Number).sort((a, b) => a - b);
  const order = [...seats].sort((a, b) => ((a - button - 1 + tableSize) % tableSize) - ((b - button - 1 + tableSize) % tableSize));
  const used = new Set([...Object.values(holes).flat(), ...board]);
  const spare = createDeck().map(cardToCode).filter((c) => !used.has(c));
  const deck: string[] = [];
  for (let r = 0; r < 2; r++) for (const s of order) deck.push(holes[s]?.[r] ?? spare.shift()!);
  deck.push(spare.shift()!, board[0]!, board[1]!, board[2]!, spare.shift()!, board[3]!, spare.shift()!, board[4]!, ...spare);
  return startHand(
    {
      handNumber: 1,
      tableSize,
      button,
      smallBlind: 50,
      bigBlind: 100,
      players: seats.map((seat) => ({ seat, id: `p${seat}`, name: `P${seat}`, stack: stacks[seat]! })),
      deck,
    },
    createSeededRng('unused'),
  );
}

function play(h: HandState, seat: number, type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin', amount?: number) {
  const r = applyAction(h, seat, { type, amount });
  if (!r.ok) throw new Error(`${seat} ${type}: ${r.message}`);
}

function finish(h: HandState) {
  while (h.stage === 'street-complete') dealNextStreet(h);
  if (h.stage === 'showdown') resolveShowdown(h, 'all');
}

describe('multi-way all-ins (rulebook scenarios)', () => {
  it('four stacks, three all-in levels: every side pot goes to the best eligible hand', () => {
    // Seat 1 (500) has the nuts, seat 2 (1500) second best, seat 3 (3000) third, seat 0 (5000) worst.
    const h = rigged(
      { 0: 5000, 1: 500, 2: 1500, 3: 3000 },
      0,
      { 1: ['As', 'Ad'], 2: ['Ks', 'Kd'], 3: ['Qs', 'Qd'], 0: ['7c', '2d'] },
      ['Ah', 'Kh', 'Qc', '9s', '4d'],
    );
    // Blinds: 1 = SB, 2 = BB; seat 3 acts first.
    play(h, 3, 'allin'); // 3000
    play(h, 0, 'call'); // 3000
    play(h, 1, 'allin'); // 500
    play(h, 2, 'allin'); // 1500
    expect(h.runout).toBe(true);
    finish(h);
    const stacks = h.players.map((p) => [p.seat, p.stack]);
    // Main 4 x 500 = 2000 → seat 1. Side 1: 3 x 1000 = 3000 → seat 2. Side 2: 2 x 1500 = 3000 → seat 3.
    expect(Object.fromEntries(stacks)).toEqual({ 0: 2000, 1: 2000, 2: 3000, 3: 3000 });
    expect(h.result!.awards.map((a) => [a.amount, a.winners])).toEqual([
      [2000, [1]],
      [3000, [2]],
      [3000, [3]],
    ]);
  });

  it('a folded big contributor funds the side pots but can never win them', () => {
    // Seat 0 raises big then folds to a shove; its chips are dead money in the pots it reached.
    const h = rigged({ 0: 5000, 1: 800, 2: 5000 }, 0, { 0: ['As', 'Ad'], 1: ['2c', '3d'], 2: ['Kc', 'Kd'] }, ['7h', '8h', 'Jc', '9s', '4d']);
    play(h, 0, 'raise', 600);
    play(h, 1, 'allin'); // 800 (short: does not reopen for seat 0... seat 0 hasn't faced a full raise)
    play(h, 2, 'raise', 2000);
    play(h, 0, 'fold');
    finish(h);
    // Seat 1 has the worst hand; seat 2 (kings) wins everything. Seat 0 folded aces and gets nothing.
    expect(playerAt(h, 0)!.stack).toBe(4400);
    expect(playerAt(h, 1)!.stack).toBe(0);
    expect(playerAt(h, 2)!.stack).toBe(5000 + 600 + 800);
    expect(h.result!.awards.every((a) => !a.winners.includes(0))).toBe(true);
  });

  it('odd chips of a three-way split go one each, clockwise from the left of the button', () => {
    const pots = buildPots([
      { seat: 0, amount: 101, folded: false },
      { seat: 2, amount: 101, folded: false },
      { seat: 4, amount: 101, folded: false },
      { seat: 5, amount: 1, folded: true },
    ]);
    const awards = settlePots(pots, new Map([[0, 9], [2, 9], [4, 9]]), 2, 6);
    const shares = Object.fromEntries(awards[0]!.shares.map((s) => [s.seat, s.amount]));
    // 304 / 3 = 101 r1: the first winner left of the button (seat 4) gets the odd chip.
    expect(shares).toEqual({ 4: 102, 0: 101, 2: 101 });
  });

  it('an all-in for less than the big blind preflop still lets the others limp for a full big blind', () => {
    const h = rigged({ 0: 5000, 1: 5000, 2: 40 }, 0, {}, ['2c', '7d', '9h', 'Js', 'Kd']);
    // 1 = SB, 2 = BB short all-in for 40. Seat 0 must call the full 100, raise at least to 200.
    expect(legalActions(h, 0)).toMatchObject({ callAmount: 100, canRaise: true, minRaiseTo: 200 });
    play(h, 0, 'call');
    expect(legalActions(h, 1)).toMatchObject({ callAmount: 50, canCheck: false });
    play(h, 1, 'call');
    // Everyone has matched; the flop comes out with seat 1 and seat 0 still able to bet.
    expect(h.stage).toBe('street-complete');
    expect(h.runout).toBe(false);
  });
});

describe('showdown reveal with an all-in and a side pot still being bet', () => {
  it('every live hand is tabled (TDA 16) even under the "winners" policy', () => {
    // Seat 1 is all-in preflop for 300; seats 0 and 2 keep betting the side pot and check it down.
    const h = rigged({ 0: 5000, 1: 300, 2: 5000 }, 0, { 0: ['Kc', 'Kd'], 1: ['7c', '2d'], 2: ['Qc', 'Qd'] }, ['Ah', '8h', '5c', '9s', '4d']);
    play(h, 0, 'raise', 300);
    play(h, 1, 'allin');
    play(h, 2, 'call');
    expect(h.runout).toBe(false);
    while (h.stage !== 'showdown') {
      if (h.stage === 'street-complete') dealNextStreet(h);
      else play(h, h.toAct, 'check');
    }
    resolveShowdown(h, 'winners');
    // Seat 0 wins both pots; seat 1 (all-in) and seat 2 lost but may not muck.
    expect(h.result!.shown.map((s) => s.seat).sort()).toEqual([0, 1, 2]);
    expect(h.result!.mucked).toEqual([]);
  });

  it('without an all-in, the "winners" policy still mucks losing hands', () => {
    const h = rigged({ 0: 5000, 1: 5000 }, 0, { 0: ['Kc', 'Kd'], 1: ['7c', '2d'] }, ['Ah', '8h', '5c', '9s', '4d']);
    play(h, 0, 'call');
    play(h, 1, 'check');
    while (h.stage !== 'showdown') {
      if (h.stage === 'street-complete') dealNextStreet(h);
      else play(h, h.toAct, 'check');
    }
    resolveShowdown(h, 'winners');
    expect(h.result!.shown.map((s) => s.seat)).toEqual([0]);
    expect(h.result!.mucked).toEqual([1]);
  });
});

describe('button and blinds across busts', () => {
  it('the button always moves forward to a dealt seat and heads-up the button posts the small blind', () => {
    const rng = createSeededRng('button');
    let button = moveButton(-1, [1, 3, 5], 6, rng);
    const seen: number[] = [button];
    for (let i = 0; i < 5; i++) {
      button = moveButton(button, [1, 3, 5], 6, rng);
      seen.push(button);
    }
    // Round robin over the dealt seats.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe([1, 3, 5][([1, 3, 5].indexOf(seen[i - 1]!) + 1) % 3]);
    // Seat 3 busts: the button moves on from wherever it was, and heads-up the button is the small blind.
    const next = moveButton(3, [1, 5], 6, rng);
    expect(next).toBe(5);
    expect(blindSeats(next, [1, 5], 6)).toEqual({ sb: 5, bb: 1 });
  });
});
