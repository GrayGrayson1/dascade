import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { cardToCode, parseCard, type Card } from '../cards/index.ts';
import {
  BlackjackRound,
  DEFAULT_TABLE_RULES,
  Shoe,
  handValue,
  type BlackjackAction,
  type CardSource,
  type RoundEntry,
  type TableRules,
} from './index.ts';

/** Deals exactly these cards in order and fails loudly if the round needs more. */
function stacked(codes: string[]): CardSource & { left: () => number } {
  let i = 0;
  return {
    draw() {
      const code = codes[i++];
      if (!code) throw new Error('stacked shoe exhausted');
      return parseCard(code);
    },
    left: () => codes.length - i,
  };
}

const codes = (cards: Card[]) => cards.map(cardToCode);

/**
 * Build a dealt round. Deal order: each seat's first card, dealer up, each seat's
 * second card, dealer hole — then the draws.
 */
function setup(opts: { rules?: Partial<TableRules>; entries?: RoundEntry[]; deal: string[]; draws?: string[] }) {
  const entries = opts.entries ?? [{ id: 'p1', balance: 1000, bet: 10 }];
  const source = stacked([...opts.deal, ...(opts.draws ?? [])]);
  const round = new BlackjackRound({ ...DEFAULT_TABLE_RULES, ...opts.rules }, source, entries);
  const steps = round.deal();
  return { round, source, steps, seat: (id = 'p1') => round.seat(id)! };
}

function play(round: BlackjackRound, id: string, ...moves: Array<[number, BlackjackAction]>) {
  for (const [hand, action] of moves) {
    const res = round.act(id, hand, action);
    if (!res.ok) throw new Error(`${action} on hand ${hand} failed: ${res.message}`);
  }
}

function finish(round: BlackjackRound) {
  expect(round.stage).toBe('dealer');
  round.playDealer();
  return round.settle();
}

describe('dealing', () => {
  it('deals two passes from first base with the dealer up card first and a hidden hole card', () => {
    const { round, steps } = setup({
      entries: [
        { id: 'a', balance: 100, bet: 10 },
        { id: 'b', balance: 100, bet: 20 },
      ],
      deal: ['2s', '3s', '4s', '5s', '6s', '7s'],
    });
    expect(steps.map((s) => (s.to === 'seat' ? s.id : s.hole ? 'hole' : 'up'))).toEqual(['a', 'b', 'up', 'a', 'b', 'hole']);
    const hole = steps[5]!;
    expect(hole.to === 'dealer' && hole.card).toBeNull();
    expect(codes(round.seat('a')!.hands[0]!.cards)).toEqual(['2s', '5s']);
    expect(codes(round.seat('b')!.hands[0]!.cards)).toEqual(['3s', '6s']);
    expect(codes(round.visibleDealerCards())).toEqual(['4s']);
    expect(round.seat('a')!.balance).toBe(90);
    expect(round.seat('b')!.balance).toBe(80);
  });

  it('rejects bets the player cannot cover', () => {
    expect(() => new BlackjackRound(DEFAULT_TABLE_RULES, stacked([]), [{ id: 'x', balance: 5, bet: 10 }])).toThrow();
    expect(() => new BlackjackRound(DEFAULT_TABLE_RULES, stacked([]), [{ id: 'x', balance: 5, bet: 0 }])).toThrow();
    expect(() => new BlackjackRound(DEFAULT_TABLE_RULES, stacked([]), [])).toThrow();
  });
});

