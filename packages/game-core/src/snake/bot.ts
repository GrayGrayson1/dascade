/**
 * A simple, deterministic snake autopilot (tests, load scripts, demos). It never reverses,
 * avoids walls and bodies, prefers moves that keep plenty of open space (a bounded flood
 * fill) and otherwise heads for the nearest item.
 */
import { DX, DY, cellX, cellY, opposite, type Dir, type SnakeGame } from './sim.ts';

function blocked(g: SnakeGame): Set<number> {
  const set = new Set<number>();
  for (const s of g.snakes) {
    if (!s.alive) continue;
    // Tails that will move are still treated as blocked (a cautious bot).
    for (const c of s.body) set.add(c);
  }
  return set;
}

function neighbour(g: SnakeGame, cell: number, d: Dir): number {
  const { cols, rows, wrap } = g.rules;
  let x = cellX(g, cell) + DX[d]!;
  let y = cellY(g, cell) + DY[d]!;
  if (wrap) {
    x = (x + cols) % cols;
    y = (y + rows) % rows;
  } else if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
  return y * cols + x;
}

function openSpace(g: SnakeGame, from: number, walls: Set<number>, cap: number): number {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length && seen.size < cap) {
    const c = queue.shift()!;
    for (let d = 0; d < 4; d++) {
      const n = neighbour(g, c, d as Dir);
      if (n < 0 || seen.has(n) || walls.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size;
}

/** The direction the bot wants for `slot` this step, or null when it has no safe move (or is dead). */
export function botDirection(g: SnakeGame, slot: number): Dir | null {
  const s = g.snakes[slot];
  if (!s || !s.alive || !s.body.length) return null;
  const walls = blocked(g);
  const head = s.body[0]!;
  const need = s.body.length + 4;
  let best: { d: Dir; space: number; dist: number } | null = null;
  for (let d = 0; d < 4; d++) {
    const dir = d as Dir;
    if (dir === opposite(s.dir)) continue;
    const n = neighbour(g, head, dir);
    if (n < 0 || walls.has(n)) continue;
    const space = openSpace(g, n, walls, need + 1);
    let dist = 1e9;
    for (const it of g.items) {
      const dd = Math.abs(cellX(g, it.cell) - cellX(g, n)) + Math.abs(cellY(g, it.cell) - cellY(g, n));
      if (dd < dist) dist = dd;
    }
    const roomy = space > need ? 1 : 0;
    if (
      !best ||
      roomy > (best.space > need ? 1 : 0) ||
      (roomy === (best.space > need ? 1 : 0) && (roomy ? dist < best.dist : space > best.space))
    ) {
      best = { d: dir, space, dist };
    }
  }
  return best ? best.d : null;
}
