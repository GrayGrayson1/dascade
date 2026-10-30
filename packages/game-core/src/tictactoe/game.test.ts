import { describe, expect, it } from 'vitest';
import { TTT_MOVE_LIMIT, TTT_VARIANTS, tttCellCount, type TttVariant } from '@dascade/shared/games/tictactoe';
import {
  cellName,
  dropCell,
  fadingCells,
  legalMoves,
  markOf,
  newGame,
  newPosition,
  numbersLeft,
  playMove,
  repetitionCount,
  replay,
  resolveMove,
  topOf,
  visible,
  type TttGame,
  type TttMove,
  type TttPosition,
} from './index.ts';

const cells = (...moves: number[]): TttMove[] => moves.map((cell) => ({ cell }));

/** Play one move that must be legal. */
function play(game: TttGame, move: TttMove): TttGame {
  const r = playMove(game, move);
  if (!r.ok) throw new Error(`refused ${JSON.stringify(move)}: ${r.reason}`);
  return r.game;
}

/** A game record in a hand-made position (white-box: the engine reads only these fields). */
function at(variant: TttVariant, patch: Partial<TttPosition>, extra: Partial<TttGame> = {}): TttGame {
  const game = newGame(variant);
  return { ...game, position: { ...game.position, ...patch }, ...extra };
}

/** Cells of a board, '' where the string has '.', from a compact string. */
const board = (s: string) => [...s].map((c) => (c === '.' ? '' : c));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe('new games', () => {
  it('starts every variant empty with the first side to move', () => {
    for (const variant of TTT_VARIANTS) {
      const g = newGame(variant);
      expect(g.position.cells).toHaveLength(tttCellCount(variant));
      expect(g.position.cells.every((c) => c === '')).toBe(true);
      expect(g.position.turn).toBe('first');
      expect(g.position.active).toBe(-1);
      expect(g.plies).toEqual([]);
      expect(g.result).toBeNull();
      expect(repetitionCount(g)).toBe(1);
    }
  });

  it('sets up the variant extras', () => {
    expect(newPosition('ultimate').boards).toBe('.........');
    expect(newPosition('notakto').boards).toBe('...');
    expect(newPosition('classic').boards).toBe('');
    expect(newPosition('nesting').hands).toEqual([2, 2, 2, 2, 2, 2]);
    expect(newPosition('classic').hands).toEqual([]);
  });

  it('offers every empty cell (and every mark / number / piece) as a first move', () => {
    const count = (v: TttVariant) => legalMoves(newPosition(v)).length;
    expect(count('classic')).toBe(9);
    expect(count('gomoku')).toBe(225);
    expect(count('ultimate')).toBe(81);
    expect(count('notakto')).toBe(27);
    expect(count('cube')).toBe(64);
    expect(count('wild')).toBe(18);
    expect(count('orderchaos')).toBe(72);
    expect(count('numbers')).toBe(45); // 9 cells × 5 odd numbers
    expect(count('gravity')).toBe(7);
    expect(count('nesting')).toBe(27); // 9 cells × 3 sizes, nothing to move yet
  });

  it('gives each side its mark', () => {
    expect(markOf('classic', 'first')).toBe('x');
    expect(markOf('classic', 'second')).toBe('o');
    expect(markOf('notakto', 'second')).toBe('x');
  });
});

