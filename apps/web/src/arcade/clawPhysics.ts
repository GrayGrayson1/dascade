/**
 * The claw machine's physics and grip model — pure, deterministic and DOM-free (unit tested in
 * clawPhysics.test.ts). ClawCloseup.tsx drives it with a fixed 120 Hz step and draws the state;
 * the floor machine (ClawMachine.tsx) draws the same pile flat.
 *
 * The world is the inside of the glass case, in centimetre-ish units: x runs left → right (0‥100),
 * z runs front → back (0‥60), y is height above the floor (the gantry rides at GANTRY.topY). The prize
 * chute is an open hole in the front-left corner; the claw parks over it.
 *
 * One try: insert a token → aim (a 20 s timer; the gantry has mass, so it accelerates and brakes) →
 * drop (commits: the gantry brakes to a stop and the cable pays out until the claw meets the pile or a
 * prong tip lands on something) → close → grip evaluated → lift → carry home → release over the chute.
 *
 * The grip is a small bespoke model, not a coin flip:
 *  - Each of the three prongs sweeps inward at the height its tip reached. It only gets purchase on a
 *    toy if it meets the toy's side on the way in, below the toy's waist (buried toys and neighbours
 *    keep the tips high, so they pinch instead of cradle), and glancing contact is weaker.
 *  - What holds is the *opposed* grip (the prongs' pushes cancel): Σq − |Σq·u|. A toy caught by one
 *    prong is just shoved or tilted; two prongs hang it off one side; three cradle it.
 *  - The hold scales with the toy's shape (a round blob grips better than a hard cube bot), the claw's
 *    weak coil (a per-try weakness draw), and it drops to CARRY_STRENGTH at the top of the lift, like a
 *    real machine's payout setting. Toys resting on the target pin it down at lift-off.
 *  - The load is the toy's weight plus the lift's acceleration, the jolt when the motor stops at the
 *    top and when the carry starts/stops, and the swing (the head hangs on a cable: gantry acceleration
 *    sets it swinging). An off-centre toy slides towards the edge of the prongs as the load bites, and
 *    goes when it gets there — or all at once if the load beats the hold.
 *  - A toy that falls lands where it falls: it can nudge its neighbours, roll off a slope, or — if it
 *    was already over the chute — drop in for a lucky win. The pile persists between tries.
 *
 * Randomness only through the state's own seed (mulberry32), so the same seed + inputs replay exactly.
 */

import {
  BOX,
  CHUTE,
  GANTRY,
  KINDS,
  freshToy,
  inChute,
  nextRandom,
  settleFully,
  settlePile,
  surfaceAt,
  topToyAt,
  type ClawToy,
  type ToyKind,
} from './clawPile.ts';

// The pile model lives in clawPile.ts (the floor needs it without the machine); re-exported for the
// close-up and the tests.
export * from './clawPile.ts';

export const CLAW = {
  /** Tip depth below the hub with the prongs open. */
  prong: 10,
  /** Tip radius from the claw's axis: wide open / fully shut. */
  openR: 9,
  closedR: 2,
  /** The hub's own footprint. */
  hubR: 3,
  /** Plush gives: the hub sinks this far into a toy before the cable goes slack… */
  sink: 1.5,
  /** …and an open prong tip pushes this far down between plushies. */
  tipSink: 3,
  dropSpeed: 30,
  liftSpeed: 24,
  cableAccel: 140,
  openTime: 0.3,
  closeTime: 0.5,
  topPause: 0.35,
  releaseTime: 0.7,
} as const;

/** The seconds you get to line up a try. */
export const AIM_TIME = 20;
export const DT = 1 / 120;
const G = 981;
/** The prongs' opening parked and while aiming. */
export const IDLE_OPEN = 0.2;
export const AIM_OPEN = 0.72;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);

/** The claw's strength and the payout loosening at the top of the lift. */
export const STRENGTH = 0.9;
export const CARRY_STRENGTH = 0.85;
/** The machine's "payout setting": a slightly stronger coil after a run of misses (honest, capped). */
export function payoutBonus(misses: number): number {
  const m = Number.isFinite(misses) ? Math.max(0, Math.floor(misses)) : 0;
  return m < 3 ? 0 : Math.min(0.15, (m - 2) * 0.05);
}

// ---------------------------------------------------------------------------------------------------
// The machine

export type ClawPhase = 'idle' | 'aim' | 'drop' | 'close' | 'lift' | 'top' | 'carry' | 'release' | 'settle';
export type ClawResult = 'win' | 'slip' | 'miss';
export type SlipCause = 'liftoff' | 'jolt' | 'swing' | 'slide' | 'weak';

export interface ProngContact {
  /** Purchase 0‥1 this prong got. */
  q: number;
  /** Where its tip ended (floor coords) — for drawing the prong closed on the toy. */
  r: number;
}

export interface GripReport {
  toy: number | null;
  prongs: [number, number, number];
  /** Opposed grip (Σq − |Σq·u|), 0‥3. */
  opposed: number;
  /** Horizontal distance of the claw's axis from the toy's centre at the drop. */
  offset: number;
  /** Weight pinning it down (toys resting on it, neighbours pressed against it). */
  buried: number;
  /** Hold ÷ load at lift-off. */
  margin: number;
  quality: 'great' | 'good' | 'weak' | 'nudge' | 'none';
  /** How many prong tips came down on other plushies (they stop high and pinch instead of cradle). */
  onNeighbours: number;
  /** The tips ended above the target's waist (they never got under it). */
  tipsHigh: boolean;
}

