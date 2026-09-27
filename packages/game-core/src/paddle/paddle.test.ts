import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  BALL_SPEEDS,
  FACE_X,
  PADDLE,
  applyPaddleSnapshot,
  createAi,
  createMatch,
  decodePaddleSnapshot,
  driveAi,
  encodePaddleSnapshot,
  forfeit,
  interceptY,
  isGameWon,
  requestServe,
  serverFor,
  setLagTicks,
  setTarget,
  snapshotOf,
  stepMatch,
  type AiLevel,
  type PaddleMatch,
  type PaddleRules,
  type PaddleSimEvent,
  type Side,
} from './index.ts';

const RULES: PaddleRules = { target: 7, winBy2: true, speed: 'classic' };
const rng = () => createSeededRng('paddle');

function run(m: PaddleMatch, ticks: number, r = rng()): PaddleSimEvent[] {
  const out: PaddleSimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...stepMatch(m, r));
  return out;
}

/** Put the ball in play at (x, y) with velocity (vx, vy). */
function inPlay(m: PaddleMatch, x: number, y: number, vx: number, vy: number): void {
  m.status = 'play';
  m.timer = 0;
  m.ball.x = x;
  m.ball.y = y;
  m.ball.vx = vx;
  m.ball.vy = vy;
  m.ball.speed = Math.sqrt(vx * vx + vy * vy);
}

function holdPaddle(m: PaddleMatch, side: Side, y: number): void {
  m.sides[side].y = y;
  m.sides[side].target = y;
  m.sides[side].history = [y];
}

describe('paddle: setup and paddles', () => {
  it('starts in serve with the ball resting on the serving paddle', () => {
    const m = createMatch(RULES, 1);
    expect(m.status).toBe('serve');
    expect(m.server).toBe(1);
    expect(m.ball.x).toBeLessThan(FACE_X[1]);
    expect(m.ball.x).toBeGreaterThan(PADDLE.width / 2);
    expect(m.ball.y).toBe(m.sides[1].y);
  });

  it('moves paddles towards their target at the capped speed and clamps to the field', () => {
    const m = createMatch(RULES, 0);
    setTarget(m, 0, 0);
    stepMatch(m, rng());
    expect(m.sides[0].y).toBe(PADDLE.height / 2 - PADDLE.paddleSpeed);
    expect(m.sides[0].vy).toBe(-PADDLE.paddleSpeed);
    run(m, 60);
    expect(m.sides[0].y).toBe(PADDLE.paddleH / 2);
    setTarget(m, 0, 99_999);
    run(m, 120);
    expect(m.sides[0].y).toBe(PADDLE.height - PADDLE.paddleH / 2);
    setTarget(m, 0, Number.NaN);
    expect(m.sides[0].target).toBe(PADDLE.height - PADDLE.paddleH / 2);
  });

  it('the resting ball follows the serving paddle', () => {
    const m = createMatch(RULES, 0);
    setTarget(m, 0, 200);
    run(m, 20);
    expect(m.ball.y).toBe(m.sides[0].y);
  });
});

describe('paddle: serve rules', () => {
  it('ignores serve requests from the receiver and before the minimum hold', () => {
    const m = createMatch(RULES, 0);
    requestServe(m, 1);
    expect(m.sides[1].serveReq).toBe(false);
    requestServe(m, 0);
    run(m, PADDLE.serveMinTicks - 2);
    expect(m.status).toBe('serve');
    const ev = run(m, 3);
    expect(m.status).toBe('play');
    expect(ev.some((e) => e.type === 'serve' && e.side === 0)).toBe(true);
    expect(m.ball.vx).toBeGreaterThan(0);
  });

  it('auto-serves so an idle server can never stall the game', () => {
    const m = createMatch(RULES, 1);
    run(m, PADDLE.serveAutoTicks - 1);
    expect(m.status).toBe('serve');
    run(m, 1);
    expect(m.status).toBe('play');
    expect(m.ball.vx).toBeLessThan(0);
    expect(m.ball.speed).toBe(BALL_SPEEDS.classic.start);
  });

  it('launch angle follows the paddle motion', () => {
    const up = createMatch(RULES, 0);
    const down = createMatch(RULES, 0);
    run(up, PADDLE.serveMinTicks);
    run(down, PADDLE.serveMinTicks);
    setTarget(up, 0, 0);
    setTarget(down, 0, PADDLE.height);
    requestServe(up, 0);
    requestServe(down, 0);
    // Same seed → same wobble; the only difference is the paddle motion.
    stepMatch(up, createSeededRng('serve'));
    stepMatch(down, createSeededRng('serve'));
    expect(up.ball.vy).toBeLessThan(down.ball.vy);
  });

  it('serve alternates every two points, and every point at deuce', () => {
    expect(serverFor(RULES, 0, 0, 0)).toBe(0);
    expect(serverFor(RULES, 0, 1, 0)).toBe(0);
    expect(serverFor(RULES, 0, 1, 1)).toBe(1);
    expect(serverFor(RULES, 0, 2, 1)).toBe(1);
    expect(serverFor(RULES, 0, 2, 2)).toBe(0);
    expect(serverFor(RULES, 1, 0, 0)).toBe(1);
    // Deuce at 6–6 (target 7, win by two): alternate each point.
    expect(serverFor(RULES, 0, 6, 6)).toBe(0);
    expect(serverFor(RULES, 0, 7, 6)).toBe(1);
    expect(serverFor(RULES, 0, 7, 7)).toBe(0);
    // Without win-by-two there is no deuce rotation.
    expect(serverFor({ ...RULES, winBy2: false }, 0, 6, 7)).toBe(serverFor({ ...RULES, winBy2: false }, 0, 7, 6));
  });
});

