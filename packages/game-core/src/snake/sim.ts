/**
 * Neon Snake — the pure, deterministic grid simulation (integer math only).
 *
 * Step order (all snakes move simultaneously):
 *  1. Frenzy respawns; power timers.
 *  2. Each living snake takes at most one buffered turn (180° reversals are never applied).
 *  3. New heads are computed. Leaving the grid is a wall crash unless the arena wraps.
 *  4. Collisions against the post-move board: a tail that moves this step frees its cell (a
 *     snake that is growing keeps its tail). Two heads on one cell (or swapping cells) crash
 *     both. Phased and spawn-guarded snakes pass through other snakes (both ways) but never
 *     through themselves or walls.
 *  5. Survivors move; heads collect items; crashes are resolved (kill credit, sparks).
 *  6. Magnet pulls, item expiry and spawning; then end-of-round checks.
 */
import type { Rng } from '@dascade/shared';

export type Dir = 0 | 1 | 2 | 3;
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const opposite = (d: Dir): Dir => ((d + 2) & 3) as Dir;

export type SnakeMode = 'survival' | 'frenzy' | 'solo';
export type ItemKind = 'energy' | 'spark' | 'gem' | 'phase' | 'magnet';
export type DeathCause = 'wall' | 'self' | 'snake' | 'head' | 'left';

export const SNAKE = {
  startLength: 4,
  /** Max buffered turns per snake. */
  maxQueue: 3,
  points: { energy: 10, spark: 5, gem: 50, phase: 15, magnet: 15, kill: 50 } as Record<ItemKind | 'kill', number>,
  growth: { energy: 1, spark: 1, gem: 3, phase: 1, magnet: 1 } as Record<ItemKind, number>,
  /** Solo: level up every N energy pickups. */
  soloLevelEvery: 5,
  soloMaxLevel: 12,
  /** Max sparks a crashed snake leaves behind. */
  maxSparks: 24,
  magnetRadius: 2,
} as const;

export interface SnakeRules {
  mode: SnakeMode;
  cols: number;
  rows: number;
  wrap: boolean;
  powerUps: boolean;
  /** Round length in steps (frenzy end / survival cap; 0 = none, used by solo). */
  maxTicks: number;
  /** Steps per second at the base speed (converts seconds to steps). */
  stepsPerSecond: number;
}

export interface Snake {
  slot: number;
  id: string;
  /** Cell indices (y * cols + x), head first. */
  body: number[];
  dir: Dir;
  queue: Dir[];
  alive: boolean;
  /** Left the match for good. */
  retired: boolean;
  grow: number;
  score: number;
  kills: number;
  deaths: number;
  eaten: number;
  best: number;
  /** Steps of phase (pass through snakes) left. */
  phase: number;
  /** Steps of magnet left. */
  magnet: number;
  /** Steps of spawn protection left (behaves like phase). */
  guard: number;
  /** Steps until a frenzy respawn (0 = not waiting). */
  respawnIn: number;
  diedAt: number;
  cause: DeathCause | null;
  killedBy: number;
}

export interface Item {
  cell: number;
  kind: ItemKind;
  /** Steps left before it fades (-1 = permanent). */
  ttl: number;
}

export interface SnakeGame {
  rules: SnakeRules;
  tick: number;
  status: 'running' | 'over';
  snakes: Snake[];
  items: Item[];
  level: number;
  /** Winners (slots) once over; several = shared first place. */
  winners: number[];
}

export type SnakeSimEvent =
  | { type: 'eat'; slot: number; kind: ItemKind; cell: number; points: number }
  | { type: 'death'; slot: number; cause: DeathCause; by: number; cell: number }
  | { type: 'respawn'; slot: number }
  | { type: 'level'; level: number }
  | { type: 'over'; winners: number[] };

export const cellX = (g: SnakeGame, cell: number) => cell % g.rules.cols;
export const cellY = (g: SnakeGame, cell: number) => Math.floor(cell / g.rules.cols);
export const cellOf = (g: SnakeGame, x: number, y: number) => y * g.rules.cols + x;

/** Arena size for a player count (small/medium/large or auto). */
export function arenaSize(arena: 'auto' | 'small' | 'medium' | 'large', players: number, solo: boolean): { cols: number; rows: number } {
  if (solo) return { cols: 30, rows: 22 };
  const pick = arena === 'auto' ? (players <= 2 ? 'small' : players <= 6 ? 'medium' : 'large') : arena;
  if (pick === 'small') return { cols: 36, rows: 26 };
  if (pick === 'medium') return { cols: 48, rows: 34 };
  return { cols: 62, rows: 44 };
}

