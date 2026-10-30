/**
 * The rules of every draughts variant, one position at a time. Positions are built from
 * (row, column) coordinates: row 0 is Dark's back row at the top, Light moves up.
 */
import { describe, expect, it } from 'vitest';
import type { CheckersVariant } from '@dascade/shared/games/checkers';
import type { Color, Position } from '../board.ts';
import type { CheckersMove } from '../moves.ts';
import { geometryFor, rcSquare } from './geometry.ts';
import { checkersEngine, describeVariantResult, drawCountdown, endgameRuleFor, type DraughtsGame } from './game.ts';
import { rulesFor } from './rules.ts';

type Pieces = Partial<Record<'d' | 'D' | 'l' | 'L', Array<[number, number]>>>;

function sq(size: number, row: number, col: number): number {
  const s = rcSquare(geometryFor(size), row, col);
  if (!s) throw new Error(`(${row},${col}) is not a dark square`);
  return s;
}

function position(size: number, pieces: Pieces, turn: Color): Position {
  const cells = Array.from({ length: (size * size) / 2 }, () => '.');
  for (const [piece, list] of Object.entries(pieces)) for (const [r, c] of list!) cells[sq(size, r, c) - 1] = piece;
  return { board: cells.join(''), turn };
}

const paths = (moves: CheckersMove[]) => moves.map((m) => m.path).sort((a, b) => a.join(',').localeCompare(b.join(',')));
const legal = (variant: CheckersVariant, pos: Position) => checkersEngine(variant).legalMoves(pos);
const p8 = (r: number, c: number) => sq(8, r, c);

describe('who moves first and the opening', () => {
  it.each([
    ['american', 'dark', 7],
    ['giveaway', 'dark', 7],
    ['pool', 'dark', 7],
    ['russian', 'light', 7],
    ['brazilian', 'light', 7],
    ['italian', 'light', 7],
    ['spanish', 'light', 7],
    ['czech', 'light', 7],
    ['international', 'light', 9],
    ['antidraughts', 'light', 9],
    ['breakthrough', 'light', 9],
    ['canadian', 'light', 11],
  ] as const)('%s: %s moves first with %i opening moves', (variant, first, count) => {
    const game = checkersEngine(variant).newGame();
    expect(game.position.turn).toBe(first);
    expect(game.result).toBeNull();
    expect(legal(variant, game.position)).toHaveLength(count);
  });

  it('International opens with the classic moves 31-26 … 35-30', () => {
    const notes = legal('international', checkersEngine('international').start()).map((m) => m.path.join('-'));
    expect(notes.sort()).toEqual(['31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30']);
  });
});

describe('men capturing backwards', () => {
  const pos = position(8, { l: [[4, 3]], d: [[5, 4]] }, 'light');
  it.each(['russian', 'pool', 'brazilian'] as const)('%s: a man may capture backwards', (variant) => {
    expect(paths(legal(variant, pos))).toEqual([[p8(4, 3), p8(6, 5)]]);
  });
  it.each(['american', 'italian', 'spanish', 'czech'] as const)('%s: men capture forwards only', (variant) => {
    expect(legal(variant, pos).every((m) => m.captures.length === 0)).toBe(true);
  });
});