describe('cell names and notation', () => {
  it('names cells by column letter and row from the bottom', () => {
    expect(cellName('classic', 0)).toBe('a3');
    expect(cellName('classic', 4)).toBe('b2');
    expect(cellName('classic', 8)).toBe('c1');
    expect(cellName('gomoku', 0)).toBe('a15');
    expect(cellName('gomoku', 224)).toBe('o1');
    expect(cellName('gravity', 38)).toBe('d1');
    expect(cellName('orderchaos', 35)).toBe('f1');
  });
  it('names Ultimate cells on the 9×9 grid', () => {
    expect(cellName('ultimate', 0)).toBe('a9');
    expect(cellName('ultimate', 40)).toBe('e5');
    expect(cellName('ultimate', 80)).toBe('i1');
    expect(cellName('ultimate', 2 * 9 + 2)).toBe('i9'); // top-right board, its top-right cell
  });
  it('prefixes the board or layer number (Notakto, cube)', () => {
    expect(cellName('notakto', 9)).toBe('2·a3');
    expect(cellName('cube', 21)).toBe('2·b3');
    expect(cellName('cube', 63)).toBe('4·d1');
  });
  it('writes marks, numbers and pieces into the notation', () => {
    expect(replay('classic', cells(4)).plies[0]!.notation).toBe('b2');
    expect(replay('wild', [{ cell: 0, mark: 'o' }]).plies[0]!.notation).toBe('Oa3');
    expect(replay('orderchaos', [{ cell: 0, mark: 'x' }]).plies[0]!.notation).toBe('Xa6');
    expect(replay('numbers', [{ cell: 4, num: 5 }]).plies[0]!.notation).toBe('5b2');
    const g = replay('nesting', [
      { cell: 0, size: 3 },
      { cell: 8, size: 1 },
      { cell: 4, from: 0 },
    ]);
    expect(g.plies.map((p) => p.notation)).toEqual(['La3', 'Sc1', 'La3-b2']);
    expect(replay('gravity', cells(3)).plies[0]!.notation).toBe('d1');
  });
});

describe('resolveMove', () => {
  it('refuses cells outside the board, fractional cells and taken cells', () => {
    const p = replay('classic', cells(4)).position;
    expect(resolveMove(p, { cell: -1 })).toBeNull();
    expect(resolveMove(p, { cell: 9 })).toBeNull();
    expect(resolveMove(p, { cell: 1.5 })).toBeNull();
    expect(resolveMove(p, { cell: 4 })).toBeNull();
    expect(resolveMove(newPosition('cube'), { cell: 64 })).toBeNull();
  });
  it('uses the side’s own mark whatever the client sends', () => {
    expect(resolveMove(newPosition('classic'), { cell: 0, mark: 'o' })).toEqual({ cell: 0, mark: 'x' });
    expect(resolveMove(replay('classic', cells(4)).position, { cell: 0, mark: 'x' })).toEqual({ cell: 0, mark: 'o' });
  });
  it('drops Gravity moves to the lowest empty cell of the column', () => {
    expect(resolveMove(newPosition('gravity'), { cell: 3 })).toEqual({ cell: 38, mark: 'x' });
    expect(resolveMove(newPosition('gravity'), { cell: 24 })).toEqual({ cell: 38, mark: 'x' });
  });
  it('needs a mark (Wild, Order & Chaos), a number (Numbers) and a piece (Nesting)', () => {
    expect(resolveMove(newPosition('wild'), { cell: 0 })).toBeNull();
    expect(resolveMove(newPosition('orderchaos'), { cell: 0 })).toBeNull();
    expect(resolveMove(newPosition('numbers'), { cell: 0 })).toBeNull();
    expect(resolveMove(newPosition('nesting'), { cell: 0 })).toBeNull();
    expect(resolveMove(newPosition('nesting'), { cell: 0, size: 2 })).toEqual({ cell: 0, size: 2 });
  });
});