/**
 * Why a try came up empty — what the machine shows on its LED line, so a miss is explainable:
 * nothing under the claw, a one-prong shove, tips caught on a neighbour, a buried plush, an off-centre
 * grab, a weak coil, or — once it was up — a jolt, a swing, a slide, or a drop right by the chute.
 */
export type MissCause =
  'nothing' | 'shove' | 'neighbour' | 'buried' | 'offcentre' | 'weak' | 'shook' | 'swung' | 'slid' | 'dropped' | 'chute';

export interface HeldToy {
  id: number;
  /** Offset of its centre from the claw's axis (slides as the load bites). */
  ox: number;
  oz: number;
  /** Its bottom relative to the prong tips. */
  dy: number;
  hold0: number;
  /** Per-try coil weakness draw. */
  weak: number;
  /** A transient extra load (jolts), decaying. */
  jolt: number;
  /** Seconds held — the lift-off check happens once, early. */
  age: number;
  liftedOff: boolean;
}

export type ClawEvent =
  | { type: 'token' }
  | { type: 'tick'; left: number }
  | { type: 'bump' }
  | { type: 'drop'; auto: boolean }
  | { type: 'touch'; onToy: boolean }
  | { type: 'close' }
  | { type: 'grip'; report: GripReport }
  | { type: 'lifted'; toy: number }
  | { type: 'top' }
  | { type: 'carry' }
  | { type: 'slip'; toy: number; cause: SlipCause }
  | { type: 'land'; toy: number; hard: boolean }
  | { type: 'jostle'; toys: number[] }
  | { type: 'release' }
  | { type: 'chute'; toy: number }
  | { type: 'win'; toy: ClawToy }
  | { type: 'done'; result: ClawResult; cause: MissCause | null };

export interface ClawInput {
  /** Joystick, −1‥1 each (x right, z back). */
  x: number;
  z: number;
  drop: boolean;
}

export interface ClawSim {
  seed: number;
  phase: ClawPhase;
  /** Seconds into the phase. */
  t: number;
  /** Aim seconds left. */
  timer: number;
  gx: number;
  gz: number;
  vx: number;
  vz: number;
  /** Last gantry acceleration (drives the swing). */
  ax: number;
  az: number;
  /** The head's swing: offset from under the trolley and its velocity. */
  sx: number;
  sz: number;
  svx: number;
  svz: number;
  hubY: number;
  vy: number;
  /** Prong opening, 0 shut ‥ 1 wide open. */
  open: number;
  /** Where the prongs stop closing (a toy in the way). */
  openStop: number;
  toys: ClawToy[];
  nextId: number;
  held: HeldToy | null;
  grip: GripReport | null;
  /** This try: had a toy up, and how it ended. */
  hadToy: boolean;
  won: boolean;
  result: ClawResult | null;
  /** Consecutive tries without a win (payout setting). */
  misses: number;
  /** Test/tuning hook: multiplies the claw's strength (1 = as built). */
  strengthScale: number;
  /** Why this try failed (set as it goes; final at 'done'). */
  cause: MissCause | null;
  /** The toy that slipped after lift-off, and why (for 'chute' vs the slip's own cause). */
  slipped: { toy: number; cause: SlipCause } | null;
}

export function createSim(toys: ClawToy[], seed: number, misses = 0): ClawSim {
  const nextId = toys.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  return {
    seed: seed | 0,
    phase: 'idle',
    t: 0,
    timer: AIM_TIME,
    gx: GANTRY.homeX,
    gz: GANTRY.homeZ,
    vx: 0,
    vz: 0,
    ax: 0,
    az: 0,
    sx: 0,
    sz: 0,
    svx: 0,
    svz: 0,
    hubY: GANTRY.topY,
    vy: 0,
    open: 0.2,
    openStop: 0,
    toys,
    nextId,
    held: null,
    grip: null,
    hadToy: false,
    won: false,
    result: null,
    misses: Math.max(0, Math.floor(misses) || 0),
    strengthScale: 1,
    cause: null,
    slipped: null,
  };
}

/** Starts a try (a free token). False when a try is already on or there's nothing to grab. */
export function insertToken(sim: ClawSim, events: ClawEvent[] = []): boolean {
  if (sim.phase !== 'idle') return false;
  if (!sim.toys.some((t) => t.mode === 'pile' || t.mode === 'fall')) return false;
  for (const t of sim.toys) t.fresh = undefined;
  sim.phase = 'aim';
  sim.t = 0;
  sim.timer = AIM_TIME;
  sim.grip = null;
  sim.hadToy = false;
  sim.won = false;
  sim.result = null;
  sim.cause = null;
  sim.slipped = null;
  events.push({ type: 'token' });
  return true;
}

/** Hands the token back (closing the machine before dropping): nothing happened. */
export function cancelAim(sim: ClawSim): boolean {
  if (sim.phase !== 'aim') return false;
  sim.phase = 'idle';
  sim.t = 0;
  sim.timer = AIM_TIME;
  return true;
}

/** The claw head's position (trolley + swing). */
export function headPos(sim: ClawSim): { x: number; z: number } {
  return { x: sim.gx + sim.sx, z: sim.gz + sim.sz };
}

