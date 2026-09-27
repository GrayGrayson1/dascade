/**
 * Pixel Paddle — the pure, deterministic 1v1 paddle-and-ball simulation.
 *
 * Units are field units (1600 × 900) and everything is stepped per 60 Hz tick. Only
 * `+ - * /`, `Math.sqrt`, `Math.abs/min/max/floor/round` are used, so the server and
 * a predicting client produce bit-identical results on every JS engine.
 *
 * Rules
 *  - Serve: the ball rests on the serving paddle until the server launches it (min 0.4 s,
 *    auto after 3 s so an idle or dropped player can never stall the game). Serve alternates
 *    every two points; at deuce (both on target − 1 with win-by-two) it alternates every point.
 *  - The launch angle follows the serving paddle's motion (plus a small random wobble).
 *  - Ball angle off a paddle comes from where it hits (centre = flat, edge = steep, up to
 *    ±54°) plus a little "english" from the paddle's own motion.
 *  - Every paddle hit speeds the ball up (rally speed-up) until its top speed.
 *  - A ball past your goal line is a point for your opponent. First to `target` wins (by two
 *    clear points when `winBy2`).
 */
import type { Rng } from '@dascade/shared';

export const PADDLE = {
  tickRate: 60,
  width: 1600,
  height: 900,
  paddleH: 150,
  paddleW: 18,
  /** Gap between the goal line and the back of a paddle. */
  inset: 56,
  ballR: 11,
  /** Max paddle travel per tick (≈1440 units/s). */
  paddleSpeed: 24,
  /** tan(54°): the steepest bounce off a paddle edge. */
  maxBounceTan: 1.3763819204711736,
  /** How much paddle motion bends the bounce (as a share of the full edge angle). */
  english: 0.3,
  /** Extra forgiveness (units) either side of a paddle. */
  hitGrace: 6,
  /** Ticks a server must hold the ball before launching. */
  serveMinTicks: 24,
  /** Ticks after which the ball launches automatically. */
  serveAutoTicks: 180,
  /** Pause after a point (celebration) before the next serve. */
  pointTicks: 78,
  /** Distance between the serving paddle's face and the ball centre. */
  serveGap: 22,
  /** Paddle position history kept for lag-fair hit checks (ticks). */
  historyTicks: 8,
  /** Max substep length (units) for the swept ball move. */
  substep: 12,
} as const;

/** Front face x of each paddle (the side the ball bounces off). */
export const FACE_X: readonly [number, number] = [PADDLE.inset + PADDLE.paddleW, PADDLE.width - PADDLE.inset - PADDLE.paddleW];

export interface BallSpeedSpec {
  /** Serve speed (units/tick). */
  start: number;
  /** Top speed (units/tick). */
  max: number;
  /** Multiplicative speed-up per paddle hit. */
  gain: number;
}

export const BALL_SPEEDS: Record<'chill' | 'classic' | 'turbo', BallSpeedSpec> = {
  chill: { start: 9, max: 21, gain: 0.04 },
  classic: { start: 11.5, max: 27, gain: 0.05 },
  turbo: { start: 14, max: 33, gain: 0.06 },
};

export type Side = 0 | 1;
export type MatchStatus = 'serve' | 'play' | 'point' | 'over';

export interface PaddleRules {
  target: number;
  winBy2: boolean;
  speed: keyof typeof BALL_SPEEDS;
}