describe('playMove basics', () => {
  it('alternates turns and records plies', () => {
    const g = replay('classic', cells(4, 0));
    expect(g.position.turn).toBe('first');
    expect(g.plies.map((p) => [p.side, p.move.cell])).toEqual([
      ['first', 4],
      ['second', 0],
    ]);
    expect(g.position.cells[4]).toBe('x');
    expect(g.position.cells[0]).toBe('o');
  });

  it('refuses illegal moves and any move after the end', () => {
    const g = replay('classic', cells(4));
    expect(playMove(g, { cell: 4 })).toEqual({ ok: false, reason: 'illegal' });
    const won = replay('classic', cells(0, 3, 1, 4, 2));
    expect(playMove(won, { cell: 8 })).toEqual({ ok: false, reason: 'over' });
  });

  it('never mutates the game it is given', () => {
    for (const [variant, setup, move] of [
      ['classic', cells(4), { cell: 0 }],
      ['ultimate', cells(4), { cell: 36 }],
      ['vanishing', cells(0, 4, 8, 2, 6, 3), { cell: 5 }],
      ['nesting', [{ cell: 0, size: 1 }], { cell: 0, size: 3 }],
      ['notakto', cells(0, 1), { cell: 2 }],
      ['gravity', cells(3), { cell: 3 }],
      ['numbers', [{ cell: 4, num: 5 }], { cell: 0, num: 2 }],
    ] as const) {
      const game = deepFreeze(replay(variant, setup as TttMove[]));
      const before = JSON.stringify(game);
      const r = playMove(game, move as TttMove);
      expect(r.ok).toBe(true);
      expect(JSON.stringify(game)).toBe(before);
    }
  });

  it('replay plays a move list and throws on an illegal one', () => {
    let g = newGame('classic');
    for (const m of cells(0, 4, 8)) g = play(g, m);
    expect(replay('classic', cells(0, 4, 8))).toEqual(g);
    expect(() => replay('classic', cells(0, 0))).toThrow(/illegal/);
  });

  it('replays the recorded (normalized) moves to the same game', () => {
    const g = replay('gravity', cells(3, 3, 4, 24, 0));
    expect(
      replay(
        'gravity',
        g.plies.map((p) => p.move),
      ),
    ).toEqual(g);
  });
});

describe('Classic', () => {
  it('wins three in a row across, down and on both diagonals', () => {
    expect(replay('classic', cells(0, 3, 1, 4, 2)).result).toEqual({ winner: 'first', reason: 'line', line: [0, 1, 2] });
    expect(replay('classic', cells(0, 1, 3, 2, 6)).result).toEqual({ winner: 'first', reason: 'line', line: [0, 3, 6] });
    expect(replay('classic', cells(0, 1, 4, 2, 8)).result).toEqual({ winner: 'first', reason: 'line', line: [0, 4, 8] });
    expect(replay('classic', cells(2, 0, 4, 1, 6)).result).toEqual({ winner: 'first', reason: 'line', line: [2, 4, 6] });
  });

  it('lets O win too', () => {
    expect(replay('classic', cells(0, 3, 1, 4, 8, 5)).result).toEqual({ winner: 'second', reason: 'line', line: [3, 4, 5] });
  });

  it('highlights both lines of a double win', () => {
    const g = replay('classic', cells(0, 1, 2, 3, 6, 5, 8, 7, 4));
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [0, 2, 4, 6, 8] });
  });

  it('draws on a full board without a line', () => {
    const g = replay('classic', cells(0, 1, 2, 4, 3, 5, 7, 6, 8));
    expect(g.result).toEqual({ winner: null, reason: 'full', line: [] });
    expect(g.plies).toHaveLength(9);
  });

  it('does not end the game early', () => {
    expect(replay('classic', cells(0, 3, 1, 4)).result).toBeNull();
  });
});

describe('Misère', () => {
  it('makes the player who completes three in a row lose', () => {
    expect(replay('misere', cells(0, 3, 1, 4, 2)).result).toEqual({ winner: 'second', reason: 'misere', line: [0, 1, 2] });
    expect(replay('misere', cells(0, 3, 1, 4, 8, 5)).result).toEqual({ winner: 'first', reason: 'misere', line: [3, 4, 5] });
  });
  it('draws on a full board', () => {
    expect(replay('misere', cells(0, 1, 2, 4, 3, 5, 7, 6, 8)).result).toEqual({ winner: null, reason: 'full', line: [] });
  });
});

describe('Big Board (5×5, four in a row)', () => {
  it('needs four, not three', () => {
    const three = replay('bigboard', cells(0, 5, 1, 6, 2, 7));
    expect(three.result).toBeNull();
    expect(play(three, { cell: 3 }).result).toEqual({ winner: 'first', reason: 'line', line: [0, 1, 2, 3] });
  });
  it('wins on a diagonal anywhere on the board', () => {
    const g = replay('bigboard', cells(1, 0, 7, 2, 13, 3, 19));
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [1, 7, 13, 19] });
  });
});