const PRONG_DIRS: readonly [number, number][] = [
  // 90°, 210°, 330°: one prong at the back, two at the front corners (as seen from the player).
  [0, 1],
  [-0.8660254, -0.5],
  [0.8660254, -0.5],
];

/** Where the prong tips come down with the claw wide open, around a head at (hx, hz). */
export function prongTips(hx: number, hz: number, r: number = CLAW.openR): [number, number][] {
  return PRONG_DIRS.map(([ux, uz]) => [hx + ux * r, hz + uz * r]);
}

/** Where the claw would stop if dropped right here (for the renderer's aiming marks). */
export function contactHeight(sim: ClawSim, hx = headPos(sim).x, hz = headPos(sim).z): number {
  let hub = -Infinity;
  for (const [ox, oz] of [
    [0, 0],
    [CLAW.hubR, 0],
    [-CLAW.hubR, 0],
    [0, CLAW.hubR],
    [0, -CLAW.hubR],
  ] as const)
    hub = Math.max(hub, surfaceAt(sim.toys, hx + ox, hz + oz) - CLAW.sink);
  let tip = -Infinity;
  for (const [tx, tz] of prongTips(hx, hz)) tip = Math.max(tip, surfaceAt(sim.toys, tx, tz) - CLAW.tipSink + CLAW.prong);
  // Never above the gantry (a hand-stacked pile can't jam the drop).
  return Math.min(GANTRY.topY - 2, Math.max(hub, tip, CLAW.prong));
}

/**
 * The grip the prongs get closing at the head's current spot and height — pure (reads the sim).
 * Picks the toy with the best opposed grip.
 */
export function evaluateGrip(sim: ClawSim): GripReport {
  const { x: hx, z: hz } = headPos(sim);
  const tipY = sim.hubY - CLAW.prong;
  let best: GripReport = {
    toy: null,
    prongs: [0, 0, 0],
    opposed: 0,
    offset: Infinity,
    buried: 0,
    margin: 0,
    quality: 'none',
    onNeighbours: 0,
    tipsHigh: false,
  };
  let bestScore = 0;
  for (const t of sim.toys) {
    if (t.mode !== 'pile') continue;
    const k = KINDS[t.kind];
    const cx = t.x - hx;
    const cz = t.z - hz;
    const dist = hyp(cx, cz);
    if (dist > CLAW.openR + k.r) continue;
    if (tipY > t.y + k.h - 0.5) continue; // the tips never got down beside it
    const waist = t.y + k.h * k.waist;
    const depth = clamp((waist - tipY) / (k.h * 0.35) + 0.5, 0, 1);
    const q: [number, number, number] = [0, 0, 0];
    let vx = 0;
    let vz = 0;
    let sum = 0;
    PRONG_DIRS.forEach(([ux, uz], i) => {
      const along = cx * ux + cz * uz;
      const perp = Math.abs(cx * uz - cz * ux);
      if (perp >= k.r) return;
      const e = along + Math.sqrt(k.r * k.r - perp * perp);
      if (e < CLAW.closedR) return; // closes past it
      const lateral = 1 - 0.6 * (perp / k.r) * (perp / k.r);
      // Tip came down on top of it rather than beside it: a poke, not a hook.
      const qi = e > CLAW.openR + 0.8 ? 0.2 * depth * lateral : depth * lateral;
      q[i] = qi;
      sum += qi;
      vx += qi * ux;
      vz += qi * uz;
    });
    const opposed = Math.max(0, sum - hyp(vx, vz));
    const score = opposed + sum * 0.01 + t.y * 0.0001;
    if (score > bestScore) {
      bestScore = score;
      best = {
        toy: t.id,
        prongs: q,
        opposed,
        offset: dist,
        buried: buriedLoad(sim.toys, t),
        margin: 0,
        quality: 'none',
        onNeighbours: 0,
        tipsHigh: tipY > waist,
      };
    }
  }
  const target = best.toy;
  // Which tips came down on another plush (higher than where they'd have hooked the target).
  for (const [tx, tz] of prongTips(hx, hz)) {
    const under = topToyAt(sim.toys, tx, tz);
    if (under && under.id !== target && surfaceAt(sim.toys, tx, tz) - CLAW.tipSink > tipY - 0.6) best.onNeighbours++;
  }
  if (target === null) return best;
  const t = sim.toys.find((x) => x.id === target)!;
  const k = KINDS[t.kind];
  const hold = holdStrength(sim, best.opposed, t.kind) * comFactor(best.offset, k.r);
  best.margin = hold / (k.mass + best.buried);
  best.quality = best.opposed < 0.15 ? 'nudge' : best.margin >= 2.2 ? 'great' : best.margin >= 1.6 ? 'good' : 'weak';
  return best;
}

/** Why a grab that never came up failed (pure; from the grip report). */
export function grabCause(g: GripReport, r: number): MissCause {
  if (g.toy === null) return g.onNeighbours > 0 ? 'neighbour' : 'nothing';
  if (g.quality === 'nudge') return g.onNeighbours > 0 && g.tipsHigh ? 'neighbour' : 'shove';
  if (g.buried >= 0.35) return 'buried';
  if (g.onNeighbours > 0 && (g.tipsHigh || g.prongs.some((q) => q < 0.45))) return 'neighbour';
  if (g.offset > r * 0.35) return 'offcentre';
  return 'weak';
}

