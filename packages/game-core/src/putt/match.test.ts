import { describe, expect, it } from 'vitest';
import { formatToPar, puttScoreLabel } from '@dascade/shared/games/putt';
import { PuttMatch } from './match.ts';
import { getHole } from './course.ts';
import { searchShots } from './solver.ts';

/** Find an intent that sinks the ball from a lie on a hole (brute force, test helper). */
function sinkFrom(holeNo: number, lie: { x: number; y: number }): { angle: number; power: number } {
  const hole = getHole(holeNo);
  const best = searchShots(hole, lie, { angleStep: 50, powers: Array.from({ length: 60 }, (_, i) => 60 + i * 16), keep: 1 });
  const c = best[0]!;
  expect(c.sim.result).toBe('cup');
  return { angle: c.angle, power: c.power };
}

/** Play a golfer's ball into the cup with searched shots (turn handed to them); returns strokes. */
function holeOut(m: PuttMatch, id: string): number {
  const g = m.golfers.get(id)!;
  for (let i = 0; i < 8 && !g.holed; i++) {
    m.turnId = m.mode === 'turns' ? id : null;
    const best = searchShots(m.hole, g.lie, { angleStep: 100, keep: 1 })[0]!;
    m.stroke(id, best.angle, best.power, 0);
  }
  expect(g.holed).toBe(true);
  return g.strokes;
}

/** A gentle putt that stays on the green (hole 1: tap it along the fairway). */
const TAP = { angle: 0, power: 200 };
/** Into the canal on hole 5 (tee deck faces the water to the east, off the bridge line). */
const SPLASH = { angle: 35000, power: 700 };

describe('PuttMatch — strokes and penalties', () => {
  it('counts strokes, moves the lie and holes out', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 4 }, ['a']);
    const g = m.golfers.get('a')!;
    expect(g.lie).toEqual({ x: 215, y: 395 });
    const out = m.stroke('a', TAP.angle, TAP.power, 0);
    expect(out.strokes).toBe(1);
    expect(out.result).toBe('rest');
    expect(g.lie.x).toBeGreaterThan(215);
    const sink = sinkFrom(1, g.lie);
    const out2 = m.stroke('a', sink.angle, sink.power, 0);
    expect(out2.holed).toBe(true);
    expect(g.card[0]).toBe(2);
    expect(m.holeComplete()).toBe(true);
  });

  it('water costs a penalty stroke and returns the ball to where it was struck', () => {
    const m = new PuttMatch({ route: [5], mode: 'turns', maxOverPar: 4 }, ['a']);
    const g = m.golfers.get('a')!;
    const before = { ...g.lie };
    const out = m.stroke('a', SPLASH.angle, SPLASH.power, 0);
    expect(out.result).toBe('water');
    expect(out.penalty).toBe(1);
    expect(out.strokes).toBe(2);
    expect(g.lie).toEqual(before);
  });

  it('out of bounds (off an open edge) is a penalty too', () => {
    // Hole 5 green deck: its canal edge is open; putt west from the green into the canal/void.
    const m = new PuttMatch({ route: [5], mode: 'turns', maxOverPar: 4 }, ['a']);
    const g = m.golfers.get('a')!;
    g.lie = { x: 760, y: 200 };
    const out = m.stroke('a', 18000, 500, 0);
    expect(['water', 'oob']).toContain(out.result);
    expect(out.penalty).toBe(1);
    expect(g.lie).toEqual({ x: 760, y: 200 });
  });

  it('picks the ball up at the stroke limit with the limit as its score', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 2 }, ['a']);
    expect(m.limit()).toBe(4);
    m.stroke('a', 18000, 60, 0);
    m.stroke('a', 18000, 60, 0);
    m.stroke('a', 18000, 60, 0);
    const out = m.stroke('a', 18000, 60, 0);
    expect(out.pickedUp).toBe(true);
    expect(m.golfers.get('a')!.card[0]).toBe(4);
    expect(m.canShoot('a')).toBe('done');
  });

  it('a penalty on the last allowed stroke clamps the score to the limit', () => {
    const m = new PuttMatch({ route: [5], mode: 'turns', maxOverPar: 2 }, ['a']);
    for (let i = 0; i < 3; i++) m.stroke('a', 18000, 60, 0);
    const out = m.stroke('a', SPLASH.angle, SPLASH.power, 0);
    expect(out.pickedUp).toBe(true);
    expect(m.golfers.get('a')!.card[0]).toBe(5);
  });

  it('shot clock: a timeout costs a stroke; two in a row pick the ball up', () => {
    const m = new PuttMatch({ route: [1, 2], mode: 'turns', maxOverPar: 4 }, ['a', 'b']);
    const t1 = m.timeout('a');
    expect(t1).toEqual({ strokes: 1, pickedUp: false, reason: null });
    // A real stroke resets the streak.
    m.stroke('a', TAP.angle, TAP.power, 0);
    expect(m.timeout('a').pickedUp).toBe(false);
    const t3 = m.timeout('a');
    expect(t3.pickedUp).toBe(true);
    expect(t3.reason).toBe('timeouts');
    expect(m.golfers.get('a')!.card[0]).toBe(6);
    // Timeouts on a finished golfer do nothing.
    expect(m.timeout('a').pickedUp).toBe(false);
  });

  it('conceding picks up with the limit', () => {
    const m = new PuttMatch({ route: [3], mode: 'turns', maxOverPar: 3 }, ['a']);
    expect(m.pickUp('a')).toBe(true);
    expect(m.golfers.get('a')!.card[0]).toBe(6);
    expect(m.pickUp('a')).toBe(false);
  });
});

