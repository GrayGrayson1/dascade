/**
 * Kart physics. `stepKart` is pure and deterministic: the same state, input, spec, track and
 * context always give the same next state, bit for bit, on every JS engine. It runs on the server
 * (authoritative) and in client prediction (replay after every snapshot).
 *
 * Feel (targets are pinned in kart.test.ts; `lab/run.ts` prints the numbers):
 *  - Velocity lives in world space: thrust/brake change the forward component, drag acts on the
 *    speed; the velocity turns ~75 % with the nose at once and realigns with it at the grip rate
 *    (1–3° of slip), so the kart is planted and goes where it points.
 *  - Steering sets a target yaw rate reached in ~70 ms. Authority is low at a crawl, peaks at mid
 *    speed and eases off at top speed (handling), capped there by the grip stat's lateral limit.
 *  - Hop-drift: pressing drift while steering at speed makes a small hop; the drift direction locks
 *    to the steer side. The drift is kinematic: inside steer tightens the arc (≈ 11 u), outside
 *    widens it (≈ 60 u); the body holds 12–25° inside the arc. Charge comes from how much the kart
 *    actually turns (528 points/rad, ≤ 16/tick): stages at 432/936/1584 points ≈ 47°/100°/170° of
 *    turning (0.6/1.3/2.2 s on a neutral arc) → a mini-turbo on release. A drift never exceeds grip
 *    top speed, so snaking down a straight earns nothing.
 *  - Boosts (pads, turbos, mini-turbos, start boost, trick landings) raise the top speed and push
 *    hard, and ignore the off-road penalty (dirt shortcuts are deep: slower still without a boost).
 *  - Start: throttle held for 3–60 applied frames before GO → boost; held longer → a short wheelspin.
 *  - Air: gravity 30 u/s²; ramps launch by speed; air control is reduced. Pressing drift within
 *    0.25 s of leaving a ramp (or hopping at the lip) is a trick → landing boost.
 *  - Walls: the kart is pushed back inside, the normal speed bounces at 35 %, at least 40 % of the
 *    speed is kept along the wall (non-head-on), the nose swings along it over a few ticks (≤ 6 rad/s)
 *    and for 0.25 s a held stick can't steer back into it — never pinned, never a dead stop.
 *  - Drops/gaps: fall for 1.2 s, then respawn stopped on the centreline at the last safe point
 *    (past the gap for gaps) with 1.5 s of immunity.
 *  - Item spin-out: 1 s of two full turns (the nose ends where it started), exits at ~30 % speed;
 *    hazard stumble: 0.5 s, one turn, keeps 70 %. Immunity follows, so hits can never chain.
 */
import type { KartInput } from '@dascade/shared/games/kart';
import { CODE_SHIELD, CODE_TURBO, CODE_TURBO3, CODE_WARP, isTrailableCode, itemFromCode, trapThrowsAhead } from './itemcodes.ts';
import type { KartItemId } from '@dascade/shared/games/kart';
import { PI, clamp, datan2, dcos, dhypot, dsin, f32, loopDelta, mod, qang, qheading, qvel, qz, wrapAngle } from './math.ts';
import type { KartSpec } from './spec.ts';
import {
  EDGE_DROP,
  EDGE_WALL,
  GRAVITY,
  SURF_CONVEYOR,
  SURF_DIRT,
  SURF_ICE,
  SURF_MUD,
  SURF_OFFROAD,
  SURF_ROAD,
  hazardPose,
  locate,
  mainIndexAt,
  newLoc,
  pointAtS,
  racingPointAt,
  surfaceOf,
  zoneAt,
  type GridSlot,
  type KartTrack,
  type Loc,
  type SurfaceCode,
} from './track.ts';

export const KART_DT = 1 / 60;

export const PHYS = {
  /** Rolling resistance (u/s²). */
  roll: 0.8,
  /** Extra drag when coasting (u/s²). */
  coast: 5,
  /** Bleed rate toward top speed when over it (1/s): boost ends, off-road entry. */
  overBleed: 2.2,
  overBleedOffroad: 3.2,
  /** Thrust while boosting (u/s²). */
  boostAccel: 60,
  /** Reverse acceleration (u/s²). */
  reverseAccel: 14,
  /** Target-yaw response rate (1/s). */
  steerResponse: 15,
  /** Fraction of the nose rotation the velocity follows at once (the rest realigns at the grip rate). */
  follow: 0.75,
  followIce: 0.4,
  /** Speed scrubbed per radian of slip per second. */
  scrub: 0.6,
  /** Grip multipliers. */
  gripOffroad: 0.85,
  /** Dirt shortcut top speed, relative to the racer's off-road top speed. */
  dirtTop: 0.72,
  gripSlick: 0.1,
  /** Air steering authority. */
  airControl: 0.35,
  /** Hop vertical speed (u/s) and min drift speed (u/s). */
  hop: 4.2,
  driftMin: 9,
  /** Drift: arc rate factor (outside … inside steer), body angle, swing, scrub. */
  /** Drift arc base rate (rad/s) — the same for every racer (× a small handling factor). */
  driftTurn: 2.6,
  driftArcWide: 0.18,
  driftArcTight: 1.05,
  driftAngle: 0.3,
  driftAngleInside: 0.1,
  driftSwing: 9,
  driftSwingResponse: 20,
  driftScrub: 0.02,
  /** Drift charge points per radian of path rotation, and the per-tick cap (a tight arc). */
  chargePerRad: 528,
  chargeMaxPerTick: 16,
  /** Walls. */
  wallRestitution: 0.35,
  /** Fraction of the pre-impact speed always kept along the wall (non-head-on hits). */
  wallKeep: 0.4,
  /** Ticks after a wall hit during which steering into that wall is ignored. */
  wallGraceTicks: 15,
  /** Bumper hazards: normal restitution and extra pop (u/s). */
  bumperRestitution: 0.5,
  bumperPop: 5,
  /** After a glancing hit the nose swings along the wall at err × rate, at most this yaw rate (rad/s). */
  wallAlignRate: 14,
  wallAlignMaxYaw: 6,
  /** Angle (rad) away from the wall the nose is set to after a glancing hit. */
  wallAway: 0.08,
  kartRadius: 1.1,
  /** Stage thresholds (charge points) → mini-turbo ticks / power (% extra top speed). */
  miniTurboTicks: [0, 36, 66, 96],
  miniTurboPower: [0, 22, 27, 32],
  /** Instant shove on release (u/s). */
  miniTurboKick: [0, 1.5, 2.5, 3.5],
  padTicks: 60,
  padPower: 30,
  turboTicks: 78,
  turboPower: 36,
  startBoostTicks: 16,
  startBoostPower: 18,
  trickTicks: 45,
  trickPower: 26,
  /** Start boost window: throttle held for 3..60 ticks when the lights go out; longer = wheelspin. */
  startMinRev: 3,
  startMaxRev: 60,
  stallTicks: 16,
  /** Thrust share during the wheelspin of a too-early start. */
  stallThrust: 0.4,
  spinTicks: 60,
  /** A spin keeps this share of the speed at the hit and bleeds at spinDrag (u/s²): it exits at ~30–40 %. */
  spinKeep: 0.53,
  /** Hazard knock: half the spin (one turn), keeps 70 % of the speed, 1 s immunity after it. */
  stumbleTicks: 30,
  stumbleKeep: 0.7,
  stumbleImmuneTicks: 60,
  spinDrag: 6,
  /** Immunity after a hit (counts from the hit, so ~1.5 s after the 1 s spin). */
  hitImmuneTicks: 150,
  blockImmuneTicks: 30,
  respawnImmuneTicks: 90,
  fallTicks: 72,
  slickTicks: 48,
  shieldTicks: 600,
  warpTicks: 180,
  warpSpeed: 44,
  warpImmuneTicks: 60,
  trickWindow: 15,
  /** Big wall hit (normal speed, u/s) that cancels a drift. */
  wallDriftCancel: 9,
  maxZVel: 60,
} as const;