/** Why a plush that was up came out (pure). `nearChute`: it came down right beside the chute. */
export function slipCause(cause: SlipCause, nearChute: boolean): MissCause {
  if (nearChute) return 'chute';
  return cause === 'jolt' ? 'shook' : cause === 'swing' ? 'swung' : cause === 'slide' ? 'slid' : 'dropped';
}

/**
 * Grabbed away from its centre of mass, a plush wants to rotate out of the prongs: the hold falls off
 * with the square of the offset (the biggest single factor in the model).
 */
export function comFactor(offset: number, r: number): number {
  const f = Math.min(1, Math.max(0, offset) / r);
  return 1 - 0.75 * f * f;
}

function holdStrength(sim: ClawSim, opposed: number, kind: ToyKind): number {
  return opposed * KINDS[kind].grip * STRENGTH * (1 + payoutBonus(sim.misses)) * sim.strengthScale;
}

/** Weight pinning a toy: toys resting on it, and a little friction from neighbours pressed against it. */
export function buriedLoad(toys: readonly ClawToy[], t: ClawToy): number {
  const k = KINDS[t.kind];
  let load = 0;
  for (const o of toys) {
    if (o.id === t.id || o.mode !== 'pile') continue;
    const ko = KINDS[o.kind];
    const d = hyp(o.x - t.x, o.z - t.z);
    const lim = (k.r + ko.r) * 0.8;
    if (d >= lim) continue;
    if (o.y >= t.y + k.h * 0.4) load += ko.mass * (1 - d / lim) * 1.4;
    else if (Math.abs(o.y - t.y) < k.h * 0.4) load += ko.mass * 0.12;
  }
  return load;
}

// ---------------------------------------------------------------------------------------------------
// Step

/** Advances the machine one fixed step (DT). Mutates `sim`; appends what happened to `events`. */
export function stepClaw(sim: ClawSim, input: ClawInput, events: ClawEvent[]): void {
  const dt = DT;
  sim.t += dt;
  const pvx = sim.vx;
  const pvz = sim.vz;
  switch (sim.phase) {
    case 'idle':
      brakeGantry(sim, dt);
      sim.open = approach(sim.open, IDLE_OPEN, dt * 2);
      break;
    case 'aim': {
      // The prongs hang open while you aim, so the grab's footprint reads.
      sim.open = approach(sim.open, AIM_OPEN, dt * 2.5);
      const before = Math.ceil(sim.timer);
      sim.timer = Math.max(0, sim.timer - dt);
      const after = Math.ceil(sim.timer);
      if (after !== before && after <= 5 && after > 0) events.push({ type: 'tick', left: after });
      driveGantry(sim, clamp(finite(input.x), -1, 1), clamp(finite(input.z), -1, 1), dt, events);
      if (input.drop || sim.timer <= 0) {
        sim.phase = 'drop';
        sim.t = 0;
        events.push({ type: 'drop', auto: !input.drop });
      }
      break;
    }
    case 'drop': {
      brakeGantry(sim, dt);
      sim.open = Math.min(1, sim.open + dt / CLAW.openTime);
      sim.vy = Math.max(-CLAW.dropSpeed, sim.vy - CLAW.cableAccel * dt);
      sim.hubY += sim.vy * dt;
      const stop = contactHeight(sim);
      if (sim.hubY <= stop && sim.open >= 0.999) {
        sim.hubY = Math.max(sim.hubY, stop - 0.5);
        sim.vy = 0;
        sim.phase = 'close';
        sim.t = 0;
        const { x, z } = headPos(sim);
        events.push({ type: 'touch', onToy: surfaceAt(sim.toys, x, z) > 0.5 });
        events.push({ type: 'close' });
        startClose(sim, events);
      } else if (sim.hubY <= stop) sim.hubY = stop;
      break;
    }
    case 'close': {
      brakeGantry(sim, dt);
      sim.open = Math.max(sim.openStop, sim.open - dt / CLAW.closeTime);
      if (sim.t >= CLAW.closeTime + 0.1) {
        sim.phase = 'lift';
        sim.t = 0;
      }
      break;
    }
    case 'lift': {
      brakeGantry(sim, dt);
      sim.vy = Math.min(CLAW.liftSpeed, sim.vy + CLAW.cableAccel * dt);
      sim.hubY += sim.vy * dt;
      if (sim.hubY >= GANTRY.topY) {
        sim.hubY = GANTRY.topY;
        sim.vy = 0;
        sim.phase = 'top';
        sim.t = 0;
        events.push({ type: 'top' });
        // The motor stops with a clunk, and the coil drops to its carry strength.
        if (sim.held) sim.held.jolt += jolt(sim, 0.08, 0.3);
      }
      break;
    }
    case 'top':
      brakeGantry(sim, dt);
      if (sim.t >= CLAW.topPause) {
        sim.phase = 'carry';
        sim.t = 0;
        events.push({ type: 'carry' });
        if (sim.held) sim.held.jolt += jolt(sim, 0.05, 0.22);
      }
      break;
    case 'carry': {
      const arrived = carryHome(sim, dt);
      if (arrived) {
        if (sim.held) sim.held.jolt += jolt(sim, 0.05, 0.22);
        sim.phase = 'release';
        sim.t = 0;
      }
      break;
    }
    case 'release': {
      brakeGantry(sim, dt);
      if (sim.t >= 0.12) {
        if (sim.open < 0.99 && sim.t - dt < 0.12) events.push({ type: 'release' });
        sim.openStop = 0;
        sim.open = Math.min(1, sim.open + dt / 0.3);
        if (sim.held) letGo(sim);
      }
      if (sim.t >= CLAW.releaseTime) {
        sim.phase = 'settle';
        sim.t = 0;
      }
      break;
    }
    case 'settle': {
      brakeGantry(sim, dt);
      sim.open = Math.max(0.2, sim.open - dt / 0.6);
      const busy = sim.toys.some((t) => t.mode === 'fall' || t.mode === 'chute');
      if (!busy && sim.t >= 0.5) {
        sim.result = sim.won ? 'win' : sim.hadToy ? 'slip' : 'miss';
        sim.misses = sim.won ? 0 : sim.misses + 1;
        if (sim.won) sim.cause = null;
        else if (sim.slipped) {
          const t = sim.toys.find((x) => x.id === sim.slipped!.toy);
          const near = !!t && t.x < CHUTE.x1 + 12 && t.z < CHUTE.z1 + 12;
          sim.cause = slipCause(sim.slipped.cause, near);
        } else if (!sim.cause) sim.cause = sim.grip ? grabCause(sim.grip, 6) : 'nothing';
        sim.phase = 'idle';
        sim.t = 0;
        sim.open = 0.2;
        events.push({ type: 'done', result: sim.result, cause: sim.cause });
      }
      break;
    }
  }
  sim.ax = (sim.vx - pvx) / dt;
  sim.az = (sim.vz - pvz) / dt;
  swing(sim, dt);
  if (sim.held) holdStep(sim, dt, events);
  fallStep(sim, dt, events);
}