describe('naturals', () => {
  it('pays a player blackjack 3:2 and the dealer does not draw', () => {
    const { round, seat } = setup({ deal: ['As', '9h', 'Kd', '6c'] });
    expect(round.resolvePeek()).toEqual({ peeked: false, dealerBlackjack: false });
    expect(seat().hands[0]!.status).toBe('blackjack');
    expect(seat().done).toBe(true);
    const outcome = round.playDealer();
    expect(outcome.draws).toEqual([]); // nobody left to beat: 15 stands as is
    const s = round.settle();
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'blackjack', payout: 25, net: 15 });
    expect(seat().balance).toBe(1015);
  });

  it('pays 6:5 and 1:1 tables and rounds fractional payouts down', () => {
    for (const [payout, bet, net] of [
      ['6:5', 10, 12],
      ['6:5', 7, 8],
      ['1:1', 10, 10],
      ['3:2', 5, 7],
    ] as const) {
      const { round, seat } = setup({ rules: { blackjackPayout: payout }, entries: [{ id: 'p1', balance: 100, bet }], deal: ['As', '9h', 'Kd', '6c'] });
      round.resolvePeek();
      const s = finish(round);
      expect(s.seats[0]!.net).toBe(net);
      expect(seat().balance).toBe(100 + net);
    }
  });

  it('counts only a two-card 21 as blackjack — three-card 21 pays even money', () => {
    const { round } = setup({ deal: ['7s', '9h', '4d', '8c'], draws: ['Td'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'hit']);
    expect(round.seat('p1')!.hands[0]).toMatchObject({ status: 'stood' });
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'win', net: 10 });
  });
});

