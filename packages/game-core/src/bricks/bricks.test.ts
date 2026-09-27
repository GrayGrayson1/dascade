import { describe, expect, it } from 'vitest';
import { InputRecorder, advanceSim, decodeEvents, replayRun, seeded, type InputEvent } from '../classics/shared/index.ts';
import {
  AUTO_LAUNCH,
  BALL_R,
  BRICK_TOP,
  BricksSim,
  CELL_H,
  CELL_W,
  CODE,
  COLS,
  EFFECT_TICKS,
  FIELD_W,
  LEVELS,
  MAX_BALLS,
  MAX_CODE,
  PADDLE_WIDE,
  PADDLE_W,
  PADDLE_Y,
  START_LIVES,
  createBricksSim,
  generateLevel,
  levelDef,
  type Brick,
} from './index.ts';

function steps(sim: BricksSim, n: number, each?: (sim: BricksSim) => void): void {
  for (let i = 0; i < n && !sim.over; i++) {
    each?.(sim);
    sim.step();
  }
}

/** Autopilot: meets the lowest falling ball with the paddle edge that aims it at the remaining bricks. */
function autopilot(sim: BricksSim): number[] {
  const falling = sim.balls.filter((b) => !b.stuck && b.vy > 0).sort((a, b) => b.y - a.y)[0];
  const ball = falling ?? sim.balls[0];
  const codes: number[] = [];
  if (ball) {
    const target = sim.bricks.filter((b) => b.alive && b.kind !== 'S').sort((a, b) => b.y - a.y)[0];
    const aim = target ? Math.sign(target.x + target.w / 2 - ball.x) || 1 : 1;
    const lean = 0.2 + ((sim.tick >> 4) % 5) * 0.1;
    codes.push(Math.max(0, Math.min(FIELD_W, Math.round(ball.x - aim * lean * (sim.paddleW / 2)))));
  }
  if (sim.phase === 'serve' && sim.tick % 30 === 0) codes.push(CODE.action);
  return codes;
}

/** Clear the level except `keep` (and make a single test brick if asked). */
function onlyBricks(sim: BricksSim, keep: (b: Brick) => boolean): void {
  for (const b of sim.bricks) if (!keep(b)) b.alive = false;
  (sim as unknown as { grid: Array<Brick | null> }).grid = (sim as unknown as { grid: Array<Brick | null> }).grid.map((b) => (b && b.alive ? b : null));
}

describe('levels', () => {
  it('eight designed levels use only known bricks and 12 columns', () => {
    expect(LEVELS).toHaveLength(8);
    for (const def of LEVELS) {
      for (const row of def.rows) {
        expect(row).toHaveLength(COLS);
        expect(row).toMatch(/^[.NAXSPM]+$/);
        if (row.includes('M')) expect(row).toMatch(/^[.M]+$/);
      }
      expect(def.rows.join('').replace(/[.S]/g, '').length).toBeGreaterThan(20);
    }
  });

  it('procedural sectors are deterministic, mirrored and always clearable', () => {
    for (let i = 8; i < 40; i++) {
      const a = generateLevel('seed', i);
      const b = generateLevel('seed', i);
      expect(a).toEqual(b);
      for (const row of a.rows) {
        expect(row).toHaveLength(COLS);
        expect(row).toBe([...row].reverse().join(''));
      }
      expect(a.rows.join('').replace(/[.S]/g, '').length).toBeGreaterThanOrEqual(24);
    }
    expect(generateLevel('seed', 8)).not.toEqual(generateLevel('other', 8));
    expect(levelDef('x', 0).name).toBe('Warm Up');
  });
});

