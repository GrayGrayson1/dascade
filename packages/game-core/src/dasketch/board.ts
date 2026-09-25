/**
 * SketchBoard — the authoritative drawing operation log for one turn.
 *
 * The server applies every artist event here (validation + bounds), relays accepted
 * events, and snapshots the log for late joiners. Clients run the exact same code to
 * replay events, so every screen reconstructs an identical op list.
 *
 * Undo pops the last op (a `clear` is an op too, so undoing a clear restores the drawing).
 */
import {
  SKETCH_CANVAS,
  SKETCH_LIMITS,
  SKETCH_MARGIN,
  SKETCH_PAPER,
  type SketchBoardSnapshot,
  type SketchEvent,
  type SketchOp,
} from '@dascade/shared/games/dasketch';

export type BoardRejectReason =
  | 'bad_points'
  | 'out_of_bounds'
  | 'bad_size'
  | 'bad_color'
  | 'no_open_stroke'
  | 'stroke_too_long'
  | 'too_many_ops'
  | 'too_many_points'
  | 'too_many_fills'
  | 'nothing_to_undo'
  | 'already_clear';

export type ApplyResult = { ok: true } | { ok: false; reason: BoardRejectReason };

const OK: ApplyResult = { ok: true };
const fail = (reason: BoardRejectReason): ApplyResult => ({ ok: false, reason });
const HEX = /^#[0-9a-f]{6}$/u;

function inRange(v: number, max: number, margin: number): boolean {
  return Number.isInteger(v) && v >= -margin && v <= max + margin;
}

/** Checks x,y pairs against the canvas (plus margin). */
export function pointsInBounds(pts: readonly number[], margin = SKETCH_MARGIN): boolean {
  if (pts.length === 0 || pts.length % 2 !== 0) return false;
  for (let i = 0; i < pts.length; i += 2) {
    if (!inRange(pts[i] as number, SKETCH_CANVAS.width, margin) || !inRange(pts[i + 1] as number, SKETCH_CANVAS.height, margin)) return false;
  }
  return true;
}

export class SketchBoard {
  ops: SketchOp[] = [];
  open = false;
  created = 0;
  points = 0;
  fills = 0;
  nextId = 1;

  static fromSnapshot(s: SketchBoardSnapshot): SketchBoard {
    const b = new SketchBoard();
    b.ops = s.ops.map((op) => ({ ...op, points: [...op.points] }));
    const last = b.lastOp();
    b.open = Boolean(s.open) && last !== undefined && isFreehand(last.tool);
    b.created = s.created;
    b.points = s.points;
    b.fills = Number.isInteger(s.fills) ? s.fills : 0;
    b.nextId = Math.max(s.nextId, ...b.ops.map((o) => o.id + 1), 1);
    return b;
  }

  snapshot(): SketchBoardSnapshot {
    return {
      ops: this.ops.map((op) => ({ ...op, points: [...op.points] })),
      open: this.open,
      created: this.created,
      points: this.points,
      fills: this.fills,
      nextId: this.nextId,
    };
  }

  lastOp(): SketchOp | undefined {
    return this.ops[this.ops.length - 1];
  }

  /** Index of the first op that is drawn after the most recent clear. */
  visibleStart(): number {
    for (let i = this.ops.length - 1; i >= 0; i--) if (this.ops[i]!.tool === 'clear') return i + 1;
    return 0;
  }

  /** True when nothing is visible (empty, or the last op is a clear). */
  isBlank(): boolean {
    return this.visibleStart() >= this.ops.length;
  }

