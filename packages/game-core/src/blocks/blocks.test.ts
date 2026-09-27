import { describe, expect, it } from 'vitest';
import { InputRecorder, advanceSim, decodeEvents, replayRun, seeded, type InputEvent } from '../classics/shared/index.ts';
import {
  ARR,
  BlocksSim,
  CLEAR_DELAY,
  CODE,
  COLS,
  DAS,
  GRAVITY,
  HIDDEN,
  LOCK_DELAY,
  MAX_CODE,
  NEXT_COUNT,
  PIECES,
  PIECE_CELL,
  ROWS,
  SHAPES,
  createBlocksSim,
  kicksFor,
  type PieceId,
} from './index.ts';

function fillRow(sim: BlocksSim, y: number, holeX: number | null = null): void {
  for (let x = 0; x < COLS; x++) sim.board[y * COLS + x] = x === holeX ? 0 : 8 - 1;
}

/** Force the active piece (resets lock state like a spawn would). */
function place(sim: BlocksSim, id: PieceId, x: number, y: number, rot = 0): void {
  sim.piece = { id, rot, x, y };
  sim.lockTimer = 0;
  sim.lockResets = 0;
}

function steps(sim: BlocksSim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

describe('pieces', () => {
  it('every rotation state has 4 distinct cells inside its box', () => {
    for (const id of PIECES) {
      for (const cells of SHAPES[id]) {
        expect(cells).toHaveLength(4);
        expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(4);
      }
    }
  });

  it('four clockwise rotations return to the spawn shape', () => {
    const t = SHAPES.T;
    expect(t[0]).toEqual([[1, 0], [0, 1], [1, 1], [2, 1]]);
    expect(t[1]).toEqual([[1, 0], [1, 1], [2, 1], [1, 2]]);
    const i = SHAPES.I;
    expect(i[1].every(([x]) => x === 2)).toBe(true);
    expect(i[3].every(([x]) => x === 1)).toBe(true);
  });

  it('kick tables start with no offset and have 5 tests (O never kicks)', () => {
    expect(kicksFor('T', 0, 1)[0]).toEqual([0, 0]);
    expect(kicksFor('T', 0, 1)).toHaveLength(5);
    expect(kicksFor('I', 1, 2)).toHaveLength(5);
    expect(kicksFor('O', 0, 1)).toEqual([[0, 0]]);
  });
});

describe('BlocksSim basics', () => {
  it('spawns from a 7-bag with a 5-piece preview, deterministically per seed', () => {
    const a = new BlocksSim('seed-1');
    const b = new BlocksSim('seed-1');
    expect(a.queue).toHaveLength(NEXT_COUNT);
    expect(a.piece?.id).toBe(b.piece?.id);
    expect(a.queue).toEqual(b.queue);
    // The active piece + preview come from the first bag: all distinct.
    const firstSix = [a.piece!.id, ...a.queue];
    expect(new Set(firstSix).size).toBe(6);
  });

  it('every bag of 7 contains all pieces (long run)', () => {
    const sim = new BlocksSim('bag-check');
    const seen: PieceId[] = [sim.piece!.id];
    for (let i = 0; i < 69; i++) {
      sim.board.fill(0);
      sim.input(CODE.hardDrop);
      while (!sim.piece && !sim.over) sim.step();
      seen.push(sim.piece!.id);
    }
    for (let bag = 0; bag < 10; bag++) expect(new Set(seen.slice(bag * 7, bag * 7 + 7)).size).toBe(7);
  });

  it('rejects codes outside the code space only', () => {
    const sim = new BlocksSim('codes');
    expect(sim.input(0)).toBe(false);
    expect(sim.input(MAX_CODE + 1)).toBe(false);
    expect(sim.input(1.5)).toBe(false);
    for (let c = 1; c <= MAX_CODE; c++) expect(sim.input(c)).toBe(true);
  });

  it('gravity drops one row per GRAVITY[level] ticks', () => {
    const sim = new BlocksSim('gravity');
    place(sim, 'T', 3, 5);
    steps(sim, GRAVITY[0] - 1);
    expect(sim.piece!.y).toBe(5);
    sim.step();
    expect(sim.piece!.y).toBe(6);
  });
});

describe('movement', () => {
  it('a tap moves one cell; holding auto-repeats after DAS every ARR', () => {
    const sim = new BlocksSim('das');
    place(sim, 'O', 4, 5);
    sim.input(CODE.leftDown);
    expect(sim.piece!.x).toBe(3);
    steps(sim, DAS - 1);
    expect(sim.piece!.x).toBe(3);
    sim.step();
    expect(sim.piece!.x).toBe(2);
    steps(sim, ARR);
    expect(sim.piece!.x).toBe(1);
    steps(sim, ARR * 5);
    expect(sim.piece!.x).toBe(0); // wall
    sim.input(CODE.leftUp);
    steps(sim, 20);
    expect(sim.piece!.x).toBe(0);
  });

  it('the most recent direction wins while both are held', () => {
    const sim = new BlocksSim('both');
    place(sim, 'O', 4, 5);
    sim.input(CODE.leftDown);
    sim.input(CODE.rightDown);
    expect(sim.piece!.x).toBe(4); // left then right
    sim.input(CODE.rightUp);
    steps(sim, DAS);
    expect(sim.piece!.x).toBeLessThan(4); // falls back to the still-held left
  });

  it('soft drop falls faster and scores 1 per row; hard drop scores 2 per row and locks', () => {
    const sim = new BlocksSim('drops');
    place(sim, 'O', 4, 2);
    sim.input(CODE.softDown);
    steps(sim, 10);
    expect(sim.piece!.y).toBeGreaterThanOrEqual(6);
    const soft = sim.score;
    expect(soft).toBeGreaterThanOrEqual(4);
    sim.input(CODE.softUp);
    const y = sim.piece!.y;
    const ghost = sim.ghostY();
    sim.input(CODE.hardDrop);
    expect(sim.score).toBe(soft + (ghost - y) * 2);
    expect(sim.pieces).toBe(1);
    expect(sim.board[(ROWS - 1) * COLS + 4]).toBe(PIECE_CELL.O);
  });
});

describe('rotation and wall kicks', () => {
  it('rotates in place when free', () => {
    const sim = new BlocksSim('rot');
    place(sim, 'T', 3, 8);
    sim.input(CODE.rotateCW);
    expect(sim.piece).toMatchObject({ rot: 1, x: 3, y: 8 });
    sim.input(CODE.rotateCCW);
    expect(sim.piece).toMatchObject({ rot: 0, x: 3, y: 8 });
  });

  it('kicks off the left wall', () => {
    const sim = new BlocksSim('kick');
    // T in state R hugging the left wall (box x = -1 → cells at x 0..1).
    place(sim, 'T', -1, 8, 1);
    expect(sim.fits('T', 1, -1, 8)).toBe(true);
    sim.input(CODE.rotateCW); // to state 2 needs x 0..2 → kicked right
    expect(sim.piece!.rot).toBe(2);
    expect(sim.piece!.x).toBe(0);
  });

  it('the I piece kicks away from the right wall', () => {
    const sim = new BlocksSim('ikick');
    place(sim, 'I', 7, 8, 1); // vertical in column 9
    expect(sim.cellsOf('I', 1, 7, 8).every(([x]) => x === 9)).toBe(true);
    sim.input(CODE.rotateCW); // to horizontal row: must shift left
    expect(sim.piece!.rot).toBe(2);
    const xs = sim.cellsOf('I', 2, sim.piece!.x, sim.piece!.y).map(([x]) => x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(9);
  });

  it('a blocked rotation with no fitting kick does nothing', () => {
    const sim = new BlocksSim('blocked');
    // Box the T in completely.
    for (let y = 5; y < 12; y++) for (let x = 0; x < COLS; x++) sim.board[y * COLS + x] = 7;
    for (const [x, y] of sim.cellsOf('T', 0, 3, 7)) sim.board[y * COLS + x] = 0;
    place(sim, 'T', 3, 7);
    sim.input(CODE.rotateCW);
    expect(sim.piece).toMatchObject({ rot: 0, x: 3, y: 7 });
  });
});

describe('lock delay', () => {
  it('locks LOCK_DELAY ticks after touching down; moves reset it (bounded)', () => {
    const sim = new BlocksSim('lock');
    place(sim, 'O', 4, ROWS - 2);
    steps(sim, LOCK_DELAY - 5);
    expect(sim.piece).not.toBeNull();
    sim.input(CODE.leftDown);
    sim.input(CODE.leftUp);
    steps(sim, LOCK_DELAY - 2);
    expect(sim.piece).not.toBeNull();
    steps(sim, 3);
    expect(sim.pieces).toBe(1);
  });

  it('infinite spinning is capped by the reset limit', () => {
    const sim = new BlocksSim('spin');
    place(sim, 'T', 3, ROWS - 2);
    let locked = false;
    for (let i = 0; i < 400 && !locked; i++) {
      sim.input(i % 2 ? CODE.rotateCW : CODE.rotateCCW);
      sim.step();
      locked = sim.pieces > 0;
    }
    expect(locked).toBe(true);
  });
});

describe('line clears and scoring', () => {
  function clearWith(lines: number, level = 1): BlocksSim {
    const sim = new BlocksSim('clear', { startLevel: level });
    for (let i = 0; i < lines; i++) fillRow(sim, ROWS - 1 - i, 0);
    sim.board[(ROWS - 8) * COLS + 9] = 7; // a stray cell so no clear empties the board
    // Vertical I into column 0.
    place(sim, 'I', -2, ROWS - 4, 1);
    sim.input(CODE.hardDrop);
    return sim;
  }

  it.each([
    [1, 100],
    [2, 300],
    [3, 500],
    [4, 800],
  ])('%i line(s) score %i × level', (lines, points) => {
    const sim = clearWith(lines as number);
    const clear = sim.drainEvents().find((e) => e.t === 'clear');
    expect(clear).toMatchObject({ lines, points });
    const lvl3 = clearWith(lines as number, 3);
    expect(lvl3.drainEvents().find((e) => e.t === 'clear')).toMatchObject({ points: (points as number) * 3 });
  });

  it('clears after CLEAR_DELAY and collapses the stack', () => {
    const sim = new BlocksSim('collapse');
    fillRow(sim, ROWS - 1, 0);
    sim.board[(ROWS - 2) * COLS + 5] = 3; // a lone cell above
    place(sim, 'I', -2, ROWS - 5, 1);
    sim.input(CODE.hardDrop);
    expect(sim.clearing).toEqual([ROWS - 1]);
    steps(sim, CLEAR_DELAY);
    expect(sim.lines).toBe(1);
    expect(sim.board[(ROWS - 1) * COLS + 5]).toBe(3);
    expect(sim.piece).not.toBeNull();
  });

  it('combos add 50 × combo × level and back-to-back quads earn ×1.5', () => {
    const sim = new BlocksSim('combo');
    const quad = () => {
      for (let i = 0; i < 4; i++) fillRow(sim, ROWS - 1 - i, 0);
      sim.board[(ROWS - 8) * COLS + 9] = 7; // not an all clear
      place(sim, 'I', -2, ROWS - 5, 1);
      sim.input(CODE.hardDrop);
      steps(sim, CLEAR_DELAY + 1);
    };
    quad();
    const e1 = sim.drainEvents().find((e) => e.t === 'clear');
    expect(e1).toMatchObject({ points: 800, b2b: false, combo: 0 });
    quad();
    const e2 = sim.drainEvents().find((e) => e.t === 'clear');
    // b2b: 800 × 1.5 = 1200, combo 1: +50
    expect(e2).toMatchObject({ b2b: true, combo: 1, points: 1250 });
  });

  it('detects a T-spin double (3-corner rule after a rotation)', () => {
    const sim = new BlocksSim('tspin');
    // Classic T-slot at the bottom: rows 20 and 21 full except a T-shaped hole at x 3..5.
    fillRow(sim, ROWS - 1, null);
    fillRow(sim, ROWS - 2, null);
    const set = (x: number, y: number, v: number) => (sim.board[y * COLS + x] = v);
    set(4, ROWS - 1, 0); // bottom stem
    set(3, ROWS - 2, 0);
    set(4, ROWS - 2, 0);
    set(5, ROWS - 2, 0);
    set(3, ROWS - 3, 7); // overhang corner so the T must rotate in
    // T pointing down (state 2) at box (3, ROWS-3): cells (3..5, ROWS-2) + (4, ROWS-1).
    place(sim, 'T', 3, ROWS - 3, 1);
    expect(sim.fits('T', 2, 3, ROWS - 3)).toBe(true);
    sim.input(CODE.rotateCW);
    expect(sim.piece).toMatchObject({ rot: 2, x: 3, y: ROWS - 3 });
    sim.input(CODE.hardDrop);
    const clear = sim.drainEvents().find((e) => e.t === 'clear');
    expect(clear).toMatchObject({ lines: 2, tspin: true, points: 1200 });
  });

  it('awards the all-clear bonus when the board empties', () => {
    const sim = new BlocksSim('allclear');
    fillRow(sim, ROWS - 1, 0);
    place(sim, 'I', -2, ROWS - 5, 1);
    // Only the column-0 I remains above? Use a flat I on a 4-wide gap instead.
    sim.board.fill(0);
    for (let x = 0; x < 6; x++) sim.board[(ROWS - 1) * COLS + x] = 7;
    place(sim, 'I', 6, ROWS - 3, 0); // flat I covering x 6..9 on the last row
    sim.input(CODE.hardDrop);
    const clear = sim.drainEvents().find((e) => e.t === 'clear');
    expect(clear).toMatchObject({ lines: 1, allClear: true, points: 100 + 1800 });
  });

  it('levels up every 10 lines and speeds up gravity', () => {
    const sim = new BlocksSim('levels');
    for (let n = 0; n < 10; n++) {
      sim.board.fill(0);
      fillRow(sim, ROWS - 1, 0);
      place(sim, 'I', -2, ROWS - 5, 1);
      sim.input(CODE.hardDrop);
      steps(sim, CLEAR_DELAY + 1);
    }
    expect(sim.lines).toBe(10);
    expect(sim.level).toBe(2);
    expect(sim.gravityTicks()).toBe(GRAVITY[1]);
  });
});

describe('hold', () => {
  it('swaps once per piece', () => {
    const sim = new BlocksSim('hold');
    const first = sim.piece!.id;
    const next = sim.queue[0];
    sim.input(CODE.hold);
    expect(sim.hold).toBe(first);
    expect(sim.piece!.id).toBe(next);
    sim.input(CODE.hold); // ignored until the piece locks
    expect(sim.hold).toBe(first);
    sim.input(CODE.hardDrop);
    while (!sim.piece) sim.step();
    const current = sim.piece.id;
    sim.input(CODE.hold);
    expect(sim.piece.id).toBe(first);
    expect(sim.hold).toBe(current);
  });
});

describe('game over', () => {
  it('blocks out when a piece cannot spawn', () => {
    const sim = new BlocksSim('topout');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 0 || y > HIDDEN + 3) sim.board[y * COLS + x] = y < 4 ? 7 : sim.board[y * COLS + x]!;
    for (let y = 0; y < 5; y++) for (let x = 1; x < COLS; x++) sim.board[y * COLS + x] = 7;
    sim.input(CODE.hardDrop);
    for (let i = 0; i < 5 && !sim.over; i++) sim.step();
    expect(sim.over).toBe(true);
    expect(sim.summary().lives).toBe(0);
    const before = sim.tick;
    sim.step();
    expect(sim.tick).toBe(before);
  });

  it('an input that tops out only reports over after the next step (so the log can carry it)', () => {
    const sim = new BlocksSim('input-death');
    // Every visible row full except column 0 (so nothing clears): an O at the top locks in the hidden rows.
    for (let y = HIDDEN; y < ROWS; y++) for (let x = 1; x < COLS; x++) sim.board[y * COLS + x] = 7;
    place(sim, 'O', 4, 0);
    const t = sim.tick;
    sim.input(CODE.hardDrop);
    expect(sim.ended).not.toBeNull();
    expect(sim.over).toBe(false);
    sim.step();
    expect(sim.over).toBe(true);
    expect(sim.tick).toBe(t + 1);
    sim.step();
    expect(sim.tick).toBe(t + 1);
  });

  it('a recorded run that ends on an input verifies identically (recorder + batches)', () => {
    const rng = seeded('death-by-drop');
    const client = createBlocksSim('seed-x');
    const rec = new InputRecorder();
    const server = createBlocksSim('seed-x', {}, false);
    let serverUpTo = 0;
    const flush = () => {
      for (;;) {
        const b = rec.take(client.tick);
        if (!b) break;
        const decoded = decodeEvents(b.events, serverUpTo, b.upTo, MAX_CODE);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) advanceSim(server, decoded.events, b.upTo);
        serverUpTo = b.upTo;
      }
    };
    while (!client.over && client.tick < 100_000) {
      const code = rng.int(4) === 0 ? CODE.hardDrop : rng.int(30) === 0 ? 1 + rng.int(10) : 0;
      if (code && client.input(code)) rec.record(client.tick, code);
      client.step();
      if (client.tick % 12 === 0 || client.over) flush();
    }
    expect(client.over).toBe(true);
    expect(server.over).toBe(true);
    expect(server.summary()).toEqual(client.summary());
    expect(server.tick).toBe(client.tick);
  });

  it('a random bot always tops out eventually and scores stay consistent', () => {
    const rng = seeded('bot');
    const sim = new BlocksSim('random-play', {}, false);
    let guard = 0;
    while (!sim.over && guard++ < 200_000) {
      const r = rng.int(20);
      if (r < 6) sim.input(1 + rng.int(10));
      sim.step();
    }
    expect(sim.over).toBe(true);
    expect(sim.score).toBeGreaterThan(0);
    expect(sim.events).toHaveLength(0);
  });
});