describe('serve and paddle', () => {
  it('starts with the ball resting on the paddle and 3 lives', () => {
    const sim = new BricksSim('s');
    expect(sim.lives).toBe(START_LIVES);
    expect(sim.phase).toBe('serve');
    expect(sim.balls).toHaveLength(1);
    expect(sim.balls[0]!.stuck).toBe(true);
  });

  it('launch sends the ball upward; auto-launch after the wait', () => {
    const sim = new BricksSim('s');
    sim.input(CODE.action);
    expect(sim.phase).toBe('play');
    sim.step();
    expect(sim.balls[0]!.vy).toBeLessThan(0);
    const idle = new BricksSim('s');
    steps(idle, AUTO_LAUNCH + 1);
    expect(idle.phase).toBe('play');
  });

  it('the paddle follows pointer targets (bounded speed) and keys, clamped to the walls', () => {
    const sim = new BricksSim('s');
    sim.input(FIELD_W);
    sim.step();
    expect(sim.paddleX).toBeGreaterThan(FIELD_W / 2);
    steps(sim, 20);
    expect(sim.paddleX).toBe(FIELD_W - PADDLE_W / 2);
    sim.input(CODE.axisLeft);
    steps(sim, 4);
    expect(sim.paddleX).toBeCloseTo(FIELD_W - PADDLE_W / 2 - 30);
    sim.input(CODE.axisNone);
    const x = sim.paddleX;
    steps(sim, 5);
    expect(sim.paddleX).toBe(x);
  });

  it('the hit position on the paddle sets the bounce angle', () => {
    const angles: number[] = [];
    for (const offset of [-30, 0, 30]) {
      const sim = new BricksSim('angle');
      onlyBricks(sim, (b) => b.kind === 'S'); // nothing breakable in the way… but keep the level "unclear"
      sim.bricks.push({ ...sim.bricks[0]!, id: 999, kind: 'N', alive: true, x: 0, y: 0, w: 1, h: 1, row: 0, col: 0 });
      sim.phase = 'play';
      const ball = sim.balls[0]!;
      ball.stuck = false;
      ball.x = sim.paddleX + offset;
      ball.y = PADDLE_Y - 20;
      ball.vx = 0;
      ball.vy = 5;
      steps(sim, 6);
      angles.push(ball.vx);
      expect(ball.vy).toBeLessThan(0);
    }
    expect(angles[0]).toBeLessThan(0);
    expect(angles[2]).toBeGreaterThan(0);
    // A centre hit goes nearly straight up — but never exactly vertical (1 table step, ≈5.6°).
    expect(Math.abs(angles[1]!)).toBeGreaterThan(0.1);
    expect(Math.abs(angles[1]!)).toBeLessThan(Math.abs(angles[0]!));
  });
});

describe('bricks', () => {
  function shootAt(sim: BricksSim, target: Brick): void {
    sim.phase = 'play';
    const ball = sim.balls[0]!;
    ball.stuck = false;
    ball.x = target.x + target.w / 2;
    ball.y = target.y + target.h + 30;
    ball.vx = 0;
    ball.vy = -4;
  }

  it('a normal brick breaks in one hit and the ball reflects', () => {
    const sim = new BricksSim('n');
    const target = sim.bricks.find((b) => b.kind === 'N' && b.row === 5)!;
    shootAt(sim, target);
    steps(sim, 12);
    expect(target.alive).toBe(false);
    expect(sim.score).toBeGreaterThanOrEqual(50);
    expect(sim.balls[0]!.vy).toBeGreaterThan(0);
    expect(sim.bricksBroken).toBe(1);
  });

  it('armored bricks crack first, steel never breaks', () => {
    const sim = new BricksSim('a', { startLevel: 2 });
    const armor = sim.bricks.find((b) => b.kind === 'A')!;
    expect(armor.hp).toBe(2);
    (sim as unknown as { damage: (b: Brick, byBall: boolean) => void }).damage(armor, true);
    expect(armor.alive).toBe(true);
    expect(armor.hp).toBe(1);
    (sim as unknown as { damage: (b: Brick, byBall: boolean) => void }).damage(armor, true);
    expect(armor.alive).toBe(false);
    const steelSim = new BricksSim('s', { startLevel: 5 });
    const steel = steelSim.bricks.find((b) => b.kind === 'S')!;
    for (let i = 0; i < 10; i++) (steelSim as unknown as { damage: (b: Brick, byBall: boolean) => void }).damage(steel, true);
    expect(steel.alive).toBe(true);
  });

  it('explosive bricks blast their neighbours (and chain)', () => {
    const sim = new BricksSim('x', { startLevel: 3 });
    const bomb = sim.bricks.find((b) => b.kind === 'X' && b.row === 2 && b.col === 5)!;
    const neighbours = sim.bricks.filter((b) => b.kind !== 'M' && Math.abs(b.row - bomb.row) <= 1 && Math.abs(b.col - bomb.col) <= 1 && b !== bomb);
    (sim as unknown as { damage: (b: Brick, byBall: boolean) => void }).damage(bomb, true);
    expect(bomb.alive).toBe(false);
    for (const n of neighbours) if (n.kind === 'N' || n.kind === 'X' || n.kind === 'P') expect(n.alive).toBe(false);
    // The adjacent explosive at col 6 chained.
    expect(sim.bricks.find((b) => b.row === 2 && b.col === 6)!.alive).toBe(false);
  });

  it('moving bricks slide and bounce at the walls', () => {
    const sim = new BricksSim('m', { startLevel: 4 });
    const movers = sim.bricks.filter((b) => b.kind === 'M');
    expect(movers.length).toBeGreaterThan(0);
    const x0 = movers.map((m) => m.x);
    steps(sim, 10);
    expect(movers.map((m) => m.x)).not.toEqual(x0);
    steps(sim, 600, (s) => s.input(CODE.axisNone));
    for (const m of movers) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.w).toBeLessThanOrEqual(FIELD_W);
    }
  });

  it('power bricks always drop a capsule; the paddle catches it', () => {
    const sim = new BricksSim('p');
    const power = sim.bricks.find((b) => b.kind === 'P')!;
    sim.phase = 'play';
    (sim as unknown as { damage: (b: Brick, byBall: boolean) => void }).damage(power, true);
    expect(sim.capsules).toHaveLength(1);
    const cap = sim.capsules[0]!;
    sim.input(Math.round(cap.x));
    const before = sim.score;
    steps(sim, 400);
    expect(sim.capsules).toHaveLength(0);
    expect(sim.score).toBeGreaterThanOrEqual(before + 100);
  });
});

