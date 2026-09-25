import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import { cardToCode, createDeck } from '../cards/index.ts';
import {
  applyAction,
  cancelHand,
  chipsInPlay,
  collectedPots,
  dealNextStreet,
  exposedSeats,
  forceFold,
  legalActions,
  playerAt,
  resolveShowdown,
  startHand,
  totalPot,
  type ActionType,
  type HandState,
  type RevealPolicy,
} from './hand.ts';
import { clockwiseFromButton } from './pots.ts';

interface Spec {
  seat: number;
  stack: number;
}

interface Opts {
  button: number;
  sb?: number;
  bb?: number;
  tableSize?: number;
  holes?: Record<number, [string, string]>;
  board?: string[];
}

/** Stacks the deck so each seat gets the given hole cards and the board comes out as listed. */
function rigDeck(seats: number[], opts: Opts): string[] {
  const tableSize = opts.tableSize ?? 6;
  const order = clockwiseFromButton(seats, opts.button, tableSize);
  const used = new Set<string>([...Object.values(opts.holes ?? {}).flat(), ...(opts.board ?? [])]);
  const spare = createDeck()
    .map(cardToCode)
    .filter((c) => !used.has(c));
  const take = () => spare.shift()!;
  const deck: string[] = [];
  for (let round = 0; round < 2; round++) for (const seat of order) deck.push(opts.holes?.[seat]?.[round] ?? take());
  const board = opts.board ?? [];
  const b = (i: number) => board[i] ?? take();
  deck.push(take(), b(0), b(1), b(2), take(), b(3), take(), b(4));
  return [...deck, ...spare];
}

function deal(players: Spec[], opts: Opts, rng: Rng = createSeededRng('holdem-test')): HandState {
  const seats = players.map((p) => p.seat);
  return startHand(
    {
      handNumber: 1,
      tableSize: opts.tableSize ?? 6,
      button: opts.button,
      smallBlind: opts.sb ?? 50,
      bigBlind: opts.bb ?? 100,
      players: players.map((p) => ({ seat: p.seat, id: `id${p.seat}`, name: `P${p.seat}`, stack: p.stack })),
      deck: opts.holes || opts.board ? rigDeck(seats, opts) : undefined,
    },
    rng,
  );
}

function act(h: HandState, seat: number, type: ActionType, amount?: number) {
  const res = applyAction(h, seat, { type, amount });
  if (!res.ok) throw new Error(`Seat ${seat} ${type} ${amount ?? ''} rejected: ${res.message}`);
  return res;
}

function rejects(h: HandState, seat: number, type: ActionType, amount?: number) {
  const before = JSON.stringify(h);
  const res = applyAction(h, seat, { type, amount });
  expect(res.ok).toBe(false);
  expect(JSON.stringify(h)).toBe(before);
  return res as Extract<typeof res, { ok: false }>;
}

/** Deals remaining streets while nobody can bet, then resolves the showdown. */
function runOut(h: HandState, policy: RevealPolicy = 'all') {
  while (h.stage === 'street-complete') dealNextStreet(h);
  if (h.stage === 'showdown') resolveShowdown(h, policy);
}

/** Checks (or calls when facing a bet) around until the stage changes. */
function checkAround(h: HandState) {
  const street = h.street;
  while (h.stage === 'betting' && h.street === street) {
    const legal = legalActions(h, h.toAct)!;
    act(h, h.toAct, legal.canCheck ? 'check' : 'call');
  }
}

const stack = (h: HandState, seat: number) => playerAt(h, seat)!.stack;
const stacksTotal = (h: HandState) => h.players.reduce((s, p) => s + p.stack, 0);

// ---------------------------------------------------------------------------