describe('dealer natural', () => {
  it('peeks under an Ace, reveals blackjack and takes non-natural hands before anyone acts', () => {
    const { round, seat } = setup({ deal: ['9s', 'Ah', '8d', 'Kc'] });
    expect(round.stage).toBe('insurance');
    round.decideInsurance('p1', false);
    const peek = round.resolvePeek();
    expect(peek).toEqual({ peeked: true, dealerBlackjack: true });
    expect(round.stage).toBe('showdown');
    expect(round.holeRevealed).toBe(true);
    const s = round.settle();
    expect(s.dealerBlackjack).toBe(true);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'lose', net: -10 });
    expect(seat().balance).toBe(990);
  });

  it('peeks under a ten without offering insurance', () => {
    const { round } = setup({
      entries: [
        { id: 'a', balance: 100, bet: 10 },
        { id: 'b', balance: 100, bet: 10 },
      ],
      deal: ['9s', 'As', 'Kh', '8d', 'Kd', 'Ac'],
    });
    expect(round.stage).toBe('peek');
    expect(round.resolvePeek().dealerBlackjack).toBe(true);
    const s = round.settle();
    expect(s.seats.find((x) => x.id === 'a')!.hands[0]!.result).toBe('lose');
    expect(s.seats.find((x) => x.id === 'b')!.hands[0]!.result).toBe('push'); // natural vs natural
  });

  it('pays insurance 2:1 against a dealer blackjack', () => {
    const { round, seat } = setup({ deal: ['9s', 'Ah', '8d', 'Qc'] });
    expect(round.decideInsurance('p1', true)).toEqual({ ok: true });
    expect(seat().balance).toBe(985);
    round.resolvePeek();
    const s = round.settle();
    expect(s.seats[0]!.insurance).toEqual({ stake: 5, result: 'won' });
    expect(s.seats[0]!.net).toBe(0);
    expect(seat().balance).toBe(1000);
  });

  it('loses insurance when the dealer does not have blackjack and play continues', () => {
    const { round, seat } = setup({ deal: ['Ts', 'Ah', '9d', '7c'] });
    round.decideInsurance('p1', true);
    expect(round.resolvePeek()).toEqual({ peeked: true, dealerBlackjack: false });
    expect(round.peeked).toBe(true);
    expect(seat().insuranceState).toBe('lost');
    play(round, 'p1', [0, 'stand']);
    const s = finish(round); // dealer soft 18 stands, player 19 wins
    expect(s.seats[0]!.hands[0]!.result).toBe('win');
    expect(s.seats[0]!.net).toBe(5);
    expect(seat().balance).toBe(1005);
  });

  it('gives even money on a natural whether or not the dealer has blackjack', () => {
    const withBj = setup({ deal: ['As', 'Ah', 'Kd', 'Qc'] });
    withBj.round.decideInsurance('p1', true);
    withBj.round.resolvePeek();
    expect(withBj.round.settle().seats[0]!.net).toBe(10);

    const without = setup({ deal: ['As', 'Ah', 'Kd', '7c'] });
    without.round.decideInsurance('p1', true);
    without.round.resolvePeek();
    expect(finish(without.round).seats[0]!.net).toBe(10);
  });

  it('pays true even money (exactly 1:1) at 6:5 and 1:1 tables and on odd bets, with or without a dealer blackjack', () => {
    for (const payout of ['3:2', '6:5', '1:1'] as const) {
      for (const bet of [10, 25, 7]) {
        for (const hole of ['Qc', '7c']) {
          const { round, seat } = setup({ rules: { blackjackPayout: payout }, entries: [{ id: 'p1', balance: 1000, bet }], deal: ['As', 'Ah', 'Kd', hole] });
          expect(seat().insuranceState).toBe('offered');
          expect(round.decideInsurance('p1', true)).toEqual({ ok: true });
          expect(seat().insuranceState).toBe('even');
          expect(seat().balance).toBe(1000 - bet); // even money costs nothing
          const peek = round.resolvePeek();
          const s = peek.dealerBlackjack ? round.settle() : finish(round);
          expect(s.seats[0]!.net, `${payout} bet ${bet} hole ${hole}`).toBe(bet);
          expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'blackjack', payout: bet * 2, net: bet });
          expect(s.seats[0]!.insurance).toEqual({ stake: 0, result: 'even' });
          expect(seat().balance).toBe(1000 + bet);
        }
      }
    }
  });

  it('offers even money to an all-in natural (it costs nothing) and to a 1-chip natural', () => {
    const allIn = setup({ entries: [{ id: 'p1', balance: 50, bet: 50 }], deal: ['As', 'Ah', 'Kd', '7c'] });
    expect(allIn.seat().insuranceState).toBe('offered');
    expect(allIn.round.decideInsurance('p1', true)).toEqual({ ok: true });
    allIn.round.resolvePeek();
    expect(finish(allIn.round).seats[0]).toMatchObject({ net: 50, balance: 100 });

    const tiny = setup({ entries: [{ id: 'p1', balance: 5, bet: 1 }], deal: ['As', 'Ah', 'Kd', 'Qc'] });
    expect(tiny.seat().insuranceState).toBe('offered');
    tiny.round.decideInsurance('p1', true);
    tiny.round.resolvePeek();
    expect(tiny.round.settle().seats[0]).toMatchObject({ net: 1, balance: 6 });
  });

  it('declined even money leaves the natural to the normal 3:2 / push settlement', () => {
    const push = setup({ entries: [{ id: 'p1', balance: 100, bet: 10 }], deal: ['As', 'Ah', 'Kd', 'Qc'] });
    push.round.decideInsurance('p1', false);
    push.round.resolvePeek();
    expect(push.round.settle().seats[0]).toMatchObject({ net: 0, balance: 100 });
    const paid = setup({ entries: [{ id: 'p1', balance: 100, bet: 10 }], deal: ['As', 'Ah', 'Kd', '7c'] });
    paid.round.closeInsurance();
    paid.round.resolvePeek();
    expect(finish(paid.round).seats[0]).toMatchObject({ net: 15, balance: 115 });
  });

  it('does not offer insurance when the stake would be zero or unaffordable, or when the rule is off', () => {
    const tiny = setup({ entries: [{ id: 'p1', balance: 100, bet: 1 }], deal: ['9s', 'Ah', '8d', '7c'] });
    expect(tiny.seat().insuranceState).toBe('');
    expect(tiny.round.stage).toBe('peek');
    const broke = setup({ entries: [{ id: 'p1', balance: 10, bet: 10 }], deal: ['9s', 'Ah', '8d', '7c'] });
    expect(broke.seat().insuranceState).toBe('');
    const off = setup({ rules: { insurance: false }, deal: ['9s', 'Ah', '8d', '7c'] });
    expect(off.round.stage).toBe('peek');
    expect(off.round.decideInsurance('p1', true)).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('without the peek, a dealer blackjack takes doubled bets too (European no-peek rule)', () => {
    const { round, seat } = setup({ rules: { dealerPeek: false, insurance: false }, deal: ['5s', 'Kh', '6d', 'Ac'], draws: ['9c'] });
    expect(round.resolvePeek()).toEqual({ peeked: false, dealerBlackjack: false });
    play(round, 'p1', [0, 'double']);
    const s = finish(round);
    expect(s.dealerBlackjack).toBe(true);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'lose', bet: 20, net: -20 });
    expect(seat().balance).toBe(980);
  });
});