/**
 * Charge points at which drift stages 1, 2, 3 are reached. A drift charges 8/12/16 points per tick
 * (wide/neutral/tight) × the racer's `chargeRate` → ~0.6 / 1.3 / 2.2 s at neutral.
 */
export const DRIFT_STAGE_POINTS = [432, 936, 1584] as const;
export const DRIFT_CHARGE_MAX = 1600;

export const BTN_DRIFT = 1;
export const BTN_ITEM = 2;

export interface KartState {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  angVel: number;
  seg: number;
  branch: number;
  safeSeg: number;
  safeBranch: number;
  grounded: boolean;
  driftDir: number;
  driftCharge: number;
  driftArmed: boolean;
  boostTicks: number;
  boostPower: number;
  stallTicks: number;
  rev: number;
  spinTicks: number;
  immuneTicks: number;
  slickTicks: number;
  shieldTicks: number;
  magnetTicks: number;
  magnetPower: number;
  warpTicks: number;
  fallTicks: number;
  /** After a wall hit: ± ticks during which steering into that wall is ignored (+ = wall on the left of the road). */
  wallTicks: number;
  airTicks: number;
  rampAir: boolean;
  trick: boolean;
  item: number;
  itemUses: number;
  rouletteTicks: number;
  trailing: boolean;
  buttons: number;
}

export interface ItemUse {
  item: KartItemId;
  /** Aimed backwards (`back` bit). */
  back: boolean;
  /** Projectiles: fired forward (= !back). Traps: lobbed ahead (only with the `ahead` bit, and not `back`). */
  ahead: boolean;
}

export interface KartStepInfo {
  /** Progress s on the main line (branch mapped). */
  s: number;
  roadS: number;
  d: number;
  branch: number;
  surface: SurfaceCode;
  onRoad: boolean;
  speed: number;
  forwardSpeed: number;
  /** Angle between velocity and nose (rad, + = sliding left). */
  slip: number;
  /** cos(nose vs road direction). */
  headingDot: number;
  /** Velocity along the road direction (u/s). */
  velDot: number;
  wallImpact: number;
  landed: boolean;
  launched: boolean;
  boostPad: boolean;
  /** Mini-turbo stage released this step (0 = none). */
  miniTurbo: number;
  startBoost: 'none' | 'boost' | 'stall';
  respawned: boolean;
  fell: boolean;
  hazardHit: number;
  hazardBlocked: boolean;
  /** Bumped by a bumper this step. */
  bumper: boolean;
  used: ItemUse | null;
}

export interface StepContext {
  /** Frozen on the grid (countdown): throttle only revs for the start boost. */
  locked: boolean;
  /** Race tick (moving hazards). */
  tick: number;
}

export interface KartStepResult {
  state: KartState;
  info: KartStepInfo;
}

export function driftStage(st: Pick<KartState, 'driftCharge' | 'driftDir'>): 0 | 1 | 2 | 3 {
  if (st.driftDir === 0) return 0;
  const c = st.driftCharge;
  return c >= DRIFT_STAGE_POINTS[2] ? 3 : c >= DRIFT_STAGE_POINTS[1] ? 2 : c >= DRIFT_STAGE_POINTS[0] ? 1 : 0;
}

export function itemIdOf(st: Pick<KartState, 'item'>): KartItemId | null {
  return itemFromCode(st.item);
}

export const isSpinning = (st: KartState): boolean => st.spinTicks > 0;
export const isImmune = (st: KartState): boolean => st.immuneTicks > 0 || st.warpTicks > 0;
export const isWarping = (st: KartState): boolean => st.warpTicks > 0;
export const isFalling = (st: KartState): boolean => st.fallTicks > 0;