describe('paddle: ball physics', () => {
  it('bounces off the top and bottom walls', () => {
    const m = createMatch(RULES, 0);
    holdPaddle(m, 0, 450);
    holdPaddle(m, 1, 450);
    inPlay(m, 800, PADDLE.ballR + 3, 4, -8);
    const ev = run(m, 1);
    expect(m.ball.vy).toBeGreaterThan(0);
    expect(m.ball.y).toBeGreaterThanOrEqual(PADDLE.ballR);
    expect(ev.some((e) => e.type === 'wall')).toBe(true);
    inPlay(m, 800, PADDLE.height - PADDLE.ballR - 3, 4, 8);
    run(m, 1);
    expect(m.ball.vy).toBeLessThan(0);
    expect(m.ball.y).toBeLessThanOrEqual(PADDLE.height - PADDLE.ballR);
  });

  it('a centre hit returns flat; the hit position sets the angle symmetrically', () => {
    const centre = createMatch(RULES, 0);
    holdPaddle(centre, 0, 450);
    inPlay(centre, FACE_X[0] + 40, 450, -12, 0);
    const ev = run(centre, 4);
    expect(ev.find((e) => e.type === 'hit')).toBeTruthy();
    expect(centre.ball.vx).toBeGreaterThan(0);
    expect(Math.abs(centre.ball.vy)).toBeLessThan(1e-9);

    const high = createMatch(RULES, 0);
    const low = createMatch(RULES, 0);
    holdPaddle(high, 0, 450);
    holdPaddle(low, 0, 450);
    inPlay(high, FACE_X[0] + 40, 450 - 60, -12, 0);
    inPlay(low, FACE_X[0] + 40, 450 + 60, -12, 0);
    run(high, 4);
    run(low, 4);
    expect(high.ball.vy).toBeLessThan(0);
    expect(low.ball.vy).toBeGreaterThan(0);
    expect(high.ball.vy).toBeCloseTo(-low.ball.vy, 9);
    // Edge hits are steep but never exceed the max bounce angle.
    const slope = Math.abs(high.ball.vy / high.ball.vx);
    expect(slope).toBeGreaterThan(0.5);
    expect(slope).toBeLessThanOrEqual(PADDLE.maxBounceTan + 1e-9);
  });

  it('paddle motion adds english to the return', () => {
    const still = createMatch(RULES, 0);
    const moving = createMatch(RULES, 0);
    holdPaddle(still, 0, 450);
    holdPaddle(moving, 0, 450);
    inPlay(still, FACE_X[0] + 13, 450, -12, 0);
    inPlay(moving, FACE_X[0] + 13, 450, -12, 0);
    // Moving paddle: steer downwards at full speed (vy > 0 after this tick).
    setTarget(moving, 0, 900);
    moving.sides[0].history = [450];
    run(still, 1);
    run(moving, 1);
    expect(moving.ball.vy).toBeGreaterThan(still.ball.vy);
  });

  it('speeds the ball up each hit, capped at the top speed', () => {
    const m = createMatch(RULES, 0);
    holdPaddle(m, 0, 450);
    inPlay(m, FACE_X[0] + 40, 450, -12, 0);
    run(m, 4);
    expect(m.ball.speed).toBeCloseTo(12 * (1 + BALL_SPEEDS.classic.gain), 9);
    const fast = createMatch(RULES, 0);
    holdPaddle(fast, 0, 450);
    inPlay(fast, FACE_X[0] + 40, 450, -BALL_SPEEDS.classic.max, 0);
    run(fast, 2);
    expect(fast.ball.speed).toBe(BALL_SPEEDS.classic.max);
  });

  it('never tunnels through a paddle at top speed', () => {
    for (const speed of ['chill', 'classic', 'turbo'] as const) {
      const max = BALL_SPEEDS[speed].max;
      for (let off = 0; off < 40; off++) {
        const m = createMatch({ ...RULES, speed }, 0);
        holdPaddle(m, 1, 450);
        inPlay(m, FACE_X[1] - 200 - off * 0.73, 450, max, 0);
        m.ball.speed = max;
        run(m, 20);
        expect(m.ball.vx, `${speed} offset ${off}`).toBeLessThan(0);
        expect(m.sides[1].hits).toBe(1);
      }
    }
  });

  it('a miss is a point for the opponent, then a pause, then the next serve', () => {
    const m = createMatch(RULES, 0);
    holdPaddle(m, 0, 150);
    holdPaddle(m, 1, 450);
    inPlay(m, 300, 700, -20, 0);
    const ev = run(m, 30);
    const point = ev.find((e) => e.type === 'point');
    expect(point).toMatchObject({ type: 'point', scorer: 1 });
    expect(m.sides[1].score).toBe(1);
    expect(m.status).toBe('point');
    run(m, PADDLE.pointTicks);
    expect(m.status).toBe('serve');
    expect(m.server).toBe(serverFor(RULES, 0, 0, 1));
  });

  it('judges hits against recent paddle positions only within the lag allowance', () => {
    const make = (lag: number) => {
      const m = createMatch(RULES, 0);
      holdPaddle(m, 0, 150);
      // The paddle was at 450 a few ticks ago and has just moved away.
      m.sides[0].history = [150, 200, 260, 330, 400, 450];
      m.sides[0].target = 150;
      setLagTicks(m, 0, lag);
      inPlay(m, FACE_X[0] + 13, 450, -12, 0);
      run(m, 1);
      return m;
    };
    expect(make(0).sides[0].hits).toBe(0);
    expect(make(6).sides[0].hits).toBe(1);
    const capped = createMatch(RULES, 0);
    setLagTicks(capped, 0, 999);
    expect(capped.sides[0].lagTicks).toBe(PADDLE.historyTicks - 1);
  });
});