describe('power-ups', () => {
  const apply = (sim: BricksSim, kind: 'wide' | 'multi' | 'laser' | 'slow' | 'sticky' | 'life') =>
    (sim as unknown as { applyPower: (k: string) => void }).applyPower(kind);

  it('wide widens the paddle for a while', () => {
    const sim = new BricksSim('w');
    apply(sim, 'wide');
    expect(sim.paddleW).toBe(PADDLE_WIDE);
    steps(sim, EFFECT_TICKS + 1);
    expect(sim.paddleW).toBe(PADDLE_W);
  });

  it('multi splits every flying ball in three (capped)', () => {
    const sim = new BricksSim('mb');
    sim.input(CODE.action);
    sim.step();
    apply(sim, 'multi');
    expect(sim.balls).toHaveLength(3);
    for (let i = 0; i < 6; i++) apply(sim, 'multi');
    expect(sim.balls.length).toBeLessThanOrEqual(MAX_BALLS);
    for (const b of sim.balls) expect(Math.abs(b.vy)).toBeGreaterThan(0.5);
  });

  it('laser fires twin bolts that break bricks', () => {
    const sim = new BricksSim('l');
    sim.input(CODE.action);
    sim.step();
    apply(sim, 'laser');
    sim.input(CODE.action);
    expect(sim.bolts).toHaveLength(2);
    const before = sim.bricksBroken;
    steps(sim, 80);
    expect(sim.bricksBroken).toBeGreaterThan(before);
  });

  it('slow reduces the ball speed; sticky catches the ball', () => {
    const sim = new BricksSim('slow');
    const fast = sim.ballSpeed();
    apply(sim, 'slow');
    expect(sim.ballSpeed()).toBeLessThan(fast);
    const st = new BricksSim('sticky');
    onlyBricks(st, (b) => b.row === 1 && b.col === 1);
    st.phase = 'play';
    apply(st, 'sticky');
    const ball = st.balls[0]!;
    ball.stuck = false;
    ball.x = st.paddleX + 10;
    ball.y = PADDLE_Y - 30;
    ball.vx = 0;
    ball.vy = 5;
    steps(st, 8);
    expect(ball.stuck).toBe(true);
    st.input(CODE.action);
    expect(ball.stuck).toBe(false);
  });

  it('+1 life and a bonus life every 25,000 points', () => {
    const sim = new BricksSim('life');
    apply(sim, 'life');
    expect(sim.lives).toBe(START_LIVES + 1);
    (sim as unknown as { addScore: (n: number) => void }).addScore(25_000);
    expect(sim.lives).toBe(START_LIVES + 2);
  });
});