describe('Gomoku (15×15, five in a row)', () => {
  it('wins with five and counts six in a row too', () => {
    const four = replay('gomoku', cells(108, 0, 109, 2, 110, 4, 111));
    expect(four.result).toBeNull();
    const five = play(four, { cell: 6 });
    expect(play(five, { cell: 112 }).result).toEqual({ winner: 'first', reason: 'line', line: [108, 109, 110, 111, 112] });
    const six = replay('gomoku', cells(108, 0, 109, 2, 110, 4, 111, 6, 113, 8, 112));
    expect(six.result).toEqual({ winner: 'first', reason: 'line', line: [108, 109, 110, 111, 112, 113] });
  });
  it('wins down a column on the edge', () => {
    const g = replay('gomoku', cells(14, 0, 29, 1, 44, 2, 59, 3, 74));
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [14, 29, 44, 59, 74] });
  });
});

describe('Gravity (7×6, four in a row)', () => {
  it('lands marks on the lowest empty cell and stacks them', () => {
    const g = replay('gravity', cells(3, 3));
    expect(g.position.cells[38]).toBe('x');
    expect(g.position.cells[31]).toBe('o');
    expect(g.plies.map((p) => p.move.cell)).toEqual([38, 31]);
    expect(dropCell(g.position, 3)).toBe(24);
    expect(dropCell(g.position, 0)).toBe(35);
  });

  it('accepts any cell of the column and refuses a full column', () => {
    let g = newGame('gravity');
    for (const cell of [0, 7, 14, 21, 28, 35]) g = play(g, { cell });
    expect(g.position.cells.filter((_, i) => i % 7 === 0)).toEqual(['o', 'x', 'o', 'x', 'o', 'x']);
    expect(dropCell(g.position, 0)).toBe(-1);
    expect(playMove(g, { cell: 0 }).ok).toBe(false);
    expect(playMove(g, { cell: 14 }).ok).toBe(false);
    expect(legalMoves(g.position)).toHaveLength(6);
  });

  it('wins across the bottom and straight up a column', () => {
    expect(replay('gravity', cells(0, 0, 1, 1, 2, 2, 3)).result).toEqual({ winner: 'first', reason: 'line', line: [35, 36, 37, 38] });
    expect(replay('gravity', cells(0, 1, 0, 1, 0, 1, 0)).result).toEqual({ winner: 'first', reason: 'line', line: [14, 21, 28, 35] });
  });

  it('wins on a rising diagonal', () => {
    // X climbs a staircase from the bottom-left: 35, 29, 23, 17.
    const g = replay('gravity', cells(0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3));
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [17, 23, 29, 35] });
  });

  it('draws when all 42 cells fill without a line', () => {
    // Columns filled in pairs so no four ever line up: 0,1 then 2,3 then 4,5, then 6.
    const order = [
      0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6,
    ];
    const g = replay('gravity', cells(...order));
    expect(g.plies).toHaveLength(42);
    expect(g.result).toEqual({ winner: null, reason: 'full', line: [] });
  });
});

describe('3D Cube (4×4×4, four in a row)', () => {
  it('wins straight down through the four layers', () => {
    expect(replay('cube', cells(0, 1, 16, 2, 32, 3, 48)).result).toEqual({ winner: 'first', reason: 'line', line: [0, 16, 32, 48] });
  });
  it('wins on a space diagonal', () => {
    expect(replay('cube', cells(0, 1, 21, 2, 42, 3, 63)).result).toEqual({ winner: 'first', reason: 'line', line: [0, 21, 42, 63] });
  });
  it('wins within a layer', () => {
    expect(replay('cube', cells(16, 0, 17, 1, 18, 2, 19)).result).toEqual({ winner: 'first', reason: 'line', line: [16, 17, 18, 19] });
  });
});