describe('dealing and blinds', () => {
  it('posts blinds left of the button, deals two unique cards each and starts left of the big blind', () => {
    const h = deal(
      [0, 1, 2, 3].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    expect(h.sbSeat).toBe(1);
    expect(h.bbSeat).toBe(2);
    expect(stack(h, 1)).toBe(950);
    expect(stack(h, 2)).toBe(900);
    expect(h.currentBet).toBe(100);
    expect(h.toAct).toBe(3);
    const cards = h.players.flatMap((p) => p.hole);
    expect(cards).toHaveLength(8);
    expect(new Set(cards).size).toBe(8);
    expect(h.deck).toHaveLength(52 - 8);
    expect(new Set([...cards, ...h.deck]).size).toBe(52);
    expect(playerAt(h, 1)!.lastAction).toBe('sb');
    expect(playerAt(h, 2)!.lastAction).toBe('bb');
  });

  it('deals one card at a time starting left of the button', () => {
    const h = deal(
      [
        { seat: 1, stack: 500 },
        { seat: 3, stack: 500 },
        { seat: 4, stack: 500 },
      ],
      { button: 3, holes: { 4: ['As', 'Ks'], 1: ['Qd', 'Jd'], 3: ['2c', '7h'] } },
    );
    expect(playerAt(h, 4)!.hole).toEqual(['As', 'Ks']);
    expect(playerAt(h, 1)!.hole).toEqual(['Qd', 'Jd']);
    expect(playerAt(h, 3)!.hole).toEqual(['2c', '7h']);
  });

  it('wraps blinds around the table', () => {
    const h = deal(
      [
        { seat: 0, stack: 500 },
        { seat: 4, stack: 500 },
        { seat: 5, stack: 500 },
      ],
      { button: 4 },
    );
    expect(h.sbSeat).toBe(5);
    expect(h.bbSeat).toBe(0);
    expect(h.toAct).toBe(4);
  });

  it('heads-up: the button posts the small blind, acts first preflop and last after the flop', () => {
    const h = deal(
      [
        { seat: 2, stack: 1000 },
        { seat: 5, stack: 1000 },
      ],
      { button: 5 },
    );
    expect(h.sbSeat).toBe(5);
    expect(h.bbSeat).toBe(2);
    expect(h.toAct).toBe(5);
    act(h, 5, 'call');
    expect(h.toAct).toBe(2); // big blind option
    act(h, 2, 'check');
    expect(h.stage).toBe('street-complete');
    dealNextStreet(h);
    expect(h.street).toBe('flop');
    expect(h.toAct).toBe(2);
    act(h, 2, 'check');
    expect(h.toAct).toBe(5);
  });

  it('a short small blind posts what it has and is all-in; callers still owe the full big blind', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 30 },
        { seat: 2, stack: 1000 },
      ],
      { button: 0 },
    );
    expect(playerAt(h, 1)!.allIn).toBe(true);
    expect(playerAt(h, 1)!.bet).toBe(30);
    expect(h.toAct).toBe(0);
    expect(legalActions(h, 0)!.callAmount).toBe(100);
  });

  it('a short big blind is all-in, but the others must still call the full big blind', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
        { seat: 2, stack: 80 },
      ],
      { button: 0 },
    );
    expect(playerAt(h, 2)!.allIn).toBe(true);
    expect(h.currentBet).toBe(100);
    expect(legalActions(h, 0)).toMatchObject({ callAmount: 100, minRaiseTo: 200 });
    act(h, 0, 'call');
    act(h, 1, 'call');
    expect(h.stage).toBe('street-complete');
    expect(collectedPots(h)).toEqual([
      { amount: 240, eligible: [0, 1, 2] },
      { amount: 40, eligible: [0, 1] },
    ]);
  });

  it('heads-up with a big blind shorter than the small blind: nothing to decide, excess returned', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 30 },
      ],
      { button: 0 },
    );
    // Button/small blind already covers the 30 all-in.
    expect(h.stage).toBe('street-complete');
    expect(h.runout).toBe(true);
    expect(playerAt(h, 0)!.committed).toBe(30);
    expect(stack(h, 0)).toBe(970);
    expect(h.log.some((l) => l.text === 'Uncalled 20 returned to P0')).toBe(true);
  });

  it('heads-up with a big blind between the blinds: the small blind only has to call the all-in', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 80 },
      ],
      { button: 0 },
    );
    expect(h.toAct).toBe(0);
    expect(legalActions(h, 0)).toMatchObject({ canCall: true, callAmount: 30, canRaise: false });
    act(h, 0, 'call');
    expect(h.stage).toBe('street-complete');
    expect(totalPot(h)).toBe(160);
  });

  it('both blinds all-in from posting: the board runs out immediately', () => {
    const h = deal(
      [
        { seat: 0, stack: 40 },
        { seat: 1, stack: 60 },
      ],
      { button: 0 },
    );
    expect(h.stage).toBe('street-complete');
    expect(h.runout).toBe(true);
    runOut(h);
    expect(h.stage).toBe('complete');
    expect(stacksTotal(h)).toBe(100);
  });

  it('rejects impossible configurations', () => {
    const rng = createSeededRng(1);
    const base = { handNumber: 1, tableSize: 6, smallBlind: 50, bigBlind: 100 };
    expect(() => startHand({ ...base, button: 0, players: [{ seat: 0, id: 'a', name: 'a', stack: 100 }] }, rng)).toThrow();
    expect(() =>
      startHand({ ...base, button: 3, players: [{ seat: 0, id: 'a', name: 'a', stack: 100 }, { seat: 1, id: 'b', name: 'b', stack: 100 }] }, rng),
    ).toThrow(/button/);
    expect(() =>
      startHand({ ...base, button: 0, players: [{ seat: 0, id: 'a', name: 'a', stack: 100 }, { seat: 1, id: 'b', name: 'b', stack: 0 }] }, rng),
    ).toThrow(/chips/);
  });
});