/** A stopped kart on a grid slot (or any pose). */
export function createKartState(track: KartTrack, slot: GridSlot | number): KartState {
  const g = typeof slot === 'number' ? track.grid[slot]! : slot;
  const loc = locate(track, g.x, g.y, -1, -1, newLoc());
  return {
    x: f32(g.x),
    y: f32(g.y),
    z: qz(loc.z),
    heading: qheading(g.heading),
    vx: 0,
    vy: 0,
    vz: 0,
    angVel: 0,
    seg: loc.seg,
    branch: loc.branch,
    safeSeg: loc.branch < 0 ? loc.seg : mainIndexAt(track, loc.s),
    safeBranch: -1,
    grounded: true,
    driftDir: 0,
    driftCharge: 0,
    driftArmed: false,
    boostTicks: 0,
    boostPower: 0,
    stallTicks: 0,
    rev: 0,
    spinTicks: 0,
    immuneTicks: 0,
    slickTicks: 0,
    shieldTicks: 0,
    magnetTicks: 0,
    magnetPower: 0,
    warpTicks: 0,
    fallTicks: 0,
    wallTicks: 0,
    airTicks: 0,
    rampAir: false,
    trick: false,
    item: 0,
    itemUses: 0,
    rouletteTicks: 0,
    trailing: false,
    buttons: 0,
  };
}

export function newStepInfo(): KartStepInfo {
  return {
    s: 0,
    roadS: 0,
    d: 0,
    branch: -1,
    surface: SURF_ROAD,
    onRoad: true,
    speed: 0,
    forwardSpeed: 0,
    slip: 0,
    headingDot: 1,
    velDot: 0,
    wallImpact: 0,
    landed: false,
    launched: false,
    boostPad: false,
    miniTurbo: 0,
    startBoost: 'none',
    respawned: false,
    fell: false,
    hazardHit: -1,
    hazardBlocked: false,
    bumper: false,
    used: null,
  };
}

/**
 * Speed-sensitive steering authority: low at a crawl, full at mid speed (8–13 u/s), easing to
 * `top` (the racer's handling-dependent value, ~0.5–0.6) from 26 u/s.
 */
export function steerFactor(v: number, top = 0.6): number {
  const a = Math.abs(v);
  if (a < 8) return 0.15 + (0.85 * a) / 8;
  if (a < 13) return 1;
  return 1 - (1 - top) * Math.min(1, (a - 13) / 13);
}

/** Drift arc rate (rad/s of the direction of travel) at speed v for arc factor k (wide 0.18 … tight 1.05). */
export function driftArcRate(spec: KartSpec, v: number, k: number): number {
  return PHYS.driftTurn * spec.driftTurn * Math.max(steerFactor(v), 0.85) * k;
}

/** Give a kart a boost (keeps the stronger/longer of the current and the new one). */
export function giveBoost(st: KartState, ticks: number, power: number): void {
  if (st.boostTicks <= 0) st.boostPower = power;
  else st.boostPower = Math.max(st.boostPower, power);
  st.boostTicks = Math.max(st.boostTicks, ticks);
}

export type HitOutcome = 'ignored' | 'blocked' | 'hit';

/**
 * Apply an item/hazard hit to a kart (mutates). `spin` = item spin-out (1 s, two turns);
 * `stumble` = hazard knock (0.5 s, one turn, keeps more speed and the held item); `slick` = fizz
 * puddle (grip loss, no spin, shields don't block). A trailing puck/mine/fizz blocks one hit from behind.
 */
export function applyHit(st: KartState, kind: 'spin' | 'stumble' | 'slick', fromBehind: boolean): HitOutcome {
  if (st.warpTicks > 0 || st.fallTicks > 0) return 'ignored';
  if (kind === 'slick') {
    if (st.immuneTicks > 0 || st.slickTicks > 0) return 'ignored';
    st.slickTicks = PHYS.slickTicks;
    st.driftDir = 0;
    st.driftCharge = 0;
    st.driftArmed = false;
    return 'hit';
  }
  if (st.immuneTicks > 0) return 'ignored';
  if (st.shieldTicks > 0) {
    st.shieldTicks = 0;
    st.immuneTicks = PHYS.blockImmuneTicks;
    return 'blocked';
  }
  if (fromBehind && st.trailing && isTrailableCode(st.item)) {
    consumeUse(st);
    st.trailing = false;
    st.immuneTicks = PHYS.blockImmuneTicks;
    return 'blocked';
  }
  // Whole turns at the same rate (two for a spin, one for a stumble): the nose ends where it started.
  st.angVel = qang((4 * 3.141592653589793) / (PHYS.spinTicks * KART_DT));
  st.driftDir = 0;
  st.driftCharge = 0;
  st.driftArmed = false;
  if (kind === 'stumble') {
    st.spinTicks = PHYS.stumbleTicks;
    st.immuneTicks = PHYS.stumbleTicks + PHYS.stumbleImmuneTicks;
    st.vx = qvel(st.vx * PHYS.stumbleKeep);
    st.vy = qvel(st.vy * PHYS.stumbleKeep);
    return 'hit';
  }
  st.spinTicks = PHYS.spinTicks;
  st.immuneTicks = PHYS.hitImmuneTicks;
  st.boostTicks = 0;
  st.boostPower = 0;
  st.magnetTicks = 0;
  st.magnetPower = 0;
  if (st.trailing) {
    consumeUse(st);
    st.trailing = false;
  }
  st.vx = qvel(st.vx * PHYS.spinKeep);
  st.vy = qvel(st.vy * PHYS.spinKeep);
  return 'hit';
}

function consumeUse(st: KartState): void {
  st.itemUses = Math.max(0, st.itemUses - 1);
  if (st.itemUses === 0) st.item = 0;
}

// Scratch locations (single-threaded; never escape).
const locA = newLoc();
const locB = newLoc();

function gapIndexAt(track: KartTrack, sPos: number): number {
  for (let i = 0; i < track.gaps.length; i++) {
    const g = track.gaps[i]!;
    if (sPos >= g.from - 1 && sPos <= g.to + 1) return i;
  }
  return -1;
}

function nearGapAhead(track: KartTrack, sPos: number, margin: number): boolean {
  for (const g of track.gaps) if (sPos >= g.from - margin && sPos <= g.to + 2) return true;
  return false;
}

function finalize(st: KartState): void {
  st.x = f32(st.x);
  st.y = f32(st.y);
  st.z = qz(st.z);
  st.heading = qheading(wrapAngle(st.heading));
  st.vx = qvel(st.vx);
  st.vy = qvel(st.vy);
  st.vz = qvel(clamp(st.vz, -PHYS.maxZVel, PHYS.maxZVel));
  st.angVel = qang(st.angVel);
}