describe('push, bust and dealer play', () => {
  it('pushes equal totals and returns the stake', () => {
    const { round, seat } = setup({ deal: ['Ts', 'Kc', '7d', '7h'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'stand']);
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'push', payout: 10, net: 0 });
    expect(seat().balance).toBe(1000);
  });

  it('busts a hand over 21 and the dealer does not draw for busted hands', () => {
    const { round, seat, source } = setup({ deal: ['Ts', '6h', '6d', 'Tc'], draws: ['Kc', '5d'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'hit']);
    expect(seat().hands[0]).toMatchObject({ status: 'bust' });
    expect(seat().done).toBe(true);
    const out = round.playDealer();
    expect(out.draws).toEqual([]);
    expect(source.left()).toBe(1);
    const s = round.settle();
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'bust', net: -10 });
  });

  it('pays even money when the dealer busts', () => {
    const { round } = setup({ deal: ['Ts', '6h', '2d', 'Tc'], draws: ['Kc'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'stand']);
    const s = finish(round);
    expect(s.dealerBust).toBe(true);
    expect(s.seats[0]!.hands[0]!.result).toBe('win');
  });

  it('dealer stands on soft 17 under S17', () => {
    const { round } = setup({ rules: { dealerHitsSoft17: false }, deal: ['Ts', 'Ah', '7d', '6c'], draws: ['4d'] });
    round.decideInsurance('p1', false);
    round.resolvePeek();
    play(round, 'p1', [0, 'stand']);
    const out = round.playDealer();
    expect(out.draws).toEqual([]);
    expect(round.settle().seats[0]!.hands[0]!.result).toBe('push'); // 17 v soft 17
  });

  it('dealer hits soft 17 under H17', () => {
    const { round } = setup({ rules: { dealerHitsSoft17: true }, deal: ['Ts', 'Ah', '7d', '6c'], draws: ['4d'] });
    round.decideInsurance('p1', false);
    round.resolvePeek();
    play(round, 'p1', [0, 'stand']);
    const out = round.playDealer();
    expect(codes(out.draws)).toEqual(['4d']);
    const s = round.settle();
    expect(s.dealerTotal).toBe(21);
    expect(s.seats[0]!.hands[0]!.result).toBe('lose');
  });

  it('H17 keeps hitting a multi-ace soft 17 and stops at hard 17', () => {
    const { round } = setup({ rules: { dealerHitsSoft17: true }, deal: ['Ts', 'Ah', '9d', 'Ac'], draws: ['5d', 'Tc'] });
    round.decideInsurance('p1', false);
    round.resolvePeek();
    play(round, 'p1', [0, 'stand']);
    const out = round.playDealer();
    expect(codes(out.draws)).toEqual(['5d', 'Tc']); // A,A,5 = soft 17 → hit → A,A,5,T = hard 17
    expect(handValue(round.visibleDealerCards())).toMatchObject({ total: 17, soft: false });
    expect(round.settle().seats[0]!.hands[0]!.result).toBe('win');
  });
});

