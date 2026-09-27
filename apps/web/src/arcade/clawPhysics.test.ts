import { describe, expect, it } from 'vitest';
import {
  AIM_TIME,
  BOX,
  CHUTE,
  CLAW,
  DT,
  GANTRY,
  KINDS,
  buriedLoad,
  cancelAim,
  contactHeight,
  createSim,
  evaluateGrip,
  fastForward,
  inChute,
  insertToken,
  nextRandom,
  payoutBonus,
  restock,
  settleFully,
  settlePile,
  stepClaw,
  stockToys,
  surfaceAt,
  type ClawEvent,
  type ClawInput,
  type ClawSim,
  type ClawToy,
  type ToyKind,
} from './clawPhysics.ts';

const IDLE: ClawInput = { x: 0, z: 0, drop: false };

function toy(id: number, kind: ToyKind, x: number, z: number, y = 0): ClawToy {
  return { id, kind, color: id % 6, x, z, y, mode: 'pile', vx: 0, vy: 0, vz: 0, tilt: 0 };
}

function run(sim: ClawSim, seconds: number, input: ClawInput = IDLE, events: ClawEvent[] = []): ClawEvent[] {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepClaw(sim, input, events);
  return events;
}

/** Plays one whole try: token, put the trolley at (x, z), drop, wait for it to finish. */
function tryAt(sim: ClawSim, x: number, z: number): ClawEvent[] {
  const events: ClawEvent[] = [];
  expect(insertToken(sim, events)).toBe(true);
  sim.gx = x;
  sim.gz = z;
  stepClaw(sim, { x: 0, z: 0, drop: true }, events);
  let n = 0;
  while (sim.phase !== 'idle' && n++ < 60 / DT) stepClaw(sim, IDLE, events);
  return events;
}

const lcg = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
};

describe('randomness', () => {
  it('is the state seed only: same seed, same numbers', () => {
    const a = { seed: 42 };
    const b = { seed: 42 };
    const xs = Array.from({ length: 50 }, () => nextRandom(a));
    expect(Array.from({ length: 50 }, () => nextRandom(b))).toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('replays a whole try exactly from the same seed and inputs', () => {
    const play = () => {
      const sim = createSim(stockToys(5, 20), 99);
      const ev = tryAt(sim, 60, 30);
      return { ev: ev.map((e) => e.type).join(','), toys: sim.toys.map((t) => [t.id, t.x.toFixed(3), t.y.toFixed(3), t.z.toFixed(3)]) };
    };
    expect(play()).toEqual(play());
  });
});

describe('the pile', () => {
  it('stocks a settled heap inside the glass and out of the chute', () => {
    for (let seed = 1; seed < 30; seed++) {
      const toys = stockToys(seed, 22);
      expect(toys).toHaveLength(22);
      expect(new Set(toys.map((t) => t.id)).size).toBe(22);
      for (const t of toys) {
        const k = KINDS[t.kind];
        expect(t.mode).toBe('pile');
        expect(t.x).toBeGreaterThanOrEqual(k.r * 0.8 - 1e-9);
        expect(t.x).toBeLessThanOrEqual(BOX.w - k.r * 0.8 + 1e-9);
        expect(t.z).toBeGreaterThanOrEqual(k.r * 0.8 - 1e-9);
        expect(t.z).toBeLessThanOrEqual(BOX.d - k.r * 0.8 + 1e-9);
        expect(inChute(t.x, t.z)).toBe(false);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeLessThan(45);
      }
    }
  });

  it('stacks a toy dropped on another and lets it fall when the one below is taken', () => {
    const toys = [toy(1, 'blob', 50, 30), toy(2, 'blob', 50.5, 30, 3)];
    settleFully(toys);
    const top = toys.find((t) => t.id === 2)!;
    expect(top.y).toBeGreaterThan(5);
    toys[0]!.mode = 'held';
    settlePile(toys);
    expect(top.mode).toBe('fall');
  });

  it('rolls a toy perched on an edge off onto the floor', () => {
    const toys = [toy(1, 'blob', 50, 30), toy(2, 'blob', 58.5, 30, 5)];
    settleFully(toys);
    expect(toys[1]!.y).toBeLessThan(1);
    expect(toys[1]!.x).toBeGreaterThan(58.5);
  });

  it('reads the surface under a point (floor 0, toy tops above it)', () => {
    const toys = [toy(1, 'bot', 50, 30)];
    expect(surfaceAt(toys, 10, 50)).toBe(0);
    expect(surfaceAt(toys, 50, 30)).toBeCloseTo(KINDS.bot.h, 6);
    expect(surfaceAt(toys, 50, 30, 1)).toBe(0);
  });

  it('counts toys resting on another as weight pinning it', () => {
    const toys = [toy(1, 'blob', 50, 30), toy(2, 'bunny', 51, 30, 4)];
    settleFully(toys);
    const low = toys.find((t) => t.id === 1)!;
    const high = toys.find((t) => t.id === 2)!;
    expect(buriedLoad(toys, low)).toBeGreaterThan(0.5);
    expect(buriedLoad(toys, high)).toBeLessThan(0.3);
  });
});

describe('the gantry', () => {
  it('accelerates and brakes like a machine, not instantly', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    run(sim, DT, { x: 1, z: 0, drop: false });
    expect(sim.vx).toBeGreaterThan(0);
    expect(sim.vx).toBeLessThan(GANTRY.maxSpeed * 0.1);
    run(sim, 0.6, { x: 1, z: 0, drop: false });
    expect(sim.vx).toBeCloseTo(GANTRY.maxSpeed, 6);
    const x = sim.gx;
    run(sim, DT);
    expect(sim.vx).toBeGreaterThan(0); // still coasting to a stop
    run(sim, 0.4);
    expect(sim.vx).toBe(0);
    expect(sim.gx).toBeGreaterThan(x);
  });

  it('stops at the walls with a bump', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    const ev = run(sim, 6, { x: 1, z: 1, drop: false });
    expect(sim.gx).toBe(GANTRY.maxX);
    expect(sim.gz).toBe(GANTRY.maxZ);
    expect(ev.some((e) => e.type === 'bump')).toBe(true);
  });

  it('ignores garbage input', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    run(sim, 1, { x: Number.NaN, z: Number.POSITIVE_INFINITY, drop: false });
    expect(Number.isFinite(sim.gx) && Number.isFinite(sim.gz)).toBe(true);
    expect(sim.gz).toBeLessThanOrEqual(GANTRY.maxZ);
  });

  it('swings the head when the trolley accelerates, and settles again', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    run(sim, 0.3, { x: 1, z: 0, drop: false });
    run(sim, 0.15);
    const peak = Math.abs(sim.sx) + Math.abs(sim.svx);
    expect(peak).toBeGreaterThan(0.05);
    run(sim, 4);
    expect(Math.abs(sim.sx)).toBeLessThan(0.05);
  });
});