/** A motor jolt: usually mild, now and then a hard clunk (the worst moment to be holding on loosely). */
function jolt(sim: ClawSim, base: number, spread: number): number {
  const r = nextRandom(sim);
  return base + spread * r + (nextRandom(sim) < 0.1 ? 1.1 : 0);
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

function approach(v: number, target: number, rate: number): number {
  return v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
}

function driveGantry(sim: ClawSim, ix: number, iz: number, dt: number, events: ClawEvent[]): void {
  const axis = (v: number, i: number) => {
    const target = i * GANTRY.maxSpeed;
    const speeding = Math.abs(target) > Math.abs(v) && target * v >= 0;
    return approach(v, target, (speeding ? GANTRY.accel : GANTRY.brake) * dt);
  };
  sim.vx = axis(sim.vx, ix);
  sim.vz = axis(sim.vz, iz);
  moveGantry(sim, dt, events);
}

function brakeGantry(sim: ClawSim, dt: number): void {
  sim.vx = approach(sim.vx, 0, GANTRY.brake * dt);
  sim.vz = approach(sim.vz, 0, GANTRY.brake * dt);
  moveGantry(sim, dt, null);
}

function moveGantry(sim: ClawSim, dt: number, events: ClawEvent[] | null): void {
  let bumped = false;
  sim.gx += sim.vx * dt;
  sim.gz += sim.vz * dt;
  if (sim.gx < GANTRY.minX || sim.gx > GANTRY.maxX) {
    bumped ||= Math.abs(sim.vx) > 6;
    sim.gx = clamp(sim.gx, GANTRY.minX, GANTRY.maxX);
    sim.vx = 0;
  }
  if (sim.gz < GANTRY.minZ || sim.gz > GANTRY.maxZ) {
    bumped ||= Math.abs(sim.vz) > 6;
    sim.gz = clamp(sim.gz, GANTRY.minZ, GANTRY.maxZ);
    sim.vz = 0;
  }
  if (bumped && events) events.push({ type: 'bump' });
}

/** Drives home on a trapezoid profile (accelerate, cruise, brake to a stop on the spot). */
function carryHome(sim: ClawSim, dt: number): boolean {
  const axis = (pos: number, v: number, home: number) => {
    const d = home - pos;
    const want = Math.sign(d) * Math.min(GANTRY.carrySpeed, Math.sqrt(2 * GANTRY.carryAccel * 0.8 * Math.abs(d)));
    return approach(v, want, GANTRY.carryAccel * dt);
  };
  sim.vx = axis(sim.gx, sim.vx, GANTRY.homeX);
  sim.vz = axis(sim.gz, sim.vz, GANTRY.homeZ);
  moveGantry(sim, dt, null);
  const close = Math.abs(sim.gx - GANTRY.homeX) < 0.3 && Math.abs(sim.gz - GANTRY.homeZ) < 0.3;
  if (close && Math.abs(sim.vx) < 2 && Math.abs(sim.vz) < 2) {
    sim.gx = GANTRY.homeX;
    sim.gz = GANTRY.homeZ;
    sim.vx = 0;
    sim.vz = 0;
    return true;
  }
  return false;
}

/** The head hangs on its cable: a damped pendulum driven by the trolley's acceleration. */
function swing(sim: ClawSim, dt: number): void {
  const len = Math.max(6, GANTRY.topY + 6 - sim.hubY);
  const k = G / len;
  const damp = sim.held ? 1.6 : 2.2;
  sim.svx += (-k * sim.sx - sim.ax - damp * sim.svx) * dt;
  sim.svz += (-k * sim.sz - sim.az - damp * sim.svz) * dt;
  sim.sx += sim.svx * dt;
  sim.sz += sim.svz * dt;
  const lim = 6;
  sim.sx = clamp(sim.sx, -lim, lim);
  sim.sz = clamp(sim.sz, -lim, lim);
}

function startClose(sim: ClawSim, events: ClawEvent[]): void {
  const report = evaluateGrip(sim);
  sim.grip = report;
  const t = report.toy !== null ? sim.toys.find((x) => x.id === report.toy) : undefined;
  // The prongs stop where they meet the toy.
  sim.openStop = t ? clamp(0.1 + (report.opposed / 3) * 0.35, 0.08, 0.5) : 0;
  events.push({ type: 'grip', report });
  const { x: hx, z: hz } = headPos(sim);
  if (!t) {
    // Closing on nothing it could hold — but prongs pushed into the pile still stir it up.
    sim.cause = grabCause(report, 6);
    if (surfaceAt(sim.toys, hx, hz) > 0.5 || report.onNeighbours > 0) jostle(sim, hx, hz, 1.6, -1, events);
    return;
  }
  const k = KINDS[t.kind];
  if (report.quality === 'nudge') {
    // One prong shoves it: dragged a little towards the axis, tilted, left in the pile.
    sim.cause = grabCause(report, k.r);
    const d = Math.max(0.001, hyp(t.x - hx, t.z - hz));
    const push = Math.min(3, d * 0.35);
    t.x -= ((t.x - hx) / d) * push;
    t.z -= ((t.z - hz) / d) * push;
    t.tilt = ((t.x - hx) / d) * 0.35;
    jostle(sim, hx, hz, 1.4, t.id, events);
    return;
  }
  // Squeezed towards the axis: an opposed grip centres it, a lopsided one leaves it hanging off a side.
  const sum = report.prongs[0] + report.prongs[1] + report.prongs[2];
  const centre = clamp(report.opposed / Math.max(0.001, sum), 0, 1) * 0.5;
  const ox = (t.x - hx) * (1 - centre);
  const oz = (t.z - hz) * (1 - centre);
  const tipY = sim.hubY - CLAW.prong;
  sim.held = {
    id: t.id,
    ox,
    oz,
    dy: t.y - tipY,
    hold0: holdStrength(sim, report.opposed, t.kind) * comFactor(report.offset, k.r),
    weak: 0.55 + 0.6 * nextRandom(sim),
    jolt: 0,
    age: 0,
    liftedOff: false,
  };
  t.mode = 'held';
  t.vx = t.vy = t.vz = 0;
  t.tilt = 0;
}

const DIRS8: readonly [number, number][] = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

/**
 * A failed grab stirs the pile: the prongs closing into it shove the plushies round (x, z) outward a
 * little, so the next try faces a changed pile instead of the same failure again.
 */
function jostle(sim: ClawSim, cx: number, cz: number, strength: number, skip: number, events: ClawEvent[]): void {
  const moved: number[] = [];
  for (const o of sim.toys) {
    if (o.mode !== 'pile' || o.id === skip) continue;
    const dx = o.x - cx;
    const dz = o.z - cz;
    const d = hyp(dx, dz);
    if (d > 14) continue;
    let ux = dx / Math.max(0.001, d);
    let uz = dz / Math.max(0.001, d);
    if (d < 0.3) [ux, uz] = DIRS8[Math.floor(nextRandom(sim) * 8) % 8]!;
    const k = strength * (1 - d / 14) * (0.6 + 0.8 * nextRandom(sim));
    o.x += ux * k + (nextRandom(sim) - 0.5) * k * 0.8;
    o.z += uz * k + (nextRandom(sim) - 0.5) * k * 0.8;
    moved.push(o.id);
  }
  settlePile(sim.toys);
  if (moved.length) events.push({ type: 'jostle', toys: moved });
}

/** The held toy: follows the head; the load bites; it slides and maybe goes. */
function holdStep(sim: ClawSim, dt: number, events: ClawEvent[]): void {
  const h = sim.held!;
  const t = sim.toys.find((x) => x.id === h.id);
  if (!t) {
    sim.held = null;
    return;
  }
  const k = KINDS[t.kind];
  h.age += dt;
  h.jolt *= 1 - Math.min(1, dt * 7);
  const lifting = sim.phase === 'lift' || sim.phase === 'top' || sim.phase === 'carry' || sim.phase === 'release';
  const off = hyp(h.ox, h.oz);
  const offFrac = off / k.r;
  // The coil: full while closing and lifting, loosened to the carry setting once at the top.
  const carry = sim.phase === 'top' || sim.phase === 'carry' || sim.phase === 'release';
  const hold = h.hold0 * h.weak * (carry ? CARRY_STRENGTH : 1) * (1 - 0.45 * offFrac * offFrac);
  const up = sim.phase === 'lift' ? Math.max(0, sim.vy < CLAW.liftSpeed ? CLAW.cableAccel : 0) : 0;
  const swingSpeed2 = sim.svx * sim.svx + sim.svz * sim.svz;
  const len = Math.max(6, GANTRY.topY + 6 - sim.hubY);
  const accH = hyp(sim.ax, sim.az);
  const load = k.mass * (1 + up / G + h.jolt + (0.6 * accH) / G + (swingSpeed2 / (len * G)) * 2);
  if (!h.liftedOff && sim.phase === 'lift' && sim.t > 0.15) {
    // Lift-off: whatever rests on it (or presses against it) has to be torn away too.
    h.liftedOff = true;
    const pinned = buriedLoad(sim.toys, t);
    if (h.hold0 * h.weak < (k.mass + pinned) * 0.95) {
      // It won't come up: the prongs slide off it, it tumbles back and knocks its neighbours about.
      if (sim.grip) sim.cause = grabCause(sim.grip, k.r);
      slip(sim, t, 'liftoff', events);
      const [ux, uz] = DIRS8[Math.floor(nextRandom(sim) * 8) % 8]!;
      const v = 10 + 12 * nextRandom(sim);
      t.vx = ux * v;
      t.vz = uz * v;
      t.vy = 35;
      jostle(sim, t.x, t.z, 1.2, t.id, events);
      return;
    }
    events.push({ type: 'lifted', toy: t.id });
    // What sat on it tumbles off into the gap.
    settlePile(sim.toys);
  }
  if (!h.liftedOff) {
    // Still closing / just starting up: it comes with the claw (or not) at lift-off.
    placeHeld(sim, t, h);
    return;
  }
  if (load > hold) {
    const cause: SlipCause = h.jolt > 0.15 ? 'jolt' : swingSpeed2 > 30 ? 'swing' : 'weak';
    slip(sim, t, cause, events);
    return;
  }
  // Off-centre, it creeps outward as the load bites (you can watch it go).
  if (lifting) {
    const creep = Math.max(0, load / hold - 0.8) * 4 + Math.max(0, offFrac - 0.35) * 3 * (load / hold);
    if (creep > 0) {
      const d = off > 0.05 ? off : 1;
      const ux = off > 0.05 ? h.ox / d : 1;
      const uz = off > 0.05 ? h.oz / d : 0;
      h.ox += ux * creep * dt;
      h.oz += uz * creep * dt;
    }
    if (hyp(h.ox, h.oz) > k.r * 0.9) {
      slip(sim, t, 'slide', events);
      return;
    }
    // Up off the pile it settles down into the prongs: its waist comes to rest on the tips.
    const cradle = 1.5 - k.h * k.waist;
    if (h.dy > cradle) h.dy = Math.max(cradle, h.dy - dt * 18);
  }
  placeHeld(sim, t, h);
}

function placeHeld(sim: ClawSim, t: ClawToy, h: HeldToy): void {
  const k = KINDS[t.kind];
  const { x, z } = headPos(sim);
  const px = t.x;
  const py = t.y;
  const pz = t.z;
  t.x = x + h.ox;
  t.z = z + h.oz;
  t.y = sim.hubY - CLAW.prong + h.dy;
  t.vx = (t.x - px) / DT;
  t.vy = (t.y - py) / DT;
  t.vz = (t.z - pz) / DT;
  const lean = (hyp(h.ox, h.oz) / k.r) * k.tilt * 0.9;
  const side = h.ox + h.oz * 0.3;
  t.tilt = clamp((side >= 0 ? 1 : -1) * lean + sim.sx * 0.03, -1.2, 1.2);
}

function slip(sim: ClawSim, t: ClawToy, cause: SlipCause, events: ClawEvent[]): void {
  sim.hadToy = sim.hadToy || cause !== 'liftoff';
  if (cause !== 'liftoff') sim.slipped = { toy: t.id, cause };
  sim.held = null;
  sim.openStop = Math.max(sim.openStop, 0.35);
  t.mode = 'fall';
  t.vy = Math.min(t.vy, 0);
  events.push({ type: 'slip', toy: t.id, cause });
}

function letGo(sim: ClawSim): void {
  const h = sim.held!;
  const t = sim.toys.find((x) => x.id === h.id);
  sim.hadToy = true;
  sim.held = null;
  if (!t) return;
  t.mode = 'fall';
  t.vy = 0;
}

/** Falling toys: gravity, the glass walls, and where they land (the pile, or the chute). */
function fallStep(sim: ClawSim, dt: number, events: ClawEvent[]): void {
  let landed = false;
  const gone: ClawToy[] = [];
  for (const t of sim.toys) {
    if (t.mode === 'chute') {
      t.vy -= G * dt;
      t.y += t.vy * dt;
      t.x += (clamp(t.x, CHUTE.x0 + 4, CHUTE.x1 - 4) - t.x) * Math.min(1, dt * 8);
      t.z += (clamp(t.z, CHUTE.z0 + 4, CHUTE.z1 - 4) - t.z) * Math.min(1, dt * 8);
      if (t.y < -45) gone.push(t);
      continue;
    }
    if (t.mode !== 'fall') continue;
    const k = KINDS[t.kind];
    t.vy -= G * dt;
    t.x += t.vx * dt;
    t.z += t.vz * dt;
    t.y += t.vy * dt;
    t.vx *= 1 - Math.min(1, dt * 1.5);
    t.vz *= 1 - Math.min(1, dt * 1.5);
    t.tilt += (t.vx >= 0 ? 1 : -1) * dt * 2.5;
    if (t.x < k.r * 0.8 || t.x > BOX.w - k.r * 0.8) t.vx *= -0.3;
    if (t.z < k.r * 0.8 || t.z > BOX.d - k.r * 0.8) t.vz *= -0.3;
    t.x = clamp(t.x, k.r * 0.8, BOX.w - k.r * 0.8);
    t.z = clamp(t.z, k.r * 0.8, BOX.d - k.r * 0.8);
    // Over the hole (its centre, with a little lip it can tip over): down the chute.
    if (inChute(t.x, t.z, k.r * 0.3) && t.y < CHUTE.wall + 4) {
      t.mode = 'chute';
      t.tilt = 0;
      events.push({ type: 'chute', toy: t.id });
      continue;
    }
    const floor = landingHeight(sim.toys, t);
    if (t.y <= floor) {
      const hard = t.vy < -160;
      t.y = floor;
      nudge(sim.toys, t, Math.min(1, -t.vy / 300));
      t.mode = 'pile';
      t.vx = t.vy = t.vz = 0;
      t.tilt = 0;
      landed = true;
      events.push({ type: 'land', toy: t.id, hard });
    }
  }
  for (const t of gone) {
    sim.won = true;
    sim.toys = sim.toys.filter((x) => x.id !== t.id);
    events.push({ type: 'win', toy: t });
  }
  if (landed) settlePile(sim.toys);
}

function landingHeight(toys: readonly ClawToy[], t: ClawToy): number {
  const k = KINDS[t.kind];
  let best = 0;
  for (const o of toys) {
    if (o.mode !== 'pile' || o.id === t.id) continue;
    const ko = KINDS[o.kind];
    const lim = (k.r + ko.r) * 0.8;
    const d = hyp(t.x - o.x, t.z - o.z);
    if (d >= lim) continue;
    const r = d / lim;
    best = Math.max(best, o.y + ko.h * (0.92 - 0.5 * r * r));
  }
  return best;
}

/** A landing shoves the toys around it outward a little. */
function nudge(toys: ClawToy[], t: ClawToy, impact: number): void {
  const k = KINDS[t.kind];
  for (const o of toys) {
    if (o.mode !== 'pile' || o.id === t.id) continue;
    const ko = KINDS[o.kind];
    const lim = (k.r + ko.r) * 0.95;
    const dx = o.x - t.x;
    const dz = o.z - t.z;
    const d = hyp(dx, dz);
    if (d >= lim || d < 0.001) continue;
    const push = (1 - d / lim) * 2.5 * impact;
    o.x += (dx / d) * push;
    o.z += (dz / d) * push;
  }
}

/**
 * Plays the rest of a try out with no one at the controls (closing the machine mid-try): the same
 * steps, just not drawn. Returns the events (the caller settles the prize from them). Bounded.
 */
export function fastForward(sim: ClawSim, maxSeconds = 60): ClawEvent[] {
  const events: ClawEvent[] = [];
  const idle: ClawInput = { x: 0, z: 0, drop: false };
  if (sim.phase === 'aim') cancelAim(sim);
  let n = Math.ceil(maxSeconds / DT);
  while (n-- > 0 && (sim.phase !== 'idle' || sim.toys.some((t) => t.mode === 'fall' || t.mode === 'chute' || t.mode === 'held'))) {
    stepClaw(sim, idle, events);
  }
  // Belt and braces: nothing is ever left mid-air.
  for (const t of sim.toys) if (t.mode !== 'pile') t.mode = 'pile';
  settleFully(sim.toys);
  return events;
}

/**
 * Tops the machine up to `count` (the attendant's restock): fresh toys fall in from above. Returns
 * how many were added.
 */
export function restock(sim: ClawSim, count: number): number {
  const rng = { seed: (sim.seed ^ 0x5bd1e995) | 0 };
  let added = 0;
  const have = sim.toys.length;
  for (let i = have; i < count; i++) {
    sim.toys.push(freshToy(rng, sim.nextId++, i + Math.floor(nextRandom(sim) * 4), true));
    added++;
  }
  sim.seed = (sim.seed + rng.seed) | 0;
  return added;
}

/**
 * A sure win (the close-up's test hook, only with `?clawSeed=`): puts the trolley dead over the plush
 * the claw would grip best, with the swing settled, and makes the coil absurdly strong. False if nothing
 * can be gripped. Aiming state only.
 */
export function rigSureWin(sim: ClawSim): boolean {
  if (sim.phase !== 'aim') return false;
  let best: { x: number; z: number; score: number } | null = null;
  const save = { gx: sim.gx, gz: sim.gz, sx: sim.sx, sz: sim.sz, hubY: sim.hubY };
  for (const t of sim.toys) {
    if (t.mode !== 'pile') continue;
    const x = clamp(t.x, GANTRY.minX, GANTRY.maxX);
    const z = clamp(t.z, GANTRY.minZ, GANTRY.maxZ);
    sim.gx = x;
    sim.gz = z;
    sim.sx = sim.sz = 0;
    sim.hubY = contactHeight(sim);
    const g = evaluateGrip(sim);
    const score = g.toy === null || g.quality === 'nudge' ? 0 : g.opposed * comFactor(g.offset, 6);
    if (score > 0.3 && (!best || score > best.score)) best = { x, z, score };
  }
  Object.assign(sim, save);
  if (!best) return false;
  sim.gx = best.x;
  sim.gz = best.z;
  sim.vx = sim.vz = sim.sx = sim.sz = sim.svx = sim.svz = 0;
  sim.strengthScale = 1000;
  return true;
}
