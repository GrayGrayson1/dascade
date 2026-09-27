/**
 * DAS Ships — battle rules: a captain's hidden board, shots, salvos, sinking, victory and turn order.
 * Pure: the server keeps one Board per captain (never serialised publicly) and publishes only
 * `publicBoard()` strings plus sunk vessels.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import type { ShipsCell, ShipsFiringMode, ShipsPlacement, ShipsShotView, ShipsVesselView, VesselId } from '@dascade/shared/games/ships';
import { inBounds, placementCells, validateLayout, type ShipsRules } from './layout.ts';

/** Shot marks on a board. */
export const SHOT_NONE = 0;
export const SHOT_MISS = 1;
export const SHOT_HIT = 2;

export interface BoardVessel {
  id: VesselId;
  placement: ShipsPlacement;
  /** Square indices (y * size + x). */
  cells: number[];
  hits: number;
}

export interface Board {
  size: number;
  vessels: BoardVessel[];
  /** Vessel index per square (-1 = open water). */
  owner: Int8Array;
  /** SHOT_* per square. */
  shots: Uint8Array;
}

/** Build a captain's board from a complete, valid layout. Throws on an invalid layout (the room validates first). */
export function createBoard(layout: readonly ShipsPlacement[], rules: ShipsRules): Board {
  const err = validateLayout(layout, rules, { complete: true });
  if (err) throw new Error(`Invalid layout: ${err.message}`);
  const size = rules.size;
  const owner = new Int8Array(size * size).fill(-1);
  const vessels: BoardVessel[] = layout.map((p, i) => {
    const cells = placementCells(p).map((c) => c.y * size + c.x);
    for (const idx of cells) owner[idx] = i;
    return { id: p.id, placement: { id: p.id, x: p.x, y: p.y, dir: p.dir }, cells, hits: 0 };
  });
  return { size, vessels, owner, shots: new Uint8Array(size * size) };
}

export function isSunk(v: BoardVessel): boolean {
  return v.hits >= v.cells.length;
}

export function vesselsAfloat(board: Board): number {
  return board.vessels.filter((v) => !isSunk(v)).length;
}

export function isDefeated(board: Board): boolean {
  return board.vessels.every(isSunk);
}

export function untouchedCount(board: Board): number {
  let n = 0;
  for (const s of board.shots) if (s === SHOT_NONE) n++;
  return n;
}

export function wasShot(board: Board, x: number, y: number): boolean {
  return board.shots[y * board.size + x] !== SHOT_NONE;
}

export type SalvoError = 'wrong_count' | 'out_of_bounds' | 'already_shot' | 'duplicate';

/** Validate a volley before resolving it: exactly `required` distinct, in-bounds, untouched squares. */
export function validateVolley(board: Board, cells: readonly ShipsCell[], required: number): SalvoError | null {
  if (cells.length !== required) return 'wrong_count';
  const seen = new Set<number>();
  for (const c of cells) {
    if (!inBounds(c.x, c.y, board.size)) return 'out_of_bounds';
    const idx = c.y * board.size + c.x;
    if (seen.has(idx)) return 'duplicate';
    seen.add(idx);
    if (board.shots[idx] !== SHOT_NONE) return 'already_shot';
  }
  return null;
}

/**
 * Resolve a (pre-validated) volley against a board, in order. A shot that completes a vessel reports
 * 'sunk' with the vessel id; other hits report only 'hit' (which vessel was hit stays secret).
 */
export function resolveVolley(board: Board, cells: readonly ShipsCell[]): ShipsShotView[] {
  const out: ShipsShotView[] = [];
  for (const c of cells) {
    const idx = c.y * board.size + c.x;
    if (board.shots[idx] !== SHOT_NONE) throw new Error('Square already shot');
    const vi = board.owner[idx]!;
    if (vi < 0) {
      board.shots[idx] = SHOT_MISS;
      out.push({ x: c.x, y: c.y, result: 'miss' });
      continue;
    }
    board.shots[idx] = SHOT_HIT;
    const v = board.vessels[vi]!;
    v.hits++;
    out.push(isSunk(v) ? { x: c.x, y: c.y, result: 'sunk', vessel: v.id } : { x: c.x, y: c.y, result: 'hit' });
  }
  return out;
}

/** Shots the attacker must fire this turn. */
export function shotsAllowed(mode: ShipsFiringMode, attacker: Board, target: Board): number {
  const want = mode === 'salvo' ? Math.max(1, vesselsAfloat(attacker)) : 1;
  return Math.max(0, Math.min(want, untouchedCount(target)));
}

/** Whether the same captain keeps firing after this volley (hot-streak mode: any hit). */
export function keepsTurn(mode: ShipsFiringMode, shots: readonly ShipsShotView[]): boolean {
  return mode === 'streak' && shots.some((s) => s.result !== 'miss');
}

/** Random untouched squares (turn-clock auto-fire). */
export function randomTargets(rng: Rng, board: Board, count: number): ShipsCell[] {
  const open: ShipsCell[] = [];
  for (let y = 0; y < board.size; y++)
    for (let x = 0; x < board.size; x++) if (board.shots[y * board.size + x] === SHOT_NONE) open.push({ x, y });
  return shuffleInPlace(open, rng).slice(0, Math.max(0, count));
}

/**
 * Public view of the shots a board has received: '.' untouched · 'o' miss · 'x' hit · '#' hit on a
 * sunk vessel. Contains nothing that isn't already known to both captains.
 */
export function publicBoard(board: Board): string {
  let s = '';
  for (let i = 0; i < board.shots.length; i++) {
    const shot = board.shots[i];
    if (shot === SHOT_MISS) s += 'o';
    else if (shot === SHOT_HIT) {
      const v = board.vessels[board.owner[i]!];
      s += v && isSunk(v) ? '#' : 'x';
    } else s += '.';
  }
  return s;
}

/** Sunk vessels (public: every square of them has been hit). */
export function sunkVessels(board: Board): ShipsVesselView[] {
  return board.vessels.filter(isSunk).map((v) => ({ ...v.placement }));
}

/** The whole fleet (revealed only after the game is over). */
export function fleetOf(board: Board): ShipsVesselView[] {
  return board.vessels.map((v) => ({ ...v.placement }));
}