describe('lives, levels and game over', () => {
  it('missing the ball costs a life and re-serves; the last miss ends the game (settled on step)', () => {
    const sim = new BricksSim('miss');
    for (let life = START_LIVES; life > 0; life--) {
      sim.input(CODE.action);
      sim.input(0); // paddle to the far left; the ball flies up and eventually falls past it
      let guard = 0;
      while (sim.lives === life && guard++ < 20_000) {
        sim.input(0);
        sim.step();
      }
      expect(sim.lives).toBe(life - 1);
      if (life > 1) {
        steps(sim, 100);
        expect(sim.phase).toBe('serve');
      }
    }
    expect(sim.over).toBe(true);
    expect(sim.summary().lives).toBe(0);
  });

  it('clearing a level awards the bonus and loads the next level', () => {
    const sim = new BricksSim('clear');
    onlyBricks(sim, (b) => b.row === 1 && b.col === 1);
    const last = sim.bricks.find((b) => b.alive)!;
    sim.phase = 'play';
    const ball = sim.balls[0]!;
    ball.stuck = false;
    ball.x = last.x + last.w / 2;
    ball.y = last.y + last.h + 20;
    ball.vx = 0;
    ball.vy = -4;
    steps(sim, 20);
    expect(sim.phase).toBe('clear');
    expect(sim.score).toBeGreaterThanOrEqual(50 + 1000 + 2000);
    steps(sim, 200);
    expect(sim.level).toBe(2);
    expect(sim.levelName).toBe('Armor Plate');
    expect(sim.phase).toBe('serve');
  });

  it('an autopilot plays several levels; the ball never escapes the field', () => {
    const sim = new BricksSim('auto', {}, false);
    let guard = 0;
    while (!sim.over && sim.level < 3 && guard++ < 60_000) {
      for (const c of autopilot(sim)) sim.input(c);
      sim.step();
      for (const b of sim.balls) {
        expect(b.x).toBeGreaterThanOrEqual(BALL_R - 0.001);
        expect(b.x).toBeLessThanOrEqual(FIELD_W - BALL_R + 0.001);
        expect(b.y).toBeGreaterThanOrEqual(BALL_R - 0.001);
      }
    }
    expect(sim.level).toBeGreaterThanOrEqual(2);
    expect(sim.bricksBroken).toBeGreaterThan(40);
  });
});

describe('verification', () => {
  it('rejects codes outside the code space only', () => {
    const sim = new BricksSim('codes');
    expect(sim.input(-1)).toBe(false);
    expect(sim.input(FIELD_W + 1)).toBe(false);
    expect(sim.input(999)).toBe(false);
    expect(sim.input(1005)).toBe(false);
    expect(sim.input(MAX_CODE + 1)).toBe(false);
    for (const c of [0, 240, FIELD_W, CODE.axisLeft, CODE.axisNone, CODE.axisRight, CODE.action]) expect(sim.input(c)).toBe(true);
  });

  it('a replayed log reproduces the exact run (batched like the server)', () => {
    const client = createBricksSim('race-seed');
    const rec = new InputRecorder();
    const server = createBricksSim('race-seed', {}, false);
    let upTo = 0;
    let lastTarget = -1;
    while (!client.over && client.tick < 30_000) {
      for (const code of autopilot(client)) {
        if (code <= FIELD_W && code === lastTarget) continue;
        if (code <= FIELD_W) lastTarget = code;
        if (client.input(code)) rec.record(client.tick, code);
      }
      client.step();
      if (client.tick % 12 === 0 || client.over) {
        for (;;) {
          const b = rec.take(client.tick);
          if (!b) break;
          const decoded = decodeEvents(b.events, upTo, b.upTo, MAX_CODE);
          expect(decoded.ok).toBe(true);
          if (decoded.ok) expect(advanceSim(server, decoded.events, b.upTo).ok).toBe(true);
          upTo = b.upTo;
        }
      }
    }
    expect(server.summary()).toEqual(client.summary());
    expect(server.tick).toBe(client.tick);
    expect(server.bricks.filter((b) => b.alive).length).toBe(client.bricks.filter((b) => b.alive).length);
  });

  it('a tampered log changes the outcome instead of inflating it', () => {
    const rng = seeded('t');
    const log: InputEvent[] = [];
    for (let t = 0; t < 4000; t += 3) log.push({ tick: t, code: rng.int(FIELD_W + 1) });
    const honest = replayRun(createBricksSim, 'x', {}, log, 4000);
    const shifted = replayRun(createBricksSim, 'x', {}, log.map((e) => ({ ...e, code: FIELD_W - e.code })), 4000);
    expect(shifted.summary()).not.toEqual(honest.summary());
  });
});

// Keep geometry constants referenced (documented layout).
it('geometry: bricks start below the top gap and fit the field', () => {
  const sim = new BricksSim('geo');
  for (const b of sim.bricks) {
    expect(b.y).toBeGreaterThanOrEqual(BRICK_TOP);
    expect(b.x + b.w).toBeLessThanOrEqual(FIELD_W);
    expect(b.w).toBe(CELL_W - 4);
    expect(b.h).toBe(CELL_H - 4);
  }
});
