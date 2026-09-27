/**
 * The claw machine Easter egg on the arcade floor — pure logic (no DOM; unit tested): the odds of a
 * try, the plan for one try and where the claw, and the toy it's after, are at any moment of it.
 * ClawMachine.tsx draws the poses. Units are the art's viewBox units; times are seconds.
 *
 * Purely cosmetic and local: nothing here is sent anywhere or touches a game.
 */

/** The claw machine's art box (ClawMachine.tsx viewBox) — shared with the floor layout without the art. */
export const CLAW_ART = { w: 152, h: 250, floor: 242 } as const;

export type ClawOutcome = 'win' | 'slip' | 'miss';

/** A toy's resting spot in the pile: its centre x and top y. */
export interface ToySpot {
  x: number;
  y: number;
}

/** A plush is 6 × 5 pixels at 2 units a pixel. */
export const TOY_W = 12;
export const TOY_H = 10;

/** The rig inside the glass. */
export const RIG = {
  /** Where the claw parks between tries (over the pile's right end). */
  homeX: 124,
  /** Over the prize chute (the glass's left end). */
  chuteX: 39,
  /** The claw head's top with the cable wound up. */
  hubY: 50,
  /** A held toy's top sits this far below the head's top (the prongs close round its lower half). */
  hold: 5,
  /** Past the glass floor: a toy dropped down the chute is out of sight by here. */
  chuteBottom: 166,
  /** Gantry travel (units a second). */
  speed: 72,
  /** Aim limits for the claw's centre (the glass's inner walls, clear of the chute). */
  minX: 58,
  maxX: 133,
} as const;

/** The pile: a bottom row of six and five on top of them, clear of the prize chute on the left. */
export const TOY_SPOTS: readonly ToySpot[] = [
  { x: 62.5, y: 136 },
  { x: 76, y: 136 },
  { x: 89.5, y: 136 },
  { x: 103, y: 136 },
  { x: 116.5, y: 136 },
  { x: 130, y: 136 },
  { x: 69.25, y: 127 },
  { x: 82.75, y: 127 },
  { x: 96.25, y: 127 },
  { x: 109.75, y: 127 },
  { x: 123.25, y: 127 },
];
const TOP_ROW_Y = 127;

/**
 * Chance to win by how many tries in a row have lost: a real claw's grip is set loose, but this one
 * is generous — and the fourth try in a row always pays out.
 */
export const WIN_ODDS = [0.34, 0.42, 0.55] as const;

export function clawOutcome(streak: number, r1: number, r2: number): ClawOutcome {
  const s = Math.max(0, Math.floor(streak));
  if (s >= WIN_ODDS.length) return 'win';
  if (r1 < WIN_ODDS[s]!) return 'win';
  // A loss is usually a heartbreaker (it lifts the toy, then lets it go) and sometimes a clean miss.
  return r2 < 0.6 ? 'slip' : 'miss';
}

export interface ClawPlan {
  outcome: ClawOutcome;
  /** The spot (index into TOY_SPOTS) of the toy it goes for. */
  toy: number;
  /** Where the claw drops (its centre x). */
  aimX: number;
  /** How far the head drops. */
  depth: number;
  /** Slip: how far through the lift (0‥1 of its time) the toy falls out. */
  slipAt: number;
  /** Phase lengths. */
  move: number;
  drop: number;
  grab: number;
  lift: number;
  carry: number;
  release: number;
  back: number;
  total: number;
  /** Win: when the prize lands in the chute (the moment to celebrate). */
  prizeAt: number;
}

const GRIP = 0.3;
/** The prongs' rest opening (0 shut, 1 wide open). */
export const IDLE_OPEN = 0.15;
const RELEASE_DELAY = 0.12;
const CHUTE_FALL = 0.34;
const SLIP_FALL = 0.34;
const SLIP_BOUNCE = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
/** Smooth in-out (quadratic). */
const ease = (p: number) => {
  const q = clamp(p, 0, 1);
  return q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q);
};

/** Plans one try at the toys on `present` spots. `rand` returns [0, 1). Null with nothing to grab. */
export function planClaw(present: readonly number[], streak: number, rand: () => number): ClawPlan | null {
  const spots = present.filter((i) => Number.isInteger(i) && i >= 0 && i < TOY_SPOTS.length);
  if (spots.length === 0) return null;
  const outcome = clawOutcome(streak, rand(), rand());
  // It usually goes for one on top of the pile.
  const top = spots.filter((i) => TOY_SPOTS[i]!.y === TOP_ROW_Y);
  const pool = top.length > 0 && rand() < 0.7 ? top : spots;
  const toy = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!;
  const spot = TOY_SPOTS[toy]!;
  const side = rand() < 0.5 ? -1 : 1;
  const off = outcome === 'miss' ? side * (6 + rand() * 2) : (rand() - 0.5) * 2;
  let aimX = clamp(spot.x + off, RIG.minX, RIG.maxX);
  // A miss squeezed against a wall lands on the other side of the toy instead.
  if (outcome === 'miss' && Math.abs(aimX - spot.x) < 5) aimX = clamp(spot.x - off, RIG.minX, RIG.maxX);
  const depth = spot.y - RIG.hold - RIG.hubY;
  const slipAt = 0.35 + rand() * 0.3;
  const move = 0.3 + Math.abs(aimX - RIG.homeX) / RIG.speed;
  const drop = 0.5 + depth / 110;
  const grab = 0.4;
  const lift = 0.45 + depth / 120;
  const win = outcome === 'win';
  const carry = win ? 0.3 + Math.abs(aimX - RIG.chuteX) / RIG.speed : 0;
  const release = win ? 0.6 : 0;
  const back = 0.3 + Math.abs((win ? RIG.chuteX : aimX) - RIG.homeX) / RIG.speed;
  const beforeRelease = move + drop + grab + lift + carry;
  return {
    outcome,
    toy,
    aimX,
    depth,
    slipAt,
    move,
    drop,
    grab,
    lift,
    carry,
    release,
    back,
    total: beforeRelease + release + back,
    prizeAt: win ? beforeRelease + RELEASE_DELAY + CHUTE_FALL : -1,
  };
}

