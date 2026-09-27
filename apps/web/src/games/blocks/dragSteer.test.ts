import { describe, expect, it } from 'vitest';
import { createBlocksSim } from '@dascade/game-core/blocks';
import { idleDrag, steerCodes } from './dragSteer.ts';

/** One engine tick with the steering codes (what BlocksPlay does each fixed step). */
function tick(sim: ReturnType<typeof createBlocksSim>, drag: ReturnType<typeof idleDrag>): void {
  for (const code of steerCodes(drag, sim)) sim.input(code);
  sim.step();
}

describe('Block Drop touch drag steering', () => {
  it('a fast swipe reaches the target column: one column per tick, none lost', () => {
    const sim = createBlocksSim('drag-seed', {}, false);
    const drag = { ...idleDrag(), active: true };
    const start = sim.piece!.x;
    // The finger jumps 3 columns right within one frame (the old per-cell taps collapsed into one).
    drag.want = 3;
    for (let i = 0; i < 3; i++) tick(sim, drag);
    expect(sim.piece!.x).toBe(start + 3);
    // Holding still: no further moves.
    tick(sim, drag);
    expect(sim.piece!.x).toBe(start + 3);
    // Back left past the start.
    drag.want = -1;
    for (let i = 0; i < 4; i++) tick(sim, drag);
    expect(sim.piece!.x).toBe(start - 1);
  });

  it('stops pushing against a wall until the target changes', () => {
    const sim = createBlocksSim('drag-wall', {}, false);
    const drag = { ...idleDrag(), active: true };
    drag.want = 20;
    const codes: number[][] = [];
    for (let i = 0; i < 20; i++) {
      codes.push(steerCodes(drag, sim));
      for (const c of codes[codes.length - 1]!) sim.input(c);
      sim.step();
    }
    const pushes = codes.filter((c) => c.length > 0).length;
    expect(pushes).toBeLessThan(12); // reached the wall, then one failed push and silence
    expect(codes.slice(-3).every((c) => c.length === 0)).toBe(true);
  });

  it('the first piece follows the whole gesture; a piece spawned mid-drag only further travel', () => {
    type Sim = Parameters<typeof steerCodes>[1];
    const drag = { ...idleDrag(), active: true, want: 2 };
    const first = { piece: { x: 3 } } as unknown as Sim;
    expect(steerCodes(drag, first)).toHaveLength(2); // finger already 2 columns right before the first tick
    const next = { piece: { x: 4 } } as unknown as Sim;
    expect(steerCodes(drag, next)).toEqual([]); // new piece at want 2: target = its own column
    drag.want = 3;
    expect(steerCodes(drag, next)).toHaveLength(2);
    expect(steerCodes(idleDrag(), first)).toEqual([]);
  });
});