function fillInfo(info: KartStepInfo, st: KartState, track: KartTrack, loc: Loc): void {
  const fx = dcos(st.heading);
  const fy = dsin(st.heading);
  const speed = dhypot(st.vx, st.vy);
  const fwd = st.vx * fx + st.vy * fy;
  const lat = st.vx * -fy + st.vy * fx;
  info.s = loc.s;
  info.roadS = loc.roadS;
  info.d = loc.d;
  info.branch = loc.branch;
  info.surface = surfaceOf(track, loc);
  info.onRoad = Math.abs(loc.d) <= (loc.d >= 0 ? loc.hwL : loc.hwR);
  info.speed = speed;
  info.forwardSpeed = fwd;
  info.slip = speed > 0.5 ? datan2(lat, Math.abs(fwd) + 1e-9) : 0;
  info.headingDot = fx * loc.tx + fy * loc.ty;
  info.velDot = st.vx * loc.tx + st.vy * loc.ty;
}

function respawn(st: KartState, track: KartTrack): void {
  let x: number;
  let y: number;
  let z: number;
  let h: number;
  const b = st.safeBranch >= 0 ? track.branches[st.safeBranch] : undefined;
  if (b) {
    const i = clamp(st.safeSeg, 0, b.n - 1);
    x = b.xs[i]!;
    y = b.ys[i]!;
    z = b.zs[i]!;
    h = datan2(b.ty[i]!, b.tx[i]!);
    st.branch = b.index;
    st.seg = Math.min(i, b.n - 2);
  } else {
    const i = clamp(st.safeSeg, 0, track.n - 1);
    x = track.xs[i]!;
    y = track.ys[i]!;
    z = track.zs[i]!;
    h = datan2(track.ty[i]!, track.tx[i]!);
    st.branch = -1;
    st.seg = i;
  }
  st.x = x;
  st.y = y;
  st.z = z;
  st.heading = h;
  st.vx = st.vy = st.vz = st.angVel = 0;
  st.grounded = true;
  st.fallTicks = 0;
  st.airTicks = 0;
  st.rampAir = false;
  st.trick = false;
  st.driftDir = 0;
  st.driftCharge = 0;
  st.driftArmed = false;
  st.boostTicks = 0;
  st.boostPower = 0;
  st.spinTicks = 0;
  st.slickTicks = 0;
  st.immuneTicks = Math.max(st.immuneTicks, PHYS.respawnImmuneTicks);
}