export type ClawPhase = 'move' | 'drop' | 'grab' | 'lift' | 'carry' | 'release' | 'back' | 'done';

export interface ClawPose {
  phase: ClawPhase;
  /** The claw's centre x, how far the head has dropped, and the prongs' opening (0 shut … 1 open). */
  x: number;
  drop: number;
  open: number;
  /** The toy it's after while it's off its spot (centre x, top y); 'gone' once it's down the chute. */
  toy: { x: number; y: number } | 'gone' | null;
}

/** Where everything is `t` seconds into the try (clamped to the try). */
export function clawPose(plan: ClawPlan, t: number): ClawPose {
  const s = clamp(Number.isFinite(t) ? t : 0, 0, plan.total);
  const rig = rigAt(plan, s);
  return { ...rig, toy: toyAt(plan, s, rig) };
}

/** Phase start times. */
function marks(plan: ClawPlan) {
  const drop = plan.move;
  const grab = drop + plan.drop;
  const lift = grab + plan.grab;
  const carry = lift + plan.lift;
  const release = carry + plan.carry;
  const back = release + plan.release;
  return { drop, grab, lift, carry, release, back, slip: lift + plan.lift * plan.slipAt };
}

function rigAt(plan: ClawPlan, s: number): Omit<ClawPose, 'toy'> {
  const m = marks(plan);
  const grip = plan.outcome === 'miss' ? 0 : GRIP;
  if (s < m.drop) return { phase: 'move', x: lerp(RIG.homeX, plan.aimX, ease(s / plan.move)), drop: 0, open: IDLE_OPEN };
  if (s < m.grab) {
    const p = (s - m.drop) / plan.drop;
    return { phase: 'drop', x: plan.aimX, drop: plan.depth * ease(p), open: lerp(IDLE_OPEN, 1, clamp(p / 0.3, 0, 1)) };
  }
  if (s < m.lift) {
    const p = (s - m.grab) / (plan.grab * 0.7);
    return { phase: 'grab', x: plan.aimX, drop: plan.depth, open: lerp(1, grip, ease(p)) };
  }
  if (s < m.carry) {
    const p = (s - m.lift) / plan.lift;
    // A slipping toy jolts the prongs apart as it goes.
    const open = plan.outcome === 'slip' && s >= m.slip ? Math.min(0.6, grip + (s - m.slip) * 2.5) : grip;
    return { phase: 'lift', x: plan.aimX, drop: plan.depth * (1 - ease(p)), open };
  }
  const win = plan.outcome === 'win';
  if (win && s < m.release) {
    const p = (s - m.carry) / plan.carry;
    return { phase: 'carry', x: lerp(plan.aimX, RIG.chuteX, ease(p)), drop: 0, open: grip };
  }
  if (win && s < m.back) {
    const p = (s - m.release) / (plan.release * 0.4);
    return { phase: 'release', x: RIG.chuteX, drop: 0, open: lerp(grip, 1, ease(p)) };
  }
  const from = win ? RIG.chuteX : plan.aimX;
  const openFrom = win ? 1 : plan.outcome === 'slip' ? 0.6 : 0;
  if (s < plan.total) {
    const p = ease((s - m.back) / plan.back);
    return { phase: 'back', x: lerp(from, RIG.homeX, p), drop: 0, open: lerp(openFrom, IDLE_OPEN, p) };
  }
  return { phase: 'done', x: RIG.homeX, drop: 0, open: IDLE_OPEN };
}

function toyAt(plan: ClawPlan, s: number, rig: Omit<ClawPose, 'toy'>): ClawPose['toy'] {
  if (plan.outcome === 'miss') return null;
  const m = marks(plan);
  const spot = TOY_SPOTS[plan.toy]!;
  if (s < m.grab) return null;
  // The prongs close on it: it's pulled in under the head.
  if (s < m.lift) return { x: lerp(spot.x, plan.aimX, ease((s - m.grab) / plan.grab)), y: spot.y };
  const held = { x: rig.x, y: RIG.hubY + rig.drop + RIG.hold };
  if (plan.outcome === 'slip') {
    if (s < m.slip) return held;
    // It falls back onto the pile (sliding home as it goes) and bounces once.
    const y0 = RIG.hubY + plan.depth * (1 - ease(plan.slipAt)) + RIG.hold;
    const dt = s - m.slip;
    if (dt < SLIP_FALL) {
      const p = dt / SLIP_FALL;
      return { x: lerp(plan.aimX, spot.x, p), y: lerp(y0, spot.y, p * p) };
    }
    if (dt < SLIP_FALL + SLIP_BOUNCE) {
      const b = (dt - SLIP_FALL) / SLIP_BOUNCE;
      return { x: spot.x, y: spot.y - 10 * b * (1 - b) };
    }
    return null;
  }
  // Win: held through the lift and the carry, then let go over the chute.
  const fallFrom = m.release + RELEASE_DELAY;
  if (s < fallFrom) return held;
  const dt = s - fallFrom;
  if (dt < CHUTE_FALL) {
    const p = dt / CHUTE_FALL;
    return { x: RIG.chuteX, y: lerp(RIG.hubY + RIG.hold, RIG.chuteBottom, p * p) };
  }
  return 'gone';
}