describe('a try', () => {
  it('only starts from idle, and hands the token back if cancelled before the drop', () => {
    const sim = createSim(stockToys(1, 10), 1);
    expect(insertToken(sim)).toBe(true);
    expect(insertToken(sim)).toBe(false);
    run(sim, 1, { x: 1, z: 0, drop: false });
    expect(cancelAim(sim)).toBe(true);
    expect(sim.phase).toBe('idle');
    expect(sim.misses).toBe(0);
    expect(cancelAim(sim)).toBe(false);
  });

  it('auto-drops when the timer runs out, with countdown ticks', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    const ev = run(sim, AIM_TIME + 0.05);
    expect(ev.filter((e) => e.type === 'tick').map((e) => (e as { left: number }).left)).toEqual([5, 4, 3, 2, 1]);
    const drop = ev.find((e) => e.type === 'drop');
    expect(drop).toEqual({ type: 'drop', auto: true });
    expect(sim.phase).toBe('drop');
  });

  it('commits on drop: the stick no longer moves the claw', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    run(sim, DT, { x: 0, z: 0, drop: true });
    expect(sim.phase).toBe('drop');
    const x = sim.gx;
    run(sim, 0.5, { x: 1, z: 1, drop: false });
    expect(sim.gx).toBe(x);
  });

  it('runs its phases in order and comes back to idle', () => {
    const sim = createSim(stockToys(3, 20), 3);
    const order = ['idle', 'aim', 'drop', 'close', 'lift', 'top', 'carry', 'release', 'settle'];
    const seen: string[] = [sim.phase];
    insertToken(sim);
    seen.push(sim.phase);
    stepClaw(sim, { x: 0, z: 0, drop: true }, []);
    for (let i = 0; i < 40 / DT && sim.phase !== 'idle'; i++) {
      stepClaw(sim, IDLE, []);
      if (seen[seen.length - 1] !== sim.phase) seen.push(sim.phase);
    }
    expect(seen.slice(0, -1)).toEqual(order);
    expect(seen[seen.length - 1]).toBe('idle');
  });

  it('comes to rest where the claw meets the pile, not through it', () => {
    const sim = createSim([toy(1, 'bot', 50, 30)], 1);
    insertToken(sim);
    sim.gx = 50;
    sim.gz = 30;
    stepClaw(sim, { x: 0, z: 0, drop: true }, []);
    const ev = run(sim, 4);
    const touch = ev.find((e) => e.type === 'touch');
    expect(touch).toEqual({ type: 'touch', onToy: true });
    expect(sim.hubY).toBeGreaterThanOrEqual(KINDS.bot.h - CLAW.sink - 0.6);
  });
});