describe('soft hands and multiple aces for the player', () => {
  it('re-scores soft totals as cards arrive', () => {
    const { round, seat } = setup({ deal: ['As', '9h', '6d', '8c'], draws: ['5c', '9s'] });
    round.resolvePeek();
    expect(handValue(seat().hands[0]!.cards)).toMatchObject({ total: 17, soft: true });
    play(round, 'p1', [0, 'hit']);
    expect(handValue(seat().hands[0]!.cards)).toMatchObject({ total: 12, soft: false });
    expect(seat().hands[0]!.status).toBe('active');
    play(round, 'p1', [0, 'hit']);
    expect(seat().hands[0]).toMatchObject({ status: 'stood' }); // 21 auto-stands
    expect(finish(round).seats[0]!.hands[0]!.result).toBe('win');
  });

  it('keeps multiple aces soft until they must harden', () => {
    const { round, seat } = setup({ rules: { maxHands: 1 }, deal: ['As', '9h', 'Ad', '8c'], draws: ['Ac', '8h'] });
    round.resolvePeek();
    expect(round.legalActions('p1')).not.toContain('split');
    play(round, 'p1', [0, 'hit']);
    expect(handValue(seat().hands[0]!.cards)).toMatchObject({ total: 13, soft: true });
    play(round, 'p1', [0, 'hit']);
    expect(handValue(seat().hands[0]!.cards)).toMatchObject({ total: 21, soft: true });
    expect(seat().hands[0]!.status).toBe('stood');
  });
});

