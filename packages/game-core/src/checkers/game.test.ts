import { describe, expect, it } from 'vitest';
import {
  FORTY_MOVE_PLIES,
  REPETITION_LIMIT,
  boardResult,
  capturedCounts,
  describeResult,
  endGame,
  fromFen,
  hasCapture,
  initialPosition,
  isKing,
  legalMoves,
  applyMove,
  movesUntilFortyMoveDraw,
  newGame,
  playMove,
  positionKey,
  repetitionCount,
  cellAt,
  type CheckersGame,
  type CheckersResult,
} from './index.ts';

function play(game: CheckersGame, ...paths: number[][]): CheckersGame {
  let g = game;
  for (const path of paths) {
    const r = playMove(g, path);
    if (!r.ok) throw new Error(`Illegal ${path.join('-')}: ${r.error}`);
    g = r.game;
  }
  return g;
}

describe('newGame / playMove', () => {
  it('starts from the standard position with no result', () => {
    const g = newGame();
    expect(g.position).toEqual(initialPosition());
    expect(g.plies).toEqual([]);
    expect(g.quietPlies).toBe(0);
    expect(g.result).toBeNull();
    expect(repetitionCount(g)).toBe(1);
  });

  it('plays legal moves, records notation and alternates turns', () => {
    const g0 = newGame();
    const r = playMove(g0, [11, 15]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ply).toEqual({ notation: '11-15', color: 'dark', path: [11, 15], captures: [], crowned: false });
    expect(r.game.position.turn).toBe('light');
    // The input game is untouched.
    expect(g0.plies).toHaveLength(0);
    expect(g0.position.turn).toBe('dark');
    const g = play(r.game, [22, 18], [15, 22]);
    expect(g.plies.map((p) => p.notation)).toEqual(['11-15', '22-18', '15x22']);
    expect(g.plies[2]!.captures).toEqual([18]);
    expect(capturedCounts(g)).toEqual({ dark: 1, light: 0 });
  });

  it('rejects illegal moves and moves out of turn', () => {
    const g = newGame();
    expect(playMove(g, [22, 18])).toEqual({ ok: false, error: 'illegal_move' }); // Light's piece on Dark's turn
    expect(playMove(g, [11, 7])).toEqual({ ok: false, error: 'illegal_move' });
    expect(playMove(g, [11, 16, 20])).toEqual({ ok: false, error: 'illegal_move' });
    expect(playMove(g, [])).toEqual({ ok: false, error: 'illegal_move' });
  });

  it('refuses a non-capture when a capture is mandatory', () => {
    const g = play(newGame(), [11, 15], [22, 18]);
    expect(playMove(g, [9, 13])).toEqual({ ok: false, error: 'illegal_move' });
    expect(playMove(g, [15, 22]).ok).toBe(true);
  });

  it('accepts an unambiguous from→to shortcut for a multi-jump', () => {
    const g = newGame(fromFen('B:W10,19:B6'));
    const r = playMove(g, [6, 24]);
    expect(r.ok && r.ply.notation).toBe('6x15x24');
  });

  it('refuses moves once the game is over', () => {
    const g = endGame(newGame(), { winner: 'light', reason: 'resign' });
    expect(playMove(g, [11, 15])).toEqual({ ok: false, error: 'game_over' });
  });
});

describe('game endings', () => {
  it('wins when the opponent has no pieces left', () => {
    const g = play(newGame(fromFen('B:W18:B15')), [15, 22]);
    expect(g.result).toEqual({ winner: 'dark', reason: 'no_pieces' });
  });

  it('wins when the opponent has pieces but no legal move', () => {
    // Light's man on 5 is blocked by the dark man on 1 (the jump would leave the board).
    const g = play(newGame(fromFen('B:W5:B1,K32')), [32, 28]);
    expect(legalMoves(g.position)).toHaveLength(0);
    expect(g.result).toEqual({ winner: 'dark', reason: 'no_moves' });
  });

  it('detects a finished position immediately', () => {
    expect(newGame(fromFen('W:W5:B1')).result).toEqual({ winner: 'dark', reason: 'no_moves' });
    expect(newGame(fromFen('W:W:B1')).result).toEqual({ winner: 'dark', reason: 'no_pieces' });
    expect(newGame(fromFen('B:W5:B')).result).toEqual({ winner: 'light', reason: 'no_pieces' });
  });

  it('ends on the capture of the last piece in a multi-jump', () => {
    const g = play(newGame(fromFen('B:W10,19:B6')), [6, 15, 24]);
    expect(g.result).toEqual({ winner: 'dark', reason: 'no_pieces' });
  });

  it('ends by resignation, timeout, forfeit or agreement from outside the board', () => {
    const reasons: CheckersResult[] = [
      { winner: 'light', reason: 'resign' },
      { winner: 'dark', reason: 'timeout' },
      { winner: 'dark', reason: 'forfeit' },
      { winner: null, reason: 'agreement' },
    ];
    for (const result of reasons) expect(endGame(newGame(), result).result).toEqual(result);
    // A finished game keeps its first result.
    const done = endGame(newGame(), { winner: 'dark', reason: 'timeout' });
    expect(endGame(done, { winner: 'light', reason: 'resign' })).toBe(done);
  });
});