describe('Vanishing', () => {
  const setup = cells(0, 4, 8, 2, 6, 3); // X: 0, 8, 6 · O: 4, 2, 3

  it('keeps three marks each: the fourth erases the oldest', () => {
    const g = replay('vanishing', setup);
    expect(g.ages).toEqual({ first: [0, 8, 6], second: [4, 2, 3] });
    expect(fadingCells(g)).toEqual({ first: 0, second: 4 });
    const next = playMove(g, { cell: 5 });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ply.removed).toBe(0);
    expect(next.game.position.cells[0]).toBe('');
    expect(next.game.position.cells[5]).toBe('x');
    expect(next.game.ages.first).toEqual([8, 6, 5]);
    expect(next.game.position.cells.filter((c) => c === 'x')).toHaveLength(3);
    expect(next.game.result).toBeNull();
  });

  it('marks nothing as fading before a side has three marks', () => {
    expect(fadingCells(replay('vanishing', cells(0, 4, 8)))).toEqual({ first: -1, second: -1 });
    expect(replay('vanishing', cells(0, 4, 8)).plies.every((p) => p.removed === -1)).toBe(true);
  });

  it('refuses occupied cells, including the mark about to fade', () => {
    const g = replay('vanishing', setup);
    expect(playMove(g, { cell: 0 }).ok).toBe(false);
    expect(playMove(g, { cell: 4 }).ok).toBe(false);
  });

  it('wins with the three marks left after the oldest fades', () => {
    // X places 7: 0 fades and 8, 6, 7 make the bottom row.
    const g = replay('vanishing', [...setup, { cell: 7 }]);
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [6, 7, 8] });
    expect(g.plies.at(-1)!.removed).toBe(0);
  });

  it('draws when the same position comes up a third time', () => {
    // X cycles 0,1,5,6 and O cycles 2,3,4,8: no three of either set make a line.
    const start = cells(0, 2, 1, 3, 5, 4);
    const cycle = cells(6, 8, 0, 2, 1, 3, 5, 4);
    const twice = replay('vanishing', [...start, ...cycle]);
    expect(twice.result).toBeNull();
    expect(repetitionCount(twice)).toBe(2);
    const g = replay('vanishing', [...start, ...cycle, ...cycle]);
    expect(g.result).toEqual({ winner: null, reason: 'repetition', line: [] });
    expect(g.plies).toHaveLength(22);
  });

  it('draws at the move limit', () => {
    const g = replay('vanishing', setup);
    const long: TttGame = { ...g, plies: Array.from({ length: TTT_MOVE_LIMIT - 1 }, () => g.plies[0]!) };
    const r = playMove(long, { cell: 5 });
    expect(r.ok && r.game.result).toEqual({ winner: null, reason: 'move_limit', line: [] });
  });
});

describe('Wild', () => {
  it('lets either side place either mark; completing any line wins', () => {
    const g = replay('wild', [
      { cell: 0, mark: 'x' },
      { cell: 4, mark: 'o' },
      { cell: 1, mark: 'x' },
      { cell: 2, mark: 'x' },
    ]);
    expect(g.result).toEqual({ winner: 'second', reason: 'line', line: [0, 1, 2] });
    const o = replay('wild', [
      { cell: 0, mark: 'o' },
      { cell: 4, mark: 'x' },
      { cell: 1, mark: 'o' },
      { cell: 8, mark: 'x' },
      { cell: 2, mark: 'o' },
    ]);
    expect(o.result).toEqual({ winner: 'first', reason: 'line', line: [0, 1, 2] });
  });
  it('does not count mixed lines', () => {
    const g = replay('wild', [
      { cell: 0, mark: 'x' },
      { cell: 1, mark: 'o' },
      { cell: 2, mark: 'x' },
    ]);
    expect(g.result).toBeNull();
  });
});