describe('paddle: winning', () => {
  it('first to target wins; with win-by-two a one-point lead is not enough', () => {
    expect(isGameWon(RULES, 7, 5)).toBe(true);
    expect(isGameWon(RULES, 7, 6)).toBe(false);
    expect(isGameWon(RULES, 8, 6)).toBe(true);
    expect(isGameWon({ ...RULES, winBy2: false }, 7, 6)).toBe(true);
    expect(isGameWon(RULES, 6, 0)).toBe(false);
  });

  it('declares the winner after the final point pause', () => {
    const m = createMatch({ target: 3, winBy2: false, speed: 'classic' }, 0);
    m.sides[0].score = 2;
    holdPaddle(m, 1, 150);
    inPlay(m, 1400, 700, 20, 0);
    const ev = run(m, 20);
    expect(ev.find((e) => e.type === 'point')).toMatchObject({ scorer: 0, gamePoint: false });
    expect(m.winner).toBe(0);
    expect(m.status).toBe('point');
    const done = run(m, PADDLE.pointTicks + 5);
    expect(done.find((e) => e.type === 'over')).toMatchObject({ winner: 0, reason: 'score' });
    expect(m.status).toBe('over');
    expect(run(m, 10)).toEqual([]);
  });

  it('flags game point', () => {
    const m = createMatch(RULES, 0);
    m.sides[0].score = 5;
    m.sides[1].score = 3;
    holdPaddle(m, 1, 150);
    inPlay(m, 1400, 700, 20, 0);
    const ev = run(m, 20);
    expect(ev.find((e) => e.type === 'point')).toMatchObject({ scorer: 0, gamePoint: true });
  });

  it('forfeit ends the game for the other side once', () => {
    const m = createMatch(RULES, 0);
    expect(forfeit(m, 0)).toEqual([{ type: 'over', winner: 1, reason: 'forfeit' }]);
    expect(m.status).toBe('over');
    expect(m.reason).toBe('forfeit');
    expect(forfeit(m, 1)).toEqual([]);
    expect(m.winner).toBe(1);
  });
});