describe('threefold repetition', () => {
  const shuffle = [
    [1, 5],
    [32, 28],
    [5, 1],
    [28, 32],
  ];

  it('draws when the same position occurs for the third time', () => {
    const start = newGame(fromFen('B:WK32:BK1'));
    const twice = play(start, ...shuffle);
    expect(twice.result).toBeNull();
    expect(repetitionCount(twice)).toBe(2);
    const almost = play(twice, ...shuffle.slice(0, 3));
    expect(almost.result).toBeNull();
    const thrice = play(almost, shuffle[3]!);
    expect(REPETITION_LIMIT).toBe(3);
    expect(repetitionCount(thrice)).toBe(3);
    expect(thrice.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('counts the side to move as part of the position', () => {
    // Dark shuffles 1-5-1 while Light walks away and back: same board, but compare turn-aware keys.
    const g = play(newGame(fromFen('B:WK32:BK1')), [1, 5], [32, 28]);
    const keys = Object.keys(g.seen);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith('B:') || k.startsWith('W:'))).toBe(true);
    expect(positionKey(g.position).startsWith('B:')).toBe(true);
  });

  it('resets the repetition table after a man move or capture (positions can never recur)', () => {
    const g = play(newGame(fromFen('B:WK32,21:BK1')), ...shuffle, [1, 5], [21, 17]);
    expect(Object.keys(g.seen)).toEqual([positionKey(g.position)]);
    expect(repetitionCount(g)).toBe(1);
  });
});

describe('40-move rule', () => {
  it('counts quiet plies: king moves increment, man moves and captures reset', () => {
    let g = newGame(fromFen('B:WK32,21:BK1,6'));
    g = play(g, [1, 5]);
    expect(g.quietPlies).toBe(1);
    g = play(g, [32, 28]);
    expect(g.quietPlies).toBe(2);
    g = play(g, [6, 10]); // dark man move
    expect(g.quietPlies).toBe(0);
    g = play(g, [28, 24]);
    expect(g.quietPlies).toBe(1);
    expect(movesUntilFortyMoveDraw(g)).toBe(40);
  });

  it('draws after 40 moves by each side without a capture or a man move', () => {
    const g = { ...newGame(fromFen('B:WK32:BK1')), quietPlies: FORTY_MOVE_PLIES - 1 };
    const next = play(g, [1, 6]);
    expect(next.quietPlies).toBe(FORTY_MOVE_PLIES);
    expect(next.result).toEqual({ winner: null, reason: 'forty_moves' });
    expect(movesUntilFortyMoveDraw(next)).toBe(0);
  });

  it('does not draw when the 80th quiet-candidate ply is a capture or a man move', () => {
    const capture = play({ ...newGame(fromFen('B:WK32,18:BK15,K1')), quietPlies: FORTY_MOVE_PLIES - 1 }, [15, 22]);
    expect(capture.quietPlies).toBe(0);
    expect(capture.result).toBeNull();
    const manMove = play({ ...newGame(fromFen('B:WK32:BK1,6')), quietPlies: FORTY_MOVE_PLIES - 1 }, [6, 10]);
    expect(manMove.result).toBeNull();
  });

  it('reaches the draw in a real 80-ply king walk that never repeats three times', () => {
    let g = newGame(fromFen('B:WK29,K30:BK3,K4'));
    while (!g.result) {
      const moves = legalMoves(g.position);
      // Prefer moves that leave no capture for either side and visit the least-seen positions.
      const scored = moves.map((m) => {
        const next = applyMove(g.position, m);
        const safe = !hasCapture(next) && !hasCapture({ ...next, turn: g.position.turn }) ? 0 : 1;
        return { m, key: safe * 100 + (g.seen[positionKey(next)] ?? 0) };
      });
      scored.sort((a, b) => a.key - b.key);
      g = play(g, scored[0]!.m.path);
    }
    expect(g.result).toEqual({ winner: null, reason: 'forty_moves' });
    expect(g.plies).toHaveLength(FORTY_MOVE_PLIES);
    expect(g.plies.every((p) => p.captures.length === 0)).toBe(true);
    expect(Object.values(g.seen).every((n) => n < REPETITION_LIMIT)).toBe(true);
    for (let sq = 1; sq <= 32; sq++) {
      const c = cellAt(g.position.board, sq);
      if (c !== '.') expect(isKing(c)).toBe(true);
    }
  });

  it('prefers a win over a simultaneous automatic draw', () => {
    const g = { ...newGame(fromFen('B:W5:B1,K32')), quietPlies: FORTY_MOVE_PLIES - 1 };
    const next = play(g, [32, 28]);
    expect(next.quietPlies).toBe(FORTY_MOVE_PLIES);
    expect(next.result).toEqual({ winner: 'dark', reason: 'no_moves' });
    // …and over repetition.
    const blocked = play(newGame(fromFen('B:W5:B1,K32')), [32, 28]);
    const rigged = { ...blocked, seen: { [positionKey(blocked.position)]: 5 }, result: null };
    expect(boardResult(rigged)).toEqual({ winner: 'dark', reason: 'no_moves' });
  });
});

describe('describeResult', () => {
  it('describes every ending in plain language', () => {
    expect(describeResult({ winner: 'dark', reason: 'no_pieces' })).toBe('Dark wins — Light has no pieces left.');
    expect(describeResult({ winner: 'light', reason: 'no_moves' })).toBe('Light wins — Dark has no legal move.');
    expect(describeResult({ winner: 'light', reason: 'resign' })).toBe('Light wins — Dark resigned.');
    expect(describeResult({ winner: 'dark', reason: 'timeout' })).toBe('Dark wins on time.');
    expect(describeResult({ winner: 'dark', reason: 'forfeit' })).toBe('Dark wins by forfeit.');
    expect(describeResult({ winner: null, reason: 'repetition' })).toBe('Draw by threefold repetition.');
    expect(describeResult({ winner: null, reason: 'forty_moves' })).toContain('40 moves');
    expect(describeResult({ winner: null, reason: 'agreement' })).toBe('Draw by agreement.');
  });
});