describe('Numbers', () => {
  it('gives odds to the first side and evens to the second, each once', () => {
    const p = newPosition('numbers');
    expect(numbersLeft(p)).toEqual([1, 3, 5, 7, 9]);
    expect(numbersLeft(p, 'second')).toEqual([2, 4, 6, 8]);
    expect(resolveMove(p, { cell: 0, num: 2 })).toBeNull();
    const g = replay('numbers', [{ cell: 4, num: 5 }]);
    expect(numbersLeft(g.position)).toEqual([2, 4, 6, 8]);
    expect(resolveMove(g.position, { cell: 0, num: 5 })).toBeNull();
    expect(resolveMove(g.position, { cell: 0, num: 3 })).toBeNull();
    const g2 = play(g, { cell: 0, num: 2 });
    expect(numbersLeft(g2.position)).toEqual([1, 3, 7, 9]);
    expect(resolveMove(g2.position, { cell: 1, num: 5 })).toBeNull();
  });

  it('wins with a full line adding up to 15, whoever’s numbers are in it', () => {
    const g = replay('numbers', [
      { cell: 4, num: 5 },
      { cell: 0, num: 4 },
      { cell: 1, num: 1 },
      { cell: 8, num: 6 },
    ]);
    expect(g.result).toEqual({ winner: 'second', reason: 'sum', line: [0, 4, 8] });
  });

  it('ignores full lines with another total and draws on a full board', () => {
    const g = replay('numbers', [
      { cell: 0, num: 1 },
      { cell: 1, num: 2 },
      { cell: 2, num: 3 },
      { cell: 3, num: 4 },
      { cell: 4, num: 9 },
      { cell: 6, num: 6 },
      { cell: 5, num: 5 },
      { cell: 8, num: 8 },
      { cell: 7, num: 7 },
    ]);
    expect(g.result).toEqual({ winner: null, reason: 'full', line: [] });
  });
});

describe('Ultimate', () => {
  const u = (b: number, i: number) => b * 9 + i;

  it('sends the opponent to the board matching the square played', () => {
    const g = replay('ultimate', cells(u(0, 4)));
    expect(g.position.active).toBe(4);
    expect(playMove(g, { cell: u(0, 0) }).ok).toBe(false);
    expect(legalMoves(g.position).map((m) => Math.floor(m.cell / 9))).toEqual(Array(9).fill(4));
    expect(play(g, { cell: u(4, 4) }).position.active).toBe(4);
  });

  it('wins a small board, then a player sent to it may play anywhere open', () => {
    const g = replay('ultimate', cells(u(0, 1), u(1, 0), u(0, 2), u(2, 0), u(0, 0)));
    expect(g.position.boards).toBe('x........');
    expect(g.plies.at(-1)!.board).toBe(0);
    expect(g.position.active).toBe(-1);
    expect(g.result).toBeNull();
    // Board 0 is closed even though it has empty squares.
    expect(playMove(g, { cell: u(0, 5) }).ok).toBe(false);
    expect(legalMoves(g.position)).toHaveLength(81 - 9 - 2);
  });

  it('marks a small board that fills without a line as nobody’s', () => {
    const drawn = board('xoxxoooxx').map((c, i) => (i === 8 ? '' : c));
    const all = Array<string>(81).fill('');
    drawn.forEach((c, i) => (all[27 + i] = c));
    const g = at('ultimate', { cells: all, active: 3 });
    const next = play(g, { cell: u(3, 8) });
    expect(next.position.boards[3]).toBe('=');
    expect(next.plies.at(-1)!.board).toBe(3);
    expect(next.position.active).toBe(8);
  });

  it('frees the next player when they are sent to a decided board', () => {
    const g = at('ultimate', { boards: '...=.....', active: 0 });
    expect(play(g, { cell: u(0, 3) }).position.active).toBe(-1);
  });

  it('wins the game with three small boards in a row (the line lists the boards)', () => {
    const all = Array<string>(81).fill('');
    all[u(2, 0)] = 'x';
    all[u(2, 1)] = 'x';
    const g = at('ultimate', { cells: all, boards: 'xx.......', active: 2 });
    const next = play(g, { cell: u(2, 2) });
    expect(next.position.boards).toBe('xxx......');
    expect(next.result).toEqual({ winner: 'first', reason: 'boards', line: [0, 1, 2] });
  });

  it('does not count drawn boards in a line', () => {
    const all = Array<string>(81).fill('');
    all[u(2, 0)] = 'x';
    all[u(2, 1)] = 'x';
    const g = at('ultimate', { cells: all, boards: 'x=.......', active: 2 });
    expect(play(g, { cell: u(2, 2) }).result).toBeNull();
  });

  it('draws when every small board is decided without a line of boards', () => {
    const all = Array<string>(81).fill('');
    board('xoxxoooxx').forEach((c, i) => (all[72 + i] = i === 8 ? '' : c));
    const g = at('ultimate', { cells: all, boards: 'xoxxooox.', active: 8 });
    const next = play(g, { cell: u(8, 8) });
    expect(next.position.boards).toBe('xoxxooox=');
    expect(next.result).toEqual({ winner: null, reason: 'full', line: [] });
  });
});