describe('PuttMatch — turns', () => {
  it('rotates turns, skips finished golfers and rejects out-of-turn strokes', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 4 }, ['a', 'b', 'c']);
    expect(m.turnId).toBe('a');
    expect(m.canShoot('b')).toBe('not_your_turn');
    expect(() => m.stroke('b', 0, 100, 0)).toThrow();
    m.stroke('a', TAP.angle, TAP.power, 0);
    expect(m.nextTurn()).toBe('b');
    m.pickUp('c');
    m.stroke('b', TAP.angle, TAP.power, 0);
    expect(m.nextTurn()).toBe('a');
    m.pickUp('a');
    expect(m.nextTurn('a')).toBe('b');
    expect(m.nextTurn('b')).toBe('b');
    m.pickUp('b');
    expect(m.nextTurn('b')).toBeNull();
    expect(m.holeComplete()).toBe(true);
  });

  it('ghost mode lets everyone putt at once', () => {
    const m = new PuttMatch({ route: [1], mode: 'ghost', maxOverPar: 4 }, ['a', 'b']);
    expect(m.turnId).toBeNull();
    expect(m.canShoot('a')).toBeNull();
    expect(m.canShoot('b')).toBeNull();
    m.stroke('b', TAP.angle, TAP.power, 0);
    m.stroke('a', TAP.angle, TAP.power, 0);
    expect(m.golfers.get('a')!.strokes).toBe(1);
    expect(m.canShoot('zz')).toBe('unknown');
  });

  it('honour: the best score on a hole tees off first on the next', () => {
    const m = new PuttMatch({ route: [1, 2], mode: 'turns', maxOverPar: 4 }, ['a', 'b']);
    m.pickUp('a'); // 6
    m.nextTurn('a');
    m.stroke('b', TAP.angle, TAP.power, 0);
    m.pickUp('b'); // limit too — tie keeps order
    expect(m.advance()).toBe(true);
    expect(m.turnId).toBe('a');
    expect(m.golfers.get('a')!.lie).toEqual({ x: getHole(2).tee[0], y: getHole(2).tee[1] });
    // Hole 2: b scores better.
    m.pickUp('a');
    const strokes = holeOut(m, 'b');
    expect(strokes).toBeLessThan(7);
    expect(m.advance()).toBe(false);
    expect(m.finished).toBe(true);
    expect(m.golfers.get('b')!.order).toBe(0);
    expect(m.golfers.get('a')!.order).toBe(1);
  });

  it('retired golfers are skipped and ranked last', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 4 }, ['a', 'b']);
    m.retire('a');
    expect(m.turnId).toBeNull();
    expect(m.nextTurn(null)).toBe('b');
    expect(m.canShoot('a')).toBe('retired');
    m.pickUp('b');
    m.advance();
    const p = m.placements();
    expect(p.at(-1)).toEqual(['a']);
    expect(p[0]).toEqual(['b']);
  });
});

