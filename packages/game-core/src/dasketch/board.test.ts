import { describe, expect, it } from 'vitest';
import { SKETCH_CANVAS, SKETCH_LIMITS, SKETCH_MARGIN, SKETCH_PAPER, SketchDrawSchema, type SketchEvent } from '@dascade/shared/games/dasketch';
import { SketchBoard, pointsInBounds } from './board.ts';

const stroke = (pts: number[], extra: Partial<Extract<SketchEvent, { k: 'stroke' }>> = {}): SketchEvent => ({
  k: 'stroke',
  tool: 'brush',
  color: '#FF4FD8',
  size: 9,
  pts,
  ...extra,
});

describe('SketchBoard: applying events', () => {
  it('opens a stroke, appends points, and closes it on the next op', () => {
    const b = new SketchBoard();
    expect(b.apply(stroke([10, 10, 20, 20]))).toEqual({ ok: true });
    expect(b.open).toBe(true);
    expect(b.apply({ k: 'pts', pts: [30, 30, 40, 45] })).toEqual({ ok: true });
    expect(b.ops).toHaveLength(1);
    expect(b.ops[0]).toMatchObject({ id: 1, tool: 'brush', color: '#ff4fd8', size: 9, points: [10, 10, 20, 20, 30, 30, 40, 45] });
    expect(b.points).toBe(4);
    b.apply({ k: 'shape', tool: 'rect', color: '#000000', size: 4, pts: [0, 0, 100, 100] });
    expect(b.open).toBe(false);
    expect(b.apply({ k: 'pts', pts: [1, 1] })).toEqual({ ok: false, reason: 'no_open_stroke' });
  });

  it('paints the eraser with the paper colour', () => {
    const b = new SketchBoard();
    b.apply(stroke([5, 5], { tool: 'eraser', color: '#123456' }));
    expect(b.ops[0]!.color).toBe(SKETCH_PAPER);
  });

  it('records shapes and fills as complete ops', () => {
    const b = new SketchBoard();
    b.apply({ k: 'shape', tool: 'ellipse', color: '#22d3ee', size: 16, pts: [100, 100, 300, 200] });
    b.apply({ k: 'fill', color: '#ffd23f', pts: [150, 150] });
    expect(b.ops.map((o) => o.tool)).toEqual(['ellipse', 'fill']);
    expect(b.ops[1]).toMatchObject({ size: 0, points: [150, 150] });
    expect(b.created).toBe(2);
  });

  it('undo pops the last op; undoing a clear restores the drawing', () => {
    const b = new SketchBoard();
    b.apply(stroke([1, 1, 2, 2]));
    b.apply({ k: 'clear' });
    expect(b.isBlank()).toBe(true);
    expect(b.visibleStart()).toBe(2);
    b.apply({ k: 'undo' });
    expect(b.isBlank()).toBe(false);
    expect(b.ops.map((o) => o.tool)).toEqual(['brush']);
    b.apply({ k: 'undo' });
    expect(b.ops).toHaveLength(0);
    expect(b.apply({ k: 'undo' })).toEqual({ ok: false, reason: 'nothing_to_undo' });
  });

  it('refuses redundant clears', () => {
    const b = new SketchBoard();
    expect(b.apply({ k: 'clear' })).toEqual({ ok: false, reason: 'already_clear' });
    b.apply(stroke([1, 1]));
    expect(b.apply({ k: 'clear' }).ok).toBe(true);
    expect(b.apply({ k: 'clear' })).toEqual({ ok: false, reason: 'already_clear' });
  });

  it('undo closes an open stroke so late points are rejected', () => {
    const b = new SketchBoard();
    b.apply(stroke([1, 1]));
    b.apply({ k: 'undo' });
    expect(b.apply({ k: 'pts', pts: [2, 2] })).toEqual({ ok: false, reason: 'no_open_stroke' });
  });
});