function createSnake(slot: number, id: string): Snake {
  return {
    slot,
    id,
    body: [],
    dir: 1,
    queue: [],
    alive: false,
    retired: false,
    grow: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    eaten: 0,
    best: 0,
    phase: 0,
    magnet: 0,
    guard: 0,
    respawnIn: 0,
    diedAt: -1,
    cause: null,
    killedBy: -1,
  };
}

/**
 * Evenly spread starting spots on interleaved lanes: even lanes start on the left facing right,
 * odd lanes on the right facing left, so no two snakes start nose to nose on the same row.
 * Slot order alternates sides (1v1 = left vs right).
 */
export function startSpots(cols: number, rows: number, n: number): Array<{ x: number; y: number; dir: Dir }> {
  if (n <= 1) return [{ x: Math.floor(cols / 4) + 2, y: Math.floor(rows / 2), dir: 1 }];
  const spots: Array<{ x: number; y: number; dir: Dir }> = [];
  for (let k = 0; k < n; k++) {
    const y = Math.floor(((k + 1) * rows) / (n + 1));
    spots.push(k % 2 === 0 ? { x: 5, y, dir: 1 } : { x: cols - 6, y, dir: 3 });
  }
  return spots;
}

function placeSnake(g: SnakeGame, s: Snake, x: number, y: number, dir: Dir): void {
  const back = opposite(dir);
  s.body = [];
  for (let i = 0; i < SNAKE.startLength; i++) {
    let cx = x + DX[back]! * i;
    let cy = y + DY[back]! * i;
    if (g.rules.wrap) {
      cx = (cx + g.rules.cols) % g.rules.cols;
      cy = (cy + g.rules.rows) % g.rules.rows;
    }
    s.body.push(cellOf(g, cx, cy));
  }
  s.dir = dir;
  s.queue = [];
  s.alive = true;
  s.grow = 0;
  s.phase = 0;
  s.magnet = 0;
  s.respawnIn = 0;
  s.cause = null;
  s.killedBy = -1;
  s.best = Math.max(s.best, s.body.length);
}

export function createGame(rules: SnakeRules, ids: readonly string[], rng: Rng): SnakeGame {
  const g: SnakeGame = { rules: { ...rules }, tick: 0, status: 'running', snakes: [], items: [], level: 1, winners: [] };
  const spots = startSpots(rules.cols, rules.rows, ids.length);
  ids.forEach((id, slot) => {
    const s = createSnake(slot, id);
    const spot = spots[slot]!;
    placeSnake(g, s, spot.x, spot.y, spot.dir);
    g.snakes.push(s);
  });
  refillItems(g, rng);
  return g;
}

/** Buffer a turn. Ignores repeats and reversals of the last buffered heading. Returns true if queued. */
export function queueTurn(g: SnakeGame, slot: number, dir: number): boolean {
  const s = g.snakes[slot];
  if (!s || !s.alive || g.status !== 'running' || !Number.isInteger(dir) || dir < 0 || dir > 3) return false;
  const d = dir as Dir;
  const last = s.queue.length ? s.queue[s.queue.length - 1]! : s.dir;
  if (d === last || d === opposite(last)) return false;
  if (s.queue.length >= SNAKE.maxQueue) return false;
  s.queue.push(d);
  return true;
}

/** A player left: their snake is removed from play (counts as a crash in survival). */
export function retireSnake(g: SnakeGame, slot: number): SnakeSimEvent[] {
  const s = g.snakes[slot];
  if (!s || s.retired) return [];
  s.retired = true;
  const events: SnakeSimEvent[] = [];
  if (s.alive) {
    const head = s.body[0] ?? 0;
    kill(g, s, 'left', -1);
    dropSparks(g, s);
    s.body = [];
    events.push({ type: 'death', slot, cause: 'left', by: -1, cell: head });
  }
  s.respawnIn = 0;
  checkEnd(g, events);
  return events;
}

function isGhost(s: Snake): boolean {
  return s.phase > 0 || s.guard > 0;
}

function occupied(g: SnakeGame): Map<number, number> {
  const map = new Map<number, number>();
  for (const s of g.snakes) if (s.alive) for (const c of s.body) map.set(c, s.slot);
  return map;
}

function nearHead(g: SnakeGame, cell: number, dist: number): boolean {
  const x = cellX(g, cell);
  const y = cellY(g, cell);
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const h = s.body[0]!;
    if (Math.abs(cellX(g, h) - x) + Math.abs(cellY(g, h) - y) < dist) return true;
  }
  return false;
}