describe('flying kings', () => {
  it('move along the whole diagonal (Russian) but one square in American', () => {
    const pos = position(8, { L: [[7, 0]], d: [[0, 1]] }, 'light');
    expect(legal('russian', pos)).toHaveLength(7);
    expect(legal('american', pos)).toHaveLength(1);
  });

  it('capture from a distance and choose the landing square', () => {
    const pos = position(8, { L: [[7, 0]], d: [[4, 3]] }, 'light');
    const moves = legal('russian', pos);
    expect(paths(moves)).toEqual(
      paths(
        [
          [3, 4],
          [2, 5],
          [1, 6],
          [0, 7],
        ].map(([r, c]) => ({ path: [p8(7, 0), p8(r!, c!)], captures: [], crowned: false })),
      ),
    );
    expect(moves.every((m) => m.captures[0] === p8(4, 3))).toBe(true);
  });

  it('must land where the capture can continue', () => {
    const pos = position(
      8,
      {
        L: [[7, 0]],
        d: [
          [5, 2],
          [2, 3],
        ],
      },
      'light',
    );
    const expected = [
      [p8(7, 0), p8(3, 4), p8(0, 1)],
      [p8(7, 0), p8(3, 4), p8(1, 2)],
    ];
    for (const variant of ['russian', 'pool', 'brazilian', 'spanish', 'czech'] as const) {
      expect(paths(legal(variant, pos)), variant).toEqual(expected);
    }
  });

  it('can’t jump a captured piece twice (Turkish strike)', () => {
    // A ring of four Dark men around a Light king on 10×10: after four captures the way back is
    // blocked by the first captured man, which is still on the board until the move ends.
    const pos = position(
      10,
      {
        L: [[9, 4]],
        d: [
          [7, 2],
          [4, 3],
          [5, 6],
          [7, 6],
        ],
      },
      'light',
    );
    const moves = legal('international', pos);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.captures).toHaveLength(4);
      expect(new Set(m.captures).size).toBe(4);
    }
  });
});

describe('promotion in the middle of a capture', () => {
  // A Light man on (2,1) takes (1,2), reaching the far row on (0,3); a Dark man waits on (1,4).
  const pos = position(
    8,
    {
      l: [[2, 1]],
      d: [
        [1, 2],
        [1, 4],
      ],
    },
    'light',
  );

  it('Russian: crowned at once, keeps capturing as a flying king', () => {
    const moves = legal('russian', pos);
    expect(paths(moves)).toEqual([
      [p8(2, 1), p8(0, 3), p8(2, 5)],
      [p8(2, 1), p8(0, 3), p8(3, 6)],
      [p8(2, 1), p8(0, 3), p8(4, 7)],
    ]);
    expect(moves.every((m) => m.crowned && m.captures.length === 2)).toBe(true);
  });

  it.each(['pool', 'brazilian'] as const)('%s: passes through as a man and is not crowned', (variant) => {
    const moves = legal(variant, pos);
    expect(paths(moves)).toEqual([[p8(2, 1), p8(0, 3), p8(2, 5)]]);
    expect(moves[0]!.crowned).toBe(false);
  });

  it.each(['american', 'italian'] as const)('%s: crowning ends the move', (variant) => {
    const moves = legal(variant, pos);
    expect(paths(moves)).toEqual([[p8(2, 1), p8(0, 3)]]);
    expect(moves[0]!.crowned).toBe(true);
  });

  it('International-family: a man that ends on the far row is crowned', () => {
    const moves = legal('brazilian', position(8, { l: [[2, 1]], d: [[1, 2]] }, 'light'));
    expect(moves.map((m) => m.crowned)).toEqual([true]);
  });
});

