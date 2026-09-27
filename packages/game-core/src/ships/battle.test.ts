import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { DEFAULT_SHIPS_SETTINGS, SHIPS_FLEETS, fleetCells, type ShipsPlacement } from '@dascade/shared/games/ships';
import {
  createBoard,
  fleetOf,
  isDefeated,
  keepsTurn,
  placementCells,
  publicBoard,
  randomLayout,
  randomTargets,
  resolveVolley,
  rulesFromSettings,
  shotsAllowed,
  sunkVessels,
  untouchedCount,
  validateVolley,
  vesselsAfloat,
  wasShot,
  type Board,
} from './index.ts';

const RULES = rulesFromSettings(DEFAULT_SHIPS_SETTINGS);
const LAYOUT: ShipsPlacement[] = [
  { id: 'arcology', x: 0, y: 0, dir: 'h' },
  { id: 'tidebreaker', x: 9, y: 0, dir: 'v' },
  { id: 'lanternfish', x: 2, y: 4, dir: 'h' },
  { id: 'riptide', x: 5, y: 7, dir: 'v' },
  { id: 'glowdart', x: 0, y: 9, dir: 'h' },
];

const fresh = (): Board => createBoard(LAYOUT, RULES);
const shoot = (b: Board, x: number, y: number) => {
  expect(validateVolley(b, [{ x, y }], 1)).toBeNull();
  return resolveVolley(b, [{ x, y }])[0]!;
};

describe('board creation', () => {
  it('refuses invalid layouts', () => {
    expect(() => createBoard(LAYOUT.slice(1), RULES)).toThrow(/Invalid layout/);
    expect(() => createBoard([...LAYOUT.slice(0, 4), { id: 'glowdart', x: 0, y: 0, dir: 'h' }], RULES)).toThrow(/overlaps/);
  });

  it('starts untouched with every vessel afloat and a blank public board', () => {
    const b = fresh();
    expect(vesselsAfloat(b)).toBe(5);
    expect(untouchedCount(b)).toBe(100);
    expect(publicBoard(b)).toBe('.'.repeat(100));
    expect(sunkVessels(b)).toEqual([]);
    expect(fleetOf(b)).toEqual(LAYOUT);
  });
});

describe('shots', () => {
  it('reports a miss', () => {
    const b = fresh();
    expect(shoot(b, 5, 5)).toEqual({ x: 5, y: 5, result: 'miss' });
    expect(wasShot(b, 5, 5)).toBe(true);
    expect(publicBoard(b)[55]).toBe('o');
  });

  it('reports a hit without naming the vessel', () => {
    const b = fresh();
    const r = shoot(b, 1, 0);
    expect(r).toEqual({ x: 1, y: 0, result: 'hit' });
    expect(r.vessel).toBeUndefined();
    expect(publicBoard(b)[1]).toBe('x');
    expect(vesselsAfloat(b)).toBe(5);
  });

  it('reports the sinking shot with the vessel, and marks its squares as sunk publicly', () => {
    const b = fresh();
    expect(shoot(b, 0, 9).result).toBe('hit');
    const sink = shoot(b, 1, 9);
    expect(sink).toEqual({ x: 1, y: 9, result: 'sunk', vessel: 'glowdart' });
    const pub = publicBoard(b);
    expect(pub[90]).toBe('#');
    expect(pub[91]).toBe('#');
    expect(vesselsAfloat(b)).toBe(4);
    expect(sunkVessels(b)).toEqual([{ id: 'glowdart', x: 0, y: 9, dir: 'h' }]);
  });

  it('rejects duplicate, out-of-bounds and wrongly-sized volleys', () => {
    const b = fresh();
    shoot(b, 3, 3);
    expect(validateVolley(b, [{ x: 3, y: 3 }], 1)).toBe('already_shot');
    expect(validateVolley(b, [{ x: 10, y: 0 }], 1)).toBe('out_of_bounds');
    expect(validateVolley(b, [{ x: -1, y: 0 }], 1)).toBe('out_of_bounds');
    expect(validateVolley(b, [{ x: 1, y: 1 }], 2)).toBe('wrong_count');
    expect(validateVolley(b, [], 1)).toBe('wrong_count');
    expect(
      validateVolley(
        b,
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        2,
      ),
    ).toBe('duplicate');
    expect(() => resolveVolley(b, [{ x: 3, y: 3 }])).toThrow();
  });

  it('declares final victory only when every vessel square is hit', () => {
    const b = fresh();
    const squares = LAYOUT.flatMap((p) => placementCells(p).map((c): [number, number] => [c.x, c.y]));
    expect(squares).toHaveLength(17);
    squares.forEach(([x, y], i) => {
      expect(isDefeated(b)).toBe(false);
      const r = shoot(b, x, y);
      expect(r.result).not.toBe('miss');
      if (i === squares.length - 1) expect(r.result).toBe('sunk');
    });
    expect(isDefeated(b)).toBe(true);
    expect(vesselsAfloat(b)).toBe(0);
    expect(
      publicBoard(b)
        .split('')
        .filter((c) => c === '#'),
    ).toHaveLength(17);
    expect(sunkVessels(b)).toHaveLength(5);
  });
});