describe('SketchBoard: validation and bounds', () => {
  it('checks coordinates against the canvas plus margin', () => {
    const { width: W, height: H } = SKETCH_CANVAS;
    expect(pointsInBounds([0, 0, W, H])).toBe(true);
    expect(pointsInBounds([-SKETCH_MARGIN, -SKETCH_MARGIN, W + SKETCH_MARGIN, H + SKETCH_MARGIN])).toBe(true);
    expect(pointsInBounds([W + SKETCH_MARGIN + 1, 0])).toBe(false);
    expect(pointsInBounds([0, H + SKETCH_MARGIN + 1])).toBe(false);
    expect(pointsInBounds([1.5, 2])).toBe(false);
    expect(pointsInBounds([1])).toBe(false);
    expect(pointsInBounds([])).toBe(false);
    const b = new SketchBoard();
    expect(b.apply(stroke([0, H + 500]))).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(b.apply({ k: 'fill', color: '#000000', pts: [-1, 5] })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(b.apply({ k: 'fill', color: '#000000', pts: [W, 5] })).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(b.ops).toHaveLength(0);
  });

  it('rejects bad sizes, colours and malformed points', () => {
    const b = new SketchBoard();
    expect(b.apply(stroke([1, 1], { size: 0 }))).toEqual({ ok: false, reason: 'bad_size' });
    expect(b.apply(stroke([1, 1], { size: 999 }))).toEqual({ ok: false, reason: 'bad_size' });
    expect(b.apply(stroke([1, 1], { color: 'red' }))).toEqual({ ok: false, reason: 'bad_color' });
    expect(b.apply(stroke([1, 1, 2]))).toEqual({ ok: false, reason: 'bad_points' });
    expect(b.apply({ k: 'shape', tool: 'line', color: '#000000', size: 4, pts: [1, 2, 3] })).toEqual({ ok: false, reason: 'bad_points' });
    expect(b.created).toBe(0);
  });

  it('caps points per stroke', () => {
    const b = new SketchBoard();
    const chunk = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? i % 1200 : i % 900));
    b.apply(stroke(chunk));
    let result = b.apply({ k: 'pts', pts: chunk });
    while (result.ok) result = b.apply({ k: 'pts', pts: chunk });
    expect(result).toEqual({ ok: false, reason: 'stroke_too_long' });
    expect(b.ops[0]!.points.length / 2).toBeLessThanOrEqual(SKETCH_LIMITS.pointsPerStroke);
  });

  it('caps points per turn', () => {
    const b = new SketchBoard();
    b.points = SKETCH_LIMITS.pointsPerTurn - 1;
    expect(b.apply(stroke([1, 1]))).toEqual({ ok: true });
    expect(b.apply({ k: 'pts', pts: [2, 2] })).toEqual({ ok: false, reason: 'too_many_points' });
    expect(b.apply(stroke([3, 3]))).toEqual({ ok: false, reason: 'too_many_points' });
  });

  it('caps ops per turn, counting undo and clear too', () => {
    const b = new SketchBoard();
    b.created = SKETCH_LIMITS.opsPerTurn - 1;
    expect(b.apply(stroke([1, 1])).ok).toBe(true);
    expect(b.apply({ k: 'undo' })).toEqual({ ok: false, reason: 'too_many_ops' });
    expect(b.apply({ k: 'clear' })).toEqual({ ok: false, reason: 'too_many_ops' });
    expect(b.apply({ k: 'fill', color: '#000000', pts: [1, 1] })).toEqual({ ok: false, reason: 'too_many_ops' });
    expect(b.apply({ k: 'shape', tool: 'line', color: '#000000', size: 2, pts: [1, 1, 5, 5] })).toEqual({ ok: false, reason: 'too_many_ops' });
  });

  it('applyAll stops at the first invalid event and reports how many were applied', () => {
    const b = new SketchBoard();
    const r = b.applyAll([stroke([1, 1]), { k: 'pts', pts: [2, 2] }, { k: 'fill', color: '#000000', pts: [5000, 1] }, { k: 'undo' }]);
    expect(r).toEqual({ applied: 2, error: 'out_of_bounds' });
    expect(b.ops).toHaveLength(1);
  });
});