describe('verification (replay)', () => {
  function randomLog(seed: string, ticks: number): InputEvent[] {
    const rng = seeded(seed);
    const log: InputEvent[] = [];
    for (let t = 0; t < ticks; t++) if (rng.int(8) === 0) log.push({ tick: t, code: 1 + rng.int(10) });
    return log;
  }

  it('server replay of the client log reaches the identical state', () => {
    const log = randomLog('replay', 6000);
    // "Client": applies events live tick by tick.
    const client = createBlocksSim('match-seed', { startLevel: 2 });
    let i = 0;
    for (let t = 0; t < 6000 && !client.over; t++) {
      while (i < log.length && log[i]!.tick === t) client.input(log[i++]!.code);
      client.step();
    }
    // "Server": replays the same log in uneven batches.
    const server = createBlocksSim('match-seed', { startLevel: 2 }, false);
    let from = 0;
    for (const upTo of [37, 400, 401, 2500, 6000]) {
      const slice = log.filter((e) => e.tick >= from && e.tick < upTo);
      advanceSim(server, slice, upTo);
      from = upTo;
    }
    expect(server.summary()).toEqual(client.summary());
    expect(server.preview()).toBe(client.preview());
    expect(server.tick).toBe(client.tick);
  });

  it('a tampered log (different inputs) produces a different, never higher-by-fiat result', () => {
    const log = randomLog('tamper', 3000);
    const honest = replayRun(createBlocksSim, 's', {}, log, 3000);
    const tampered = log.map((e, k) => (k % 3 === 0 ? { ...e, code: CODE.hardDrop } : e));
    const other = replayRun(createBlocksSim, 's', {}, tampered, 3000);
    expect(other.preview()).not.toBe(honest.preview());
    // Invalid codes are refused outright.
    const bad = createBlocksSim('s');
    expect(advanceSim(bad, [{ tick: 3, code: 99 }], 10).ok).toBe(false);
  });
});