/** Advance one kart by one fixed 60 Hz step. Pure: `prev` is not modified. */
export function stepKart(prev: KartState, input: KartInput, spec: KartSpec, track: KartTrack, ctx: StepContext): KartStepResult {
  const dt = KART_DT;
  const st: KartState = { ...prev };
  const info = newStepInfo();
  const driftHeld = input.drift;
  const itemHeld = input.item;
  const driftPressed = driftHeld && (prev.buttons & BTN_DRIFT) === 0;
  const itemPressed = itemHeld && (prev.buttons & BTN_ITEM) === 0;
  const itemReleased = !itemHeld && (prev.buttons & BTN_ITEM) !== 0;
  st.buttons = (driftHeld ? BTN_DRIFT : 0) | (itemHeld ? BTN_ITEM : 0);

  // --- Grid (countdown) --------------------------------------------------------------------
  if (ctx.locked) {
    st.rev = input.throttle >= 0.5 ? Math.min(255, prev.rev + 1) : 0;
    st.vx = st.vy = st.vz = st.angVel = 0;
    st.driftDir = 0;
    st.driftCharge = 0;
    st.driftArmed = false;
    const loc = locate(track, st.x, st.y, st.branch, st.seg, locA);
    st.seg = loc.seg;
    st.branch = loc.branch;
    st.z = loc.z;
    st.grounded = true;
    finalize(st);
    fillInfo(info, st, track, loc);
    return { state: st, info };
  }
  if (prev.rev > 0) {
    if (prev.rev > PHYS.startMaxRev) {
      st.stallTicks = PHYS.stallTicks;
      info.startBoost = 'stall';
    } else if (prev.rev >= PHYS.startMinRev) {
      giveBoost(st, PHYS.startBoostTicks, PHYS.startBoostPower);
      info.startBoost = 'boost';
    }
    st.rev = 0;
  }

  // --- Timers -------------------------------------------------------------------------------
  if (st.boostTicks > 0 && --st.boostTicks === 0) st.boostPower = 0;
  if (st.stallTicks > 0) st.stallTicks--;
  if (st.slickTicks > 0) st.slickTicks--;
  if (st.shieldTicks > 0) st.shieldTicks--;
  if (st.magnetTicks > 0 && --st.magnetTicks === 0) st.magnetPower = 0;
  if (st.rouletteTicks > 0) st.rouletteTicks--;
  if (st.immuneTicks > 0) st.immuneTicks--;
  if (st.wallTicks !== 0) st.wallTicks -= st.wallTicks > 0 ? 1 : -1;

  // --- Falling ------------------------------------------------------------------------------
  if (st.fallTicks > 0) {
    st.fallTicks--;
    st.vz -= GRAVITY * dt;
    st.vx *= 0.96;
    st.vy *= 0.96;
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.z += st.vz * dt;
    if (st.fallTicks === 0) {
      respawn(st, track);
      info.respawned = true;
    }
    const loc = locate(track, st.x, st.y, st.branch, st.seg, locA);
    st.seg = loc.seg;
    st.branch = loc.branch;
    finalize(st);
    fillInfo(info, st, track, loc);
    return { state: st, info };
  }

  const spinning = st.spinTicks > 0;
  const throttle = spinning ? 0 : clamp(input.throttle, 0, 1);
  const brake = spinning ? 0 : clamp(input.brake, 0, 1);
  const steer = spinning ? 0 : clamp(input.steer, -1, 1);

  // --- Items (the use happens before the physics so a turbo kicks in this very tick) ----------
  if (!spinning && st.warpTicks === 0) {
    if (st.trailing) {
      if (st.item === 0) st.trailing = false;
      else if (itemReleased) {
        const id = itemFromCode(st.item)!;
        info.used = { item: id, back: input.back, ahead: id === 'mine' || id === 'fizz' ? trapThrowsAhead(input) : !input.back };
        st.trailing = false;
        consumeUse(st);
      }
    } else if (itemPressed && st.item !== 0 && st.rouletteTicks === 0) {
      if (isTrailableCode(st.item)) {
        st.trailing = true;
      } else {
        const code = st.item;
        info.used = { item: itemFromCode(code)!, back: input.back, ahead: !input.back };
        consumeUse(st);
        if (code === CODE_TURBO || code === CODE_TURBO3) giveBoost(st, PHYS.turboTicks, PHYS.turboPower);
        else if (code === CODE_SHIELD) st.shieldTicks = PHYS.shieldTicks;
        else if (code === CODE_WARP) {
          st.warpTicks = PHYS.warpTicks;
          st.driftDir = 0;
          st.driftCharge = 0;
          st.driftArmed = false;
          st.trailing = false;
        }
      }
    }
  }

  // --- Warp: ride the racing line, untouchable ------------------------------------------------
  if (st.warpTicks > 0) {
    stepWarp(st, track, info);
    return { state: st, info };
  }

  const here = locate(track, st.x, st.y, st.branch, st.seg, locA);
  const sPrev = here.s;
  const onMainPrev = here.branch < 0;
  const surface = surfaceOf(track, here);
  const zone = here.branch < 0 ? zoneAt(track, here.s, here.d) : null;

  let fx = dcos(st.heading);
  let fy = dsin(st.heading);
  let vx = st.vx;
  let vy = st.vy;
  const velA0 = datan2(vy, vx);
  const speed0 = dhypot(vx, vy);
  const boosting = st.boostTicks > 0;
  const slow = surface === SURF_OFFROAD || surface === SURF_DIRT || surface === SURF_MUD;
  const offroadSlow = slow && !boosting;

  // --- Longitudinal: thrust/brake change the forward component; drag acts on the speed -------
  let topMul = 1;
  if (boosting) topMul += st.boostPower / 100;
  if (st.magnetTicks > 0) topMul += st.magnetPower / 100;
  // Dirt shortcuts are deep: much slower than a grass shoulder unless you boost through them.
  const surfTop = offroadSlow
    ? surface === SURF_MUD
      ? Math.max(0.62, spec.offroadTop)
      : surface === SURF_DIRT
        ? spec.offroadTop * PHYS.dirtTop
        : spec.offroadTop
    : 1;
  const top = spec.topSpeed * surfTop * topMul;
  if (st.grounded) {
    const vf0 = vx * fx + vy * fy;
    let vf = vf0;
    if (throttle > 0) {
      if (vf < -0.5) vf = Math.min(0, vf + spec.brake * throttle * dt);
      else {
        const r = Math.max(0, vf) / top;
        const a =
          spec.accel *
          Math.max(0, 1 - r * r) *
          throttle *
          (offroadSlow ? spec.offroadAccel : 1) *
          (st.stallTicks > 0 ? PHYS.stallThrust : 1);
        vf += a * dt;
      }
    }
    if (boosting) {
      const r = Math.max(0, vf) / top;
      vf += PHYS.boostAccel * Math.max(0, 1 - r * r) * dt;
    }
    if (brake > 0) {
      if (vf > 0.3) vf = Math.max(0, vf - spec.brake * brake * dt);
      else if (throttle === 0) vf = Math.max(-spec.reverseMax, vf - PHYS.reverseAccel * brake * dt);
    }
    vx += fx * (vf - vf0);
    vy += fy * (vf - vf0);
    const speed = dhypot(vx, vy);
    if (speed > 0) {
      let drag: number = PHYS.roll;
      if (spinning) drag += PHYS.spinDrag;
      else if (throttle === 0 && brake === 0 && !boosting) drag += PHYS.coast;
      let next = Math.max(0, speed - drag * dt);
      if (next > top) next = Math.max(top, next - ((next - top) * (offroadSlow ? PHYS.overBleedOffroad : PHYS.overBleed) + 2) * dt);
      vx *= next / speed;
      vy *= next / speed;
    }
  } else {
    vx *= 1 - 0.05 * dt;
    vy *= 1 - 0.05 * dt;
  }

  // --- Hop / drift ----------------------------------------------------------------------------
  const vfNow = vx * fx + vy * fy;
  const speedAbs = Math.abs(vfNow);
  if (!spinning) {
    if (driftPressed && st.rampAir && st.airTicks <= PHYS.trickWindow) {
      st.trick = true;
    } else if (driftPressed && st.grounded && vfNow > PHYS.driftMin) {
      st.vz = PHYS.hop;
      st.grounded = false;
      st.airTicks = 0;
      st.driftArmed = true;
    }
    if (st.driftArmed && driftHeld && st.driftDir === 0 && Math.abs(steer) > 0.25) {
      st.driftDir = steer > 0 ? 1 : -1;
      st.driftArmed = false;
      st.driftCharge = 0;
    }
    if (!driftHeld) {
      st.driftArmed = false;
      if (st.driftDir !== 0) {
        const stage = driftStage(st);
        if (stage > 0) {
          giveBoost(st, PHYS.miniTurboTicks[stage]!, PHYS.miniTurboPower[stage]!);
          // The kick: an instant shove along the nose.
          vx += fx * PHYS.miniTurboKick[stage]!;
          vy += fy * PHYS.miniTurboKick[stage]!;
          info.miniTurbo = stage;
        }
        st.driftDir = 0;
        st.driftCharge = 0;
      }
    }
    if (st.driftDir !== 0 && speedAbs < PHYS.driftMin * 0.6) {
      st.driftDir = 0;
      st.driftCharge = 0;
    }
  }
  const along = st.driftDir !== 0 ? clamp(steer * st.driftDir, -1, 1) : 0;

  // --- Steering + grip ------------------------------------------------------------------------
  const speed = dhypot(vx, vy);
  if (spinning) {
    st.heading = wrapAngle(st.heading + st.angVel * dt);
  } else if (st.driftDir !== 0 && st.grounded) {
    // Kinematic drift: steering picks the arc (inside = tight, outside = wide); the body holds
    // a drift angle inside the arc and swings smoothly into it.
    const k = PHYS.driftArcWide + (PHYS.driftArcTight - PHYS.driftArcWide) * ((along + 1) / 2);
    const arc = st.driftDir * driftArcRate(spec, speed, k);
    const newVel = velA0 + arc * dt;
    // Never faster than grip driving: the nose-forward thrust can't push the drift over top speed
    // (a boost's own top still applies; leftover speed above it bleeds as usual).
    const kept = Math.min(speed * (1 - PHYS.driftScrub * dt), Math.max(top, speed0));
    // Charge comes from how much the kart actually turns: ~47° of path rotation for stage 1,
    // ~100° for stage 2, ~170° for stage 3 (0.6 / 1.3 / 2.2 s on a neutral arc). A weave down a
    // straight never turns enough to earn a mini-turbo.
    if (!slow && speedAbs > PHYS.driftMin) {
      const pts = Math.min(PHYS.chargeMaxPerTick, Math.round(Math.abs(arc) * dt * PHYS.chargePerRad * spec.chargeRate));
      st.driftCharge = Math.min(DRIFT_CHARGE_MAX, st.driftCharge + pts);
    }
    vx = dcos(newVel) * kept;
    vy = dsin(newVel) * kept;
    const body = newVel + st.driftDir * (PHYS.driftAngle + PHYS.driftAngleInside * along);
    const want = clamp(arc + wrapAngle(body - st.heading) * PHYS.driftSwing, -6, 6);
    st.angVel += (want - st.angVel) * Math.min(1, PHYS.driftSwingResponse * dt);
    st.heading = wrapAngle(st.heading + st.angVel * dt);
  } else {
    let yawTarget = 0;
    // After a glancing wall hit: swing the nose along the wall (the way the kart is sliding, angled
    // slightly away) at a bounded yaw rate, over a few ticks.
    let aligning = false;
    if (st.wallTicks !== 0 && st.grounded && speed > 2) {
      const vt = vx * here.tx + vy * here.ty;
      if (Math.abs(vt) > 0.3 * speed) {
        const fwd = vt >= 0 ? 1 : -1;
        const side = st.wallTicks > 0 ? 1 : -1;
        const target = datan2(here.ty * fwd, here.tx * fwd) - side * fwd * PHYS.wallAway;
        const err = wrapAngle(target - st.heading);
        if (Math.abs(err) > 0.04 && Math.abs(err) < 1.75) {
          aligning = true;
          yawTarget = clamp(err * PHYS.wallAlignRate, -PHYS.wallAlignMaxYaw, PHYS.wallAlignMaxYaw);
        }
      }
    }
    if (aligning) {
      // yawTarget is the bounded align rate (set above).
    } else if (!st.grounded && (st.driftArmed || st.driftDir !== 0)) {
      // Hop: swing the nose toward the drift side in the air.
      const dir = st.driftDir !== 0 ? st.driftDir : steer;
      yawTarget = dir * spec.turnRate * 0.9;
    } else {
      yawTarget = steer * spec.turnRate * steerFactor(speedAbs, spec.steerTop) * (vfNow < -0.3 ? -1 : 1);
      // Tyre limit: the yaw rate at speed is capped by the lateral acceleration budget (grip stat).
      if (speedAbs > 1) yawTarget = clamp(yawTarget, -spec.latMax / speedAbs, spec.latMax / speedAbs);
      // Just bounced off a wall: a held stick can't turn the nose back into it (no pinning).
      if (st.wallTicks !== 0) {
        const into = (st.wallTicks > 0 ? 1 : -1) * (fx * here.tx + fy * here.ty >= 0 ? 1 : -1);
        if (yawTarget * into > 0) yawTarget = 0;
      }
      if (!st.grounded) yawTarget *= PHYS.airControl;
    }
    if (aligning) {
      // The align rate applies directly (bounded per tick); no grip realign while the nose swings.
      st.angVel = yawTarget;
    } else {
      if (st.slickTicks > 0) yawTarget *= 0.6;
      st.angVel += (yawTarget - st.angVel) * Math.min(1, PHYS.steerResponse * dt);
    }
    const dh = st.angVel * dt;
    st.heading = wrapAngle(st.heading + dh);
    if (st.grounded && !aligning) {
      if (speed < 1) {
        const f2x = dcos(st.heading);
        const f2y = dsin(st.heading);
        const along2 = vx * f2x + vy * f2y;
        vx = f2x * along2;
        vy = f2y * along2;
      } else {
        const icy = surface === SURF_ICE || st.slickTicks > 0;
        // The velocity turns with the nose (mostly)…
        const a = dh * (icy ? PHYS.followIce : PHYS.follow);
        let c = dcos(a);
        let s = dsin(a);
        let nvx = vx * c - vy * s;
        vy = vx * s + vy * c;
        vx = nvx;
        // …then realigns with it at the grip rate, scrubbing a little speed.
        let grip = spec.grip;
        if (surface === SURF_ICE) grip *= spec.iceGrip;
        else if (slow) grip *= PHYS.gripOffroad;
        if (st.slickTicks > 0) grip *= PHYS.gripSlick;
        const f2x = dcos(st.heading);
        const f2y = dsin(st.heading);
        const backwards = vx * f2x + vy * f2y < 0;
        const target = backwards ? wrapAngle(st.heading + PI) : st.heading;
        const slip = wrapAngle(datan2(vy, vx) - target);
        const rot = -slip * Math.min(1, grip * dt);
        c = dcos(rot);
        s = dsin(rot);
        nvx = vx * c - vy * s;
        vy = vx * s + vy * c;
        vx = nvx;
        const keep = 1 - Math.min(0.5, Math.abs(slip) * PHYS.scrub * dt);
        vx *= keep;
        vy *= keep;
      }
    }
  }
  fx = dcos(st.heading);
  fy = dsin(st.heading);

  // Conveyor push (displacement along the road normal).
  if (zone && zone.kind === SURF_CONVEYOR && st.grounded) {
    st.x += -here.ty * zone.push * dt;
    st.y += here.tx * zone.push * dt;
  }

  // --- Integrate -----------------------------------------------------------------------------
  const zPrev = st.z;
  st.x += vx * dt;
  st.y += vy * dt;
  if (!st.grounded) {
    st.vz -= GRAVITY * dt;
    st.z += st.vz * dt;
    st.airTicks = Math.min(255, st.airTicks + 1);
  }

  // --- Walls ---------------------------------------------------------------------------------
  const loc = locate(track, st.x, st.y, here.branch, here.seg, locB);
  const left = loc.d >= 0;
  const hw = left ? loc.hwL : loc.hwR;
  const edge = left ? loc.edgeL : loc.edgeR;
  const corridor = hw + track.shoulder;
  const lim = corridor - PHYS.kartRadius;
  if (edge === EDGE_WALL && Math.abs(loc.d) > lim) {
    const side = left ? 1 : -1;
    const ox = -loc.ty * side;
    const oy = loc.tx * side;
    const pen = Math.abs(loc.d) - lim;
    st.x -= ox * pen;
    st.y -= oy * pen;
    loc.d -= side * pen;
    const vn = vx * ox + vy * oy;
    if (vn > 0) {
      info.wallImpact = vn;
      const pre = dhypot(vx, vy);
      // Glancing or head-on is judged by the motion, not the nose (a drifting kart's nose points
      // well inside its direction of travel).
      const preAlong = pre > 0.5 ? (vx * loc.tx + vy * loc.ty) / pre : 0;
      vx -= ox * vn * (1 + PHYS.wallRestitution);
      vy -= oy * vn * (1 + PHYS.wallRestitution);
      const vt = vx * loc.tx + vy * loc.ty;
      const friction = Math.min(0.2, vn * 0.012);
      vx -= loc.tx * vt * friction;
      vy -= loc.ty * vt * friction;
      // Never a dead stop on anything but a head-on hit: keep ≥ 40 % of the speed along the wall.
      const vt2 = vt * (1 - friction);
      const glancing = Math.abs(preAlong) > 0.3;
      if (glancing && Math.abs(vt2) < pre * PHYS.wallKeep) {
        const dir = preAlong > 0 ? 1 : -1;
        const add = dir * pre * PHYS.wallKeep - vt2;
        vx += loc.tx * add;
        vy += loc.ty * add;
      }
      if (vn > 3) st.wallTicks = side * PHYS.wallGraceTicks;
      if (!spinning && glancing) {
        // Not head-on: swing the nose along the wall (the way it was going), angled slightly away,
        // so the kart slides on instead of grinding (and throttle doesn't brake a "backwards" bounce).
        // The velocity turns at once (bounce + slide); the nose follows over the next few ticks
        // at a bounded yaw rate (see the wall-align step in the steering), so it never teleports.
        const fwd = preAlong >= 0 ? 1 : -1;
        const alongH = datan2(loc.ty * fwd, loc.tx * fwd) - side * fwd * PHYS.wallAway;
        st.angVel = clamp(wrapAngle(alongH - st.heading) * PHYS.wallAlignRate, -PHYS.wallAlignMaxYaw, PHYS.wallAlignMaxYaw);
      }
      if (vn > PHYS.wallDriftCancel) {
        st.driftDir = 0;
        st.driftCharge = 0;
        st.driftArmed = false;
      }
    }
  }
  st.vx = vx;
  st.vy = vy;

  // --- Ground --------------------------------------------------------------------------------
  const beyondDrop = edge === EDGE_DROP && Math.abs(loc.d) > corridor;
  const hasGround = !loc.noGround && !beyondDrop;
  const gz = loc.z;
  if (st.grounded) {
    if (!hasGround) {
      st.grounded = false;
    } else {
      const vzg = (gz - zPrev) / dt;
      const expected = prev.vz - GRAVITY * dt;
      if (vzg < expected - 1.5 && prev.grounded) {
        // Cresting faster than gravity can pull the kart down: a little natural air.
        st.grounded = false;
        st.vz = expected;
        st.z = zPrev + st.vz * dt;
        st.airTicks = 0;
      } else {
        st.z = gz;
        st.vz = clamp(vzg, -30, 30);
      }
    }
  } else if (hasGround && st.z <= gz && zPrev >= gz - 1.2) {
    // Landing.
    st.z = gz;
    st.vz = 0;
    st.grounded = true;
    info.landed = true;
    if (st.trick) {
      giveBoost(st, PHYS.trickTicks, PHYS.trickPower);
      st.trick = false;
    }
    st.rampAir = false;
    st.airTicks = 0;
    if (prev.vz < -16) {
      st.vx *= 0.92;
      st.vy *= 0.92;
    }
  } else if (st.z < gz - 3) {
    // Fell off an edge or into a gap.
    st.fallTicks = PHYS.fallTicks;
    info.fell = true;
    st.driftDir = 0;
    st.driftCharge = 0;
    st.driftArmed = false;
    st.trailing = false;
    const gi = loc.branch < 0 ? gapIndexAt(track, loc.s) : -1;
    if (gi >= 0) {
      st.safeBranch = -1;
      st.safeSeg = mainIndexAt(track, track.gaps[gi]!.to + 14);
    }
  }

  // --- Ramps (main line; a hop at the lip still counts, and makes it a trick) -------------------
  if (loc.branch < 0 && onMainPrev && st.fallTicks === 0 && st.z - gz < 1.3) {
    for (const r of track.ramps) {
      if (loopDelta(r.s, sPrev, track.length) < 0 && loopDelta(r.s, loc.s, track.length) >= 0 && Math.abs(loc.d - r.d) <= r.width / 2) {
        const vfNow = st.vx * fx + st.vy * fy;
        st.vz = r.launch * clamp(vfNow / spec.topSpeed, 0.35, 1.15);
        if (st.driftArmed && !st.grounded) st.trick = true;
        st.grounded = false;
        st.rampAir = true;
        st.airTicks = 0;
        st.driftArmed = false;
        info.launched = true;
        break;
      }
    }
  }

  // --- Boost pads ----------------------------------------------------------------------------
  if (st.grounded && loc.branch < 0) {
    for (const p of track.boostPads) {
      if (Math.abs(loopDelta(p.s, loc.s, track.length)) <= p.length / 2 && Math.abs(loc.d - p.d) <= p.width / 2) {
        giveBoost(st, PHYS.padTicks, PHYS.padPower);
        info.boostPad = true;
        break;
      }
    }
  }

  // --- Hazards (they stand on the main road: karts on a branch only meet them by world position) --
  for (let i = 0; i < track.hazards.length; i++) {
    const h = track.hazards[i]!;
    if (loc.branch >= 0) {
      if (h.kind === 'laser') continue;
      const dx = st.x - h.x;
      const dy = st.y - h.y;
      const reach = h.radius + (h.kind === 'roller' ? h.amp : h.kind === 'sweeper' ? h.amp : 0) + 4;
      if (dx * dx + dy * dy > reach * reach) continue;
    } else if (Math.abs(loopDelta(h.s, loc.s, track.length)) > (h.kind === 'roller' ? h.amp + 10 : 12)) continue;
    const pose = hazardPose(track, i, ctx.tick);
    if (h.kind === 'laser') {
      if (!pose.active || Math.abs(loopDelta(pose.s, loc.s, track.length)) > 0.9 || Math.abs(loc.d - pose.d) > pose.radius) continue;
      if (st.z - pose.z > 3) continue;
    } else {
      const dx = st.x - pose.x;
      const dy = st.y - pose.y;
      const r = pose.radius + PHYS.kartRadius;
      if (dx * dx + dy * dy > r * r || Math.abs(st.z - pose.z) > (h.kind === 'stomper' ? 2 : 3)) continue;
      if (h.kind === 'bumper') {
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        st.x = pose.x + nx * r;
        st.y = pose.y + ny * r;
        // Bouncy, not a wall: the normal speed reflects at 50 % plus a 5 u/s pop; glancing hits
        // mostly deflect sideways.
        const vn = st.vx * nx + st.vy * ny;
        const out = Math.max(0, -vn) * PHYS.bumperRestitution + PHYS.bumperPop;
        const dvn = Math.max(0, out - vn);
        st.vx += nx * dvn;
        st.vy += ny * dvn;
        st.driftDir = 0;
        st.driftCharge = 0;
        info.bumper = true;
        info.hazardHit = i;
        continue;
      }
      if (!pose.active) continue;
    }
    const out = applyHit(st, 'stumble', false);
    if (out !== 'ignored') {
      info.hazardHit = i;
      info.hazardBlocked = out === 'blocked';
    }
  }

  // --- Spin-out rotation ends -----------------------------------------------------------------
  if (st.spinTicks > 0 && --st.spinTicks === 0) st.angVel = 0;

  // --- Safe respawn point -------------------------------------------------------------------
  if (st.grounded && hasGround && Math.abs(loc.d) < hw - 1 && (loc.branch >= 0 || !nearGapAhead(track, loc.s, 30))) {
    st.safeSeg = loc.seg;
    st.safeBranch = loc.branch;
  }
  st.seg = loc.seg;
  st.branch = loc.branch;
  finalize(st);
  fillInfo(info, st, track, loc);
  return { state: st, info };
}