describe('the grip', () => {
  const lone = (kind: ToyKind, hx: number, hz: number) => {
    const sim = createSim([toy(1, kind, 50, 30)], 1);
    sim.gx = hx;
    sim.gz = hz;
    sim.hubY = contactHeight(sim);
    return evaluateGrip(sim);
  };

  it('cradles a lone plush dropped dead centre with all three prongs', () => {
    for (const kind of ['blob', 'bunny', 'star', 'bot'] as const) {
      const g = lone(kind, 50, 30);
      expect(g.toy).toBe(1);
      expect(g.prongs.every((q) => q > 0.2)).toBe(true);
      expect(g.opposed).toBeGreaterThan(1.2);
    }
    expect(lone('blob', 50, 30).quality).toBe('great');
  });

  it('gets worse the further the claw lands off centre — biggest factor', () => {
    let last = Infinity;
    for (const off of [0, 2, 4, 6, 8]) {
      const g = lone('blob', 50 + off, 30);
      expect(g.opposed).toBeLessThanOrEqual(last + 1e-9);
      last = g.opposed;
    }
    expect(lone('blob', 57, 30).quality).toMatch(/nudge|weak|none/);
    expect(lone('blob', 72, 30).toy).toBeNull();
  });

  it('holds a round blob better than a hard cube bot', () => {
    expect(lone('blob', 50, 30).margin).toBeGreaterThan(lone('bot', 50, 30).margin);
  });

  it('a buried plush pins down: less margin than the same one on its own', () => {
    const free = lone('blob', 50, 30);
    const sim = createSim([toy(1, 'blob', 50, 30), toy(2, 'bunny', 52, 31, 5), toy(3, 'bot', 47, 29, 5)], 1);
    settleFully(sim.toys);
    sim.gx = 50;
    sim.gz = 30;
    sim.hubY = contactHeight(sim);
    const g = evaluateGrip(sim);
    if (g.toy === 1) expect(g.margin).toBeLessThan(free.margin);
    else expect(g.toy).not.toBe(1);
  });

  it('makes the machine a little stronger after a run of misses (capped)', () => {
    expect(payoutBonus(0)).toBe(0);
    expect(payoutBonus(2)).toBe(0);
    expect(payoutBonus(3)).toBeGreaterThan(0);
    expect(payoutBonus(100)).toBe(0.15);
    expect(payoutBonus(Number.NaN)).toBe(0);
  });
});