describe('paddle: prediction helpers', () => {
  it('interceptY matches the simulated wall bounces', () => {
    const r = createSeededRng('intercept');
    for (let i = 0; i < 60; i++) {
      const m = createMatch(RULES, 0);
      holdPaddle(m, 0, 450);
      holdPaddle(m, 1, 450);
      const vy = (r.next() * 2 - 1) * 14;
      inPlay(m, 800, 100 + r.next() * 700, 9, vy);
      const pred = interceptY(m.ball.x, m.ball.y, m.ball.vx, m.ball.vy, FACE_X[1])!;
      expect(pred).not.toBeNull();
      // Step until the ball's leading edge reaches the face.
      // Park the right paddle far from the intercept so it can't touch the ball.
      holdPaddle(m, 1, pred.y > 450 ? PADDLE.paddleH / 2 : PADDLE.height - PADDLE.paddleH / 2);
      let guard = 0;
      while (m.ball.x + PADDLE.ballR < FACE_X[1] && guard++ < 400) stepMatch(m, r);
      const overshoot = m.ball.x + PADDLE.ballR - FACE_X[1];
      const yAtFace = m.ball.y - (m.ball.vy / m.ball.vx) * overshoot;
      expect(Math.abs(yAtFace - pred.y)).toBeLessThan(2);
    }
    expect(interceptY(800, 400, -5, 0, FACE_X[1])).toBeNull();
  });

  it('snapshots round-trip and reject malformed bytes', () => {
    const m = createMatch(RULES, 1);
    run(m, 200);
    const snap = snapshotOf(m, 42);
    const bytes = encodePaddleSnapshot(snap);
    const back = decodePaddleSnapshot(bytes)!;
    expect(back.matchId).toBe(42);
    expect(back.tick).toBe(m.tick);
    expect(back.status).toBe(m.status);
    expect(back.ball.x).toBeCloseTo(m.ball.x, 3);
    expect(back.paddles[1].y).toBeCloseTo(m.sides[1].y, 3);
    expect(decodePaddleSnapshot(bytes.slice(0, 20))).toBeNull();
    const bad = bytes.slice();
    bad[0] = 99;
    expect(decodePaddleSnapshot(bad)).toBeNull();
    const nan = bytes.slice();
    new DataView(nan.buffer).setFloat32(12, Number.NaN, true);
    expect(decodePaddleSnapshot(nan)).toBeNull();
    const mirror = applyPaddleSnapshot(null, back, RULES);
    expect(mirror.ball.x).toBe(back.ball.x);
    expect(mirror.status).toBe(back.status);
  });
});

describe('paddle: determinism and AI', () => {
  function aiGame(left: AiLevel, right: AiLevel, seed: string, rules: PaddleRules = RULES): PaddleMatch {
    const r = createSeededRng(seed);
    const m = createMatch(rules, (r.int(2) as Side));
    const a = createAi(left);
    const b = createAi(right);
    let guard = 0;
    while (m.status !== 'over' && guard++ < 60 * 60 * 30) {
      driveAi(m, 0, a, r);
      driveAi(m, 1, b, r);
      stepMatch(m, r);
    }
    return m;
  }

  it('is deterministic for the same seed', () => {
    const a = aiGame('pro', 'ace', 'det');
    const b = aiGame('pro', 'ace', 'det');
    expect(a.tick).toBe(b.tick);
    expect(a.sides[0].score).toBe(b.sides[0].score);
    expect(a.sides[1].score).toBe(b.sides[1].score);
    expect(a.ball).toEqual(b.ball);
  });

  it('AI games always finish, with legal scores', () => {
    for (let i = 0; i < 12; i++) {
      const levels: AiLevel[] = ['rookie', 'pro', 'ace', 'legend'];
      const m = aiGame(levels[i % 4]!, levels[(i + 1) % 4]!, `finish-${i}`);
      expect(m.status).toBe('over');
      const w = m.winner as Side;
      expect(isGameWon(RULES, m.sides[w].score, m.sides[w === 0 ? 1 : 0].score)).toBe(true);
    }
  });

  it('harder levels beat easier ones most of the time', () => {
    let legendWins = 0;
    let aceWins = 0;
    for (let i = 0; i < 10; i++) {
      if (aiGame('legend', 'rookie', `lr-${i}`, { target: 5, winBy2: false, speed: 'classic' }).winner === 0) legendWins++;
      if (aiGame('rookie', 'ace', `ra-${i}`, { target: 5, winBy2: false, speed: 'classic' }).winner === 1) aceWins++;
    }
    expect(legendWins).toBeGreaterThanOrEqual(8);
    expect(aceWins).toBeGreaterThanOrEqual(7);
  });

  it('legend vs legend produces real rallies (the AI returns the ball)', () => {
    const m = aiGame('legend', 'legend', 'rally', { target: 5, winBy2: false, speed: 'classic' });
    expect(m.longestRally).toBeGreaterThanOrEqual(4);
  });

  it('the AI never moves faster than the paddle cap', () => {
    const r = createSeededRng('cap');
    const m = createMatch(RULES, 0);
    const ai = createAi('legend');
    for (let i = 0; i < 2000 && m.status !== 'over'; i++) {
      driveAi(m, 1, ai, r);
      setTarget(m, 0, m.ball.y);
      const before = m.sides[1].y;
      stepMatch(m, r);
      expect(Math.abs(m.sides[1].y - before)).toBeLessThanOrEqual(PADDLE.paddleSpeed + 1e-9);
    }
  });
});