/** Warp autopilot: steer along the racing line at warp speed; hold the road height over gaps. */
function stepWarp(st: KartState, track: KartTrack, info: KartStepInfo): void {
  const dt = KART_DT;
  const here = locate(track, st.x, st.y, st.branch, st.seg, locA);
  let tx: number;
  let ty: number;
  if (here.branch >= 0) {
    const b = track.branches[here.branch]!;
    const i = Math.min(b.n - 1, here.seg + Math.ceil(10 / b.spacing));
    tx = b.xs[i]!;
    ty = b.ys[i]!;
  } else {
    const p = racingPointAt(track, here.s + 10);
    tx = p.x;
    ty = p.y;
  }
  const want = datan2(ty - st.y, tx - st.x);
  const err = wrapAngle(want - st.heading);
  const turn = clamp(err, -6 * dt, 6 * dt);
  st.angVel = turn / dt;
  st.heading = wrapAngle(st.heading + turn);
  const fx = dcos(st.heading);
  const fy = dsin(st.heading);
  st.vx = fx * PHYS.warpSpeed;
  st.vy = fy * PHYS.warpSpeed;
  st.x += st.vx * dt;
  st.y += st.vy * dt;
  const loc = locate(track, st.x, st.y, here.branch, here.seg, locB);
  const hw = loc.d >= 0 ? loc.hwL : loc.hwR;
  const lim = hw - 1;
  if (Math.abs(loc.d) > lim) {
    const side = loc.d >= 0 ? 1 : -1;
    const pen = Math.abs(loc.d) - lim;
    st.x -= -loc.ty * side * pen;
    st.y -= loc.tx * side * pen;
  }
  st.z = loc.z;
  st.vz = 0;
  st.grounded = true;
  st.rampAir = false;
  st.trick = false;
  st.fallTicks = 0;
  st.spinTicks = 0;
  st.slickTicks = 0;
  if (--st.warpTicks === 0) st.immuneTicks = Math.max(st.immuneTicks, PHYS.warpImmuneTicks);
  st.seg = loc.seg;
  st.branch = loc.branch;
  if (!loc.noGround) {
    st.safeSeg = loc.seg;
    st.safeBranch = loc.branch;
  }
  finalize(st);
  fillInfo(info, st, track, loc);
}

/** HUD speed in "km/h"-ish units (1 u ≈ 1 m; karts feel faster than they are). */
export function displaySpeed(uPerSecond: number): number {
  return Math.round(Math.abs(uPerSecond) * 4.2);
}

/** Main-line point helper re-exported for convenience. */
export { pointAtS, mod };