export interface PaddleSideState {
  y: number;
  /** Movement applied last tick (units/tick, signed). */
  vy: number;
  /** Where the controller wants the paddle. */
  target: number;
  score: number;
  hits: number;
  /** Serve requested and not yet consumed. */
  serveReq: boolean;
  /** Recent y positions, newest first (lag-fair hit checks). */
  history: number[];
  /** How many ticks of history this side may be judged against (0 = current position only). */
  lagTicks: number;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

export interface PaddleMatch {
  rules: PaddleRules;
  spec: BallSpeedSpec;
  tick: number;
  status: MatchStatus;
  /** Ticks spent in the current status. */
  timer: number;
  ball: BallState;
  sides: [PaddleSideState, PaddleSideState];
  firstServer: Side;
  server: Side;
  rally: number;
  longestRally: number;
  lastScorer: Side | -1;
  winner: Side | -1;
  reason: '' | 'score' | 'forfeit';
}

export type PaddleSimEvent =
  | { type: 'hit'; side: Side; rally: number; speed: number; offset: number; x: number; y: number }
  | { type: 'wall'; x: number; y: number }
  | { type: 'serve'; side: Side }
  | { type: 'point'; scorer: Side; rally: number; gamePoint: boolean }
  | { type: 'over'; winner: Side; reason: 'score' | 'forfeit' };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const HALF_H = PADDLE.paddleH / 2;
const MIN_Y = HALF_H;
const MAX_Y = PADDLE.height - HALF_H;

function createSide(): PaddleSideState {
  const mid = PADDLE.height / 2;
  return { y: mid, vy: 0, target: mid, score: 0, hits: 0, serveReq: false, history: [mid], lagTicks: 0 };
}

export function createMatch(rules: PaddleRules, firstServer: Side): PaddleMatch {
  const spec = BALL_SPEEDS[rules.speed] ?? BALL_SPEEDS.classic;
  const m: PaddleMatch = {
    rules: { ...rules, target: Math.max(1, Math.floor(rules.target)) },
    spec,
    tick: 0,
    status: 'serve',
    timer: 0,
    ball: { x: PADDLE.width / 2, y: PADDLE.height / 2, vx: 0, vy: 0, speed: spec.start },
    sides: [createSide(), createSide()],
    firstServer,
    server: firstServer,
    rally: 0,
    longestRally: 0,
    lastScorer: -1,
    winner: -1,
    reason: '',
  };
  placeBallOnServer(m);
  return m;
}

/** Steer a paddle (any number is clamped into the field). */
export function setTarget(m: PaddleMatch, side: Side, y: number): void {
  if (!Number.isFinite(y)) return;
  m.sides[side].target = clamp(y, MIN_Y, MAX_Y);
}

/** Ask to launch the ball (only meaningful for the side holding serve). */
export function requestServe(m: PaddleMatch, side: Side): void {
  if (m.status === 'serve' && m.server === side) m.sides[side].serveReq = true;
}

/** Ticks of paddle history a side may be judged against (bounded by PADDLE.historyTicks). */
export function setLagTicks(m: PaddleMatch, side: Side, ticks: number): void {
  m.sides[side].lagTicks = clamp(Math.floor(Number.isFinite(ticks) ? ticks : 0), 0, PADDLE.historyTicks - 1);
}

/** Whether a score line is a finished game under the rules. */
export function isGameWon(rules: PaddleRules, mine: number, theirs: number): boolean {
  return mine >= rules.target && (!rules.winBy2 || mine - theirs >= 2);
}

/** Next point would win the game for `side`. */
export function isGamePoint(m: PaddleMatch, side: Side): boolean {
  const mine = m.sides[side].score;
  const theirs = m.sides[side === 0 ? 1 : 0].score;
  return isGameWon(m.rules, mine + 1, theirs);
}

/** Who serves given the points played so far. */
export function serverFor(rules: PaddleRules, firstServer: Side, s0: number, s1: number): Side {
  const total = s0 + s1;
  const deuce = rules.winBy2 && s0 >= rules.target - 1 && s1 >= rules.target - 1;
  const swaps = deuce ? total : Math.floor(total / 2);
  return ((firstServer + swaps) % 2) as Side;
}

function placeBallOnServer(m: PaddleMatch): void {
  const side = m.server;
  const p = m.sides[side];
  const dir = side === 0 ? 1 : -1;
  m.ball.x = FACE_X[side] + dir * (PADDLE.ballR + PADDLE.serveGap);
  m.ball.y = p.y;
  m.ball.vx = 0;
  m.ball.vy = 0;
  m.ball.speed = m.spec.start;
}

/** Unit direction from a slope (dy per dx), pointing along +x or −x. */
function direction(tan: number, towardsRight: boolean): { dx: number; dy: number } {
  const n = Math.sqrt(1 + tan * tan);
  return { dx: (towardsRight ? 1 : -1) / n, dy: tan / n };
}

function launch(m: PaddleMatch, rng: Rng): void {
  const side = m.server;
  const p = m.sides[side];
  const motion = clamp(p.vy / PADDLE.paddleSpeed, -1, 1);
  const wobble = (rng.int(9) - 4) * 0.05;
  const t = clamp(motion * 0.55 + wobble, -0.6, 0.6) * PADDLE.maxBounceTan;
  const d = direction(t, side === 0);
  const speed = m.spec.start;
  m.ball.speed = speed;
  m.ball.vx = d.dx * speed;
  m.ball.vy = d.dy * speed;
  m.status = 'play';
  m.timer = 0;
  m.rally = 0;
  p.serveReq = false;
}

function movePaddles(m: PaddleMatch): void {
  for (const p of m.sides) {
    const dy = clamp(p.target - p.y, -PADDLE.paddleSpeed, PADDLE.paddleSpeed);
    p.y = clamp(p.y + dy, MIN_Y, MAX_Y);
    p.vy = dy;
    p.history.unshift(p.y);
    if (p.history.length > PADDLE.historyTicks) p.history.length = PADDLE.historyTicks;
  }
}

/** The paddle y (current or recent, within the side's lag allowance) that best meets a ball at `yc`. */
function bestPaddleY(p: PaddleSideState, yc: number): number {
  let best = p.y;
  let bestDist = Math.abs(yc - p.y);
  const n = Math.min(p.history.length, p.lagTicks + 1);
  for (let i = 1; i < n; i++) {
    const y = p.history[i]!;
    const d = Math.abs(yc - y);
    if (d < bestDist) {
      best = y;
      bestDist = d;
    }
  }
  return best;
}

function moveBall(m: PaddleMatch, events: PaddleSimEvent[]): void {
  const b = m.ball;
  const r = PADDLE.ballR;
  const steps = Math.max(1, Math.ceil(b.speed / PADDLE.substep));
  for (let s = 0; s < steps; s++) {
    const x0 = b.x;
    const y0 = b.y;
    let x1 = x0 + b.vx / steps;
    let y1 = y0 + b.vy / steps;
    if (y1 - r < 0) {
      y1 = 2 * r - y1;
      b.vy = -b.vy;
      events.push({ type: 'wall', x: x1, y: 0 });
    } else if (y1 + r > PADDLE.height) {
      y1 = 2 * (PADDLE.height - r) - y1;
      b.vy = -b.vy;
      events.push({ type: 'wall', x: x1, y: PADDLE.height });
    }
    // Swept test against the paddle the ball is travelling towards.
    const side: Side = b.vx < 0 ? 0 : 1;
    const face = FACE_X[side];
    const lead0 = side === 0 ? x0 - r : x0 + r;
    const lead1 = side === 0 ? x1 - r : x1 + r;
    const crossed = side === 0 ? lead0 >= face && lead1 < face : lead0 <= face && lead1 > face;
    if (crossed) {
      const t = (lead0 - face) / (lead0 - lead1);
      const yc = y0 + (y1 - y0) * t;
      const p = m.sides[side];
      const py = bestPaddleY(p, yc);
      const reach = HALF_H + r + PADDLE.hitGrace;
      if (Math.abs(yc - py) <= reach) {
        const offset = clamp((yc - py) / (HALF_H + r), -1, 1);
        const english = clamp(p.vy / PADDLE.paddleSpeed, -1, 1) * PADDLE.english;
        const tan = clamp(offset + english, -1, 1) * PADDLE.maxBounceTan;
        const speed = Math.min(m.spec.max, b.speed * (1 + m.spec.gain));
        const d = direction(tan, side === 0);
        b.speed = speed;
        b.vx = d.dx * speed;
        b.vy = d.dy * speed;
        const dirX = side === 0 ? 1 : -1;
        x1 = face + dirX * r;
        y1 = yc;
        m.rally++;
        p.hits++;
        if (m.rally > m.longestRally) m.longestRally = m.rally;
        events.push({ type: 'hit', side, rally: m.rally, speed, offset, x: x1, y: y1 });
      }
    }
    b.x = x1;
    b.y = clamp(y1, r, PADDLE.height - r);
    if (b.x < 0 || b.x > PADDLE.width) {
      scorePoint(m, b.x < 0 ? 1 : 0, events);
      return;
    }
  }
}

function scorePoint(m: PaddleMatch, scorer: Side, events: PaddleSimEvent[]): void {
  const other: Side = scorer === 0 ? 1 : 0;
  m.sides[scorer].score++;
  m.lastScorer = scorer;
  const won = isGameWon(m.rules, m.sides[scorer].score, m.sides[other].score);
  if (won) {
    m.winner = scorer;
    m.reason = 'score';
  }
  m.status = 'point';
  m.timer = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  events.push({ type: 'point', scorer, rally: m.rally, gamePoint: !won && (isGamePoint(m, 0) || isGamePoint(m, 1)) });
}

/** A player left: the other side wins immediately. */
export function forfeit(m: PaddleMatch, loser: Side): PaddleSimEvent[] {
  if (m.status === 'over') return [];
  const winner: Side = loser === 0 ? 1 : 0;
  m.winner = winner;
  m.reason = 'forfeit';
  m.status = 'over';
  m.timer = 0;
  m.ball.vx = 0;
  m.ball.vy = 0;
  return [{ type: 'over', winner, reason: 'forfeit' }];
}

/** Advance one fixed tick. */
export function stepMatch(m: PaddleMatch, rng: Rng): PaddleSimEvent[] {
  if (m.status === 'over') return [];
  const events: PaddleSimEvent[] = [];
  m.tick++;
  m.timer++;
  movePaddles(m);
  switch (m.status) {
    case 'serve': {
      placeBallOnServer(m);
      const p = m.sides[m.server];
      if ((p.serveReq && m.timer >= PADDLE.serveMinTicks) || m.timer >= PADDLE.serveAutoTicks) {
        launch(m, rng);
        events.push({ type: 'serve', side: m.server });
      }
      break;
    }
    case 'play':
      moveBall(m, events);
      break;
    case 'point':
      if (m.timer >= PADDLE.pointTicks) {
        if (m.winner !== -1) {
          m.status = 'over';
          m.timer = 0;
          events.push({ type: 'over', winner: m.winner, reason: 'score' });
        } else {
          m.server = serverFor(m.rules, m.firstServer, m.sides[0].score, m.sides[1].score);
          m.status = 'serve';
          m.timer = 0;
          m.sides[0].serveReq = false;
          m.sides[1].serveReq = false;
          placeBallOnServer(m);
        }
      }
      break;
  }
  return events;
}

/**
 * Where a ball travelling from (x, y) with velocity (vx, vy) meets the face plane `faceX`,
 * folding off the top and bottom walls. Returns null when it is moving away.
 */
export function interceptY(x: number, y: number, vx: number, vy: number, faceX: number): { y: number; ticks: number } | null {
  const r = PADDLE.ballR;
  const lead = vx < 0 ? x - r : x + r;
  const dist = faceX - lead;
  if (vx === 0 || dist / vx < 0) return null;
  const ticks = dist / vx;
  const span = PADDLE.height - 2 * r;
  const u = y - r + vy * ticks;
  const period = 2 * span;
  let w = u % period;
  if (w < 0) w += period;
  const folded = w <= span ? w : period - w;
  return { y: r + folded, ticks };
}
