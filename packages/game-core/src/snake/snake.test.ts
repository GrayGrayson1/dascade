import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import {
  GUARD_SECONDS,
  RESPAWN_SECONDS,
  SNAKE,
  arenaSize,
  botDirection,
  cellOf,
  cellX,
  cellY,
  createGame,
  decodeSnakeSnapshot,
  encodeSnakeSnapshot,
  queueTurn,
  rank,
  retireSnake,
  startSpots,
  stepGame,
  type Dir,
  type SnakeGame,
  type SnakeRules,
  type SnakeSimEvent,
} from './index.ts';

const RULES: SnakeRules = { mode: 'survival', cols: 30, rows: 20, wrap: false, powerUps: false, maxTicks: 0, stepsPerSecond: 10 };

function game(ids: string[], rules: Partial<SnakeRules> = {}, seed = 'snake'): { g: SnakeGame; rng: Rng } {
  const rng = createSeededRng(seed);
  const g = createGame({ ...RULES, ...rules }, ids, rng);
  return { g, rng };
}

/** Clear items and place a snake manually (head first) — test setup only. */
function place(g: SnakeGame, slot: number, cells: Array<[number, number]>, dir: Dir): void {
  const s = g.snakes[slot]!;
  s.body = cells.map(([x, y]) => cellOf(g, x, y));
  s.dir = dir;
  s.queue = [];
  s.alive = true;
  s.grow = 0;
}

function step(g: SnakeGame, rng: Rng, n = 1): SnakeSimEvent[] {
  const out: SnakeSimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...stepGame(g, rng));
  return out;
}

const head = (g: SnakeGame, slot: number) => [cellX(g, g.snakes[slot]!.body[0]!), cellY(g, g.snakes[slot]!.body[0]!)];

describe('snake: setup', () => {
  it('spreads up to 12 snakes on distinct, in-bounds starting cells', () => {
    for (let n = 1; n <= 12; n++) {
      const size = arenaSize('auto', n, n === 1);
      const { g } = game(Array.from({ length: n }, (_, i) => `p${i}`), { ...size, mode: n === 1 ? 'solo' : 'survival' });
      const cells = new Set<number>();
      for (const s of g.snakes) {
        expect(s.alive).toBe(true);
        expect(s.body.length).toBe(SNAKE.startLength);
        for (const c of s.body) {
          expect(cells.has(c)).toBe(false);
          cells.add(c);
        }
      }
      expect(startSpots(size.cols, size.rows, n)).toHaveLength(n);
      // Items never spawn on a body.
      for (const it of g.items) expect(cells.has(it.cell)).toBe(false);
    }
  });

  it('1v1 starts on opposite sides facing each other', () => {
    const { g } = game(['a', 'b']);
    expect(g.snakes[0]!.dir).toBe(1);
    expect(g.snakes[1]!.dir).toBe(3);
    expect(head(g, 0)[0]).toBeLessThan(head(g, 1)[0]!);
  });
});

describe('snake: movement and turns', () => {
  it('moves one cell per step keeping its length', () => {
    const { g, rng } = game(['a']);
    g.items = [];
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    step(g, rng);
    expect(head(g, 0)).toEqual([11, 10]);
    expect(g.snakes[0]!.body.length).toBe(4);
    expect(cellX(g, g.snakes[0]!.body[3]!)).toBe(8);
  });

  it('never applies a 180° reversal or a repeat', () => {
    const { g, rng } = game(['a']);
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    expect(queueTurn(g, 0, 3)).toBe(false);
    expect(queueTurn(g, 0, 1)).toBe(false);
    expect(queueTurn(g, 0, 7)).toBe(false);
    expect(queueTurn(g, 0, 1.5)).toBe(false);
    // Even a reversal forced into the buffer is skipped when consumed.
    g.snakes[0]!.queue.push(3);
    g.items = [];
    step(g, rng);
    expect(g.snakes[0]!.dir).toBe(1);
    expect(head(g, 0)).toEqual([11, 10]);
  });

  it('buffers quick double turns so none are lost (one per step)', () => {
    const { g, rng } = game(['a']);
    g.items = [];
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    // Moving right: up then left within one step = a U-turn over two steps.
    expect(queueTurn(g, 0, 0)).toBe(true);
    expect(queueTurn(g, 0, 3)).toBe(true);
    // Relative to the last buffered heading (left), right is a reversal and down is fine.
    expect(queueTurn(g, 0, 1)).toBe(false);
    expect(queueTurn(g, 0, 2)).toBe(true);
    // Buffer is full at three.
    expect(queueTurn(g, 0, 3)).toBe(false);
    step(g, rng);
    expect(head(g, 0)).toEqual([10, 9]);
    step(g, rng);
    expect(head(g, 0)).toEqual([9, 9]);
    step(g, rng);
    expect(head(g, 0)).toEqual([9, 10]);
    expect(g.snakes[0]!.alive).toBe(true);
  });

  it('dead snakes and finished games ignore turns', () => {
    const { g } = game(['a']);
    g.snakes[0]!.alive = false;
    expect(queueTurn(g, 0, 0)).toBe(false);
    expect(queueTurn(g, 5, 0)).toBe(false);
  });
});