/** A random empty cell (not a body, not an item, not right next to a head). -1 if the board is full. */
export function freeCell(g: SnakeGame, rng: Rng, headDist = 3): number {
  const total = g.rules.cols * g.rules.rows;
  const bodies = occupied(g);
  const items = new Set(g.items.map((i) => i.cell));
  const ok = (c: number) => !bodies.has(c) && !items.has(c) && !nearHead(g, c, headDist);
  for (let attempt = 0; attempt < 40; attempt++) {
    const c = rng.int(total);
    if (ok(c)) return c;
  }
  const start = rng.int(total);
  for (let k = 0; k < total; k++) {
    const c = (start + k) % total;
    if (ok(c)) return c;
  }
  for (let k = 0; k < total; k++) {
    const c = (start + k) % total;
    if (!bodies.has(c) && !items.has(c)) return c;
  }
  return -1;
}

function livingCount(g: SnakeGame): number {
  let n = 0;
  for (const s of g.snakes) if (!s.retired) n++;
  return n;
}

function energyTarget(g: SnakeGame): number {
  if (g.rules.mode === 'solo') return 2;
  return Math.min(14, 2 + livingCount(g));
}

function refillItems(g: SnakeGame, rng: Rng): void {
  let energy = 0;
  let rare = 0;
  for (const it of g.items) {
    if (it.kind === 'energy') energy++;
    else if (it.kind !== 'spark') rare++;
  }
  const want = energyTarget(g);
  while (energy < want) {
    const c = freeCell(g, rng);
    if (c < 0) break;
    g.items.push({ cell: c, kind: 'energy', ttl: -1 });
    energy++;
  }
  if (!g.rules.powerUps) return;
  const maxRare = g.rules.mode === 'solo' || livingCount(g) < 6 ? 1 : 2;
  // On average one rare item every ~9 seconds while there is room for one.
  if (rare < maxRare && rng.int(Math.max(1, Math.round(g.rules.stepsPerSecond * 9))) === 0) {
    const c = freeCell(g, rng, 4);
    if (c < 0) return;
    const roll = rng.int(10);
    const kind: ItemKind = roll < 4 ? 'gem' : roll < 7 ? 'phase' : 'magnet';
    g.items.push({ cell: c, kind, ttl: Math.round(g.rules.stepsPerSecond * 10) });
  }
}

function kill(g: SnakeGame, s: Snake, cause: DeathCause, by: number): void {
  s.alive = false;
  s.cause = cause;
  s.killedBy = by;
  s.diedAt = g.tick;
  s.deaths++;
  s.queue = [];
  s.phase = 0;
  s.magnet = 0;
  s.guard = 0;
}

/** A crashed snake breaks into sparks along its body (multiplayer only). */
function dropSparks(g: SnakeGame, s: Snake): void {
  if (g.rules.mode === 'solo') return;
  const taken = new Set(g.items.map((i) => i.cell));
  const bodies = occupied(g);
  let dropped = 0;
  for (let i = 1; i < s.body.length && dropped < SNAKE.maxSparks; i += 2) {
    const c = s.body[i]!;
    if (taken.has(c) || bodies.has(c)) continue;
    g.items.push({ cell: c, kind: 'spark', ttl: Math.round(g.rules.stepsPerSecond * 12) });
    taken.add(c);
    dropped++;
  }
}

function spawnSpot(g: SnakeGame, rng: Rng): { x: number; y: number; dir: Dir } | null {
  const { cols, rows } = g.rules;
  const bodies = occupied(g);
  const items = new Set(g.items.map((i) => i.cell));
  const clear = (x: number, y: number) => x >= 1 && y >= 1 && x < cols - 1 && y < rows - 1 && !bodies.has(y * cols + x);
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = 3 + rng.int(Math.max(1, cols - 6));
    const y = 3 + rng.int(Math.max(1, rows - 6));
    const dir = rng.int(4) as Dir;
    const back = opposite(dir);
    let ok = !nearHead(g, y * cols + x, 6) && !items.has(y * cols + x);
    for (let i = -6; ok && i < SNAKE.startLength; i++) {
      // i < 0: cells ahead of the head; i ≥ 0: the body.
      const k = i < 0 ? -i : i;
      const d = i < 0 ? dir : back;
      const cx = x + DX[d]! * k;
      const cy = y + DY[d]! * k;
      if (!clear(cx, cy)) ok = false;
    }
    if (ok) return { x, y, dir };
  }
  return null;
}