describe('salvo and turn rules', () => {
  it('classic and streak fire one shot; salvo fires one per surviving vessel', () => {
    const me = fresh();
    const them = fresh();
    expect(shotsAllowed('classic', me, them)).toBe(1);
    expect(shotsAllowed('streak', me, them)).toBe(1);
    expect(shotsAllowed('salvo', me, them)).toBe(5);
    // Lose the Glowdart: four shots.
    shoot(me, 0, 9);
    shoot(me, 1, 9);
    expect(shotsAllowed('salvo', me, them)).toBe(4);
    expect(shotsAllowed('classic', me, them)).toBe(1);
  });

  it('never asks for more shots than untouched squares remain', () => {
    const me = fresh();
    const them = fresh();
    const open: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) open.push({ x, y });
    // Shoot everything but three squares, avoiding one Tidebreaker square so the fleet isn't wiped out.
    const keepOpen = new Set(['9,3', '5,5', '6,6']);
    resolveVolley(
      them,
      open.filter((c) => !keepOpen.has(`${c.x},${c.y}`)),
    );
    expect(untouchedCount(them)).toBe(3);
    expect(shotsAllowed('salvo', me, them)).toBe(3);
  });

  it('resolves a salvo in order: a second shot can sink what the first damaged', () => {
    const b = fresh();
    const shots = [
      { x: 0, y: 9 },
      { x: 1, y: 9 },
      { x: 4, y: 4 },
    ];
    expect(validateVolley(b, shots, 3)).toBeNull();
    expect(resolveVolley(b, shots)).toEqual([
      { x: 0, y: 9, result: 'hit' },
      { x: 1, y: 9, result: 'sunk', vessel: 'glowdart' },
      { x: 4, y: 4, result: 'hit' },
    ]);
  });

  it('hot streak keeps the turn after a hit or sinking, never after a miss', () => {
    expect(keepsTurn('streak', [{ x: 0, y: 0, result: 'hit' }])).toBe(true);
    expect(keepsTurn('streak', [{ x: 0, y: 0, result: 'sunk', vessel: 'wisp' }])).toBe(true);
    expect(keepsTurn('streak', [{ x: 0, y: 0, result: 'miss' }])).toBe(false);
    expect(keepsTurn('classic', [{ x: 0, y: 0, result: 'hit' }])).toBe(false);
    expect(keepsTurn('salvo', [{ x: 0, y: 0, result: 'hit' }])).toBe(false);
  });
});

describe('auto-fire targets', () => {
  it('picks distinct untouched squares', () => {
    const b = fresh();
    shoot(b, 0, 0);
    const rng = createSeededRng('auto');
    for (let n = 0; n < 20; n++) {
      const cells = randomTargets(rng, b, 5);
      expect(cells).toHaveLength(5);
      expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(5);
      for (const c of cells) expect(wasShot(b, c.x, c.y)).toBe(false);
    }
    expect(randomTargets(rng, b, 0)).toEqual([]);
    expect(randomTargets(rng, b, 500)).toHaveLength(99);
  });
});

describe('seeded random duels (invariants)', () => {
  for (const firing of ['classic', 'streak', 'salvo'] as const) {
    it(`${firing}: a random duel always ends with exactly one fleet destroyed and consistent public boards`, () => {
      for (let seed = 0; seed < 30; seed++) {
        const rng = createSeededRng(`${firing}:${seed}`);
        const fleet = (['skirmish', 'standard', 'armada'] as const)[seed % 3]!;
        const gridSize = fleet === 'armada' ? 10 : ([8, 10, 12] as const)[seed % 3]!;
        const rules = rulesFromSettings({ gridSize, fleet, spacing: seed % 2 ? 'apart' : 'touching' });
        const boards = [createBoard(randomLayout(rng, rules), rules), createBoard(randomLayout(rng, rules), rules)] as const;
        let turn = 0;
        let volleys = 0;
        while (!isDefeated(boards[0]) && !isDefeated(boards[1])) {
          const attacker = boards[turn]!;
          const target = boards[1 - turn]!;
          const n = shotsAllowed(firing, attacker, target);
          expect(n).toBeGreaterThan(0);
          const cells = randomTargets(rng, target, n);
          expect(validateVolley(target, cells, n)).toBeNull();
          const results = resolveVolley(target, cells);
          if (!keepsTurn(firing, results)) turn = 1 - turn;
          volleys++;
          expect(volleys).toBeLessThan(400);
        }
        const loser = isDefeated(boards[0]) ? boards[0] : boards[1];
        const winner = loser === boards[0] ? boards[1] : boards[0];
        expect(isDefeated(winner)).toBe(false);
        const pub = publicBoard(loser);
        expect(pub.split('').filter((c) => c === '#')).toHaveLength(fleetCells(fleet));
        expect(pub.includes('x')).toBe(false);
        expect(sunkVessels(loser)).toHaveLength(SHIPS_FLEETS[fleet].vessels.length);
        // Public boards only ever mark squares that were shot.
        for (const b of boards) {
          const p = publicBoard(b);
          for (let i = 0; i < p.length; i++) expect(p[i] === '.').toBe(b.shots[i] === 0);
        }
      }
    });
  }
});
