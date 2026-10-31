import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { REVERSI_VARIANTS, REVERSI_VARIANT_INFO, reversiCellCount, type ReversiVariant } from '@dascade/shared/games/reversi';
import {
  applyPlacement,
  canMove,
  cellIndex,
  cellName,
  centreCells,
  cornerHoles,
  discCounts,
  flipsAt,
  fromPlies,
  inOpening,
  isFinal,
  legalMoves,
  mustPass,
  newGame,
  playMove,
  randomBlockers,
  randomOpening,
  randomSetup,
  refusal,
  scoreResult,
  startBoard,
  startPosition,
  type ReversiGame,
  type ReversiPosition,
} from './index.ts';

const at = (name: string, size = 8) => cellIndex(size, name);
const names = (cells: readonly number[], size = 8) => cells.map((c) => cellName(size, c));
const pos = (
  variant: ReversiVariant,
  rows: string[],
  turn: 'first' | 'second' = 'first',
  supply: [number, number] | null = null,
): ReversiPosition => ({
  variant,
  board: rows.join(''),
  turn,
  supply,
});
const gameAt = (position: ReversiPosition): ReversiGame => ({
  variant: position.variant,
  start: position,
  position,
  plies: [],
  result: null,
});

/** Leaf count of the move tree (a skipped turn counts as one move), like the published perft tables. */
function perft(position: ReversiPosition, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(position);
  if (moves.length === 0) {
    if (isFinal(position)) return 1;
    return perft({ ...position, turn: position.turn === 'first' ? 'second' : 'first' }, depth - 1);
  }
  let n = 0;
  for (const m of moves) n += perft(applyPlacement(position, m)!.position, depth - 1);
  return n;
}

describe('reversi — coordinates', () => {
  it('names cells by column letter and row from the top, both ways', () => {
    expect(cellName(8, 0)).toBe('a1');
    expect(cellName(8, 7)).toBe('h1');
    expect(cellName(8, 63)).toBe('h8');
    expect(cellName(10, 99)).toBe('j10');
    for (const size of [6, 8, 10]) for (let c = 0; c < size * size; c++) expect(cellIndex(size, cellName(size, c))).toBe(c);
    expect(cellIndex(8, 'i1')).toBe(-1);
    expect(cellIndex(8, 'a9')).toBe(-1);
    expect(cellIndex(8, 'zz')).toBe(-1);
  });
});