export const GUARD_SECONDS = 2;
export const RESPAWN_SECONDS = 2;
export const POWER_SECONDS = { phase: 5, magnet: 7 } as const;

/** Advance one grid step. */
export function stepGame(g: SnakeGame, rng: Rng): SnakeSimEvent[] {
  const events: SnakeSimEvent[] = [];
  if (g.status === 'over') return events;
  g.tick++;
  const { cols, rows, wrap } = g.rules;
  const sps = g.rules.stepsPerSecond;

  // 1. Respawns (frenzy) and power timers.
  for (const s of g.snakes) {
    if (s.retired) continue;
    if (!s.alive && s.respawnIn > 0) {
      s.respawnIn--;
      if (s.respawnIn === 0) {
        const spot = spawnSpot(g, rng);
        if (spot) {
          placeSnake(g, s, spot.x, spot.y, spot.dir);
          s.guard = Math.round(sps * GUARD_SECONDS);
          events.push({ type: 'respawn', slot: s.slot });
        } else s.respawnIn = 1;
      }
    }
    if (!s.alive) continue;
    if (s.phase > 0) s.phase--;
    if (s.magnet > 0) s.magnet--;
    if (s.guard > 0) s.guard--;
  }

  // 2 + 3. Turns and new heads.
  const next = new Map<number, number>();
  const wallDead = new Set<number>();
  for (const s of g.snakes) {
    if (!s.alive) continue;
    while (s.queue.length) {
      const d = s.queue.shift()!;
      if (d !== s.dir && d !== opposite(s.dir)) {
        s.dir = d;
        break;
      }
    }
    const head = s.body[0]!;
    let x = cellX(g, head) + DX[s.dir]!;
    let y = cellY(g, head) + DY[s.dir]!;
    if (wrap) {
      x = (x + cols) % cols;
      y = (y + rows) % rows;
    } else if (x < 0 || y < 0 || x >= cols || y >= rows) {
      wallDead.add(s.slot);
      continue;
    }
    next.set(s.slot, y * cols + x);
  }

  // 4. Collisions against the post-move board.
  const solid = new Map<number, number>(); // cell → owner slot (bodies after the move)
  for (const s of g.snakes) {
    if (!s.alive) continue;
    const keepTail = s.grow > 0 || wallDead.has(s.slot);
    const len = keepTail ? s.body.length : s.body.length - 1;
    for (let i = 0; i < len; i++) solid.set(s.body[i]!, s.slot);
  }
  const headsAt = new Map<number, number[]>();
  for (const [slot, cell] of next) {
    const list = headsAt.get(cell) ?? [];
    list.push(slot);
    headsAt.set(cell, list);
  }
  const crashes = new Map<number, { cause: DeathCause; by: number }>();
  for (const slot of wallDead) crashes.set(slot, { cause: 'wall', by: -1 });
  for (const [slot, cell] of next) {
    const s = g.snakes[slot]!;
    const owner = solid.get(cell);
    if (owner !== undefined) {
      if (owner === slot) {
        crashes.set(slot, { cause: 'self', by: -1 });
        continue;
      }
      const other = g.snakes[owner]!;
      if (!isGhost(s) && !isGhost(other)) {
        // Two heads swapping cells is a head-on crash (no kill credit either way).
        const swap = next.get(owner) === s.body[0] && other.body[0] === cell;
        crashes.set(slot, swap ? { cause: 'head', by: -1 } : { cause: 'snake', by: owner });
        continue;
      }
    }
    const rivals = (headsAt.get(cell) ?? []).filter((o) => o !== slot && !isGhost(g.snakes[o]!));
    if (rivals.length && !isGhost(s)) crashes.set(slot, { cause: 'head', by: -1 });
  }

  // 5. Crashes, then survivors move and eat.
  for (const [slot, crash] of crashes) {
    const s = g.snakes[slot]!;
    const at = next.get(slot) ?? s.body[0]!;
    kill(g, s, crash.cause, crash.by);
    events.push({ type: 'death', slot, cause: crash.cause, by: crash.by, cell: at });
    if (crash.by >= 0 && g.rules.mode !== 'solo') {
      const killer = g.snakes[crash.by]!;
      killer.kills++;
      killer.score += SNAKE.points.kill;
    }
  }
  for (const [slot, cell] of next) {
    const s = g.snakes[slot]!;
    if (!s.alive) continue;
    s.body.unshift(cell);
    if (s.grow > 0) s.grow--;
    else s.body.pop();
    eatAt(g, s, cell, events);
  }
  // Magnet: sweep energy and sparks around the head.
  for (const s of g.snakes) {
    if (!s.alive || s.magnet <= 0) continue;
    const hx = cellX(g, s.body[0]!);
    const hy = cellY(g, s.body[0]!);
    for (const it of [...g.items]) {
      if (it.kind !== 'energy' && it.kind !== 'spark') continue;
      const dx = Math.abs(cellX(g, it.cell) - hx);
      const dy = Math.abs(cellY(g, it.cell) - hy);
      if (dx <= SNAKE.magnetRadius && dy <= SNAKE.magnetRadius) eatAt(g, s, it.cell, events);
    }
  }
  for (const [slot] of crashes) {
    const s = g.snakes[slot]!;
    dropSparks(g, s);
    s.best = Math.max(s.best, s.body.length);
    s.body = [];
    if (g.rules.mode === 'frenzy' && !s.retired) s.respawnIn = Math.round(sps * RESPAWN_SECONDS);
  }

  // 6. Items: expiry and refills.
  for (let i = g.items.length - 1; i >= 0; i--) {
    const it = g.items[i]!;
    if (it.ttl > 0) {
      it.ttl--;
      if (it.ttl === 0) g.items.splice(i, 1);
    }
  }
  refillItems(g, rng);
  checkEnd(g, events);
  return events;
}