describe('Notakto', () => {
  it('has both players place X', () => {
    const g = replay('notakto', cells(0, 1));
    expect(g.position.cells[0]).toBe('x');
    expect(g.position.cells[1]).toBe('x');
  });

  it('kills a board with three X in a row; nobody plays there again', () => {
    const g = replay('notakto', cells(0, 1, 2));
    expect(g.position.boards).toBe('#..');
    expect(g.plies.at(-1)!.board).toBe(0);
    expect(g.result).toBeNull();
    expect(playMove(g, { cell: 4 }).ok).toBe(false);
    expect(legalMoves(g.position).every((m) => m.cell >= 9)).toBe(true);
  });

  it('makes the player who kills the last live board lose', () => {
    const all = Array<string>(27).fill('');
    all[18] = 'x';
    all[19] = 'x';
    const g = at('notakto', { cells: all, boards: '##.' });
    expect(play(g, { cell: 20 }).result).toEqual({ winner: 'second', reason: 'last_board', line: [18, 19, 20] });
    expect(play({ ...g, position: { ...g.position, turn: 'second' } }, { cell: 20 }).result?.winner).toBe('first');
  });
});

describe('Nesting', () => {
  it('places pieces from the hand and counts them down', () => {
    const g = replay('nesting', [{ cell: 0, size: 1 }]);
    expect(g.position.cells[0]).toBe('x1');
    expect(g.position.hands).toEqual([1, 2, 2, 2, 2, 2]);
    const g2 = replay('nesting', [
      { cell: 0, size: 1 },
      { cell: 8, size: 3 },
      { cell: 1, size: 1 },
      { cell: 7, size: 3 },
    ]);
    expect(g2.position.hands).toEqual([0, 2, 2, 2, 2, 0]);
    expect(resolveMove(g2.position, { cell: 2, size: 1 })).toBeNull();
    expect(resolveMove({ ...g2.position, turn: 'second' }, { cell: 2, size: 3 })).toBeNull();
  });

  it('covers smaller pieces only, of either owner', () => {
    const g = replay('nesting', [
      { cell: 0, size: 1 },
      { cell: 0, size: 2 },
    ]);
    expect(g.position.cells[0]).toBe('x1o2');
    expect(topOf('x1o2')).toEqual({ owner: 'o', size: 2 });
    expect(visible('nesting', 'x1o2')).toBe('o');
    expect(resolveMove(g.position, { cell: 0, size: 2 })).toBeNull();
    expect(resolveMove(g.position, { cell: 0, size: 1 })).toBeNull();
    expect(play(g, { cell: 0, size: 3 }).position.cells[0]).toBe('x1o2x3');
  });

  it('moves one of your visible pieces, uncovering what was under it', () => {
    const g = replay('nesting', [
      { cell: 0, size: 1 },
      { cell: 0, size: 2 },
      { cell: 0, size: 3 },
      { cell: 8, size: 1 },
    ]);
    const next = playMove(g, { cell: 4, from: 0 });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.ply.move).toEqual({ cell: 4, from: 0, size: 3 });
    expect(next.game.position.cells[0]).toBe('x1o2');
    expect(next.game.position.cells[4]).toBe('x3');
    expect(next.game.position.hands).toEqual(g.position.hands);
  });

  it('refuses moving the opponent’s piece, onto an equal or bigger piece, or nowhere', () => {
    const g = replay('nesting', [
      { cell: 0, size: 2 },
      { cell: 8, size: 2 },
    ]);
    expect(resolveMove(g.position, { cell: 4, from: 8 })).toBeNull();
    expect(resolveMove(g.position, { cell: 8, from: 0 })).toBeNull();
    expect(resolveMove(g.position, { cell: 0, from: 0 })).toBeNull();
    expect(resolveMove(g.position, { cell: 4, from: 3 })).toBeNull(); // empty
    expect(resolveMove(g.position, { cell: 4, from: 0, size: 3 })).toBeNull(); // wrong size
    expect(resolveMove(g.position, { cell: 4, from: 0, size: 2 })).toEqual({ cell: 4, from: 0, size: 2 });
  });

  it('wins with three visible pieces in a row', () => {
    const g = replay('nesting', [
      { cell: 0, size: 1 },
      { cell: 3, size: 1 },
      { cell: 1, size: 1 },
      { cell: 4, size: 1 },
      { cell: 2, size: 2 },
    ]);
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [0, 1, 2] });
  });

  it('hands the win to the opponent whose line you uncover', () => {
    const g = at('nesting', { cells: ['o1', 'o1', 'o2x3', '', '', '', '', '', ''], hands: [2, 2, 1, 0, 1, 2] });
    expect(play(g, { cell: 4, from: 2 }).result).toEqual({ winner: 'second', reason: 'uncovered', line: [0, 1, 2] });
    // Covering a piece of that line with the same move saves the day.
    expect(play(g, { cell: 0, from: 2 }).result).toBeNull();
  });

  it('draws when the same position comes up a third time', () => {
    const shuffle: TttMove[] = [
      { cell: 1, from: 0 },
      { cell: 7, from: 8 },
      { cell: 0, from: 1 },
      { cell: 8, from: 7 },
    ];
    const g = replay('nesting', [{ cell: 0, size: 3 }, { cell: 8, size: 3 }, ...shuffle, ...shuffle]);
    expect(g.result).toEqual({ winner: null, reason: 'repetition', line: [] });
    expect(g.plies).toHaveLength(10);
    const before = replay('nesting', [{ cell: 0, size: 3 }, { cell: 8, size: 3 }, ...shuffle]);
    expect(repetitionCount(before)).toBe(2);
  });
});

