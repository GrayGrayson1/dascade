/**
 * Block Drop — deterministic falling-block engine (60 Hz ticks, integer grid, seeded 7-bag).
 *
 * Runs identically on the client (instant feel) and on the server (replay of the input log);
 * see @dascade/game-core/classics/shared (ClassicsSim) and the classics kit notes.
 *
 * Rules
 *  - Board 10 × 22 (the top 2 rows are hidden spawn rows). Pieces come from a shuffled bag of
 *    all seven; a queue of the next 5 is visible. Hold swaps once per piece.
 *  - Movement: tap moves one cell; holding auto-repeats after DAS (10 ticks) every ARR (2 ticks).
 *  - Rotation CW/CCW with wall kicks (pieces.ts). Soft drop falls 1 row / 2 ticks (1 pt per row);
 *    hard drop falls to the ghost and locks at once (2 pts per row).
 *  - Lock delay: 30 ticks on the ground; a successful move/rotation resets it, at most 15 times
 *    per piece (then it locks as soon as it touches down).
 *  - Line clears (× level): 1 = 100, 2 = 300, 3 = 500, 4 ("QUAD") = 800. A T piece that locks
 *    right after a rotation with 3 of its 4 box corners filled is a T-SPIN: 0 lines 400, 1 = 800,
 *    2 = 1200, 3 = 1600. Consecutive "hard" clears (quads, T-spins with lines) are BACK-TO-BACK ×1.5.
 *    Consecutive line-clearing locks build a COMBO: +50 × combo × level. Clearing the whole
 *    board adds ALL CLEAR +1800 × level.
 *  - Level = startLevel + floor(lines / 10), gravity from GRAVITY (ticks per row).
 *  - Clears pause spawning for CLEAR_DELAY ticks (the clear animation).
 *  - Game over: a new piece can't spawn (block out) or a piece locks entirely in the hidden rows.
 *
 * Input codes (anything else is invalid → a tampered log):
 *  1 left down · 2 left up · 3 right down · 4 right up · 5 soft down · 6 soft up
 *  7 hard drop · 8 rotate CW · 9 rotate CCW · 10 hold
 */
import type { RunSummary } from '@dascade/shared/games/classics';
import { substream, type ClassicsSim, type Rng } from '../classics/shared/index.ts';
import { CELL_PIECE, PIECES, PIECE_CELL, SHAPES, boxSize, kicksFor, type Cells, type PieceId } from './pieces.ts';

export const COLS = 10;
export const ROWS = 22;
export const HIDDEN = 2;
export const VISIBLE_ROWS = ROWS - HIDDEN;
export const NEXT_COUNT = 5;

export const DAS = 10;
export const ARR = 2;
export const SOFT_EVERY = 2;
export const LOCK_DELAY = 30;
export const MAX_LOCK_RESETS = 15;
export const CLEAR_DELAY = 18;
export const MAX_LEVEL = 20;

/** Ticks per row at levels 1..20 (hand-tuned curve; integers keep the engine exact). */
export const GRAVITY = [60, 48, 38, 30, 24, 19, 15, 12, 10, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1] as const;

export const CODE = {
  leftDown: 1,
  leftUp: 2,
  rightDown: 3,
  rightUp: 4,
  softDown: 5,
  softUp: 6,
  hardDrop: 7,
  rotateCW: 8,
  rotateCCW: 9,
  hold: 10,
} as const;
export const MAX_CODE = 10;

export const LINE_SCORES = [0, 100, 300, 500, 800] as const;
export const TSPIN_SCORES = [400, 800, 1200, 1600] as const;
export const COMBO_SCORE = 50;
export const ALL_CLEAR_SCORE = 1800;

export interface BlocksOptions {
  startLevel?: number;
}

export interface ActivePiece {
  id: PieceId;
  rot: number;
  x: number;
  y: number;
}