describe('turn order and legality', () => {
  const four = () =>
    deal(
      [0, 1, 2, 3].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );

  it('rejects acting out of turn without changing anything', () => {
    const h = four();
    expect(rejects(h, 1, 'call').code).toBe('not_your_turn');
    expect(rejects(h, 5, 'fold').code).toBe('not_your_turn');
    expect(legalActions(h, 1)).toBeNull();
  });

  it('rejects checking into a bet and calling nothing', () => {
    const h = four();
    expect(rejects(h, 3, 'check').code).toBe('illegal_action');
    act(h, 3, 'call');
    act(h, 0, 'call');
    act(h, 1, 'call');
    // Big blind option: nothing to call.
    expect(rejects(h, 2, 'call').code).toBe('illegal_action');
    expect(legalActions(h, 2)).toMatchObject({ canCheck: true, canRaise: true, minRaiseTo: 200 });
  });

  it('gives the big blind the option to raise after limps', () => {
    const h = four();
    act(h, 3, 'call');
    act(h, 0, 'call');
    act(h, 1, 'call');
    expect(h.toAct).toBe(2);
    act(h, 2, 'raise', 300);
    expect(h.toAct).toBe(3);
    expect(legalActions(h, 3)).toMatchObject({ callAmount: 200, minRaiseTo: 500 });
  });

  it('enforces the minimum raise preflop and keeps the raise size as the new increment', () => {
    const h = four();
    expect(legalActions(h, 3)).toMatchObject({ minRaiseTo: 200, maxRaiseTo: 1000, isBet: false });
    expect(rejects(h, 3, 'raise', 199).code).toBe('bad_amount');
    act(h, 3, 'raise', 300); // raise of 200
    expect(h.minRaise).toBe(200);
    expect(legalActions(h, 0)!.minRaiseTo).toBe(500);
    expect(rejects(h, 0, 'raise', 450).code).toBe('bad_amount');
    act(h, 0, 'raise', 500);
    expect(legalActions(h, 1)!.minRaiseTo).toBe(700);
    act(h, 1, 'raise', 900); // raise of 400
    expect(legalActions(h, 2)!.minRaiseTo).toBe(1000); // capped by the stack (all-in)
  });

  it('rejects betting more chips than the stack', () => {
    const h = four();
    const res = rejects(h, 3, 'raise', 1001);
    expect(res.code).toBe('insufficient_chips');
    act(h, 3, 'raise', 1000);
    expect(playerAt(h, 3)!.allIn).toBe(true);
  });

  it('rejects a bet when facing a bet and a raise when nothing was bet', () => {
    const h = four();
    expect(rejects(h, 3, 'bet', 300).code).toBe('illegal_action');
    checkAround(h);
    dealNextStreet(h);
    expect(h.toAct).toBe(1);
    expect(legalActions(h, 1)).toMatchObject({ isBet: true, minRaiseTo: 100, canCheck: true });
    expect(rejects(h, 1, 'raise', 200).code).toBe('illegal_action');
    expect(rejects(h, 1, 'bet', 99).code).toBe('bad_amount');
    expect(rejects(h, 1, 'bet').code).toBe('bad_amount');
    act(h, 1, 'bet', 150);
    expect(legalActions(h, 2)!.minRaiseTo).toBe(300);
  });

  it('lets a player fold even when checking is free', () => {
    const h = four();
    checkAround(h);
    dealNextStreet(h);
    act(h, 1, 'fold');
    expect(playerAt(h, 1)!.folded).toBe(true);
  });

  it('all-in shortcut raises when raising is allowed, otherwise calls a bigger bet', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 300 },
        { seat: 2, stack: 5000 },
      ],
      { button: 0 },
    );
    act(h, 0, 'allin');
    expect(h.currentBet).toBe(1000);
    expect(playerAt(h, 0)!.lastAction).toBe('allin');
    const r = act(h, 1, 'allin'); // 300 total < 1000: an all-in call for less
    expect(r.amount).toBe(250);
    expect(playerAt(h, 1)!.allIn).toBe(true);
    // Big blind: only the 1,000 all-in left to match — no raise possible, all-in shortcut refused.
    expect(legalActions(h, 2)).toMatchObject({ canRaise: false, callAmount: 900 });
    expect(rejects(h, 2, 'allin').code).toBe('illegal_action');
    act(h, 2, 'call');
    expect(h.runout).toBe(true);
  });

  it('a short-stack call puts in everything and creates a side pot', () => {
    const h = deal(
      [
        { seat: 0, stack: 2000 },
        { seat: 1, stack: 2000 },
        { seat: 2, stack: 2000 },
        { seat: 3, stack: 250 },
      ],
      { button: 0 },
    );
    act(h, 3, 'call');
    act(h, 0, 'raise', 600);
    expect(legalActions(h, 1)!.callAmount).toBe(550);
    act(h, 1, 'call');
    act(h, 2, 'call');
    expect(legalActions(h, 3)).toMatchObject({ callAmount: 150, canRaise: false });
    act(h, 3, 'call');
    expect(playerAt(h, 3)!.allIn).toBe(true);
    expect(h.stage).toBe('street-complete');
    expect(collectedPots(h)).toEqual([
      { amount: 1000, eligible: [0, 1, 2, 3] },
      { amount: 1050, eligible: [0, 1, 2] },
    ]);
  });
});