function eatAt(g: SnakeGame, s: Snake, cell: number, events: SnakeSimEvent[]): void {
  const idx = g.items.findIndex((i) => i.cell === cell);
  if (idx < 0) return;
  const it = g.items[idx]!;
  g.items.splice(idx, 1);
  const mult = g.rules.mode === 'solo' ? g.level : 1;
  const points = SNAKE.points[it.kind] * mult;
  s.score += points;
  s.grow += SNAKE.growth[it.kind];
  s.best = Math.max(s.best, s.body.length + s.grow);
  const sps = g.rules.stepsPerSecond;
  if (it.kind === 'phase') s.phase = Math.round(sps * POWER_SECONDS.phase);
  if (it.kind === 'magnet') s.magnet = Math.round(sps * POWER_SECONDS.magnet);
  events.push({ type: 'eat', slot: s.slot, kind: it.kind, cell, points });
  if (it.kind === 'energy') {
    s.eaten++;
    if (g.rules.mode === 'solo' && s.eaten % SNAKE.soloLevelEvery === 0 && g.level < SNAKE.soloMaxLevel) {
      g.level++;
      events.push({ type: 'level', level: g.level });
    }
  }
}

/** Ranking key for the living at a time cap: length, then score. */
function strength(s: Snake): number {
  return s.body.length * 1_000_000 + s.score;
}

function checkEnd(g: SnakeGame, events: SnakeSimEvent[]): void {
  if (g.status === 'over') return;
  const { mode, maxTicks } = g.rules;
  const timeUp = maxTicks > 0 && g.tick >= maxTicks;
  const alive = g.snakes.filter((s) => s.alive);
  const over =
    mode === 'solo'
      ? g.snakes.every((s) => !s.alive && s.respawnIn === 0)
      : mode === 'survival'
        ? timeUp || (alive.length <= 1 && g.snakes.length > 1) || alive.length === 0
        : timeUp || livingCount(g) === 0;
  if (!over) return;
  g.status = 'over';
  g.winners = rank(g)[0] ?? [];
  events.push({ type: 'over', winners: g.winners });
}

/**
 * Final standings as groups of slots (best first; a group is a shared place).
 * Survival: the living (by length, then score), then crashed snakes by how long they lasted
 * (same-step crashes share a place). Frenzy and solo: by score.
 */
export function rank(g: SnakeGame): number[][] {
  const groups: number[][] = [];
  const push = (list: Snake[], key: (s: Snake) => number) => {
    const sorted = [...list].sort((a, b) => key(b) - key(a) || a.slot - b.slot);
    let prev: number | null = null;
    for (const s of sorted) {
      const k = key(s);
      if (prev !== null && k === prev) groups[groups.length - 1]!.push(s.slot);
      else groups.push([s.slot]);
      prev = k;
    }
  };
  if (g.rules.mode === 'survival') {
    const alive = g.snakes.filter((s) => s.alive);
    const dead = g.snakes.filter((s) => !s.alive);
    push(alive, strength);
    push(dead, (s) => s.diedAt);
    return groups;
  }
  push(g.snakes, (s) => s.score);
  return groups;
}
