/**
 * Compact binary grid snapshot for Neon Snake (little-endian).
 *
 * Header (16 bytes)
 *   u8 version   u8 status (0 running, 1 over)   u16 matchId
 *   u32 tick     u16 stepMs   u8 cols   u8 rows
 *   u8 snakes    u8 level     u16 items
 * Snake (8 bytes + body)
 *   u8 slot   u8 flags (1 alive, 2 phase, 4 magnet, 8 guard, 16 retired)   u8 dir   u8 next (queued dir or 255)
 *   u16 length   u8 headX   u8 headY
 *   ceil((length − 1) / 4) bytes: 2-bit direction from each segment to the next one towards the tail
 * Item (4 bytes)
 *   u8 x   u8 y   u8 kind   u8 ttl (steps left, 255 = permanent or ≥ 255)
 */
import { DX, DY, cellX, cellY, type Dir, type ItemKind, type SnakeGame } from './sim.ts';

export const SNAKE_SNAPSHOT_VERSION = 1;
const HEADER = 16;
const ITEM_KINDS: readonly ItemKind[] = ['energy', 'spark', 'gem', 'phase', 'magnet'];

export const SnakeFlag = { alive: 1, phase: 2, magnet: 4, guard: 8, retired: 16 } as const;

export interface SnapSnake {
  slot: number;
  flags: number;
  dir: Dir;
  /** Next buffered direction (-1 = none). */
  next: number;
  /** Cells as [x, y] pairs, head first. */
  body: Array<[number, number]>;
}

export interface SnapItem {
  x: number;
  y: number;
  kind: ItemKind;
  ttl: number;
}

export interface SnakeSnapshot {
  matchId: number;
  tick: number;
  over: boolean;
  stepMs: number;
  cols: number;
  rows: number;
  level: number;
  snakes: SnapSnake[];
  items: SnapItem[];
}

/** Direction from cell a to its neighbour b (wrap-aware). */
function stepDir(ax: number, ay: number, bx: number, by: number, cols: number, rows: number): Dir {
  let dx = bx - ax;
  let dy = by - ay;
  if (dx > 1) dx -= cols;
  if (dx < -1) dx += cols;
  if (dy > 1) dy -= rows;
  if (dy < -1) dy += rows;
  if (dy < 0) return 0;
  if (dx > 0) return 1;
  if (dy > 0) return 2;
  return 3;
}

export function encodeSnakeSnapshot(g: SnakeGame, matchId: number, stepMs: number): Uint8Array {
  const { cols, rows } = g.rules;
  let size = HEADER + g.items.length * 4;
  for (const s of g.snakes) size += 8 + Math.ceil(Math.max(0, s.body.length - 1) / 4);
  const buf = new Uint8Array(size);
  const v = new DataView(buf.buffer);
  v.setUint8(0, SNAKE_SNAPSHOT_VERSION);
  v.setUint8(1, g.status === 'over' ? 1 : 0);
  v.setUint16(2, matchId & 0xffff, true);
  v.setUint32(4, g.tick >>> 0, true);
  v.setUint16(8, Math.min(0xffff, Math.round(stepMs)), true);
  v.setUint8(10, cols);
  v.setUint8(11, rows);
  v.setUint8(12, g.snakes.length);
  v.setUint8(13, Math.min(255, g.level));
  v.setUint16(14, g.items.length, true);
  let o = HEADER;
  for (const s of g.snakes) {
    const flags =
      (s.alive ? SnakeFlag.alive : 0) |
      (s.phase > 0 ? SnakeFlag.phase : 0) |
      (s.magnet > 0 ? SnakeFlag.magnet : 0) |
      (s.guard > 0 ? SnakeFlag.guard : 0) |
      (s.retired ? SnakeFlag.retired : 0);
    v.setUint8(o, s.slot);
    v.setUint8(o + 1, flags);
    v.setUint8(o + 2, s.dir);
    v.setUint8(o + 3, s.queue.length ? s.queue[0]! : 255);
    v.setUint16(o + 4, s.body.length, true);
    const head = s.body[0] ?? 0;
    v.setUint8(o + 6, s.body.length ? cellX(g, head) : 0);
    v.setUint8(o + 7, s.body.length ? cellY(g, head) : 0);
    o += 8;
    const n = Math.max(0, s.body.length - 1);
    for (let i = 0; i < n; i++) {
      const a = s.body[i]!;
      const b = s.body[i + 1]!;
      const d = stepDir(cellX(g, a), cellY(g, a), cellX(g, b), cellY(g, b), cols, rows);
      buf[o + (i >> 2)]! |= d << ((i & 3) * 2);
    }
    o += Math.ceil(n / 4);
  }
  for (const it of g.items) {
    v.setUint8(o, cellX(g, it.cell));
    v.setUint8(o + 1, cellY(g, it.cell));
    v.setUint8(o + 2, Math.max(0, ITEM_KINDS.indexOf(it.kind)));
    v.setUint8(o + 3, it.ttl < 0 ? 255 : Math.min(255, it.ttl));
    o += 4;
  }
  return buf;
}

/** Decode a grid snapshot; null for anything malformed. */
export function decodeSnakeSnapshot(bytes: Uint8Array): SnakeSnapshot | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== SNAKE_SNAPSHOT_VERSION) return null;
  const cols = v.getUint8(10);
  const rows = v.getUint8(11);
  if (cols < 4 || rows < 4) return null;
  const count = v.getUint8(12);
  const itemCount = v.getUint16(14, true);
  const snakes: SnapSnake[] = [];
  let o = HEADER;
  for (let k = 0; k < count; k++) {
    if (o + 8 > bytes.byteLength) return null;
    const len = v.getUint16(o + 4, true);
    const bodyBytes = Math.ceil(Math.max(0, len - 1) / 4);
    if (o + 8 + bodyBytes > bytes.byteLength) return null;
    let x = v.getUint8(o + 6);
    let y = v.getUint8(o + 7);
    const body: Array<[number, number]> = [];
    if (len > 0) body.push([x, y]);
    for (let i = 0; i < len - 1; i++) {
      const d = ((bytes[o + 8 + (i >> 2)]! >> ((i & 3) * 2)) & 3) as Dir;
      x = (x + DX[d]! + cols) % cols;
      y = (y + DY[d]! + rows) % rows;
      body.push([x, y]);
    }
    const next = v.getUint8(o + 3);
    snakes.push({ slot: v.getUint8(o), flags: v.getUint8(o + 1), dir: (v.getUint8(o + 2) & 3) as Dir, next: next === 255 ? -1 : next & 3, body });
    o += 8 + bodyBytes;
  }
  if (o + itemCount * 4 > bytes.byteLength) return null;
  const items: SnapItem[] = [];
  for (let k = 0; k < itemCount; k++) {
    const kind = ITEM_KINDS[v.getUint8(o + 2)];
    if (kind) items.push({ x: v.getUint8(o), y: v.getUint8(o + 1), kind, ttl: v.getUint8(o + 3) });
    o += 4;
  }
  return {
    matchId: v.getUint16(2, true),
    tick: v.getUint32(4, true),
    over: v.getUint8(1) === 1,
    stepMs: v.getUint16(8, true),
    cols,
    rows,
    level: v.getUint8(13),
    snakes,
    items,
  };
}