describe('minimum raise and reopening rules', () => {
  it('a short all-in raise does not reopen betting for players who already acted', () => {
    // Blinds 50/100. P3 raises to 300 (full raise of 200). P0 short all-in to 400 (+100 only).
    const h = deal(
      [
        { seat: 0, stack: 400 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 5000 },
        { seat: 3, stack: 5000 },
      ],
      { button: 1 },
    );
    expect(h.toAct).toBe(0); // button 1 → SB 2, BB 3, UTG 0
    act(h, 0, 'call');
    act(h, 1, 'raise', 300);
    act(h, 2, 'call');
    act(h, 3, 'call');
    // Back to P0 who is facing a raise; P0 moves all-in for 400 total: a short raise (+100 < 200).
    act(h, 0, 'allin');
    expect(h.currentBet).toBe(400);
    expect(h.minRaise).toBe(200);
    // P1, P2, P3 all acted already: they may only call or fold.
    expect(legalActions(h, 1)).toMatchObject({ canCall: true, callAmount: 100, canRaise: false });
    expect(rejects(h, 1, 'raise', 600).code).toBe('illegal_action');
    act(h, 1, 'call');
    expect(legalActions(h, 2)!.canRaise).toBe(false);
    act(h, 2, 'call');
    act(h, 3, 'call');
    expect(h.stage).toBe('street-complete');
  });

  it('a short all-in raise still lets players who have not acted raise, from the new bet', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 5000 },
        { seat: 3, stack: 250 },
      ],
      { button: 0 },
    );
    // UTG (seat 3) shoves 250: +150 over the big blind is a full raise? No: min raise is 100, so 250 IS full (150 ≥ 100).
    act(h, 3, 'allin');
    expect(h.minRaise).toBe(150);
    expect(legalActions(h, 0)!.minRaiseTo).toBe(400);
  });

  it('several short all-ins that add up to a full raise reopen the betting', () => {
    // Postflop: P1 bets 100, P2 all-in 150 (+50), P3 all-in 200 (+50 → +100 total = full). P1 may re-raise.
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 250 },
        { seat: 3, stack: 300 },
      ],
      { button: 0 },
    );
    checkAround(h);
    dealNextStreet(h);
    expect(h.toAct).toBe(1);
    act(h, 1, 'bet', 100);
    act(h, 2, 'allin'); // 150 total
    expect(h.minRaise).toBe(100);
    act(h, 3, 'allin'); // 200 total
    expect(h.currentBet).toBe(200);
    expect(h.minRaise).toBe(100);
    act(h, 0, 'call');
    expect(legalActions(h, 1)).toMatchObject({ canRaise: true, callAmount: 100, minRaiseTo: 300 });
  });

  it('a single short all-in over a bet leaves the original bettor call-or-fold', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 250 },
      ],
      { button: 0 },
    );
    checkAround(h);
    dealNextStreet(h);
    act(h, 1, 'bet', 100);
    act(h, 2, 'allin'); // 150 total: +50
    act(h, 0, 'call'); // hasn't acted yet this street: may raise, but calls
    expect(legalActions(h, 1)).toMatchObject({ canRaise: false, callAmount: 50 });
  });

  it('an all-in bet smaller than the big blind is allowed; the next raise is at least a big blind more', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 140 },
        { seat: 2, stack: 5000 },
      ],
      { button: 0 },
    );
    checkAround(h);
    dealNextStreet(h);
    expect(h.toAct).toBe(1);
    expect(legalActions(h, 1)).toMatchObject({ isBet: true, minRaiseTo: 40, maxRaiseTo: 40 });
    act(h, 1, 'bet', 40);
    expect(playerAt(h, 1)!.allIn).toBe(true);
    expect(legalActions(h, 2)).toMatchObject({ callAmount: 40, minRaiseTo: 140 });
  });

  it('no raising when every opponent is all-in', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 500 },
      ],
      { button: 0 },
    );
    act(h, 0, 'fold');
    act(h, 1, 'allin');
    expect(legalActions(h, 2)).toMatchObject({ canRaise: false, callAmount: 400 });
    act(h, 2, 'call');
    expect(h.runout).toBe(true);
    // The small blind's unmatched chips come back.
    expect(playerAt(h, 1)!.committed).toBe(500);
    expect(stack(h, 1)).toBe(4500);
  });
});

