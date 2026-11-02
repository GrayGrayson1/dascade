import { describe, expect, it } from 'vitest';
import { emptyTally, handWinsBySeat, holdemAwards, recordHandWin, type HoldemPlayerTally } from './awards.ts';
import type { HandResult, WinnerLine } from './hand.ts';

const line = (seat: number, potIndex: number, amount: number, description = ''): WinnerLine => ({ seat, potIndex, amount, description, bestCards: [] });
const result = (winners: WinnerLine[], uncontested = false): HandResult => ({ uncontested, awards: [], payouts: [], shown: [], mucked: [], winners });
const tally = (handsWon: number, bestPot: number, bestPotHand = 0, bestPotLabel = ''): HoldemPlayerTally => ({ handsWon, bestPot, bestPotHand, bestPotLabel });
const lookup = (map: Record<string, HoldemPlayerTally>) => (id: string) => map[id];

describe('handWinsBySeat', () => {
  it('is empty without a result or without winners', () => {
    expect(handWinsBySeat(null).size).toBe(0);
    expect(handWinsBySeat(undefined).size).toBe(0);
    expect(handWinsBySeat(result([])).size).toBe(0);
  });

  it('an uncontested pot has no description', () => {
    expect([...handWinsBySeat(result([line(3, 0, 150)], true))]).toEqual([[3, { amount: 150, description: '' }]]);
  });

  it('sums a seat across the main pot and side pots and keeps the main-pot description', () => {
    const wins = handWinsBySeat(
      result([line(1, 0, 600, 'Flush, Ace-high'), line(2, 1, 400, 'Two Pair, Kings and Fours'), line(1, 2, 200, 'Flush, Ace-high (side)')]),
    );
    expect(wins.get(1)).toEqual({ amount: 800, description: 'Flush, Ace-high' });
    expect(wins.get(2)).toEqual({ amount: 400, description: 'Two Pair, Kings and Fours' });
  });

  it('a split pot gives each winner their own share', () => {
    const wins = handWinsBySeat(result([line(0, 0, 250, 'Straight, Ten-high'), line(4, 0, 250, 'Straight, Ten-high')]));
    expect(wins.get(0)!.amount).toBe(250);
    expect(wins.get(4)!.amount).toBe(250);
  });
});

describe('recordHandWin', () => {
  it('counts every won hand and keeps the biggest win with its hand and description', () => {
    const t = emptyTally();
    recordHandWin(t, 2, 300, '');
    recordHandWin(t, 5, 1200, 'Full House, Kings over Sevens');
    recordHandWin(t, 9, 700, 'Pair of Aces');
    expect(t).toEqual(tally(3, 1200, 5, 'Full House, Kings over Sevens'));
  });

  it('an equal win later on does not replace the first one', () => {
    const t = emptyTally();
    recordHandWin(t, 1, 500, 'Pair of Twos');
    recordHandWin(t, 4, 500, 'Three of a Kind, Nines');
    expect(t.bestPotHand).toBe(1);
    expect(t.bestPotLabel).toBe('Pair of Twos');
    expect(t.handsWon).toBe(2);
  });
});

describe('holdemAwards', () => {
  const rows = [
    { playerId: 'a', name: 'Ada' },
    { playerId: 'b', name: 'Bo' },
    { playerId: 'c', name: 'Cy' },
  ];

  it('no awards when nobody won a hand (or the game ended before one was dealt)', () => {
    expect(holdemAwards(0, rows, () => undefined)).toEqual({ hands: 0, mostHands: null, biggestPot: null });
    expect(holdemAwards(3, [], () => undefined)).toEqual({ hands: 3, mostHands: null, biggestPot: null });
  });

  it('names the player with the most hands won and the player with the biggest single-hand win', () => {
    const awards = holdemAwards(12, rows, lookup({ a: tally(2, 9000, 11, 'Straight Flush, Nine-high'), b: tally(7, 1500, 3, ''), c: tally(3, 800, 6, 'Pair of Jacks') }));
    expect(awards.hands).toBe(12);
    expect(awards.mostHands).toEqual({ count: 7, players: [{ playerId: 'b', name: 'Bo' }] });
    expect(awards.biggestPot).toEqual({
      amount: 9000,
      players: [{ playerId: 'a', name: 'Ada', handNumber: 11, description: 'Straight Flush, Nine-high' }],
    });
  });

  it('ties share the award, in leaderboard order', () => {
    const awards = holdemAwards(8, rows, lookup({ a: tally(3, 400, 2, ''), c: tally(3, 400, 7, 'Pair of Fives'), b: tally(1, 100, 1, '') }));
    expect(awards.mostHands!.players.map((p) => p.name)).toEqual(['Ada', 'Cy']);
    expect(awards.biggestPot!.players.map((p) => [p.name, p.handNumber])).toEqual([
      ['Ada', 2],
      ['Cy', 7],
    ]);
  });

  it('only players on the final leaderboard can win (a player who left is ignored)', () => {
    const awards = holdemAwards(20, rows.slice(0, 2), lookup({ a: tally(1, 300, 4, ''), b: tally(2, 200, 9, ''), c: tally(15, 50_000, 12, 'Royal Flush') }));
    expect(awards.mostHands!.players.map((p) => p.playerId)).toEqual(['b']);
    expect(awards.biggestPot!.players.map((p) => p.playerId)).toEqual(['a']);
  });

  it('carries only names, counts, amounts, hand numbers and tabled descriptions', () => {
    const awards = holdemAwards(4, rows, lookup({ a: tally(1, 300, 4, 'Pair of Queens') }));
    expect(Object.keys(awards).sort()).toEqual(['biggestPot', 'hands', 'mostHands']);
    expect(Object.keys(awards.biggestPot!.players[0]!).sort()).toEqual(['description', 'handNumber', 'name', 'playerId']);
    expect(JSON.stringify(awards)).not.toMatch(/\b[2-9TJQKA][shdc]\b/);
  });
});