describe('snake: items and growth', () => {
  it('energy grows the snake by one and scores', () => {
    const { g, rng } = game(['a', 'b']);
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    g.items = [{ cell: cellOf(g, 11, 10), kind: 'energy', ttl: -1 }];
    const ev = step(g, rng);
    expect(ev.find((e) => e.type === 'eat')).toMatchObject({ slot: 0, kind: 'energy', points: SNAKE.points.energy });
    expect(g.snakes[0]!.score).toBe(10);
    expect(g.snakes[0]!.body.length).toBe(4);
    step(g, rng);
    expect(g.snakes[0]!.body.length).toBe(5);
    step(g, rng);
    expect(g.snakes[0]!.body.length).toBe(5);
  });

  it('gems grow by three; the board is refilled with energy', () => {
    const { g, rng } = game(['a', 'b']);
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    g.items = [{ cell: cellOf(g, 11, 10), kind: 'gem', ttl: 50 }];
    step(g, rng, 4);
    expect(g.snakes[0]!.body.length).toBe(7);
    expect(g.snakes[0]!.score).toBe(SNAKE.points.gem);
    expect(g.items.filter((i) => i.kind === 'energy').length).toBeGreaterThanOrEqual(2);
  });

  it('rare items expire; power-ups only appear when enabled', () => {
    const { g, rng } = game(['a', 'b'], { powerUps: false });
    for (let i = 0; i < 400 && g.status === 'running'; i++) {
      for (const s of g.snakes) {
        const d = botDirection(g, s.slot);
        if (d !== null) queueTurn(g, s.slot, d);
      }
      stepGame(g, rng);
      expect(g.items.some((it) => it.kind === 'gem' || it.kind === 'phase' || it.kind === 'magnet')).toBe(false);
    }
    const on = game(['a', 'b'], { powerUps: true, cols: 40, rows: 30 }, 'powers');
    on.g.items.push({ cell: cellOf(on.g, 1, 1), kind: 'phase', ttl: 3 });
    step(on.g, on.rng, 3);
    expect(on.g.items.some((it) => it.cell === cellOf(on.g, 1, 1) && it.kind === 'phase')).toBe(false);
    let sawRare = false;
    for (let i = 0; i < 1500 && on.g.status === 'running' && !sawRare; i++) {
      for (const s of on.g.snakes) {
        const d = botDirection(on.g, s.slot);
        if (d !== null) queueTurn(on.g, s.slot, d);
      }
      stepGame(on.g, on.rng);
      sawRare = on.g.items.some((it) => it.kind === 'gem' || it.kind === 'phase' || it.kind === 'magnet');
    }
    expect(sawRare).toBe(true);
  });

  it('magnet sweeps energy within two cells of the head', () => {
    const { g, rng } = game(['a', 'b']);
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    g.snakes[0]!.magnet = 20;
    g.items = [
      { cell: cellOf(g, 12, 12), kind: 'energy', ttl: -1 },
      { cell: cellOf(g, 11, 14), kind: 'energy', ttl: -1 },
    ];
    step(g, rng);
    // Head at (11,10): (12,12) is within 2 cells; (11,14) is not.
    expect(g.snakes[0]!.score).toBe(10);
    expect(g.items.some((i) => i.cell === cellOf(g, 11, 14))).toBe(true);
  });
});