export type BlocksEvent =
  | { t: 'move' }
  | { t: 'rotate'; kick: number }
  | { t: 'hold' }
  | { t: 'harddrop'; rows: number; cells: Array<[number, number]>; piece: PieceId }
  | { t: 'lock'; cells: Array<[number, number]>; piece: PieceId }
  | { t: 'clear'; rows: number[]; lines: number; tspin: boolean; b2b: boolean; combo: number; allClear: boolean; points: number }
  | { t: 'tspin'; points: number }
  | { t: 'level'; level: number }
  | { t: 'spawn'; piece: PieceId }
  | { t: 'over'; reason: 'blockout' | 'lockout' };

export class BlocksSim implements ClassicsSim {
  tick = 0;
  /** Why the game ended (set the moment it happens, even mid-input). */
  ended: 'blockout' | 'lockout' | null = null;
  /** The tick in which the game ended has been stepped (see ClassicsSim: over only flips inside step()). */
  private endSettled = false;
  private stepping = false;
  readonly board = new Uint8Array(COLS * ROWS);
  piece: ActivePiece | null = null;
  hold: PieceId | null = null;
  holdUsed = false;
  readonly queue: PieceId[] = [];
  score = 0;
  lines = 0;
  level: number;
  readonly startLevel: number;
  combo = -1;
  b2b = false;
  pieces = 0;
  tspins = 0;
  quads = 0;
  maxCombo = 0;
  /** Rows being cleared (for the clear animation) and ticks left. */
  clearing: number[] = [];
  clearTimer = 0;
  lockTimer = 0;
  lockResets = 0;
  /** The last successful action on the current piece was a rotation (T-spin detection). */
  private lastRotate = false;
  private lowestY = 0;
  private gravityCount = 0;
  private softCount = 0;
  leftHeld = false;
  rightHeld = false;
  softHeld = false;
  /** Most recently pressed direction wins while both are held. */
  private dir: -1 | 0 | 1 = 0;
  private dasCount = 0;
  private arrCount = 0;
  private readonly bagRng: Rng;
  private bag: PieceId[] = [];
  /** Render/sfx events since the last drain (client only; bounded). */
  readonly events: BlocksEvent[] = [];
  private readonly recordEvents: boolean;

  constructor(seed: string, options: BlocksOptions = {}, recordEvents = true) {
    this.startLevel = Math.max(1, Math.min(10, Math.floor(options.startLevel ?? 1)));
    this.level = this.startLevel;
    this.bagRng = substream(seed, 'bag');
    this.recordEvents = recordEvents;
    while (this.queue.length < NEXT_COUNT) this.queue.push(this.nextFromBag());
    this.spawn();
  }

  // ---------------------------------------------------------------------------
  // ClassicsSim
  // ---------------------------------------------------------------------------

  /** Game over, visible to the verified-run plumbing only after the ending tick was stepped. */
  get over(): boolean {
    return this.ended !== null && this.endSettled;
  }

  input(code: number): boolean {
    if (!Number.isInteger(code) || code < 1 || code > MAX_CODE) return false;
    if (this.ended) return true;
    switch (code) {
      case CODE.leftDown:
        this.leftHeld = true;
        this.startShift(-1);
        break;
      case CODE.leftUp:
        this.leftHeld = false;
        if (this.dir === -1) this.resumeShift();
        break;
      case CODE.rightDown:
        this.rightHeld = true;
        this.startShift(1);
        break;
      case CODE.rightUp:
        this.rightHeld = false;
        if (this.dir === 1) this.resumeShift();
        break;
      case CODE.softDown:
        this.softHeld = true;
        this.softCount = SOFT_EVERY;
        break;
      case CODE.softUp:
        this.softHeld = false;
        break;
      case CODE.hardDrop:
        this.hardDrop();
        break;
      case CODE.rotateCW:
        this.rotate(1);
        break;
      case CODE.rotateCCW:
        this.rotate(-1);
        break;
      case CODE.hold:
        this.doHold();
        break;
    }
    return true;
  }

  step(): void {
    if (this.ended) {
      // An input ended the game during this tick: finish the tick once so the ending input's
      // tick is strictly before the final tick (the last batch then carries it).
      if (!this.endSettled) {
        this.tick++;
        this.endSettled = true;
      }
      return;
    }
    this.tick++;
    this.stepping = true;
    try {
      this.stepInner();
    } finally {
      this.stepping = false;
    }
  }