describe('outcomes', () => {
  /** A careful player: over the most exposed plush with a small aiming error. */
  function careful(seed: number, tries: number): number {
    const r = lcg(seed);
    const sim = createSim(stockToys(seed, 22), seed);
    let wins = 0;
    for (let i = 0; i < tries; i++) {
      if (sim.toys.length < 10) {
        restock(sim, 22);
        settleFully(sim.toys);
      }
      let best: ClawToy | null = null;
      let score = -Infinity;
      for (const t of sim.toys) {
        const v = t.y + KINDS[t.kind].h - buriedLoad(sim.toys, t) * 6 + r() * 6;
        if (v > score) {
          score = v;
          best = t;
        }
      }
      const ev = tryAt(sim, best!.x + (r() - 0.5) * 2, best!.z + (r() - 0.5) * 3);
      if (ev.some((e) => e.type === 'done' && e.result === 'win')) wins++;
    }
    return wins / tries;
  }
  function careless(seed: number, tries: number): number {
    const r = lcg(seed);
    const sim = createSim(stockToys(seed, 22), seed);
    let wins = 0;
    for (let i = 0; i < tries; i++) {
      if (sim.toys.length < 10) restock(sim, 22);
      const ev = tryAt(sim, GANTRY.minX + r() * (GANTRY.maxX - GANTRY.minX), GANTRY.minZ + r() * (GANTRY.maxZ - GANTRY.minZ));
      if (ev.some((e) => e.type === 'done' && e.result === 'win')) wins++;
    }
    return wins / tries;
  }

  it('a careful player wins roughly one try in two or three; a careless one rarely', () => {
    let good = 0;
    let bad = 0;
    for (let s = 1; s <= 6; s++) {
      good += careful(s, 20);
      bad += careless(s + 100, 20);
    }
    good /= 6;
    bad /= 6;
    expect(good).toBeGreaterThan(0.28);
    expect(good).toBeLessThan(0.65);
    expect(bad).toBeLessThan(0.14);
  });

  it('a win takes exactly one plush down the chute (never lost, never doubled)', () => {
    const sim = createSim([toy(1, 'blob', 50, 30)], 7);
    sim.strengthScale = 6;
    const ev = tryAt(sim, 50, 30);
    const wins = ev.filter((e) => e.type === 'win');
    expect(wins).toHaveLength(1);
    expect(sim.toys).toHaveLength(0);
    expect(ev.find((e) => e.type === 'done')).toEqual({ type: 'done', result: 'win' });
    expect(sim.misses).toBe(0);
  });

  it('a weak claw lifts it and lets it go: back in the pile, nothing won', () => {
    const sim = createSim([toy(1, 'blob', 50, 30)], 7);
    sim.strengthScale = 0.35;
    const ev = tryAt(sim, 50, 30);
    expect(ev.some((e) => e.type === 'win')).toBe(false);
    expect(sim.toys).toHaveLength(1);
    expect(sim.toys[0]!.mode).toBe('pile');
    expect(sim.result === 'slip' || sim.result === 'miss').toBe(true);
    expect(sim.misses).toBe(1);
  });

  it('a clean miss over bare floor comes up empty', () => {
    const sim = createSim([toy(1, 'blob', 80, 45)], 7);
    const ev = tryAt(sim, 40, 20);
    expect(ev.find((e) => e.type === 'grip')).toMatchObject({ report: { toy: null, quality: 'none' } });
    expect(sim.result).toBe('miss');
  });

  it('a plush that slips while over the chute drops in anyway (a lucky win)', () => {
    const sim = createSim([toy(1, 'star', 60, 30)], 3);
    sim.phase = 'carry';
    sim.gx = GANTRY.homeX + 1;
    sim.gz = GANTRY.homeZ;
    sim.hubY = GANTRY.topY;
    const t = sim.toys[0]!;
    t.mode = 'fall';
    t.x = CHUTE.x0 + 8;
    t.z = CHUTE.z0 + 8;
    t.y = 40;
    const ev = run(sim, 3);
    expect(ev.some((e) => e.type === 'chute')).toBe(true);
    expect(ev.some((e) => e.type === 'win')).toBe(true);
  });
});

describe('closing mid-try', () => {
  it('fast-forwards a dropped try to its end with the same rules', () => {
    for (let seed = 1; seed < 12; seed++) {
      const sim = createSim(stockToys(seed, 18), seed);
      const before = sim.toys.length;
      insertToken(sim);
      sim.gx = 40 + seed * 3;
      sim.gz = 20 + seed;
      stepClaw(sim, { x: 0, z: 0, drop: true }, []);
      run(sim, 1.5 + (seed % 5));
      const ev = fastForward(sim);
      expect(sim.phase).toBe('idle');
      const won = ev.filter((e) => e.type === 'win').length;
      expect(sim.toys.length + won).toBeLessThanOrEqual(before);
      expect(sim.toys.every((t) => t.mode === 'pile')).toBe(true);
    }
  });

  it('cancels (token back) when still aiming', () => {
    const sim = createSim(stockToys(1, 10), 1);
    insertToken(sim);
    run(sim, 2, { x: 1, z: 0, drop: false });
    const ev = fastForward(sim);
    expect(ev.some((e) => e.type === 'done')).toBe(false);
    expect(sim.phase).toBe('idle');
    expect(sim.misses).toBe(0);
  });
});

describe('restock', () => {
  it('tops the machine up with fresh plushies that fall in and settle', () => {
    const sim = createSim(stockToys(2, 5), 2);
    const added = restock(sim, 22);
    expect(added).toBe(17);
    expect(sim.toys).toHaveLength(22);
    expect(new Set(sim.toys.map((t) => t.id)).size).toBe(22);
    expect(sim.toys.filter((t) => t.fresh)).toHaveLength(17);
    run(sim, 3);
    expect(sim.toys.every((t) => t.mode === 'pile')).toBe(true);
    expect(restock(sim, 22)).toBe(0);
  });
});
