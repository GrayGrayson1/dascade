/**
 * The house paddle: a beatable, human-feeling AI with four difficulty levels.
 *
 * It only ever *steers* (sets a target and asks to serve) through the same interface a
 * player uses, so it obeys the paddle speed cap. Human feel comes from:
 *  - reaction time: it re-plans a few ticks after the ball changes direction, not instantly;
 *  - a speed handicap on lower levels (its target moves slower than a human could);
 *  - aim error: a random miss-offset chosen per incoming ball (sometimes larger than the paddle);
 *  - prediction: Rookie chases the ball; higher levels read the wall bounces and aim their returns.
 */
import type { Rng } from '@dascade/shared';
import { FACE_X, PADDLE, clamp, interceptY, requestServe, setTarget, type PaddleMatch, type Side } from './sim.ts';

export type AiLevel = 'rookie' | 'pro' | 'ace' | 'legend';

export interface AiProfile {
  /** Share of the full paddle speed the AI will use. */
  speed: number;
  /** Ticks between a ball direction change and the AI reacting. */
  reaction: number;
  /** Max aim error (units) at the intercept on a clean read. */
  error: number;
  /** Chance of misjudging an incoming ball completely (at serve speed, and at top speed). */
  whiff: [number, number];
  /** Reads wall bounces (otherwise it just follows the ball). */
  predicts: boolean;
  /** How hard it tries to hit with the paddle edge (0 = centre only). */
  aim: number;
  /** Ticks it waits before serving (min, max). */
  serveWait: [number, number];
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  rookie: { speed: 0.55, reaction: 14, error: 60, whiff: [0.16, 0.42], predicts: false, aim: 0, serveWait: [50, 90] },
  pro: { speed: 0.75, reaction: 9, error: 45, whiff: [0.06, 0.2], predicts: true, aim: 0.35, serveWait: [40, 80] },
  ace: { speed: 0.9, reaction: 6, error: 32, whiff: [0.03, 0.1], predicts: true, aim: 0.6, serveWait: [30, 60] },
  legend: { speed: 1, reaction: 3, error: 18, whiff: [0.012, 0.045], predicts: true, aim: 0.8, serveWait: [24, 44] },
};

export interface AiBrain {
  level: AiLevel;
  profile: AiProfile;
  /** Tick the current plan was made for (ball direction sign × incoming). */
  planKey: number;
  /** Tick at which the pending plan becomes active. */
  reactAt: number;
  /** Planned paddle y. */
  plan: number;
  /** Planned offset from the ball (aim error + deliberate edge aim). */
  offset: number;
  /** Tick at which to serve. */
  serveAt: number;
  /** Serve wiggle direction. */
  wiggle: number;
}

export function createAi(level: AiLevel): AiBrain {
  return { level, profile: AI_PROFILES[level] ?? AI_PROFILES.pro, planKey: 0, reactAt: 0, plan: PADDLE.height / 2, offset: 0, serveAt: -1, wiggle: 1 };
}

function randRange(rng: Rng, lo: number, hi: number): number {
  return lo + rng.next() * (hi - lo);
}

/** Decide this tick's intent for `side` and apply it to the match. Call before stepMatch. */
export function driveAi(m: PaddleMatch, side: Side, brain: AiBrain, rng: Rng): void {
  const prof = brain.profile;
  const p = m.sides[side];
  const b = m.ball;
  const mid = PADDLE.height / 2;
  let desired: number;

  if (m.status === 'serve') {
    brain.planKey = 0;
    if (m.server === side) {
      if (brain.serveAt < 0) {
        brain.serveAt = m.tick + Math.round(randRange(rng, prof.serveWait[0], prof.serveWait[1]));
        brain.wiggle = rng.next() < 0.5 ? -1 : 1;
        brain.plan = clamp(mid + (rng.next() * 2 - 1) * 160, PADDLE.paddleH, PADDLE.height - PADDLE.paddleH);
      }
      desired = brain.plan;
      // Start moving just before the launch so the serve takes some angle.
      if (brain.serveAt - m.tick < 10) desired = p.y + brain.wiggle * PADDLE.paddleSpeed * 4;
      if (m.tick >= brain.serveAt) {
        requestServe(m, side);
        brain.serveAt = -1;
      }
    } else {
      brain.serveAt = -1;
      desired = mid;
    }
  } else if (m.status === 'play') {
    brain.serveAt = -1;
    const incoming = side === 0 ? b.vx < 0 : b.vx > 0;
    // A new plan whenever the ball turns towards or away from us (after the reaction delay).
    const key = incoming ? 1 + m.sides[0].hits + m.sides[1].hits : -1 - m.sides[0].hits - m.sides[1].hits;
    if (key !== brain.planKey) {
      brain.planKey = key;
      brain.reactAt = m.tick + prof.reaction;
      if (incoming) {
        const hit = prof.predicts ? interceptY(b.x, b.y, b.vx, b.vy, FACE_X[side]) : null;
        const baseY = hit ? hit.y : b.y;
        // How fast the rally is (0 at serve speed, 1 at top speed) makes every level shakier.
        const pace = clamp((b.speed - m.spec.start) / Math.max(1e-6, m.spec.max - m.spec.start), 0, 1);
        const whiff = rng.next() < prof.whiff[0] + (prof.whiff[1] - prof.whiff[0]) * pace;
        const reach = PADDLE.paddleH / 2 + PADDLE.ballR + PADDLE.hitGrace;
        const sign = rng.next() < 0.5 ? -1 : 1;
        // A whiff is a committed lunge to the wrong spot: always outside the paddle's reach.
        const err = whiff ? sign * (reach + 12 + rng.next() * 70) : (rng.next() * 2 - 1) * prof.error * (0.7 + pace * 0.6);
        // Aim: meet the ball off-centre so the return angles away from the opponent.
        const opp = m.sides[side === 0 ? 1 : 0];
        const oppHigh = opp.y < mid;
        const aimSign = oppHigh ? -1 : 1;
        const aim = whiff ? 0 : prof.aim * (0.4 + rng.next() * 0.6) * (PADDLE.paddleH / 2) * aimSign;
        brain.offset = err + aim;
        brain.plan = baseY + brain.offset;
      } else {
        // Drift back towards the middle while the ball is away.
        brain.plan = mid + (rng.next() * 2 - 1) * 60;
      }
    }
    if (m.tick < brain.reactAt) {
      desired = p.target;
    } else if (!prof.predicts && incoming) {
      // Chaser: keep following the ball, with its planned error baked in.
      desired = b.y + brain.offset;
    } else {
      desired = brain.plan;
    }
  } else {
    desired = mid;
  }

  // Speed handicap: the target can't run ahead of what this level could reach.
  const cap = PADDLE.paddleSpeed * prof.speed;
  const target = p.y + clamp(desired - p.y, -cap, cap);
  setTarget(m, side, target);
}