  private stepInner(): void {
    if (this.clearTimer > 0) {
      this.clearTimer--;
      this.chargeDas();
      if (this.clearTimer === 0) this.finishClear();
      return;
    }
    const p = this.piece;
    if (!p) {
      this.spawn();
      return;
    }
    this.autoShift();
    // Gravity / soft drop.
    const g = GRAVITY[Math.min(MAX_LEVEL, this.level) - 1]!;
    let fall = false;
    if (this.softHeld) {
      if (--this.softCount <= 0) {
        this.softCount = Math.min(SOFT_EVERY, g);
        fall = true;
        if (this.fits(p.id, p.rot, p.x, p.y + 1)) this.score += 1;
      }
    }
    if (++this.gravityCount >= g) {
      this.gravityCount = 0;
      fall = true;
    }
    if (fall && this.fits(p.id, p.rot, p.x, p.y + 1)) {
      p.y++;
      this.lastRotate = false;
      if (p.y > this.lowestY) {
        this.lowestY = p.y;
        this.lockResets = 0;
      }
    }
    // Lock delay.
    if (!this.fits(p.id, p.rot, p.x, p.y + 1)) {
      this.lockTimer++;
      if (this.lockTimer >= LOCK_DELAY || this.lockResets >= MAX_LOCK_RESETS) this.lock();
    } else {
      this.lockTimer = 0;
    }
  }

  summary(): RunSummary {
    return { score: this.score, level: this.level, lives: this.ended ? 0 : 1, stat: this.lines };
  }

  // ---------------------------------------------------------------------------
  // Queries (rendering)
  // ---------------------------------------------------------------------------

  cell(x: number, y: number): number {
    if (x < 0 || x >= COLS || y >= ROWS) return 8;
    if (y < 0) return 0;
    return this.board[y * COLS + x]!;
  }

  cellsOf(id: PieceId, rot: number, x: number, y: number): Array<[number, number]> {
    return SHAPES[id][rot & 3].map(([cx, cy]) => [x + cx, y + cy] as [number, number]);
  }

  fits(id: PieceId, rot: number, x: number, y: number): boolean {
    for (const [cx, cy] of SHAPES[id][rot & 3] as Cells) {
      const gx = x + cx;
      const gy = y + cy;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return false;
      if (gy >= 0 && this.board[gy * COLS + gx] !== 0) return false;
    }
    return true;
  }

  /** Row the active piece would land on (hard-drop target). */
  ghostY(): number {
    const p = this.piece;
    if (!p) return 0;
    let y = p.y;
    while (this.fits(p.id, p.rot, p.x, y + 1)) y++;
    return y;
  }

  gravityTicks(): number {
    return GRAVITY[Math.min(MAX_LEVEL, this.level) - 1]!;
  }

  drainEvents(): BlocksEvent[] {
    return this.events.splice(0);
  }

  /** Compact visible-board string (20 rows × 10, '0'–'7'), active piece included. */
  preview(): string {
    const out: string[] = [];
    const active = new Map<number, number>();
    if (this.piece) {
      const v = PIECE_CELL[this.piece.id];
      for (const [x, y] of this.cellsOf(this.piece.id, this.piece.rot, this.piece.x, this.piece.y)) active.set(y * COLS + x, v);
    }
    for (let y = HIDDEN; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        out.push(String(active.get(i) ?? this.board[i]!));
      }
    }
    return out.join('');
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private emit(e: BlocksEvent): void {
    if (!this.recordEvents) return;
    if (this.events.length >= 96) this.events.shift();
    this.events.push(e);
  }

  private nextFromBag(): PieceId {
    if (this.bag.length === 0) {
      const bag = [...PIECES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = this.bagRng.int(i + 1);
        const t = bag[i]!;
        bag[i] = bag[j]!;
        bag[j] = t;
      }
      this.bag = bag;
    }
    return this.bag.shift()!;
  }

  private spawnXY(id: PieceId): { x: number; y: number } {
    const n = boxSize(id);
    return { x: n === 2 ? 4 : 3, y: id === 'I' ? 0 : 1 };
  }