describe('snake: collisions', () => {
  it('walls are deadly unless the arena wraps', () => {
    const { g, rng } = game(['a', 'b']);
    g.items = [];
    place(g, 0, [[29, 5], [28, 5], [27, 5], [26, 5]], 1);
    place(g, 1, [[5, 15], [6, 15], [7, 15], [8, 15]], 3);
    const ev = step(g, rng);
    expect(ev.find((e) => e.type === 'death')).toMatchObject({ slot: 0, cause: 'wall' });
    expect(g.snakes[0]!.alive).toBe(false);

    const w = game(['a', 'b'], { wrap: true });
    w.g.items = [];
    place(w.g, 0, [[29, 5], [28, 5], [27, 5], [26, 5]], 1);
    place(w.g, 1, [[5, 15], [6, 15], [7, 15], [8, 15]], 3);
    step(w.g, w.rng);
    expect(w.g.snakes[0]!.alive).toBe(true);
    expect(head(w.g, 0)).toEqual([0, 5]);
  });

  it('may follow its own tail, but not while growing', () => {
    const loop: Array<[number, number]> = [[10, 10], [10, 11], [11, 11], [11, 10]];
    const { g, rng } = game(['a', 'b']);
    g.items = [];
    place(g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    place(g, 0, loop, 1); // head (10,10) moving right into (11,10) = its tail
    step(g, rng);
    expect(g.snakes[0]!.alive).toBe(true);

    const grow = game(['a', 'b']);
    grow.g.items = [];
    place(grow.g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    place(grow.g, 0, loop, 1);
    grow.g.snakes[0]!.grow = 1;
    const ev = step(grow.g, grow.rng);
    expect(ev.find((e) => e.type === 'death')).toMatchObject({ slot: 0, cause: 'self' });
  });

  it('hitting another body is a crash and credits the other snake', () => {
    const { g, rng } = game(['a', 'b']);
    g.items = [];
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(g, 1, [[11, 8], [11, 9], [11, 10], [11, 11]], 0); // body crosses (11,10)
    const ev = step(g, rng);
    expect(ev.find((e) => e.type === 'death')).toMatchObject({ slot: 0, cause: 'snake', by: 1 });
    expect(g.snakes[1]!.kills).toBe(1);
    expect(g.snakes[1]!.score).toBe(SNAKE.points.kill);
    // Survival 1v1: the survivor wins.
    expect(g.status).toBe('over');
    expect(g.winners).toEqual([1]);
  });

  it('head-on (same cell or swapping cells) crashes both with no credit', () => {
    const same = game(['a', 'b']);
    same.g.items = [];
    place(same.g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(same.g, 1, [[12, 10], [13, 10], [14, 10], [15, 10]], 3);
    const ev = step(same.g, same.rng);
    expect(ev.filter((e) => e.type === 'death').map((e) => (e as { cause: string }).cause)).toEqual(['head', 'head']);
    expect(same.g.status).toBe('over');
    expect(rank(same.g)).toEqual([[0, 1]]);

    const swap = game(['a', 'b']);
    swap.g.items = [];
    place(swap.g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(swap.g, 1, [[11, 10], [12, 10], [13, 10], [14, 10]], 3);
    const ev2 = step(swap.g, swap.rng);
    const deaths = ev2.filter((e) => e.type === 'death') as Array<{ cause: string; by: number }>;
    expect(deaths).toHaveLength(2);
    expect(deaths.every((d) => d.cause === 'head' && d.by === -1)).toBe(true);
    expect(swap.g.snakes[0]!.kills + swap.g.snakes[1]!.kills).toBe(0);
  });

  it('phase passes through other snakes (both ways) but not itself', () => {
    const { g, rng } = game(['a', 'b', 'c']);
    g.items = [];
    place(g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(g, 1, [[11, 8], [11, 9], [11, 10], [11, 11]], 0);
    place(g, 2, [[25, 18], [26, 18], [27, 18], [28, 18]], 3);
    g.snakes[0]!.phase = 5;
    step(g, rng);
    expect(g.snakes[0]!.alive).toBe(true);
    // A normal snake driving into a phased body also survives.
    const b = game(['a', 'b', 'c']);
    b.g.items = [];
    place(b.g, 0, [[10, 10], [9, 10], [8, 10], [7, 10]], 1);
    place(b.g, 1, [[11, 8], [11, 9], [11, 10], [11, 11]], 0);
    place(b.g, 2, [[25, 18], [26, 18], [27, 18], [28, 18]], 3);
    b.g.snakes[1]!.phase = 5;
    step(b.g, b.rng);
    expect(b.g.snakes[0]!.alive).toBe(true);
    // Phase never saves you from your own body.
    const self = game(['a', 'b']);
    self.g.items = [];
    place(self.g, 1, [[20, 15], [21, 15], [22, 15], [23, 15]], 3);
    place(self.g, 0, [[10, 10], [10, 11], [11, 11], [11, 10], [12, 10]], 1);
    self.g.snakes[0]!.phase = 5;
    step(self.g, self.rng);
    expect(self.g.snakes[0]!.alive).toBe(false);
  });

  it('crashed snakes break into sparks in multiplayer', () => {
    const { g, rng } = game(['a', 'b', 'c']);
    g.items = [];
    place(g, 0, [[29, 5], [28, 5], [27, 5], [26, 5], [25, 5], [24, 5]], 1);
    place(g, 1, [[5, 15], [6, 15], [7, 15], [8, 15]], 3);
    place(g, 2, [[5, 18], [6, 18], [7, 18], [8, 18]], 3);
    step(g, rng);
    expect(g.snakes[0]!.alive).toBe(false);
    expect(g.snakes[0]!.body).toEqual([]);
    expect(g.items.filter((i) => i.kind === 'spark').length).toBeGreaterThan(0);
  });
});

describe('snake: modes and standings', () => {
  it('survival: last snake alive wins; later crashes rank higher', () => {
    const { g, rng } = game(['a', 'b', 'c']);
    g.items = [];
    place(g, 0, [[29, 2], [28, 2], [27, 2], [26, 2]], 1);
    place(g, 1, [[26, 6], [27, 6], [28, 6], [29, 6]], 3);
    place(g, 2, [[10, 15], [9, 15], [8, 15], [7, 15]], 1);
    // Slot 1 heads left safely for now; slot 0 crashes immediately.
    step(g, rng);
    expect(g.snakes[0]!.alive).toBe(false);
    expect(g.status).toBe('running');
    queueTurn(g, 1, 0);
    // Drive slot 1 into the top wall.
    for (let i = 0; i < 10 && g.snakes[1]!.alive; i++) step(g, rng);
    expect(g.status).toBe('over');
    expect(rank(g)).toEqual([[2], [1], [0]]);
    expect(g.winners).toEqual([2]);
  });

  it('survival time cap ranks the living by length', () => {
    const { g, rng } = game(['a', 'b'], { maxTicks: 3 });
    g.items = [];
    place(g, 0, [[5, 3], [4, 3], [3, 3], [2, 3]], 1);
    place(g, 1, [[5, 12], [4, 12], [3, 12], [2, 12], [1, 12]], 1);
    step(g, rng, 3);
    expect(g.status).toBe('over');
    expect(g.winners).toEqual([1]);
  });

  it('frenzy: respawn after a delay with spawn protection; ends at the time limit by score', () => {
    const { g, rng } = game(['a', 'b'], { mode: 'frenzy', maxTicks: 200 });
    g.items = [];
    place(g, 0, [[29, 5], [28, 5], [27, 5], [26, 5]], 1);
    place(g, 1, [[5, 15], [6, 15], [7, 15], [8, 15]], 3);
    g.snakes[1]!.score = 30;
    step(g, rng);
    const a = g.snakes[0]!;
    expect(a.alive).toBe(false);
    expect(a.deaths).toBe(1);
    expect(a.respawnIn).toBe(RESPAWN_SECONDS * 10);
    const ev = step(g, rng, RESPAWN_SECONDS * 10);
    expect(ev.some((e) => e.type === 'respawn' && e.slot === 0)).toBe(true);
    expect(a.alive).toBe(true);
    expect(a.body.length).toBe(SNAKE.startLength);
    expect(a.guard).toBeGreaterThan(0);
    expect(a.guard).toBeLessThanOrEqual(GUARD_SECONDS * 10);
    // Keep both snakes alive with the bot until the clock runs out.
    while (g.status === 'running') {
      for (const s of g.snakes) {
        const d = botDirection(g, s.slot);
        if (d !== null) queueTurn(g, s.slot, d);
      }
      stepGame(g, rng);
    }
    expect(g.tick).toBe(200);
    const order = rank(g).flat();
    expect(g.snakes[order[0]!]!.score).toBeGreaterThanOrEqual(g.snakes[order[1]!]!.score);
  });

  it('solo: levels up every few pickups, multiplies points and ends on the crash', () => {
    const { g, rng } = game(['solo'], { mode: 'solo' });
    const s = g.snakes[0]!;
    place(g, 0, [[5, 10], [4, 10], [3, 10], [2, 10]], 1);
    let levels = 0;
    for (let i = 0; i < SNAKE.soloLevelEvery + 1; i++) {
      const [hx, hy] = head(g, 0);
      g.items = [{ cell: cellOf(g, hx! + 1, hy!), kind: 'energy', ttl: -1 }];
      levels += step(g, rng).filter((e) => e.type === 'level').length;
    }
    expect(levels).toBe(1);
    expect(g.level).toBe(2);
    expect(s.score).toBe(SNAKE.soloLevelEvery * 10 + 20);
    g.items = [];
    for (let i = 0; i < 40 && g.status === 'running'; i++) step(g, rng);
    expect(g.status).toBe('over');
    expect(g.winners).toEqual([0]);
  });

  it('a player leaving counts as a crash and can end a survival match', () => {
    const { g } = game(['a', 'b']);
    const ev = retireSnake(g, 0);
    expect(ev.find((e) => e.type === 'death')).toMatchObject({ slot: 0, cause: 'left' });
    expect(g.status).toBe('over');
    expect(g.winners).toEqual([1]);
    expect(retireSnake(g, 0)).toEqual([]);
  });
});

describe('snake: snapshots, determinism, invariants', () => {
  it('snapshots round-trip bodies (including across a wrap edge) and items', () => {
    const { g } = game(['a', 'b'], { wrap: true });
    place(g, 0, [[0, 5], [29, 5], [28, 5], [28, 6], [28, 7]], 1);
    g.snakes[0]!.queue = [0];
    g.snakes[1]!.phase = 3;
    g.items = [{ cell: cellOf(g, 3, 4), kind: 'gem', ttl: 40 }];
    const snap = decodeSnakeSnapshot(encodeSnakeSnapshot(g, 7, 110))!;
    expect(snap.matchId).toBe(7);
    expect(snap.stepMs).toBe(110);
    expect(snap.snakes[0]!.body).toEqual([[0, 5], [29, 5], [28, 5], [28, 6], [28, 7]]);
    expect(snap.snakes[0]!.next).toBe(0);
    expect(snap.snakes[1]!.flags & 2).toBe(2);
    expect(snap.items).toEqual([{ x: 3, y: 4, kind: 'gem', ttl: 40 }]);
    expect(decodeSnakeSnapshot(new Uint8Array(4))).toBeNull();
    const bytes = encodeSnakeSnapshot(g, 7, 110);
    expect(decodeSnakeSnapshot(bytes.slice(0, bytes.length - 3))).toBeNull();
  });

  function botGame(seed: string, n: number, rules: Partial<SnakeRules> = {}): SnakeGame {
    const rng = createSeededRng(seed);
    const size = arenaSize('auto', n, false);
    const g = createGame({ ...RULES, ...size, powerUps: true, maxTicks: 1500, ...rules }, Array.from({ length: n }, (_, i) => `b${i}`), rng);
    // Phased and spawn-guarded snakes may legally overlap other bodies, so strict overlap checks
    // need power-ups off and no respawns.
    const strict = !g.rules.powerUps && g.rules.mode !== 'frenzy';
    while (g.status === 'running') {
      for (const s of g.snakes) {
        const d = botDirection(g, s.slot);
        if (d !== null) queueTurn(g, s.slot, d);
      }
      stepGame(g, rng);
      // Invariants every step.
      const seen = new Set<number>();
      for (const s of g.snakes) {
        if (!s.alive) continue;
        for (let i = 0; i < s.body.length; i++) {
          const c = s.body[i]!;
          if (strict) expect(seen.has(c), `overlap at tick ${g.tick}`).toBe(false);
          seen.add(c);
          if (i > 0 && !g.rules.wrap) {
            const p = s.body[i - 1]!;
            expect(Math.abs(cellX(g, p) - cellX(g, c)) + Math.abs(cellY(g, p) - cellY(g, c))).toBe(1);
          }
        }
      }
    }
    return g;
  }

  it('is deterministic for the same seed', () => {
    const a = botGame('det', 4);
    const b = botGame('det', 4);
    expect(a.tick).toBe(b.tick);
    expect(a.snakes.map((s) => [s.score, s.deaths, s.body.length])).toEqual(b.snakes.map((s) => [s.score, s.deaths, s.body.length]));
  });

  it('random bot arenas keep every invariant and always finish', () => {
    for (let i = 0; i < 6; i++) {
      const g = botGame(`prop-${i}`, 2 + i * 2, { mode: i % 2 ? 'frenzy' : 'survival', wrap: i === 3, powerUps: i >= 3 });
      expect(g.status).toBe('over');
      const flat = rank(g).flat();
      expect(new Set(flat).size).toBe(g.snakes.length);
    }
  });
});
