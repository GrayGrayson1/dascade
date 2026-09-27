import { describe, expect, it } from 'vitest';
import { IDLE_OPEN, RIG, TOY_SPOTS, WIN_ODDS, clawOutcome, clawPose, planClaw, type ClawOutcome, type ClawPlan } from './claw.ts';

/** A repeatable stream of [0, 1) numbers. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const ALL = TOY_SPOTS.map((_, i) => i);

function planFor(outcome: ClawOutcome, present: readonly number[] = ALL, seed = 1): ClawPlan {
  for (let k = 0; k < 500; k++) {
    const plan = planClaw(present, outcome === 'win' ? 3 : 0, lcg(seed + k * 7919));
    if (plan && plan.outcome === outcome) return plan;
  }
  throw new Error(`no ${outcome} plan`);
}

describe('clawOutcome', () => {
  it('pays out at the listed odds and always on the fourth try in a row', () => {
    for (let s = 0; s < WIN_ODDS.length; s++) {
      expect(clawOutcome(s, WIN_ODDS[s]! - 0.001, 0)).toBe('win');
      expect(clawOutcome(s, WIN_ODDS[s]!, 0)).not.toBe('win');
    }
    for (const r of [0, 0.5, 0.999]) expect(clawOutcome(WIN_ODDS.length, 0.9999, r)).toBe('win');
    expect(clawOutcome(99, 0.9999, 0.9999)).toBe('win');
  });
  it('loses as a slip or a clean miss', () => {
    expect(clawOutcome(0, 0.99, 0.1)).toBe('slip');
    expect(clawOutcome(0, 0.99, 0.9)).toBe('miss');
  });
  it('treats odd streak values sanely', () => {
    expect(clawOutcome(-3, 0.3, 0)).toBe('win');
    expect(clawOutcome(1.7, WIN_ODDS[1] - 0.01, 0)).toBe('win');
  });
  it('gets more generous with every loss', () => {
    for (let s = 1; s < WIN_ODDS.length; s++) expect(WIN_ODDS[s]!).toBeGreaterThan(WIN_ODDS[s - 1]!);
  });
});

describe('planClaw', () => {
  it('has nothing to do with an empty (or bogus) pile', () => {
    expect(planClaw([], 0, Math.random)).toBeNull();
    expect(planClaw([-1, 99, 2.5], 0, Math.random)).toBeNull();
  });
  it('goes for a toy that is there and drops right onto it', () => {
    for (let seed = 1; seed < 300; seed++) {
      const present = ALL.filter((i) => (i * 7 + seed) % 3 !== 0);
      const plan = planClaw(present, seed % 4, lcg(seed))!;
      expect(present).toContain(plan.toy);
      const spot = TOY_SPOTS[plan.toy]!;
      expect(plan.depth).toBe(spot.y - RIG.hold - RIG.hubY);
      expect(plan.aimX).toBeGreaterThanOrEqual(RIG.minX);
      expect(plan.aimX).toBeLessThanOrEqual(RIG.maxX);
      if (plan.outcome === 'miss') expect(Math.abs(plan.aimX - spot.x)).toBeGreaterThanOrEqual(5);
      else expect(Math.abs(plan.aimX - spot.x)).toBeLessThanOrEqual(1);
      expect(plan.total).toBeCloseTo(plan.move + plan.drop + plan.grab + plan.lift + plan.carry + plan.release + plan.back, 9);
      expect(plan.total).toBeGreaterThan(2.5);
      expect(plan.total).toBeLessThan(9);
      expect(plan.slipAt).toBeGreaterThanOrEqual(0.35);
      expect(plan.slipAt).toBeLessThan(0.65);
    }
  });
  it('only carries a toy to the chute when it wins', () => {
    expect(planFor('win').carry).toBeGreaterThan(0);
    expect(planFor('win').prizeAt).toBeGreaterThan(0);
    for (const o of ['slip', 'miss'] as const) {
      const plan = planFor(o);
      expect(plan.carry).toBe(0);
      expect(plan.release).toBe(0);
      expect(plan.prizeAt).toBe(-1);
    }
  });
  it('can still reach the last toy in either corner', () => {
    for (const spot of [0, 5]) {
      for (let seed = 1; seed < 60; seed++) {
        const plan = planClaw([spot], 0, lcg(seed))!;
        expect(plan.toy).toBe(spot);
        if (plan.outcome === 'miss') expect(Math.abs(plan.aimX - TOY_SPOTS[spot]!.x)).toBeGreaterThanOrEqual(5);
      }
    }
  });
  it('uses the injected randomness only (same numbers, same plan)', () => {
    const a = planClaw(ALL, 1, seq([0.2, 0.7, 0.1, 0.9, 0.4, 0.3]));
    const b = planClaw(ALL, 1, seq([0.2, 0.7, 0.1, 0.9, 0.4, 0.3]));
    expect(a).toEqual(b);
  });
});

describe('clawPose', () => {
  const outcomes: ClawOutcome[] = ['win', 'slip', 'miss'];

  it('starts and ends parked, prongs at rest', () => {
    for (const o of outcomes) {
      const plan = planFor(o);
      for (const t of [-1, 0, Number.NaN]) {
        const p = clawPose(plan, t);
        expect(p.phase).toBe('move');
        expect(p.x).toBeCloseTo(RIG.homeX, 6);
        expect(p.drop).toBe(0);
        expect(p.open).toBeCloseTo(IDLE_OPEN, 6);
        expect(p.toy).toBeNull();
      }
      const end = clawPose(plan, plan.total + 5);
      expect(end.phase).toBe('done');
      expect(end.x).toBe(RIG.homeX);
      expect(end.drop).toBe(0);
      expect(end.toy).toBe(o === 'win' ? 'gone' : null);
    }
  });

  it('moves smoothly (no jumps between frames)', () => {
    for (const o of outcomes) {
      for (let seed = 1; seed < 40; seed++) {
        const plan = planFor(o, ALL, seed * 13);
        let prev = clawPose(plan, 0);
        for (let t = 1 / 120; t <= plan.total + 0.01; t += 1 / 120) {
          const p = clawPose(plan, t);
          expect(Math.abs(p.x - prev.x)).toBeLessThan(2.5);
          expect(Math.abs(p.drop - prev.drop)).toBeLessThan(2.5);
          expect(Math.abs(p.open - prev.open)).toBeLessThan(0.2);
          if (p.toy && p.toy !== 'gone' && prev.toy && prev.toy !== 'gone') {
            expect(Math.abs(p.toy.x - prev.toy.x)).toBeLessThan(2.5);
            // falling toys accelerate; a slip's fall is the fastest move
            expect(Math.abs(p.toy.y - prev.toy.y)).toBeLessThan(6);
          }
          prev = p;
        }
      }
    }
  });

  it('runs its phases in order', () => {
    const order = ['move', 'drop', 'grab', 'lift', 'carry', 'release', 'back', 'done'];
    for (const o of outcomes) {
      const plan = planFor(o);
      let last = 0;
      const seen = new Set<string>();
      for (let t = 0; t <= plan.total + 0.05; t += 1 / 60) {
        const at = order.indexOf(clawPose(plan, t).phase);
        expect(at).toBeGreaterThanOrEqual(last);
        last = at;
        seen.add(order[at]!);
      }
      expect(seen.has('carry')).toBe(o === 'win');
      expect(seen.has('release')).toBe(o === 'win');
      for (const p of ['move', 'drop', 'grab', 'lift', 'back', 'done']) expect(seen.has(p)).toBe(true);
    }
  });

  it('reaches the toy at the bottom of the drop', () => {
    for (const o of outcomes) {
      const plan = planFor(o);
      const bottom = clawPose(plan, plan.move + plan.drop + plan.grab * 0.9);
      expect(bottom.phase).toBe('grab');
      expect(bottom.drop).toBeCloseTo(plan.depth, 6);
      expect(bottom.x).toBeCloseTo(plan.aimX, 6);
      expect(bottom.open).toBeLessThan(o === 'miss' ? 0.05 : 0.35);
    }
  });

  it('win: the toy rides up with the claw, over the chute and down it — landing at prizeAt', () => {
    const plan = planFor('win');
    const spot = TOY_SPOTS[plan.toy]!;
    const liftStart = plan.move + plan.drop + plan.grab;
    const start = clawPose(plan, liftStart + 1e-6);
    expect(start.toy).not.toBe('gone');
    expect((start.toy as { y: number }).y).toBeCloseTo(spot.y, 3);
    const top = clawPose(plan, liftStart + plan.lift + plan.carry * 0.5);
    expect(top.phase).toBe('carry');
    const held = top.toy as { x: number; y: number };
    expect(held.x).toBeCloseTo(top.x, 6);
    expect(held.y).toBeCloseTo(RIG.hubY + RIG.hold, 6);
    const falling = clawPose(plan, plan.prizeAt - 0.05).toy as { x: number; y: number };
    expect(falling.x).toBe(RIG.chuteX);
    expect(falling.y).toBeGreaterThan(RIG.hubY + RIG.hold);
    expect(clawPose(plan, plan.prizeAt + 0.01).toy).toBe('gone');
    expect(plan.prizeAt).toBeLessThan(plan.total);
  });

  it('slip: the toy lifts, then falls back onto its spot with a bounce', () => {
    const plan = planFor('slip');
    const spot = TOY_SPOTS[plan.toy]!;
    const liftStart = plan.move + plan.drop + plan.grab;
    const slip = liftStart + plan.lift * plan.slipAt;
    const before = clawPose(plan, slip - 0.01).toy as { x: number; y: number };
    expect(before.y).toBeLessThan(spot.y - 1);
    let bounced = false;
    for (let t = slip; t < slip + 0.6; t += 1 / 120) {
      const toy = clawPose(plan, t).toy;
      if (toy && toy !== 'gone' && toy.x === spot.x && toy.y < spot.y) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(clawPose(plan, slip + 0.6).toy).toBeNull();
    expect(clawPose(plan, plan.total).toy).toBeNull();
  });

  it('miss: the prongs close on nothing and the toy never moves', () => {
    const plan = planFor('miss');
    for (let t = 0; t <= plan.total; t += 1 / 30) expect(clawPose(plan, t).toy).toBeNull();
  });
});