  private spawn(id?: PieceId): void {
    const next = id ?? this.queue.shift()!;
    if (!id) this.queue.push(this.nextFromBag());
    const { x, y } = this.spawnXY(next);
    this.piece = { id: next, rot: 0, x, y };
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = y;
    this.gravityCount = 0;
    this.lastRotate = false;
    if (!this.fits(next, 0, x, y)) {
      this.gameOver('blockout');
      return;
    }
    this.emit({ t: 'spawn', piece: next });
    // Pieces enter already falling: drop one row right away when there is room (visible sooner).
    if (this.fits(next, 0, x, y + 1)) {
      this.piece.y++;
      this.lowestY = this.piece.y;
    }
    // A held direction (DAS charged during the clear/entry) applies immediately.
    if (this.dir !== 0 && this.dasCount >= DAS) this.shift(this.dir);
  }

  private startShift(d: -1 | 1): void {
    this.dir = d;
    this.dasCount = 0;
    this.arrCount = 0;
    if (this.piece && this.clearTimer === 0) this.shift(d);
  }

  private resumeShift(): void {
    const other: -1 | 0 | 1 = this.leftHeld ? -1 : this.rightHeld ? 1 : 0;
    this.dir = other;
    this.dasCount = 0;
    this.arrCount = 0;
  }

  private chargeDas(): void {
    if (this.dir !== 0 && this.dasCount < DAS) this.dasCount++;
  }

  private autoShift(): void {
    if (this.dir === 0) return;
    if (this.dasCount < DAS) {
      this.dasCount++;
      if (this.dasCount < DAS) return;
      this.arrCount = 0;
      this.shift(this.dir);
      return;
    }
    if (++this.arrCount >= ARR) {
      this.arrCount = 0;
      this.shift(this.dir);
    }
  }

  private shift(d: -1 | 1): boolean {
    const p = this.piece;
    if (!p || !this.fits(p.id, p.rot, p.x + d, p.y)) return false;
    p.x += d;
    this.lastRotate = false;
    this.afterManipulation();
    this.emit({ t: 'move' });
    return true;
  }