describe('SketchBoard: snapshots and determinism', () => {
  const script: SketchEvent[] = [
    stroke([10, 10, 20, 30]),
    { k: 'pts', pts: [40, 50, 60, 70] },
    { k: 'shape', tool: 'line', color: '#000000', size: 4, pts: [0, 0, 1200, 900] },
    { k: 'fill', color: '#2de38f', pts: [600, 100] },
    { k: 'clear' },
    stroke([100, 100], { tool: 'eraser' }),
    { k: 'undo' },
    { k: 'undo' },
    stroke([500, 500, 505, 505]),
  ];

  it('two boards replaying the same events end identical', () => {
    const a = new SketchBoard();
    const b = new SketchBoard();
    for (const ev of script) {
      a.apply(ev);
      b.apply(ev);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('round-trips through a snapshot (late join / reconnect) and keeps validating identically', () => {
    const a = new SketchBoard();
    a.applyAll(script);
    const copy = SketchBoard.fromSnapshot(JSON.parse(JSON.stringify(a.snapshot())));
    expect(copy.snapshot()).toEqual(a.snapshot());
    expect(copy.open).toBe(true);
    const next: SketchEvent = { k: 'pts', pts: [510, 512] };
    expect(copy.apply(next)).toEqual(a.apply(next));
    expect(copy.snapshot()).toEqual(a.snapshot());
  });

  it('snapshots are deep copies', () => {
    const a = new SketchBoard();
    a.apply(stroke([1, 1]));
    const snap = a.snapshot();
    snap.ops[0]!.points.push(99, 99);
    expect(a.ops[0]!.points).toEqual([1, 1]);
  });

  it('caps flood fills per turn (each one costs every viewer a full-canvas readback), even across undo', () => {
    const b = new SketchBoard();
    for (let i = 0; i < SKETCH_LIMITS.fillsPerTurn; i++) {
      expect(b.apply({ k: 'fill', color: i % 2 ? '#000000' : '#ffffff', pts: [10, 10] })).toEqual({ ok: true });
      if (i % 2) expect(b.apply({ k: 'undo' })).toEqual({ ok: true });
    }
    expect(b.fills).toBe(SKETCH_LIMITS.fillsPerTurn);
    expect(b.apply({ k: 'fill', color: '#22d3ee', pts: [10, 10] })).toEqual({ ok: false, reason: 'too_many_fills' });
    // Other tools keep working, and a snapshot (reconnecting artist) keeps the same budget.
    expect(b.apply(stroke([1, 1]))).toEqual({ ok: true });
    const copy = SketchBoard.fromSnapshot(JSON.parse(JSON.stringify(b.snapshot())));
    expect(copy.fills).toBe(SKETCH_LIMITS.fillsPerTurn);
    expect(copy.apply({ k: 'fill', color: '#22d3ee', pts: [10, 10] })).toEqual({ ok: false, reason: 'too_many_fills' });
  });

  it('never trusts an open flag for a non-freehand op', () => {
    const b = SketchBoard.fromSnapshot({ ops: [{ id: 4, tool: 'fill', color: '#000000', size: 0, points: [1, 1] }], open: true, created: 1, points: 0, fills: 1, nextId: 2 });
    expect(b.open).toBe(false);
    expect(b.nextId).toBe(5);
  });
});

describe('SketchDrawSchema (wire validation)', () => {
  it('accepts well-formed batches', () => {
    expect(SketchDrawSchema.safeParse({ turn: 3, events: script() }).success).toBe(true);
  });

  it('rejects malformed payloads', () => {
    const bad = [
      { turn: 1, events: [] },
      { turn: 1, events: [{ k: 'stroke', tool: 'brush', color: '#fff', size: 4, pts: [1, 1] }] },
      { turn: 1, events: [{ k: 'stroke', tool: 'spray', color: '#ffffff', size: 4, pts: [1, 1] }] },
      { turn: 1, events: [{ k: 'pts', pts: [1, 2, 3] }] },
      { turn: 1, events: [{ k: 'pts', pts: [1.5, 2] }] },
      { turn: 1, events: [{ k: 'pts', pts: Array.from({ length: SKETCH_LIMITS.pointsPerMessage * 2 + 2 }, () => 1) }] },
      { turn: 1, events: Array.from({ length: SKETCH_LIMITS.eventsPerMessage + 1 }, () => ({ k: 'undo' })) },
      { turn: 1, events: [{ k: 'fill', color: '#000000', pts: [1, 2, 3, 4] }] },
      { turn: 1, events: [{ k: 'nuke' }] },
      { turn: -1, events: [{ k: 'undo' }] },
      { events: [{ k: 'undo' }] },
    ];
    for (const payload of bad) expect(SketchDrawSchema.safeParse(payload).success, JSON.stringify(payload).slice(0, 80)).toBe(false);
  });

  it('caps the total points in one message (not just per event)', () => {
    const half = Array.from({ length: SKETCH_LIMITS.pointsPerMessage }, (_, i) => i % 900);
    const ok = { turn: 1, events: [stroke(half), { k: 'pts', pts: half }] };
    expect(SketchDrawSchema.safeParse(ok).success).toBe(true);
    const full = Array.from({ length: SKETCH_LIMITS.pointsPerMessage * 2 }, (_, i) => i % 900);
    const tooMany = { turn: 1, events: Array.from({ length: SKETCH_LIMITS.eventsPerMessage }, () => ({ k: 'pts', pts: full })) };
    expect(SketchDrawSchema.safeParse(tooMany).success).toBe(false);
    expect(SketchDrawSchema.safeParse({ turn: 1, events: [stroke(full), { k: 'pts', pts: [1, 1] }] }).success).toBe(false);
  });

  function script(): SketchEvent[] {
    return [stroke([1, 1, 2, 2]), { k: 'pts', pts: [3, 3] }, { k: 'fill', color: '#000000', pts: [5, 5] }, { k: 'undo' }, { k: 'clear' }];
  }
});