describe('reversi — setup', () => {
  it('Classic starts crosswise in the centre, Black to move', () => {
    const p = startPosition('classic');
    expect(p.board[at('d4')]).toBe('w');
    expect(p.board[at('e4')]).toBe('b');
    expect(p.board[at('d5')]).toBe('b');
    expect(p.board[at('e5')]).toBe('w');
    expect(discCounts(p.board)).toEqual([2, 2]);
    expect(p.turn).toBe('first');
    expect(p.supply).toBeNull();
  });

  it('every variant has a board of its size with the right start', () => {
    for (const v of REVERSI_VARIANTS) {
      const info = REVERSI_VARIANT_INFO[v];
      const board = startBoard(v);
      expect(board).toHaveLength(reversiCellCount(v));
      expect(board).toMatch(/^[.bw#]+$/);
      const [b, w] = discCounts(board);
      expect(b + w).toBe(info.start === 'empty' ? 0 : 4);
      const holes = [...board].filter((ch) => ch === '#').length;
      expect(holes).toBe(info.holes === 'corners' ? 12 : 0);
      for (const c of centreCells(info.size)) expect(board[c]).not.toBe('#');
    }
  });

  it('Mini and Grand put the four discs in their own centre', () => {
    expect(
      names(
        [...startBoard('mini')].flatMap((ch, i) => (ch === 'b' ? [i] : [])),
        6,
      ),
    ).toEqual(['d3', 'c4']);
    expect(
      names(
        [...startBoard('grand')].flatMap((ch, i) => (ch === 'w' ? [i] : [])),
        10,
      ),
    ).toEqual(['e5', 'f6']);
  });

  it('Parallel Start puts each colour side by side', () => {
    const board = startBoard('parallel');
    expect([board[at('d4')], board[at('e4')], board[at('d5')], board[at('e5')]]).toEqual(['w', 'w', 'b', 'b']);
    expect(names(legalMoves(startPosition('parallel')))).toEqual(['c3', 'd3', 'e3', 'f3']);
  });

  it('Octagon cuts three squares off each corner', () => {
    expect(names(cornerHoles(8))).toEqual(['a1', 'b1', 'g1', 'h1', 'a2', 'h2', 'a7', 'h7', 'a8', 'b8', 'g8', 'h8']);
    const board = startBoard('octagon');
    for (const c of cornerHoles(8)) expect(board[c]).toBe('#');
  });

  it('Original starts empty with 32 discs each', () => {
    const p = startPosition('original');
    expect(discCounts(p.board)).toEqual([0, 0]);
    expect(p.supply).toEqual([32, 32]);
    expect(inOpening(p)).toBe(true);
  });

  it('rejects a board of the wrong size', () => {
    expect(() => startPosition('classic', '.'.repeat(36))).toThrow();
  });
});

describe('reversi — moves', () => {
  it('Black opens with d3, c4, f5 or e6, each flipping one disc', () => {
    const p = startPosition('classic');
    expect(names(legalMoves(p))).toEqual(['d3', 'c4', 'f5', 'e6']);
    expect(names(flipsAt(p, at('d3')))).toEqual(['d4']);
    expect(names(flipsAt(p, at('e6')))).toEqual(['e5']);
    expect(flipsAt(p, at('a1'))).toEqual([]);
    expect(flipsAt(p, at('d4'))).toEqual([]);
  });

  it('matches the published move-tree counts of the standard game (depth 1–6)', () => {
    const p = startPosition('classic');
    expect([1, 2, 3, 4, 5, 6].map((d) => perft(p, d))).toEqual([4, 12, 56, 244, 1396, 8200]);
  });

  it('flips in all eight directions at once', () => {
    const p = pos('classic', ['........', '.b.b.b..', '..www...', '.bw.wb..', '..www...', '.b.b.b..', '........', '........']);
    expect(names(flipsAt(p, at('d4')))).toEqual(['c3', 'd3', 'e3', 'c4', 'e4', 'c5', 'd5', 'e5']);
    const played = applyPlacement(p, at('d4'))!;
    expect(discCounts(played.position.board)).toEqual([17, 0]);
    expect(played.position.turn).toBe('second');
  });

  it('a line must end in one of your own discs (not an empty square or the edge)', () => {
    const p = pos('classic', ['.wwwww..', '........', '........', '........', '........', '........', '........', 'b.......']);
    expect(flipsAt(p, at('a1'))).toEqual([]);
    expect(flipsAt(p, at('g1'))).toEqual([]);
    expect(refusal(p, at('a1'))).toBe('no_flip');
  });

  it('refuses taken squares, holes and squares off the board', () => {
    const p = startPosition('octagon');
    expect(refusal(p, at('d4'))).toBe('occupied');
    expect(refusal(p, at('a1'))).toBe('hole');
    expect(refusal(p, 64)).toBe('off_board');
    expect(refusal(p, -1)).toBe('off_board');
    expect(refusal(p, 2.5)).toBe('off_board');
    expect(refusal(p, at('d3'))).toBeNull();
  });

  it('a missing square ends a line (Octagon, Blockers)', () => {
    const open = pos('octagon', ['#.....##', '#.......', '........', '.wb.....', '........', '........', '#......#', '##....##']);
    expect(names(flipsAt(open, at('a4')))).toEqual(['b4']);
    const holed = pos('octagon', ['#.....##', '#.......', '........', '.w#b....', '........', '........', '#......#', '##....##']);
    expect(flipsAt(holed, at('a4'))).toEqual([]);
  });

  it('Wraparound lines continue across the edges', () => {
    const rows = ['........', '........', '........', '......bw', '........', '........', '........', '........'];
    expect(names(flipsAt(pos('torus', rows), at('a4')))).toEqual(['h4']);
    expect(flipsAt(pos('classic', rows), at('a4'))).toEqual([]);
    // Diagonally: a1 ← h8 (White) ← g7 (Black).
    const diag = ['........', '........', '........', '........', '........', '........', '......b.', '.......w'];
    expect(names(flipsAt(pos('torus', diag), at('a1')))).toEqual(['h8']);
    // A ring of the opponent's discs with none of yours never flips (and never loops).
    expect(flipsAt(pos('torus', ['.wwwwwww', ...Array<string>(7).fill('........')]), 0)).toEqual([]);
  });
});

describe('reversi — turns and the end', () => {
  it('skips a player who can’t move, then ends when nobody can', () => {
    const start = pos('classic', ['bw......', '........', '........', '........', '........', '........', '........', '......wb']);
    const first = playMove(gameAt(start), at('c1'));
    if (!first.ok) throw new Error(first.reason);
    expect(names(first.ply.flips)).toEqual(['b1']);
    expect(first.passed).toBe('second');
    expect(first.game.position.turn).toBe('first');
    expect(first.game.plies.map((p) => p.notation)).toEqual(['c1', 'pass']);
    expect(first.game.result).toBeNull();

    const second = playMove(first.game, at('f8'));
    if (!second.ok) throw new Error(second.reason);
    expect(second.passed).toBeNull();
    expect(second.game.result).toEqual({ winner: 'first', reason: 'discs', score: [6, 0] });
    expect(playMove(second.game, at('a2'))).toEqual({ ok: false, reason: 'over' });
  });

  it('counts discs at the end: most wins, Anti fewest, equal is a draw', () => {
    const full = (b: number) => 'b'.repeat(b) + 'w'.repeat(64 - b);
    expect(scoreResult({ variant: 'classic', board: full(40), turn: 'first', supply: null })).toEqual({
      winner: 'first',
      reason: 'discs',
      score: [40, 24],
    });
    expect(scoreResult({ variant: 'anti', board: full(40), turn: 'first', supply: null })).toEqual({
      winner: 'second',
      reason: 'discs',
      score: [40, 24],
    });
    expect(scoreResult({ variant: 'classic', board: full(32), turn: 'first', supply: null })).toEqual({
      winner: null,
      reason: 'tie',
      score: [32, 32],
    });
    expect(isFinal({ variant: 'classic', board: full(32), turn: 'first', supply: null })).toBe(true);
  });

  it('a wipe-out ends the game at once (Anti: the side with no discs wins)', () => {
    const rows = ['bw......', '........', '........', '........', '........', '........', '........', '........'];
    const classic = playMove(gameAt(pos('classic', rows)), at('c1'));
    const anti = playMove(gameAt(pos('anti', rows)), at('c1'));
    if (!classic.ok || !anti.ok) throw new Error('refused');
    expect(classic.game.result).toEqual({ winner: 'first', reason: 'discs', score: [3, 0] });
    expect(anti.game.result).toEqual({ winner: 'second', reason: 'discs', score: [3, 0] });
  });

  it('never changes the game it was given', () => {
    const game = newGame('classic');
    const before = JSON.stringify(game);
    Object.freeze(game.plies);
    const played = playMove(game, at('d3'));
    expect(played.ok).toBe(true);
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe('reversi — Original', () => {
  it('the first four discs go on the centre squares and flip nothing', () => {
    let game = newGame('original');
    expect(names(legalMoves(game.position))).toEqual(['d4', 'e4', 'd5', 'e5']);
    expect(refusal(game.position, at('c3'))).toBe('centre');
    for (const sq of ['d4', 'e4', 'e5', 'd5']) {
      const played = playMove(game, at(sq));
      if (!played.ok) throw new Error(played.reason);
      expect(played.ply.flips).toEqual([]);
      game = played.game;
    }
    // Black took d4 and e5, White e4 and d5: a crosswise centre with the colours swapped.
    expect([
      game.position.board[at('d4')],
      game.position.board[at('e4')],
      game.position.board[at('d5')],
      game.position.board[at('e5')],
    ]).toEqual(['b', 'w', 'w', 'b']);
    expect(inOpening(game.position)).toBe(false);
    expect(game.position.supply).toEqual([30, 30]);
    expect(game.position.turn).toBe('first');
    expect(legalMoves(game.position).length).toBeGreaterThan(0);
    for (const m of legalMoves(game.position)) expect(flipsAt(game.position, m).length).toBeGreaterThan(0);
  });

  it('a player with no discs left can’t move — their turn is skipped', () => {
    const p = startPosition('classic');
    const empty: ReversiPosition = { ...p, variant: 'original', board: p.board, supply: [0, 5] };
    expect(inOpening(empty)).toBe(false);
    expect(legalMoves(empty)).toEqual([]);
    expect(refusal(empty, at('d3'))).toBe('no_discs');
    expect(mustPass(empty)).toBe(true);
    expect(canMove({ ...empty, turn: 'second' })).toBe(true);
  });

  it('counts discs down as they are placed', () => {
    const played = playMove(newGame('original'), at('d4'));
    if (!played.ok) throw new Error(played.reason);
    expect(played.game.position.supply).toEqual([31, 32]);
  });
});

describe('reversi — random setups', () => {
  it('Blockers blocks two squares and their mirror images, away from the centre', () => {
    for (let seed = 0; seed < 300; seed++) {
      const holes = randomBlockers('blockers', createSeededRng(`blockers:${seed}`));
      expect(holes).toHaveLength(4);
      expect(new Set(holes).size).toBe(4);
      for (const h of holes) {
        expect(holes).toContain(63 - h);
        const r = Math.floor(h / 8);
        const c = h % 8;
        expect(r >= 2 && r <= 5 && c >= 2 && c <= 5).toBe(false);
      }
      const board = randomSetup('blockers', createSeededRng(`blockers:${seed}`))!;
      expect([...board].filter((ch) => ch === '#').length).toBe(4);
      expect(names(legalMoves(startPosition('blockers', board))).length).toBeGreaterThan(0);
    }
  });

  it('is the same for the same seed', () => {
    expect(randomSetup('blockers', createSeededRng('x'))).toBe(randomSetup('blockers', createSeededRng('x')));
    expect(randomSetup('random', createSeededRng('y'))).toBe(randomSetup('random', createSeededRng('y')));
    expect(randomSetup('classic', createSeededRng('z'))).toBeUndefined();
  });

  it('Random Start plays four legal opening moves, Black to move', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const board = randomOpening('random', createSeededRng(`random:${seed}`));
      seen.add(board);
      expect(discCounts(board).reduce((a, b) => a + b, 0)).toBe(8);
      const p = startPosition('random', board);
      expect(p.turn).toBe('first');
      expect(legalMoves(p).length).toBeGreaterThan(0);
    }
    // Plenty of different openings.
    expect(seen.size).toBeGreaterThan(50);
  });
});

describe('reversi — records', () => {
  it('rebuilds a game from its plies, skipped turns included', () => {
    const start = pos('classic', ['bw......', '........', '........', '........', '........', '........', '........', '......wb']);
    const rebuilt = fromPlies('classic', [at('c1'), -1, at('f8')], start.board);
    expect(rebuilt.result).toEqual({ winner: 'first', reason: 'discs', score: [6, 0] });
    expect(rebuilt.plies.map((p) => p.notation)).toEqual(['c1', 'pass', 'f8']);
  });

  it('a record cut right before a skipped turn needs that pass', () => {
    const start = pos('classic', ['bw......', '........', '........', '........', '........', '........', '........', '......wb']);
    const cut = fromPlies('classic', [at('c1')], start.board);
    expect(cut.result).toBeNull();
    expect(mustPass(cut.position)).toBe(true);
  });

  it('refuses illegal records', () => {
    expect(() => fromPlies('classic', [at('a1')])).toThrow();
    expect(() => fromPlies('classic', [-1])).toThrow();
  });
});

describe('reversi — random playouts of every variant', () => {
  for (const variant of REVERSI_VARIANTS) {
    it(`${variant}: every ply follows the rules and the game always ends`, () => {
      const cells = reversiCellCount(variant);
      for (let seed = 0; seed < 25; seed++) {
        const rng = createSeededRng(`${variant}:${seed}`);
        let game = newGame(variant, randomSetup(variant, rng));
        let guard = 0;
        while (!game.result) {
          expect(++guard).toBeLessThanOrEqual(cells);
          const p = game.position;
          const moves = legalMoves(p);
          expect(moves.length).toBeGreaterThan(0);
          const cell = moves[rng.int(moves.length)]!;
          const flips = inOpening(p) ? [] : flipsAt(p, cell);
          const before = discCounts(p.board);
          const played = playMove(game, cell);
          if (!played.ok) throw new Error(`${variant}: ${played.reason}`);
          expect(played.ply.flips).toEqual(flips);
          const after = discCounts(played.game.position.board);
          const mine = p.turn === 'first' ? 0 : 1;
          expect(after[mine]).toBe(before[mine] + 1 + flips.length);
          expect(after[1 - mine]).toBe(before[1 - mine] - flips.length);
          expect([...played.game.position.board].filter((ch) => ch === '#').length).toBe([...p.board].filter((ch) => ch === '#').length);
          if (played.passed) {
            expect(played.game.position.turn).toBe(p.turn);
            expect(played.game.plies[played.game.plies.length - 1]!.notation).toBe('pass');
          } else if (!played.game.result) {
            expect(played.game.position.turn).not.toBe(p.turn);
          }
          if (p.supply) expect(Math.min(...played.game.position.supply!)).toBeGreaterThanOrEqual(0);
          game = played.game;
        }
        expect(isFinal(game.position)).toBe(true);
        expect(game.result).toEqual(scoreResult(game.position));
        const again = fromPlies(
          variant,
          game.plies.map((p) => p.cell),
          game.start.board,
        );
        expect(again.position).toEqual(game.position);
        expect(again.result).toEqual(game.result);
        expect(again.plies).toEqual(game.plies);
      }
    });
  }
});