  private afterManipulation(): void {
    if (this.lockTimer > 0 || !this.piece || !this.fits(this.piece.id, this.piece.rot, this.piece.x, this.piece.y + 1)) {
      if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockTimer = 0;
        this.lockResets++;
      }
    }
  }

  private rotate(dir: 1 | -1): void {
    const p = this.piece;
    if (!p || this.clearTimer > 0 || p.id === 'O') return;
    const to = (p.rot + (dir === 1 ? 1 : 3)) & 3;
    const kicks = kicksFor(p.id, p.rot, to);
    for (let k = 0; k < kicks.length; k++) {
      const [dx, dy] = kicks[k]!;
      if (this.fits(p.id, to, p.x + dx, p.y + dy)) {
        p.x += dx;
        p.y += dy;
        p.rot = to;
        this.lastRotate = true;
        this.afterManipulation();
        this.emit({ t: 'rotate', kick: k });
        return;
      }
    }
  }

  private doHold(): void {
    const p = this.piece;
    if (!p || this.holdUsed || this.clearTimer > 0) return;
    const current = p.id;
    this.holdUsed = true;
    this.emit({ t: 'hold' });
    if (this.hold) {
      const swap = this.hold;
      this.hold = current;
      this.spawn(swap);
    } else {
      this.hold = current;
      this.spawn();
    }
  }

  private hardDrop(): void {
    const p = this.piece;
    if (!p || this.clearTimer > 0) return;
    const target = this.ghostY();
    const rows = target - p.y;
    if (rows > 0) {
      p.y = target;
      this.lastRotate = false;
    }
    this.score += rows * 2;
    this.emit({ t: 'harddrop', rows, cells: this.cellsOf(p.id, p.rot, p.x, p.y), piece: p.id });
    this.lock();
  }

  /** 3-corner T-spin check for the active T piece at its current position. */
  private isTSpin(p: ActivePiece): boolean {
    if (p.id !== 'T' || !this.lastRotate) return false;
    const corners: Array<[number, number]> = [
      [p.x, p.y],
      [p.x + 2, p.y],
      [p.x, p.y + 2],
      [p.x + 2, p.y + 2],
    ];
    let filled = 0;
    for (const [x, y] of corners) if (this.cell(x, y) !== 0) filled++;
    return filled >= 3;
  }

  private lock(): void {
    const p = this.piece;
    if (!p) return;
    const cells = this.cellsOf(p.id, p.rot, p.x, p.y);
    const tspin = this.isTSpin(p);
    const v = PIECE_CELL[p.id];
    let allHidden = true;
    for (const [x, y] of cells) {
      if (y >= 0) this.board[y * COLS + x] = v;
      if (y >= HIDDEN) allHidden = false;
    }
    this.piece = null;
    this.pieces++;
    this.holdUsed = false;
    this.emit({ t: 'lock', cells, piece: p.id });
    if (allHidden) {
      this.gameOver('lockout');
      return;
    }
    const full: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      let n = 0;
      for (let x = 0; x < COLS; x++) if (this.board[y * COLS + x] !== 0) n++;
      if (n === COLS) full.push(y);
    }
    const lines = full.length;
    const lvl = this.level;
    if (lines === 0) {
      this.combo = -1;
      if (tspin) {
        const pts = TSPIN_SCORES[0] * lvl;
        this.score += pts;
        this.tspins++;
        this.emit({ t: 'tspin', points: pts });
      }
      this.spawn();
      return;
    }
    const hard = lines === 4 || tspin;
    const b2b = hard && this.b2b;
    let points = (tspin ? TSPIN_SCORES[Math.min(3, lines)]! : LINE_SCORES[lines]!) * lvl;
    if (b2b) points = Math.floor((points * 3) / 2);
    this.b2b = hard;
    this.combo++;
    if (this.combo > 0) points += COMBO_SCORE * this.combo * lvl;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    // All clear: nothing left outside the rows being cleared.
    let remaining = 0;
    for (let y = 0; y < ROWS; y++) {
      if (full.includes(y)) continue;
      for (let x = 0; x < COLS; x++) if (this.board[y * COLS + x] !== 0) remaining++;
    }
    const allClear = remaining === 0;
    if (allClear) points += ALL_CLEAR_SCORE * lvl;
    if (tspin) this.tspins++;
    if (lines === 4) this.quads++;
    this.score += points;
    this.clearing = full;
    this.clearTimer = CLEAR_DELAY;
    this.emit({ t: 'clear', rows: full, lines, tspin, b2b, combo: Math.max(0, this.combo), allClear, points });
  }

  private finishClear(): void {
    const rows = this.clearing;
    this.clearing = [];
    const keep: number[] = [];
    for (let y = 0; y < ROWS; y++) if (!rows.includes(y)) keep.push(y);
    const next = new Uint8Array(COLS * ROWS);
    let dst = ROWS - 1;
    for (let i = keep.length - 1; i >= 0; i--, dst--) {
      const y = keep[i]!;
      next.set(this.board.subarray(y * COLS, y * COLS + COLS), dst * COLS);
    }
    this.board.set(next);
    const before = this.level;
    this.lines += rows.length;
    this.level = Math.min(99, this.startLevel + Math.floor(this.lines / 10));
    if (this.level > before) this.emit({ t: 'level', level: this.level });
    this.spawn();
  }

  private gameOver(reason: 'blockout' | 'lockout'): void {
    this.ended = reason;
    this.endSettled = this.stepping;
    this.piece = null;
    this.emit({ t: 'over', reason });
  }
}

export function createBlocksSim(seed: string, options: Record<string, number | string | boolean> = {}, recordEvents = true): BlocksSim {
  const startLevel = typeof options.startLevel === 'number' ? options.startLevel : 1;
  return new BlocksSim(seed, { startLevel }, recordEvents);
}

export { CELL_PIECE, PIECES, PIECE_CELL, SHAPES, boxSize, kicksFor };
export type { PieceId };