describe('which capture must be played', () => {
  // The man on (6,1) can take two; the man on (6,7) can take one.
  const two = position(
    8,
    {
      l: [
        [6, 1],
        [6, 7],
      ],
      d: [
        [5, 2],
        [3, 2],
        [5, 6],
      ],
    },
    'light',
  );

  it('Russian and Pool: any capture', () => {
    expect(
      legal('russian', two)
        .map((m) => m.captures.length)
        .sort(),
    ).toEqual([1, 2]);
    expect(legal('pool', two).length).toBe(2);
  });

  it('Brazilian / International: the most pieces', () => {
    expect(legal('brazilian', two).map((m) => m.captures.length)).toEqual([2]);
  });

  it('kings and men count the same for the maximum', () => {
    // One capture takes a king, the other two men: the two men must be taken.
    const pos = position(
      8,
      {
        l: [
          [6, 1],
          [7, 6],
        ],
        d: [
          [5, 2],
          [3, 4],
        ],
        D: [[6, 5]],
      },
      'light',
    );
    expect(legal('brazilian', pos).map((m) => m.captures)).toEqual([[p8(5, 2), p8(3, 4)]]);
  });

  it('Italian: a man may not capture a king', () => {
    const pos = position(8, { l: [[5, 2]], D: [[4, 3]] }, 'light');
    expect(paths(legal('italian', pos))).toEqual([[p8(5, 2), p8(4, 1)]]);
    expect(legal('american', pos)[0]!.captures).toEqual([p8(4, 3)]);
  });

  it('Italian: with equal counts, a king captures rather than a man', () => {
    const pos = position(
      8,
      {
        l: [[6, 1]],
        L: [[6, 5]],
        d: [
          [5, 2],
          [5, 6],
        ],
      },
      'light',
    );
    expect(paths(legal('italian', pos))).toEqual([[p8(6, 5), p8(4, 7)]]);
    expect(legal('american', pos)).toHaveLength(2);
  });

  it('Italian: then the capture that takes the most kings', () => {
    const pos = position(8, { L: [[4, 3]], d: [[3, 2]], D: [[3, 4]] }, 'light');
    expect(paths(legal('italian', pos))).toEqual([[p8(4, 3), p8(2, 5)]]);
  });

  it('Italian: then the capture that meets a king first', () => {
    const pos = position(
      8,
      {
        L: [
          [7, 0],
          [0, 7],
        ],
        D: [
          [6, 1],
          [3, 6],
        ],
        d: [
          [4, 3],
          [1, 6],
        ],
      },
      'light',
    );
    expect(legal('american', pos)).toHaveLength(2);
    expect(paths(legal('italian', pos))).toEqual([[p8(7, 0), p8(5, 2), p8(3, 4)]]);
  });

  it('Spanish: the most pieces, then the most kings', () => {
    const pos = position(8, { L: [[4, 3]], d: [[2, 1]], D: [[2, 5]] }, 'light');
    expect(legal('international', position(10, { L: [[4, 3]], d: [[2, 1]], D: [[2, 5]] }, 'light'))).toHaveLength(3);
    expect(legal('spanish', pos).every((m) => m.captures[0] === p8(2, 5))).toBe(true);
    expect(legal('spanish', pos)).toHaveLength(2);
  });

  it('Czech: a king must capture when it can, however few it takes', () => {
    const pos = position(
      8,
      {
        l: [[6, 1]],
        L: [[1, 6]],
        d: [
          [5, 2],
          [2, 5],
        ],
      },
      'light',
    );
    expect(legal('czech', pos).every((m) => m.path[0] === p8(1, 6))).toBe(true);
    expect(legal('czech', pos)).toHaveLength(2);
    expect(legal('russian', pos)).toHaveLength(3);
  });

  it('duplicate captures (same pieces, same start and end) are listed once', () => {
    for (const variant of ['international', 'russian', 'spanish'] as const) {
      const moves = legal(variant, checkersEngine(variant).start());
      const keys = moves.map((m) => `${m.path[0]}>${m.path.at(-1)}:${[...m.captures].sort().join(',')}:${m.crowned}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('winning', () => {
  it('Giveaway: running out of pieces wins', () => {
    const pos = position(8, { d: [[0, 1]] }, 'light');
    expect(checkersEngine('giveaway').newGame(pos).result).toEqual({ winner: 'light', reason: 'no_pieces' });
    expect(checkersEngine('american').newGame(pos).result).toEqual({ winner: 'dark', reason: 'no_pieces' });
  });

  it('Giveaway and Antidraughts: being blocked wins', () => {
    const blocked = position(
      8,
      {
        l: [[1, 0]],
        d: [
          [0, 1],
          [2, 1],
        ],
      },
      'light',
    );
    expect(checkersEngine('giveaway').newGame(blocked).result).toEqual({ winner: 'light', reason: 'no_moves' });
    const blocked10 = position(
      10,
      {
        l: [[1, 0]],
        d: [
          [0, 1],
          [2, 1],
          [3, 2],
        ],
      },
      'light',
    );
    expect(checkersEngine('antidraughts').newGame(blocked10).result).toEqual({ winner: 'light', reason: 'no_moves' });
    expect(checkersEngine('international').newGame(blocked10).result).toEqual({ winner: 'dark', reason: 'no_moves' });
  });

  it('Breakthrough: the first king wins', () => {
    const engine = checkersEngine('breakthrough');
    const game = engine.newGame(position(10, { l: [[1, 0]], d: [[5, 4]] }, 'light'));
    const played = engine.playMove(game, [sq(10, 1, 0), sq(10, 0, 1)]);
    expect(played.ok && played.game.result).toEqual({ winner: 'light', reason: 'breakthrough' });
  });

  it('Breakthrough: passing the far row mid-capture is not a king', () => {
    const engine = checkersEngine('breakthrough');
    const game = engine.newGame(
      position(
        10,
        {
          l: [[2, 1]],
          d: [
            [1, 2],
            [1, 4],
            [6, 5],
          ],
        },
        'light',
      ),
    );
    const played = engine.playMove(game, [sq(10, 2, 1), sq(10, 0, 3), sq(10, 2, 5)]);
    expect(played.ok && played.game.result).toBeNull();
    expect(played.ok && played.ply.crowned).toBe(false);
  });
});

describe('automatic draws', () => {
  function from(variant: CheckersVariant, pos: Position, counters: Partial<DraughtsGame>): DraughtsGame {
    return { ...checkersEngine(variant).newGame(pos), seen: {}, ...counters };
  }
  // Three Light kings, Dark's lone king safe on the top edge.
  const three10 = position(
    10,
    {
      L: [
        [9, 0],
        [9, 2],
        [8, 9],
      ],
      D: [[0, 1]],
    },
    'light',
  );
  const kingMove10 = [sq(10, 9, 0), sq(10, 8, 1)];

  it('International: three pieces with a king against a lone king — 16 moves each', () => {
    const engine = checkersEngine('international');
    const early = engine.playMove(from('international', three10, { endgamePlies: 30 }), kingMove10);
    expect(early.ok && early.game.result).toBeNull();
    const done = engine.playMove(from('international', three10, { endgamePlies: 31 }), kingMove10);
    expect(done.ok && done.game.result).toEqual({ winner: null, reason: 'endgame', rule: 'fmjd_three' });
    expect(done.ok && describeVariantResult('international', done.game.result!)).toBe(
      'Draw — three pieces with a king against a lone king, 16 moves each',
    );
  });

  it('International: two pieces or fewer with a king against a lone king — 5 moves each', () => {
    const pos = position(
      10,
      {
        L: [
          [9, 0],
          [8, 9],
        ],
        D: [[0, 1]],
      },
      'light',
    );
    expect(endgameRuleFor(rulesFor('international'), pos.board)?.id).toBe('few_vs_king');
    const done = checkersEngine('international').playMove(from('international', pos, { endgamePlies: 9 }), kingMove10);
    expect(done.ok && done.game.result?.reason).toBe('endgame');
  });

  it('International: 25 king moves each without a capture or man move', () => {
    const done = checkersEngine('international').playMove(from('international', three10, { quietPlies: 49 }), kingMove10);
    expect(done.ok && done.game.result).toEqual({ winner: null, reason: 'move_limit' });
    expect(describeVariantResult('international', { winner: null, reason: 'move_limit' })).toBe(
      'Draw — 25 moves each without a capture or a man move',
    );
  });

  it('Russian: three kings against a lone king — 15 moves; 15 king moves each', () => {
    const pos = position(
      8,
      {
        L: [
          [7, 0],
          [7, 2],
          [6, 7],
        ],
        D: [[0, 1]],
      },
      'light',
    );
    const move = [p8(7, 0), p8(6, 1)];
    const engine = checkersEngine('russian');
    const endgame = engine.playMove(from('russian', pos, { endgamePlies: 29 }), move);
    expect(endgame.ok && endgame.game.result).toEqual({ winner: null, reason: 'endgame', rule: 'kings_vs_king' });
    const quiet = engine.playMove(from('russian', pos, { quietPlies: 29 }), move);
    expect(quiet.ok && quiet.game.result).toEqual({ winner: null, reason: 'move_limit' });
  });

  it('Russian: long king endings with unchanged material', () => {
    const rules = rulesFor('russian');
    const pos5 = position(
      8,
      {
        L: [
          [7, 0],
          [7, 2],
        ],
        l: [[5, 2]],
        D: [[0, 1]],
        d: [[2, 3]],
      },
      'light',
    );
    expect(endgameRuleFor(rules, pos5.board)?.moves).toBe(30);
    const pos7 = position(
      8,
      {
        L: [
          [7, 0],
          [7, 2],
        ],
        l: [
          [5, 2],
          [5, 4],
        ],
        D: [[0, 1]],
        d: [
          [2, 3],
          [2, 5],
        ],
      },
      'light',
    );
    expect(endgameRuleFor(rules, pos7.board)?.moves).toBe(60);
    expect(endgameRuleFor(rulesFor('international'), pos7.board)).toBeNull();
  });

  it('a capture or crowning restarts the endgame count', () => {
    const engine = checkersEngine('international');
    const game = from('international', position(10, { L: [[9, 0]], l: [[1, 2]], D: [[4, 7]] }, 'light'), { endgamePlies: 9 });
    const crown = engine.playMove(game, [sq(10, 1, 2), sq(10, 0, 3)]);
    expect(crown.ok && crown.game.endgamePlies).toBe(0);
    expect(crown.ok && crown.game.result).toBeNull();
  });

  it('Antidraughts has no move-limit draw; repetition still draws', () => {
    const pos = position(10, { L: [[9, 2]], D: [[0, 9]] }, 'light');
    const out = [sq(10, 9, 2), sq(10, 8, 3)];
    const engine = checkersEngine('antidraughts');
    const long = engine.playMove(from('antidraughts', pos, { quietPlies: 500, endgamePlies: 500 }), out);
    expect(long.ok && long.game.result).toBeNull();
    let game = engine.newGame(pos);
    const shuffle = [out, [sq(10, 0, 9), sq(10, 1, 8)], [...out].reverse(), [sq(10, 1, 8), sq(10, 0, 9)]];
    for (let i = 0; i < 8 && !game.result; i++) {
      const next = engine.playMove(game, shuffle[i % 4]!);
      if (!next.ok) throw new Error(`illegal ${i}`);
      game = next.game;
    }
    expect(game.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('drawCountdown names the nearest automatic draw', () => {
    expect(drawCountdown('international', three10.board, 10, 20)).toEqual({
      kind: 'endgame',
      movesLeft: 6,
      label: 'three pieces with a king against a lone king',
    });
    expect(drawCountdown('american', checkersEngine('american').start().board, 70, 0)).toEqual({
      kind: 'move_limit',
      movesLeft: 5,
      limit: 40,
    });
    expect(drawCountdown('antidraughts', three10.board, 70, 70)).toBeNull();
  });
});

describe('result text', () => {
  it('describes every ending', () => {
    expect(describeVariantResult('giveaway', { winner: 'dark', reason: 'no_pieces' })).toBe('Dark wins — gave away every piece');
    expect(describeVariantResult('russian', { winner: 'light', reason: 'no_moves' })).toBe('Light wins — Dark has no legal move');
    expect(describeVariantResult('breakthrough', { winner: 'light', reason: 'breakthrough' })).toBe('Light wins — first to crown a king');
    expect(describeVariantResult('spanish', { winner: null, reason: 'move_limit' })).toBe(
      'Draw — 20 moves each without a capture or a man move',
    );
  });
});