describe('Order & Chaos', () => {
  it('gives Order the win for five of either mark in a row, whoever placed it', () => {
    const g = replay('orderchaos', [
      { cell: 0, mark: 'o' },
      { cell: 1, mark: 'o' },
      { cell: 2, mark: 'o' },
      { cell: 10, mark: 'x' },
      { cell: 3, mark: 'o' },
      { cell: 4, mark: 'o' },
    ]);
    expect(g.plies.at(-1)!.side).toBe('second');
    expect(g.result).toEqual({ winner: 'first', reason: 'line', line: [0, 1, 2, 3, 4] });
  });

  it('gives Chaos the win when the board fills without five in a row', () => {
    const pattern = Array.from({ length: 36 }, (_, i) => ((2 * Math.floor(i / 6) + (i % 6)) % 4 < 2 ? 'x' : 'o'));
    const all = pattern.map((c, i) => (i === 35 ? '' : c));
    const g = at('orderchaos', { cells: all });
    expect(play(g, { cell: 35, mark: pattern[35] as 'x' | 'o' }).result).toEqual({ winner: 'second', reason: 'chaos', line: [] });
    expect(play({ ...g, position: { ...g.position, turn: 'second' } }, { cell: 35, mark: pattern[35] as 'x' | 'o' }).result?.winner).toBe(
      'second',
    );
  });
});
