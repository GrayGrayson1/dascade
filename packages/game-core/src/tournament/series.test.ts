import { describe, expect, it } from 'vitest';
import { SERIES_DECIDER_GAMES } from '@dascade/shared';
import { deciderFor, firstForGame, seriesState, type SeriesSpec } from './series.ts';

const spec = (over: Partial<SeriesSpec> = {}): SeriesSpec => ({
  a: 'A',
  b: 'B',
  bestOf: 3,
  requireWinner: true,
  sides: false,
  firstId: null,
  ...over,
});
const g = (winnerId: string | null, n = 0, firstId: string | null = null) => ({ winnerId, n, firstId });

describe('series', () => {
  it('best of 1: one decisive game decides', () => {
    const s = seriesState(spec({ bestOf: 1 }), [g('B')]);
    expect(s.decided).toBe(true);
    expect(s.winner).toBe('B');
    expect(s.points).toEqual({ A: 0, B: 1 });
  });

  it('best of 3 stops at 2–0 and goes to game 3 at 1–1', () => {
    expect(seriesState(spec(), [g('A'), g('A')])).toMatchObject({ decided: true, winner: 'A' });
    const s = seriesState(spec(), [g('A'), g('B')]);
    expect(s.decided).toBe(false);
    expect(s.next).toEqual({ n: 3, decider: '', firstId: null });
    expect(seriesState(spec(), [g('A'), g('B'), g('B')])).toMatchObject({ decided: true, winner: 'B' });
  });

  it('best of 5 needs a clinching majority', () => {
    const s = seriesState(spec({ bestOf: 5 }), [g('A'), g('A')]);
    expect(s.decided).toBe(false);
    expect(seriesState(spec({ bestOf: 5 }), [g('A'), g('A'), g('A')])).toMatchObject({ decided: true, winner: 'A' });
    expect(seriesState(spec({ bestOf: 5 }), [g('A'), g('B'), g('A'), g('B'), g('B')])).toMatchObject({ decided: true, winner: 'B' });
  });

  it('draws count half a point and can decide early', () => {
    // Bo3: 1½–½ after two games → the trailer can still level (1½–1½) → game 3.
    const s = seriesState(spec(), [g('A'), g(null)]);
    expect(s.points).toEqual({ A: 1.5, B: 0.5 });
    expect(s.decided).toBe(false);
    // Bo3: 2–0 is decided; ½–½, ½–½ then A wins game 3 → 2–1.
    expect(seriesState(spec(), [g(null), g(null), g('A')])).toMatchObject({ decided: true, winner: 'A', points: { A: 2, B: 1 } });
  });

  it('round robin / Swiss: a level series is a drawn match', () => {
    const s = seriesState(spec({ requireWinner: false, bestOf: 2 }), [g('A'), g('B')]);
    expect(s).toMatchObject({ decided: true, winner: null, needsLots: false });
    expect(seriesState(spec({ requireWinner: false, bestOf: 1 }), [g(null)])).toMatchObject({ decided: true, winner: null });
  });

  it('elimination: a level series goes to sudden-death deciders', () => {
    const s = seriesState(spec({ bestOf: 2 }), [g('A'), g('B')]);
    expect(s.decided).toBe(false);
    expect(s.next).toEqual({ n: 3, decider: 'sudden_death', firstId: null });
    expect(seriesState(spec({ bestOf: 2 }), [g('A'), g('B'), g('B')])).toMatchObject({ decided: true, winner: 'B', note: 'Decider' });
  });

  it('elimination with sides: the last decider is Armageddon (draw wins for second)', () => {
    const sp = spec({ bestOf: 1, sides: true, firstId: 'A' });
    expect(deciderFor(sp, 1)).toBe('');
    expect(deciderFor(sp, 2)).toBe('sudden_death');
    expect(deciderFor(sp, 1 + SERIES_DECIDER_GAMES)).toBe('armageddon');
    // Game 1 A first (drawn), game 2 B first (drawn), game 3 (Armageddon) A first → drawn → B (second) wins.
    const s = seriesState(sp, [g(null, 1, 'A'), g(null, 2, 'B'), g(null, 3, 'A')]);
    expect(s).toMatchObject({ decided: true, winner: 'B', note: 'Armageddon' });
    // A decisive Armageddon game is simply won.
    expect(seriesState(sp, [g(null, 1, 'A'), g(null, 2, 'B'), g('A', 3, 'A')])).toMatchObject({ decided: true, winner: 'A' });
  });

  it('side-less elimination still level after every decider needs lots', () => {
    const sp = spec({ bestOf: 1 });
    const s = seriesState(sp, [g(null), g(null), g(null)]);
    expect(s).toMatchObject({ decided: true, winner: null, needsLots: true });
  });

  it('alternates sides every game, starting with firstId', () => {
    const sp = spec({ bestOf: 5, sides: true, firstId: 'B' });
    expect([1, 2, 3, 4, 5, 6].map((n) => firstForGame(sp, n))).toEqual(['B', 'A', 'B', 'A', 'B', 'A']);
    expect(firstForGame(spec(), 1)).toBeNull();
    const s = seriesState(sp, [g('A'), g('B')]);
    expect(s.next?.firstId).toBe('B');
  });

  it('never needs more than bestOf + deciders games', () => {
    for (const bestOf of [1, 2, 3, 5]) {
      for (const sides of [false, true]) {
        const sp = spec({ bestOf, sides, firstId: sides ? 'A' : null });
        const games: Array<ReturnType<typeof g>> = [];
        let s = seriesState(sp, games);
        while (!s.decided) {
          games.push(g(null, games.length + 1, s.next!.firstId));
          s = seriesState(sp, games);
        }
        expect(games.length).toBe(bestOf + SERIES_DECIDER_GAMES);
      }
    }
  });
});