describe('hand endings and settlement', () => {
  it('everyone folds: the last player wins uncontested and the uncalled raise is returned', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    act(h, 0, 'raise', 300);
    act(h, 1, 'fold');
    act(h, 2, 'fold');
    expect(h.stage).toBe('complete');
    expect(h.result).toMatchObject({ uncontested: true, winners: [{ seat: 0, amount: 250 }] });
    expect(stack(h, 0)).toBe(1150);
    expect(stack(h, 1)).toBe(950);
    expect(stack(h, 2)).toBe(900);
    expect(stacksTotal(h)).toBe(3000);
    expect(exposedSeats(h)).toEqual([]);
  });

  it('plays a full hand to showdown with the best hand winning', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      {
        button: 0,
        holes: { 0: ['Ah', 'Kh'], 1: ['Qc', 'Qd'], 2: ['7s', '2d'] },
        board: ['Kd', '9h', '4c', '8s', '3h'],
      },
    );
    act(h, 0, 'raise', 300);
    act(h, 1, 'call');
    act(h, 2, 'fold');
    dealNextStreet(h);
    expect(h.board).toEqual(['Kd', '9h', '4c']);
    expect(h.toAct).toBe(1);
    act(h, 1, 'check');
    act(h, 0, 'bet', 400);
    act(h, 1, 'call');
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    expect(h.board).toHaveLength(5);
    expect(h.burned).toHaveLength(3);
    checkAround(h);
    expect(h.stage).toBe('showdown');
    const result = resolveShowdown(h);
    expect(result.winners).toEqual([{ seat: 0, potIndex: 0, amount: 1500, description: 'Pair of Kings', bestCards: ['Kh', 'Kd', 'Ah', '9h', '8s'] }]);
    expect(stack(h, 0)).toBe(1800);
    expect(stack(h, 1)).toBe(300);
    expect(stack(h, 2)).toBe(900);
    // Nobody bet the river: the first live seat left of the button shows first.
    expect(result.shown.map((s) => s.seat)).toEqual([1, 0]);
  });

  it('splits a tied pot when the board plays', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 2, holes: { 0: ['2c', '3d'], 1: ['4h', '2s'], 2: ['9c', '9d'] }, board: ['As', 'Ks', 'Qd', 'Jh', 'Tc'] },
    );
    // Button 2 → SB 0, BB 1.
    act(h, 2, 'fold');
    act(h, 0, 'call');
    act(h, 1, 'check');
    for (let i = 0; i < 3; i++) {
      dealNextStreet(h);
      checkAround(h);
    }
    const result = resolveShowdown(h);
    expect(result.awards[0]!.winners).toEqual([0, 1]);
    expect(result.winners.map((w) => [w.seat, w.amount])).toEqual([
      [0, 100],
      [1, 100],
    ]);
    expect(result.winners[0]!.description).toBe('Straight, Ace-high');
    expect(stacksTotal(h)).toBe(3000);
  });

  it('odd chip from dead money goes to the winner closest to the left of the button', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
        { seat: 2, stack: 1000 },
        { seat: 3, stack: 1000 },
      ],
      {
        button: 1,
        sb: 5,
        bb: 10,
        tableSize: 4,
        holes: { 0: ['2c', '3d'], 3: ['4h', '2s'], 1: ['9c', '8d'], 2: ['7c', '6d'] },
        board: ['As', 'Ks', 'Qd', 'Jh', 'Tc'],
      },
    );
    // Button 1 → SB 2 (5), BB 3 (10), UTG 0.
    act(h, 0, 'call');
    act(h, 1, 'call');
    act(h, 2, 'fold'); // 5 dead chips
    act(h, 3, 'check');
    dealNextStreet(h);
    act(h, 3, 'check');
    act(h, 0, 'check');
    act(h, 1, 'bet', 10);
    act(h, 3, 'call');
    act(h, 0, 'call');
    dealNextStreet(h);
    act(h, 3, 'check');
    act(h, 0, 'check');
    act(h, 1, 'bet', 20);
    act(h, 3, 'call');
    act(h, 0, 'call');
    dealNextStreet(h);
    act(h, 3, 'check');
    act(h, 0, 'check');
    act(h, 1, 'check');
    // Pot: 5 + 3×10 + 3×10 + 3×20 = 125. Everyone plays the board's broadway straight: three-way split 42/42/41.
    const result = resolveShowdown(h);
    expect(result.awards[0]!.amount).toBe(125);
    expect(result.awards[0]!.winners).toEqual([0, 1, 3]);
    // Clockwise from button 1: seat 3 first (seat 2 folded), then 0, then 1 (the button) last.
    expect(result.awards[0]!.shares).toEqual([
      { seat: 3, amount: 42 },
      { seat: 0, amount: 42 },
      { seat: 1, amount: 41 },
    ]);
    expect(stacksTotal(h)).toBe(4000);
  });

  it('multi-way all-in: main pot and side pots go to the right players', () => {
    // Short (seat 1, 200) has the nuts, middle (seat 2, 600) second best, big (seat 3, 2000) worst, seat 0 folds.
    const h = deal(
      [
        { seat: 0, stack: 2000 },
        { seat: 1, stack: 200 },
        { seat: 2, stack: 600 },
        { seat: 3, stack: 2000 },
      ],
      {
        button: 0,
        holes: { 1: ['As', 'Ad'], 2: ['Ks', 'Kd'], 3: ['Qs', 'Qd'], 0: ['7c', '2h'] },
        board: ['Ac', 'Kh', '9d', '5s', '3c'],
      },
    );
    // Button 0 → SB 1, BB 2, UTG 3.
    act(h, 3, 'raise', 2000);
    act(h, 0, 'fold');
    act(h, 1, 'allin');
    act(h, 2, 'allin');
    expect(h.runout).toBe(true);
    expect(exposedSeats(h).sort()).toEqual([1, 2, 3]);
    // Seat 3's unmatched 1,400 is returned before the runout.
    expect(playerAt(h, 3)!.committed).toBe(600);
    expect(collectedPots(h)).toEqual([
      { amount: 600, eligible: [1, 2, 3] },
      { amount: 800, eligible: [2, 3] },
    ]);
    runOut(h);
    const result = h.result!;
    expect(result.awards.map((a) => [a.amount, a.winners])).toEqual([
      [600, [1]],
      [800, [2]],
    ]);
    expect(stack(h, 1)).toBe(600);
    expect(stack(h, 2)).toBe(800);
    expect(stack(h, 3)).toBe(1400);
    expect(stack(h, 0)).toBe(2000);
    expect(stacksTotal(h)).toBe(4800);
    expect(result.winners.find((w) => w.seat === 1)!.description).toBe('Three of a Kind, Aces');
  });

  it('a folded contributor is excluded from awards even with the best cards', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      {
        button: 0,
        holes: { 0: ['As', 'Ah'], 1: ['7c', '2d'], 2: ['8c', '3d'] },
        board: ['Ad', 'Ac', 'Kh', '9s', '4h'],
      },
    );
    act(h, 0, 'call');
    act(h, 1, 'call');
    act(h, 2, 'check');
    dealNextStreet(h);
    act(h, 1, 'bet', 200);
    act(h, 2, 'call');
    act(h, 0, 'fold'); // folds quads!
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    checkAround(h);
    const result = resolveShowdown(h);
    expect(result.winners.map((w) => w.seat)).toEqual([2]);
    expect(result.shown.map((s) => s.seat)).not.toContain(0);
    expect(stack(h, 0)).toBe(900);
    expect(stack(h, 2)).toBe(1000 - 300 + 700);
  });

  it('reveal policy: "winners" mucks the losing hand, "all" tables it', () => {
    const play = (policy: RevealPolicy) => {
      const h = deal(
        [
          { seat: 0, stack: 1000 },
          { seat: 1, stack: 1000 },
        ],
        { button: 0, holes: { 0: ['As', 'Ks'], 1: ['7c', '8d'] }, board: ['Ad', '9c', '5h', '4s', '3d'] },
      );
      act(h, 0, 'call');
      act(h, 1, 'check');
      for (let i = 0; i < 3; i++) {
        dealNextStreet(h);
        checkAround(h);
      }
      return resolveShowdown(h, policy);
    };
    const winnersOnly = play('winners');
    expect(winnersOnly.shown.map((s) => s.seat)).toEqual([0]);
    expect(winnersOnly.mucked).toEqual([1]);
    const all = play('all');
    expect(all.shown.map((s) => s.seat).sort()).toEqual([0, 1]);
    expect(all.mucked).toEqual([]);
  });

  it('all-in hands are always tabled, whatever the reveal policy', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
      { button: 0, holes: { 0: ['As', 'Ks'], 1: ['7c', '8d'] }, board: ['Ad', '9c', '5h', '4s', '3d'] },
    );
    act(h, 0, 'allin');
    act(h, 1, 'call');
    runOut(h, 'winners');
    expect(h.result!.shown.map((s) => s.seat).sort()).toEqual([0, 1]);
  });

  it('the last river aggressor shows first', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0, holes: { 0: ['2s', '3s'], 1: ['Kc', 'Kd'], 2: ['Qc', 'Qd'] }, board: ['Ad', '9c', '5h', '4s', '7d'] },
    );
    checkAround(h);
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    act(h, 1, 'check');
    act(h, 2, 'bet', 100);
    act(h, 0, 'call');
    act(h, 1, 'call');
    const result = resolveShowdown(h);
    expect(result.shown.map((s) => s.seat)).toEqual([2, 0, 1]);
  });

  it('names the deciding kicker in the winner description', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
      { button: 0, holes: { 0: ['Ac', 'Qd'], 1: ['As', 'Jd'] }, board: ['Ah', '9c', '5h', '4s', '2d'] },
    );
    act(h, 0, 'call');
    act(h, 1, 'check');
    for (let i = 0; i < 3; i++) {
      dealNextStreet(h);
      checkAround(h);
    }
    const result = resolveShowdown(h);
    expect(result.winners[0]).toMatchObject({ seat: 0, description: 'Pair of Aces (Queen kicker)' });
  });

  it('returns an uncalled postflop bet when the caller is short', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 500 },
      ],
      { button: 0 },
    );
    act(h, 0, 'call');
    act(h, 1, 'check');
    dealNextStreet(h);
    act(h, 1, 'check');
    act(h, 0, 'bet', 2000);
    act(h, 1, 'call'); // all-in for 400
    expect(playerAt(h, 0)!.committed).toBe(500);
    expect(stack(h, 0)).toBe(4500);
    expect(playerAt(h, 0)!.allIn).toBe(false);
    expect(h.log.some((l) => l.text === 'Uncalled 1,600 returned to P0')).toBe(true);
  });

  it('a partly called shove is no longer shown as all-in once the excess is returned', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 800 },
      ],
      { button: 0 },
    );
    act(h, 0, 'allin');
    act(h, 1, 'call');
    const p0 = playerAt(h, 0)!;
    expect(p0.allIn).toBe(false);
    expect(p0.stack).toBe(4200);
    expect(p0.lastAction).toBe('raise');
    expect(p0.lastAmount).toBe(800);
    expect(playerAt(h, 1)!.lastAction).toBe('allin');
  });

  it('the public log never contains hole cards before the showdown', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    act(h, 0, 'raise', 250);
    act(h, 1, 'call');
    act(h, 2, 'call');
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    checkAround(h);
    dealNextStreet(h);
    const hole = h.players.flatMap((p) => p.hole);
    const text = h.log.map((l) => l.text).join('\n');
    for (const card of hole) expect(text).not.toContain(card);
    checkAround(h);
    resolveShowdown(h);
    const after = h.log.map((l) => l.text).join('\n');
    expect(after).toContain(h.players[0]!.hole[0]!);
  });
});