describe('PuttMatch — course completion and standings', () => {
  it('plays a whole route to the end', () => {
    const route = [1, 2, 3];
    const m = new PuttMatch({ route, mode: 'turns', maxOverPar: 3 }, ['a', 'b']);
    let holes = 0;
    for (;;) {
      for (const id of ['a', 'b']) m.pickUp(id);
      holes++;
      if (!m.advance()) break;
    }
    expect(holes).toBe(3);
    expect(m.finished).toBe(true);
    const t = m.totals(m.golfers.get('a')!);
    expect(t.thru).toBe(3);
    expect(t.total).toBe(route.reduce((s, n) => s + getHole(n).par + 3, 0));
    expect(m.canShoot('a')).toBe('match_over');
  });

  it('ties share a place; lower totals rank first', () => {
    const m = new PuttMatch({ route: [1], mode: 'ghost', maxOverPar: 4 }, ['a', 'b', 'c']);
    const g = m.golfers.get('c')!;
    const s = sinkFrom(1, g.lie);
    m.stroke('c', TAP.angle, TAP.power, 0); // 1 stroke, not holed
    const s2 = sinkFrom(1, g.lie);
    m.stroke('c', s2.angle, s2.power, 0); // holed in 2
    void s;
    m.pickUp('a');
    m.pickUp('b');
    m.advance();
    expect(m.placements()).toEqual([['c'], ['a', 'b']]);
    expect(m.scores()).toEqual({ a: 6, b: 6, c: 2 });
    expect(m.leaders()).toEqual(['c']);
    expect(m.standings()[0]!.id).toBe('c');
  });

  it('sudden-death playoff splits tied leaders', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 4 }, ['a', 'b']);
    m.pickUp('a');
    m.pickUp('b');
    expect(m.advance()).toBe(false);
    expect(m.leaders()).toEqual(['a', 'b']);
    m.startPlayoff(['a', 'b'], 1);
    expect(m.isPlayoff).toBe(true);
    expect(m.turnId).toBe('a');
    // a holes out in 2, b picks up.
    const ga = m.golfers.get('a')!;
    m.stroke('a', TAP.angle, TAP.power, 0);
    const s = sinkFrom(1, ga.lie);
    m.nextTurn('a');
    m.pickUp('b');
    m.nextTurn('b');
    m.stroke('a', s.angle, s.power, 0);
    expect(m.advance()).toBe(false);
    expect(m.playoffResult).toEqual([['a'], ['b']]);
    expect(m.placements()).toEqual([['a'], ['b']]);
    // Playoff holes never count towards the regulation total.
    expect(m.scores()).toEqual({ a: 6, b: 6 });
  });

  it('playoff players only: others sit out; a still-tied playoff can continue or end drawn', () => {
    const m = new PuttMatch({ route: [1], mode: 'turns', maxOverPar: 4 }, ['a', 'b', 'c']);
    const sa = holeOut(m, 'a');
    const sb = holeOut(m, 'b');
    expect(sa).toBe(sb);
    m.pickUp('c');
    expect(m.advance()).toBe(false);
    expect(m.leaders()).toEqual(['a', 'b']);
    m.startPlayoff(['a', 'b'], 9);
    expect(m.golfers.get('c')!.sittingOut).toBe(true);
    expect(m.canShoot('c')).toBe('done');
    expect(m.playing().map((g) => g.id).sort()).toEqual(['a', 'b']);
    m.pickUp('a');
    m.pickUp('b');
    expect(m.advance()).toBe(false);
    expect(m.playoffResult).toBeNull();
    expect(m.playoffIds).toEqual(['a', 'b']);
    // Another playoff hole could follow; here the organiser's cap is reached.
    m.endPlayoffTied();
    expect(m.placements()).toEqual([['a', 'b'], ['c']]);
  });
});

describe('score labels', () => {
  it('names golf scores', () => {
    expect(puttScoreLabel(1, 3)).toBe('Hole in one!');
    expect(puttScoreLabel(2, 4)).toBe('Eagle');
    expect(puttScoreLabel(2, 3)).toBe('Birdie');
    expect(puttScoreLabel(3, 3)).toBe('Par');
    expect(puttScoreLabel(4, 3)).toBe('Bogey');
    expect(puttScoreLabel(5, 3)).toBe('Double bogey');
    expect(puttScoreLabel(8, 3)).toBe('+5');
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(3)).toBe('+3');
    expect(formatToPar(-2)).toBe('−2');
  });
});