  /** Validates and applies one event. On failure nothing changes. */
  apply(ev: SketchEvent): ApplyResult {
    switch (ev.k) {
      case 'stroke': {
        const check = this.checkNew(ev.color, ev.size, ev.pts, SKETCH_MARGIN);
        if (!check.ok) return check;
        const n = ev.pts.length / 2;
        if (n > SKETCH_LIMITS.pointsPerStroke) return fail('stroke_too_long');
        if (this.points + n > SKETCH_LIMITS.pointsPerTurn) return fail('too_many_points');
        this.push({ tool: ev.tool, color: ev.tool === 'eraser' ? SKETCH_PAPER : ev.color.toLowerCase(), size: ev.size, points: [...ev.pts] });
        this.points += n;
        this.open = true;
        return OK;
      }
      case 'pts': {
        const last = this.lastOp();
        if (!this.open || !last || !isFreehand(last.tool)) return fail('no_open_stroke');
        if (!pointsInBounds(ev.pts)) return fail('out_of_bounds');
        const n = ev.pts.length / 2;
        if (last.points.length / 2 + n > SKETCH_LIMITS.pointsPerStroke) return fail('stroke_too_long');
        if (this.points + n > SKETCH_LIMITS.pointsPerTurn) return fail('too_many_points');
        for (const v of ev.pts) last.points.push(v);
        this.points += n;
        return OK;
      }
      case 'shape': {
        if (ev.pts.length !== 4) return fail('bad_points');
        const check = this.checkNew(ev.color, ev.size, ev.pts, SKETCH_MARGIN);
        if (!check.ok) return check;
        this.push({ tool: ev.tool, color: ev.color.toLowerCase(), size: ev.size, points: [...ev.pts] });
        this.open = false;
        return OK;
      }
      case 'fill': {
        if (ev.pts.length !== 2) return fail('bad_points');
        const [x, y] = ev.pts as [number, number];
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SKETCH_CANVAS.width || y >= SKETCH_CANVAS.height) {
          return fail('out_of_bounds');
        }
        if (!HEX.test(ev.color.toLowerCase())) return fail('bad_color');
        if (this.created >= SKETCH_LIMITS.opsPerTurn) return fail('too_many_ops');
        if (this.fills >= SKETCH_LIMITS.fillsPerTurn) return fail('too_many_fills');
        this.push({ tool: 'fill', color: ev.color.toLowerCase(), size: 0, points: [x, y] });
        this.fills++;
        this.open = false;
        return OK;
      }
      case 'undo': {
        if (this.ops.length === 0) return fail('nothing_to_undo');
        if (this.created >= SKETCH_LIMITS.opsPerTurn) return fail('too_many_ops');
        this.ops.pop();
        this.created++;
        this.open = false;
        return OK;
      }
      case 'clear': {
        if (this.isBlank()) return fail('already_clear');
        if (this.created >= SKETCH_LIMITS.opsPerTurn) return fail('too_many_ops');
        this.push({ tool: 'clear', color: SKETCH_PAPER, size: 0, points: [] });
        this.open = false;
        return OK;
      }
    }
  }

  /** Applies events in order and stops at the first rejection. Returns how many were applied. */
  applyAll(events: readonly SketchEvent[]): { applied: number; error?: BoardRejectReason } {
    for (let i = 0; i < events.length; i++) {
      const r = this.apply(events[i]!);
      if (!r.ok) return { applied: i, error: r.reason };
    }
    return { applied: events.length };
  }

  private checkNew(color: string, size: number, pts: readonly number[], margin: number): ApplyResult {
    if (pts.length === 0 || pts.length % 2 !== 0) return fail('bad_points');
    if (!pointsInBounds(pts, margin)) return fail('out_of_bounds');
    if (!Number.isInteger(size) || size < SKETCH_LIMITS.minSize || size > SKETCH_LIMITS.maxSize) return fail('bad_size');
    if (!HEX.test(color.toLowerCase())) return fail('bad_color');
    if (this.created >= SKETCH_LIMITS.opsPerTurn) return fail('too_many_ops');
    return OK;
  }

  private push(op: Omit<SketchOp, 'id'>): void {
    this.ops.push({ id: this.nextId++, ...op });
    this.created++;
  }
}

export function isFreehand(tool: SketchOp['tool']): boolean {
  return tool === 'brush' || tool === 'eraser';
}