describe('leaving mid-hand (forceFold)', () => {
  it('folding out of turn keeps the action moving and the chips in the pot', () => {
    const h = deal(
      [0, 1, 2, 3].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    act(h, 3, 'call');
    expect(h.toAct).toBe(0);
    expect(forceFold(h, 2)).toBe(true); // big blind leaves
    expect(h.toAct).toBe(0);
    act(h, 0, 'call');
    act(h, 1, 'call');
    expect(h.stage).toBe('street-complete');
    expect(totalPot(h)).toBe(400);
    expect(collectedPots(h)).toEqual([{ amount: 400, eligible: [0, 1, 3] }]);
  });

  it('the player to act leaving is a normal fold', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    expect(forceFold(h, 0)).toBe(true);
    expect(h.toAct).toBe(1);
  });

  it('when the last opponent leaves, the remaining player wins', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 1000 },
      ],
      { button: 0 },
    );
    act(h, 0, 'raise', 400);
    forceFold(h, 0); // raiser leaves while the big blind is thinking
    expect(h.stage).toBe('complete');
    expect(h.result!.winners[0]).toMatchObject({ seat: 1, amount: 500 });
    expect(stack(h, 1)).toBe(1400);
    // The leaver's chips in the pot are lost; their stack behind leaves with them.
    expect(stack(h, 0)).toBe(600);
  });

  it('an all-in player leaving during the runout forfeits; the rest still show down', () => {
    const h = deal(
      [
        { seat: 0, stack: 1000 },
        { seat: 1, stack: 300 },
        { seat: 2, stack: 300 },
      ],
      { button: 0 },
    );
    act(h, 0, 'raise', 1000);
    act(h, 1, 'allin');
    act(h, 2, 'allin');
    expect(h.stage).toBe('street-complete');
    forceFold(h, 1);
    expect(h.stage).toBe('street-complete');
    runOut(h);
    expect(h.result!.uncontested).toBe(false);
    expect(h.result!.awards.reduce((s, a) => s + a.amount, 0)).toBe(900);
    expect(stacksTotal(h)).toBe(1600 - 0);
  });

  it('a big bettor leaving leaves only the all-in amount to call', () => {
    const h = deal(
      [
        { seat: 0, stack: 5000 },
        { seat: 1, stack: 5000 },
        { seat: 2, stack: 300 },
      ],
      { button: 0 },
    );
    act(h, 0, 'call');
    act(h, 1, 'call');
    act(h, 2, 'check');
    dealNextStreet(h);
    act(h, 1, 'bet', 900);
    act(h, 2, 'allin'); // 200 behind
    expect(h.toAct).toBe(0);
    forceFold(h, 1);
    expect(h.toAct).toBe(0);
    expect(legalActions(h, 0)).toMatchObject({ callAmount: 200, canRaise: false });
    act(h, 0, 'call');
    runOut(h);
    // P1's 900 stays in as dead money: total pot 300 + 900 + 200 + 200.
    expect(h.result!.awards.reduce((s, a) => s + a.amount, 0)).toBe(1600);
  });

  it('forceFold is a no-op for unknown or already folded seats', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    expect(forceFold(h, 5)).toBe(false);
    act(h, 0, 'fold');
    expect(forceFold(h, 0)).toBe(false);
  });
});