describe('legal actions', () => {
  it('offers the full menu on a fresh two-card hand', () => {
    const { round } = setup({ deal: ['8s', '9h', '8d', '7c'] });
    round.resolvePeek();
    expect(round.legalActions('p1')).toEqual(['hit', 'stand', 'double', 'split', 'surrender']);
  });

  it('removes double, split and surrender after a hit', () => {
    const { round } = setup({ deal: ['8s', '9h', '8d', '7c'], draws: ['2c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'hit']);
    expect(round.legalActions('p1')).toEqual(['hit', 'stand']);
    expect(round.act('p1', 0, 'double')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(round.act('p1', 0, 'surrender')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(round.act('p1', 0, 'split')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('rejects splitting a non-pair and actions on inactive hands', () => {
    const { round } = setup({
      entries: [
        { id: 'p1', balance: 100, bet: 10 },
        { id: 'p2', balance: 100, bet: 10 },
      ],
      deal: ['8s', '5c', '9h', '9d', '6c', '7c'],
    });
    expect(round.act('p1', 0, 'hit')).toMatchObject({ ok: false, code: 'wrong_phase' });
    round.resolvePeek();
    expect(round.act('p1', 0, 'split')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(round.act('p1', 1, 'hit')).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(round.act('ghost', 0, 'hit')).toMatchObject({ ok: false, code: 'not_allowed' });
    play(round, 'p1', [0, 'stand']);
    expect(round.stage).toBe('players');
    expect(round.act('p1', 0, 'hit')).toMatchObject({ ok: false, code: 'not_your_turn' });
    play(round, 'p2', [0, 'stand']);
    expect(round.act('p2', 0, 'hit')).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('requires chips to double or split', () => {
    const { round } = setup({ entries: [{ id: 'p1', balance: 10, bet: 10 }], deal: ['8s', '9h', '8d', '7c'] });
    round.resolvePeek();
    expect(round.legalActions('p1')).toEqual(['hit', 'stand', 'surrender']);
    expect(round.act('p1', 0, 'double')).toMatchObject({ ok: false, code: 'insufficient_chips' });
    expect(round.act('p1', 0, 'split')).toMatchObject({ ok: false, code: 'insufficient_chips' });
  });
});

describe('double accounting', () => {
  it('doubles the stake, deals exactly one card and pays on the doubled bet', () => {
    const { round, seat } = setup({ deal: ['5s', 'Th', '6d', '7c'], draws: ['Kc'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'double']);
    const hand = seat().hands[0]!;
    expect(hand).toMatchObject({ bet: 20, doubled: true, status: 'stood' });
    expect(hand.cards).toHaveLength(3);
    expect(seat().balance).toBe(980);
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'win', payout: 40, net: 20 });
    expect(seat().balance).toBe(1020);
  });

  it('loses the doubled stake on a losing double', () => {
    const { round, seat } = setup({ deal: ['5s', 'Th', '6d', '7c'], draws: ['2c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'double']);
    expect(seat().hands[0]!.status).toBe('stood');
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'lose', net: -20 });
    expect(seat().balance).toBe(980);
  });

  it('can bust on a double', () => {
    const { round, seat } = setup({ deal: ['Ts', 'Th', '2d', '7c'], draws: ['Kc'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'double']);
    expect(seat().hands[0]!.status).toBe('bust');
    expect(finish(round).seats[0]!.net).toBe(-20);
  });

  it('honours the 9–11 and 10–11 double rules', () => {
    const soft = setup({ rules: { doubleRule: '9-11' }, deal: ['As', 'Th', '8d', '7c'] });
    soft.round.resolvePeek();
    expect(soft.round.legalActions('p1')).not.toContain('double');
    const nine = setup({ rules: { doubleRule: '9-11' }, deal: ['4s', 'Th', '5d', '7c'] });
    nine.round.resolvePeek();
    expect(nine.round.legalActions('p1')).toContain('double');
    const tenEleven = setup({ rules: { doubleRule: '10-11' }, deal: ['4s', 'Th', '5d', '7c'] });
    tenEleven.round.resolvePeek();
    expect(tenEleven.round.act('p1', 0, 'double')).toMatchObject({ ok: false, code: 'not_allowed' });
  });
});

describe('split accounting', () => {
  it('splits a pair into two funded hands, doubles after split and settles each hand', () => {
    const { round, seat } = setup({ deal: ['8s', '6h', '8d', 'Tc'], draws: ['3c', 'Ts', 'Kd', '9h'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    expect(seat().hands).toHaveLength(2);
    expect(seat().balance).toBe(980);
    expect(codes(seat().hands[0]!.cards)).toEqual(['8s', '3c']);
    expect(seat().hands[1]!.status).toBe('waiting');
    expect(seat().active).toBe(0);
    play(round, 'p1', [0, 'double']); // 11 + T = 21
    expect(seat().hands[0]).toMatchObject({ bet: 20, doubled: true, status: 'stood' });
    expect(seat().active).toBe(1);
    expect(codes(seat().hands[1]!.cards)).toEqual(['8d', 'Kd']);
    play(round, 'p1', [1, 'stand']);
    const s = finish(round); // dealer 16 + 9 = bust
    expect(s.seats[0]!.hands.map((h) => [h.result, h.bet, h.net])).toEqual([
      ['win', 20, 20],
      ['win', 10, 10],
    ]);
    expect(s.seats[0]!.net).toBe(30);
    expect(seat().balance).toBe(1030);
  });

  it('settles split hands independently (one wins, one loses)', () => {
    const { round, seat } = setup({ deal: ['9s', 'Th', '9d', '8c'], draws: ['Tc', '7h'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split'], [0, 'stand'], [1, 'stand']);
    const s = finish(round); // 19 beats 18, 16 loses
    expect(s.seats[0]!.hands.map((h) => h.result)).toEqual(['win', 'lose']);
    expect(s.seats[0]!.net).toBe(0);
    expect(seat().balance).toBe(1000);
  });

  it('re-splits up to the maximum number of hands', () => {
    const { round, seat } = setup({ rules: { maxHands: 3 }, deal: ['8s', '6h', '8d', 'Tc'], draws: ['8c', '8h', '2c', '3d', '4s'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']); // hand0 = 8s 8c
    play(round, 'p1', [0, 'split']); // hand0 = 8s 8h, three hands
    expect(seat().hands).toHaveLength(3);
    expect(round.act('p1', 0, 'split')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(seat().balance).toBe(970);
    play(round, 'p1', [0, 'stand'], [1, 'stand'], [2, 'stand']);
    expect(seat().hands.map((h) => codes(h.cards))).toEqual([
      ['8s', '8h'],
      ['8c', '2c'],
      ['8d', '3d'],
    ]);
  });

  it('gives split aces one card each, auto-stands them and pays 21 after a split at 1:1', () => {
    const { round, seat } = setup({ deal: ['As', '9c', 'Ad', '8h'], draws: ['Kh', '5d'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    expect(seat().done).toBe(true);
    expect(seat().hands.map((h) => [codes(h.cards), h.status])).toEqual([
      [['As', 'Kh'], 'stood'],
      [['Ad', '5d'], 'stood'],
    ]);
    const s = finish(round);
    expect(s.seats[0]!.hands.map((h) => [h.result, h.net])).toEqual([
      ['win', 10],
      ['lose', -10],
    ]);
  });

  it('lets split aces take more cards when the table allows it', () => {
    const { round, seat } = setup({ rules: { hitSplitAces: true }, deal: ['As', '9c', 'Ad', '8h'], draws: ['5h', '4d'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    expect(round.legalActions('p1')).toContain('hit');
    play(round, 'p1', [0, 'hit']);
    expect(handValue(seat().hands[0]!.cards).total).toBe(20);
  });

  it('re-splits aces only when allowed', () => {
    const no = setup({ deal: ['As', '9c', 'Ad', '8h'], draws: ['Ac', '5d'] });
    no.round.resolvePeek();
    play(no.round, 'p1', [0, 'split']);
    expect(no.seat().hands).toHaveLength(2);
    expect(no.seat().hands[0]).toMatchObject({ status: 'stood' }); // A,A = soft 12, stuck

    const yes = setup({ rules: { resplitAces: true }, deal: ['As', '9c', 'Ad', '8h'], draws: ['Ac', '9d', '7s', '6h'] });
    yes.round.resolvePeek();
    play(yes.round, 'p1', [0, 'split']);
    expect(yes.round.legalActions('p1')).toEqual(['stand', 'split']);
    play(yes.round, 'p1', [0, 'split']);
    expect(yes.seat().hands).toHaveLength(3);
    expect(yes.seat().done).toBe(true);
  });

  it('forbids doubling after a split when DAS is off', () => {
    const { round } = setup({ rules: { doubleAfterSplit: false }, deal: ['8s', '6h', '8d', 'Tc'], draws: ['3c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    expect(round.legalActions('p1')).toEqual(['hit', 'stand']);
    expect(round.act('p1', 0, 'double')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('disables splitting when the table allows only one hand', () => {
    const { round } = setup({ rules: { maxHands: 1 }, deal: ['8s', '6h', '8d', 'Tc'] });
    round.resolvePeek();
    expect(round.act('p1', 0, 'split')).toMatchObject({ ok: false, code: 'not_allowed', message: 'Splitting is disabled at this table.' });
  });

  it('never allows surrender after a split', () => {
    const { round } = setup({ deal: ['8s', '6h', '8d', 'Tc'], draws: ['3c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    expect(round.legalActions('p1')).not.toContain('surrender');
  });
});

describe('surrender', () => {
  it('returns half the bet (late surrender after the peek)', () => {
    const { round, seat } = setup({ deal: ['Ts', 'Kh', '6d', '7c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'surrender']);
    expect(seat().hands[0]!.status).toBe('surrendered');
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'surrender', payout: 5, net: -5 });
    expect(seat().balance).toBe(995);
  });

  it('rounds an odd surrender refund down', () => {
    const { round, seat } = setup({ entries: [{ id: 'p1', balance: 100, bet: 5 }], deal: ['Ts', 'Kh', '6d', '7c'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'surrender']);
    expect(finish(round).seats[0]!.net).toBe(-3);
    expect(seat().balance).toBe(97);
  });

  it('is unavailable when the table disables it', () => {
    const { round } = setup({ rules: { surrender: false }, deal: ['Ts', 'Kh', '6d', '7c'] });
    round.resolvePeek();
    expect(round.legalActions('p1')).not.toContain('surrender');
    expect(round.act('p1', 0, 'surrender')).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('cannot escape a dealer blackjack when there was no peek', () => {
    const { round } = setup({ rules: { dealerPeek: false }, deal: ['Ts', 'Kh', '6d', 'Ac'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'surrender']);
    const s = finish(round);
    expect(s.seats[0]!.hands[0]).toMatchObject({ result: 'lose', net: -10 });
  });
});

describe('simultaneous multi-seat play', () => {
  it('waits for every seat, in any order, before the dealer plays', () => {
    const { round } = setup({
      entries: [
        { id: 'a', balance: 100, bet: 10 },
        { id: 'b', balance: 100, bet: 10 },
        { id: 'c', balance: 100, bet: 10 },
      ],
      deal: ['Ts', '9s', '5s', '6h', '8s', '7d', '6c', 'Tc'],
      draws: ['Kd', '4d', '2c'],
    });
    round.resolvePeek();
    play(round, 'c', [0, 'hit']); // 5+6+K = 21 → auto stand
    expect(round.seat('c')!.done).toBe(true);
    expect(round.stage).toBe('players');
    play(round, 'a', [0, 'stand']);
    expect(round.stage).toBe('players');
    play(round, 'b', [0, 'hit']); // 9+7+4 = 20
    play(round, 'b', [0, 'stand']);
    const s = finish(round); // dealer 16 draws to 18
    expect(s.seats.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('stands every remaining hand on timeout, dealing the second card to waiting split hands', () => {
    const { round, seat } = setup({ deal: ['8s', '6h', '8d', 'Tc'], draws: ['3c', '9d', 'Kc'] });
    round.resolvePeek();
    play(round, 'p1', [0, 'split']);
    const drawn = round.standAll('p1');
    expect(codes(drawn)).toEqual(['9d']);
    expect(seat().done).toBe(true);
    expect(seat().hands.map((h) => h.status)).toEqual(['stood', 'stood']);
    expect(round.stage).toBe('dealer');
  });
});

describe('invariants (seeded fuzz)', () => {
  it('conserves chips and always terminates across thousands of random rounds', () => {
    const rng = createSeededRng('fuzz');
    const actions: BlackjackAction[] = ['hit', 'stand', 'double', 'split', 'surrender'];
    for (let r = 0; r < 1500; r++) {
      const rules: TableRules = {
        ...DEFAULT_TABLE_RULES,
        decks: 1 + rng.int(8),
        dealerHitsSoft17: rng.next() < 0.5,
        blackjackPayout: (['3:2', '6:5', '1:1'] as const)[rng.int(3)]!,
        doubleRule: (['any', '9-11', '10-11'] as const)[rng.int(3)]!,
        doubleAfterSplit: rng.next() < 0.5,
        maxHands: 1 + rng.int(4),
        resplitAces: rng.next() < 0.5,
        hitSplitAces: rng.next() < 0.5,
        surrender: rng.next() < 0.5,
        insurance: rng.next() < 0.5,
        dealerPeek: rng.next() < 0.7,
      };
      const shoe = new Shoe(rules.decks, 75, rng);
      const n = 1 + rng.int(7);
      const entries = Array.from({ length: n }, (_, i) => {
        const balance = 1 + rng.int(500);
        return { id: `p${i}`, balance, bet: 1 + rng.int(balance) };
      });
      const round = new BlackjackRound(rules, shoe, entries);
      round.deal();
      for (const id of round.pendingInsurance()) round.decideInsurance(id, rng.next() < 0.5);
      const peek = round.resolvePeek();
      let guard = 0;
      while (round.stage === 'players') {
        for (const seat of round.seats) {
          if (seat.done) continue;
          const legal = round.legalActions(seat.id);
          expect(legal.length).toBeGreaterThan(0);
          expect(legal).toContain('stand');
          const action = rng.next() < 0.8 ? legal[rng.int(legal.length)]! : actions[rng.int(actions.length)]!;
          round.act(seat.id, seat.active, action);
        }
        if (++guard > 200) throw new Error('round did not terminate');
      }
      if (!peek.dealerBlackjack) round.playDealer();
      const s = round.settle();
      for (const seat of s.seats) {
        const entry = entries.find((e) => e.id === seat.id)!;
        expect(seat.balance).toBe(entry.balance + seat.net);
        expect(seat.balance).toBeGreaterThanOrEqual(0);
        for (const h of seat.hands) expect(h.payout).toBeGreaterThanOrEqual(0);
        const rs = round.seat(seat.id)!;
        expect(rs.hands.length).toBeLessThanOrEqual(Math.max(1, rules.maxHands));
        for (const h of rs.hands) expect(h.cards.length).toBeGreaterThanOrEqual(2);
      }
      const dv = handValue(round.visibleDealerCards());
      if (round.dealerMustDraw && !s.dealerBlackjack) expect(dv.total).toBeGreaterThanOrEqual(17);
    }
  });
});