describe('cancelHand', () => {
  it('returns every committed chip', () => {
    const h = deal(
      [0, 1, 2].map((seat) => ({ seat, stack: 1000 })),
      { button: 0 },
    );
    act(h, 0, 'raise', 600);
    act(h, 1, 'call');
    cancelHand(h);
    expect(h.stage).toBe('complete');
    expect(h.players.map((p) => p.stack)).toEqual([1000, 1000, 1000]);
  });
});

// ---------------------------------------------------------------------------
// Randomized play: thousands of hands with random legal (and illegal) actions.
// ---------------------------------------------------------------------------

describe('randomized hands (chip conservation and rule invariants)', () => {
  it('never creates or loses chips and always terminates', () => {
    const rng = createSeededRng('fuzz-holdem');
    for (let n = 0; n < 1500; n++) {
      const tableSize = 2 + rng.int(9);
      const count = 2 + rng.int(tableSize - 1);
      const seats = [...Array(tableSize).keys()].sort(() => rng.next() - 0.5).slice(0, count).sort((a, b) => a - b);
      const bb = [2, 10, 100][rng.int(3)]!;
      const players = seats.map((seat) => ({ seat, stack: 1 + rng.int(bb * 60) }));
      const before = players.reduce((s, p) => s + p.stack, 0);
      const h = startHand(
        {
          handNumber: n,
          tableSize,
          button: seats[rng.int(seats.length)]!,
          smallBlind: Math.max(1, bb / 2),
          bigBlind: bb,
          players: players.map((p) => ({ ...p, id: `id${p.seat}`, name: `P${p.seat}` })),
        },
        rng,
      );
      const all = [...h.players.flatMap((p) => p.hole), ...h.deck];
      expect(new Set(all).size).toBe(52);

      for (let steps = 0; h.stage !== 'complete'; steps++) {
        expect(steps).toBeLessThan(400);
        expect(chipsInPlay(h)).toBe(before);
        if (h.stage === 'street-complete') {
          dealNextStreet(h);
          continue;
        }
        if (h.stage === 'showdown') {
          resolveShowdown(h, rng.next() < 0.5 ? 'all' : 'winners');
          continue;
        }
        if (rng.next() < 0.02) {
          const victim = h.players[rng.int(h.players.length)]!;
          forceFold(h, victim.seat);
          continue;
        }
        const seat = h.toAct;
        const legal = legalActions(h, seat)!;
        expect(legal).not.toBeNull();
        // Occasionally try something illegal: it must be refused without side effects.
        if (rng.next() < 0.15) {
          const other = h.players.find((p) => p.seat !== seat && !p.folded);
          if (other) expect(applyAction(h, other.seat, { type: 'call' }).ok).toBe(false);
          if (legal.canRaise) {
            expect(applyAction(h, seat, { type: legal.isBet ? 'bet' : 'raise', amount: legal.maxRaiseTo + 1 }).ok).toBe(false);
            if (legal.minRaiseTo > h.currentBet + 1 && legal.minRaiseTo < legal.maxRaiseTo) {
              expect(applyAction(h, seat, { type: legal.isBet ? 'bet' : 'raise', amount: legal.minRaiseTo - 1 }).ok).toBe(false);
            }
          }
          if (!legal.canCheck) expect(applyAction(h, seat, { type: 'check' }).ok).toBe(false);
        }
        const roll = rng.next();
        const p = playerAt(h, seat)!;
        const prevBet = h.currentBet;
        const prevMin = h.minRaise;
        if (roll < 0.12) act(h, seat, 'fold');
        else if (roll < 0.25 && legal.canRaise) {
          const to = legal.minRaiseTo + rng.int(legal.maxRaiseTo - legal.minRaiseTo + 1);
          act(h, seat, legal.isBet ? 'bet' : 'raise', to);
          // Raises are full raises unless the player is all-in.
          if (!p.allIn) expect(to - prevBet).toBeGreaterThanOrEqual(prevMin);
        } else if (roll < 0.3) {
          const r = applyAction(h, seat, { type: 'allin' });
          if (!r.ok) act(h, seat, legal.canCheck ? 'check' : 'call');
        } else act(h, seat, legal.canCheck ? 'check' : 'call');
        for (const q of h.players) {
          expect(q.stack).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(q.stack)).toBe(true);
        }
      }
      const after = h.players.reduce((s, p) => s + p.stack, 0);
      expect(after).toBe(before);
      const won = h.result!.payouts.reduce((s, x) => s + x.amount, 0);
      const inPot = h.players.reduce((s, p) => s + p.committed, 0);
      expect(won).toBe(inPot);
      for (const w of h.result!.payouts) expect(playerAt(h, w.seat)!.folded).toBe(false);
      if (!h.result!.uncontested) {
        expect(h.board).toHaveLength(5);
        expect(new Set([...h.board, ...h.burned, ...h.players.flatMap((p) => p.hole), ...h.deck]).size).toBe(52);
      }
    }
  });
});
