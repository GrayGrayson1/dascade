/**
 * Computer racers. A bot only produces a `KartInput` (the same path as a human's input), from
 * what a player could see: the track, the karts around it and the items on the road.
 *
 *  - Line: the racing line (or a chosen branch) with a curvature-aware look-ahead; steering is
 *    pure pursuit plus a curvature feed-forward, so bots hold clean lines in tight sections.
 *  - Speed: a braking plan from the corner-speed limits ahead (grip or drift, whichever it uses).
 *  - Drift: corners long enough to charge are hop-drifted; the arc is steered from the direction
 *    of travel (inside/outside steer), held to the skill's target stage and released at the exit.
 *  - Boost pads, hazards (dodged sideways or timed: lasers, stompers), traps and karts ahead.
 *  - Items: fire pucks at karts lined up ahead (or behind), drop traps on karts following, trail
 *    items as a shield, raise the shield when something is homing in, save turbos for straights
 *    or dirt shortcuts, magnet/seeker/pulse when there is someone to catch.
 *  - Mistakes: a late brake, a wobble, a drift held too long — rarer and smaller with skill.
 *  - Recovery: reverse out of walls, turn around when facing the wrong way.
 */
import { NEUTRAL_KART_INPUT, type KartBotSkill, type KartInput } from '@dascade/shared/games/kart';
import { DRIFT_STAGE_POINTS, driftArcRate, driftStage, itemIdOf, steerFactor, type KartState } from './kart.ts';
import { clamp, datan2, dcos, dsin, loopDelta, mod, wrapAngle } from './math.ts';
import type { KartSim, SimKart } from './sim.ts';
import type { KartSpec } from './spec.ts';
import { hazardPose, mainIndexAt, racingPointAt, type BuiltBranch, type KartTrack } from './track.ts';

interface SkillProfile {
  /** Fraction of the physically possible cornering speed the bot aims for. */
  corner: number;
  /** Fraction of top speed it drives on straights. */
  pace: number;
  /** Probability per second of starting a mistake. */
  mistakeRate: number;
  /** Chance to drift a drift-worthy corner. */
  driftChance: number;
  /** Drift stage it holds for (if the corner allows). */
  driftStage: number;
  /** Chance of a perfect start. */
  startSkill: number;
  /** How well it uses items (0..1). */
  items: number;
  /** Steering noise amplitude (rad). */
  noise: number;
  /** Takes shortcuts. */
  shortcuts: number;
  /** Reacts to hazards. */
  hazards: number;
}

const PROFILES: Record<KartBotSkill, SkillProfile> = {
  easy: {
    corner: 0.8,
    pace: 0.9,
    mistakeRate: 0.1,
    driftChance: 0.25,
    driftStage: 1,
    startSkill: 0.2,
    items: 0.35,
    noise: 0.06,
    shortcuts: 0,
    hazards: 0.55,
  },
  normal: {
    corner: 0.9,
    pace: 0.96,
    mistakeRate: 0.05,
    driftChance: 0.7,
    driftStage: 2,
    startSkill: 0.55,
    items: 0.7,
    noise: 0.03,
    shortcuts: 0.5,
    hazards: 0.7,
  },
  hard: {
    corner: 0.97,
    pace: 1,
    mistakeRate: 0.02,
    driftChance: 0.95,
    driftStage: 3,
    startSkill: 0.85,
    items: 1,
    noise: 0.012,
    shortcuts: 1,
    hazards: 1,
  },
};

/** Small deterministic PRNG (mulberry32) so bots are reproducible for a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const vcapCache = new WeakMap<KartTrack, Map<string, Float64Array>>();

/** Max grip-cornering speed per main-line sample for a spec at a skill margin (racing-line curvature). */
function cornerCaps(track: KartTrack, spec: KartSpec, margin: number): Float64Array {
  let byKey = vcapCache.get(track);
  if (!byKey) vcapCache.set(track, (byKey = new Map()));
  const key = `${spec.turnRate}:${spec.latMax}:${spec.topSpeed}:${margin}`;
  let caps = byKey.get(key);
  if (caps) return caps;
  caps = new Float64Array(track.n);
  const top = spec.topSpeed * 1.4;
  for (let i = 0; i < track.n; i++) {
    let k = 0;
    for (let j = -2; j <= 2; j++) k = Math.max(k, Math.abs(track.racingLine.curvature[(i + j + track.n) % track.n]!));
    let v = top;
    if (k > 1e-4) {
      // Largest v with v·k ≤ min(turnRate · steerFactor(v), latMax / v) · margin.
      for (v = top; v > 6; v -= 0.25) if (v * k <= Math.min(spec.turnRate * steerFactor(v, spec.steerTop), spec.latMax / v) * margin) break;
    }
    caps[i] = v;
  }
  byKey.set(key, caps);
  return caps;
}

interface Corner {
  /** Distance ahead (u) where it starts / its length (u). */
  start: number;
  length: number;
  sign: number;
  /** Mean |curvature|. */
  k: number;
  /** Main-line sample index where it starts (identifies the corner). */
  id: number;
}

const KMIN = 1 / 75;

export class KartBot {
  readonly skill: KartBotSkill;
  private readonly p: SkillProfile;
  private readonly rnd: () => number;
  private lane = 0;
  private laneTimer = 0;
  private stuck = 0;
  private reverse = 0;
  private mistake = 0;
  private mistakeKind = 0;
  private driftHeld = false;
  private driftWant = 0;
  private driftTicks = 0;
  private straightTicks = 0;
  private readonly cornerPlan = new Map<number, boolean>();
  private itemBtn = false;
  private itemTicks = 0;
  private releaseBack = false;
  private startPress = -1;
  /** Steer while reversing (0 = aim the nose back along the track). */
  private reverseSteer = 0;
  /** Progress watchdog: last progress s and the tick it was taken; escape ticks left. */
  private watchS = -1;
  private watchTick = 0;
  private escape = 0;
  private readonly branchPlan = new Map<number, boolean>();

  constructor(skill: KartBotSkill, seed: number) {
    this.skill = skill;
    this.p = PROFILES[skill];
    this.rnd = mulberry32(seed || 1);
    this.lane = (this.rnd() - 0.5) * 3;
  }

  think(sim: KartSim, kart: SimKart): KartInput {
    const st = kart.state;
    const track = sim.track;
    const spec = kart.spec;
    const input: KartInput = { ...NEUTRAL_KART_INPUT };
    if (sim.status === 'grid') {
      if (sim.goTick >= 0) {
        if (this.startPress < 0) {
          // The start-boost window is 3..60 ticks of throttle before the lights; misjudge sometimes.
          const good = this.rnd() < this.p.startSkill;
          this.startPress = good ? 12 + Math.floor(this.rnd() * 36) : this.rnd() < 0.5 ? 70 + Math.floor(this.rnd() * 60) : 0;
        }
        input.throttle = this.startPress > 0 && sim.goTick - sim.tick <= this.startPress ? 1 : 0;
      }
      return input;
    }
    if (st.fallTicks > 0 || st.warpTicks > 0) {
      input.throttle = 1;
      this.driftHeld = false;
      return input;
    }
    const info = kart.info;
    const speed = Math.max(0, info.forwardSpeed);

    // --- Recovery -----------------------------------------------------------------------------
    // Watchdog: no progress for ~2.5 s (wedged against something) → back out and head for the centre.
    if (sim.status === 'racing' && st.spinTicks === 0) {
      if (this.watchS < 0 || Math.abs(loopDelta(this.watchS, info.s, track.length)) > 4) {
        this.watchS = info.s;
        this.watchTick = sim.tick;
      } else if (sim.tick - this.watchTick > 150) {
        this.watchTick = sim.tick;
        this.escape = 100;
        this.reverse = 35;
        this.reverseSteer = 0;
      }
    }
    if (this.escape > 0) this.escape--;
    if (this.reverse > 0) {
      this.reverse--;
      const want = this.trackHeading(track, st, info.s);
      const turn = wrapAngle(want - st.heading);
      this.driftHeld = false;
      if (this.tailToWall(track, kart)) {
        // Backed up against the wall: the way out is forward, turning toward the track direction.
        input.throttle = 1;
        input.steer = Math.sign(turn || 1);
        return input;
      }
      input.brake = 1;
      input.steer = this.reverseSteer !== 0 ? this.reverseSteer : -Math.sign(turn || 1);
      return input;
    }
    this.reverseSteer = 0;
    // Nose against a bumper/stomper at a crawl: back off, turning the nose away from it.
    if (speed < 9 && sim.status === 'racing') {
      const side = this.blocker(sim, kart);
      if (side !== 0) {
        this.reverse = 22;
        this.reverseSteer = side;
        input.brake = 1;
        input.steer = side;
        return input;
      }
    }
    if (Math.abs(info.forwardSpeed) < 1.5 && st.spinTicks === 0 && sim.status === 'racing') this.stuck++;
    else this.stuck = Math.max(0, this.stuck - 2);
    if (this.stuck > 70) {
      this.stuck = 0;
      this.reverse = 35;
    }

    // --- Mistakes / lane choice ------------------------------------------------------------------
    if (this.mistake > 0) this.mistake--;
    else if (this.rnd() < this.p.mistakeRate / 60) {
      this.mistake = 40 + Math.floor(this.rnd() * 70);
      this.mistakeKind = Math.floor(this.rnd() * 3);
    }
    if (--this.laneTimer <= 0) {
      this.laneTimer = 120 + Math.floor(this.rnd() * 240);
      this.lane = (this.rnd() - 0.5) * (this.skill === 'hard' ? 1.2 : this.skill === 'normal' ? 2.4 : 3.6);
    }

    // --- Route + look-ahead -------------------------------------------------------------------
    const s = info.s;
    const kNear = this.maxCurv(track, s, 24);
    let look = 4 + speed * 0.32;
    if (kNear > 0.015) look = Math.min(look, Math.max(4.5, 0.75 / kNear));
    // On a branch it didn't choose (brushed the mouth): steer back to the main line while that's
    // still possible; once committed (past its mouth) follow it.
    let onBranch: BuiltBranch | null = st.branch >= 0 ? track.branches[st.branch]! : null;
    if (onBranch && !this.branchPlan.get(onBranch.index) && info.roadS < 30) onBranch = null;
    if (!onBranch) {
      for (const b of track.branches) {
        const rel = loopDelta(s, b.from, track.length);
        if (rel < 0 || rel > 45) continue;
        if (!this.branchPlan.has(b.index)) {
          const turbo = itemIdOf(st) === 'turbo' || itemIdOf(st) === 'turbo3';
          const useful = b.surface === 'road' ? b.length < b.to - b.from + 5 : turbo;
          this.branchPlan.set(b.index, useful && this.rnd() < this.p.shortcuts);
        }
        if (this.branchPlan.get(b.index) && rel < look + 4) onBranch = b;
      }
    }
    // Past a branch's rejoin: decide afresh next lap.
    for (const b of track.branches) {
      const past = loopDelta(b.to, s, track.length);
      if (st.branch !== b.index && past > 5 && past < 120) this.branchPlan.delete(b.index);
    }
    let tx: number;
    let ty: number;
    if (onBranch && st.branch === onBranch.index) {
      const roadS = info.roadS;
      if (roadS + look > onBranch.length) {
        const p = racingPointAt(track, onBranch.to + (roadS + look - onBranch.length));
        tx = p.x;
        ty = p.y;
      } else {
        const i = Math.min(onBranch.n - 1, Math.floor((roadS + look) / onBranch.spacing));
        tx = onBranch.xs[i]!;
        ty = onBranch.ys[i]!;
      }
    } else if (onBranch) {
      const i = Math.min(onBranch.n - 1, Math.floor(look / onBranch.spacing) + 2);
      tx = onBranch.xs[i]!;
      ty = onBranch.ys[i]!;
    } else {
      const p = racingPointAt(track, s + look);
      const ti = mainIndexAt(track, s + look);
      const hwL = track.hwL[ti]!;
      const hwR = track.hwR[ti]!;
      let lane = this.lane * (this.mistake > 0 && this.mistakeKind === 1 ? 2.2 : 1);
      lane += this.avoidance(sim, kart, s);
      lane += this.padPull(track, s, p.d);
      lane += this.hazardDodge(sim, s, speed, p.d + lane, info.d);
      if (this.escape > 0) lane = -p.d; // escaping: the road centre
      const d = clamp(p.d + lane, -hwR + 1.6, hwL - 1.6) - p.d;
      tx = p.x - track.ty[ti]! * d;
      ty = p.y + track.tx[ti]! * d;
    }
    const aim = datan2(ty - st.y, tx - st.x);
    let errH = wrapAngle(aim - st.heading);
    if (info.headingDot < -0.2) errH = wrapAngle(this.trackHeading(track, st, s) - st.heading);
    if (this.mistake > 0 && this.mistakeKind === 1) errH += dsin(sim.tick * 0.2) * 0.1;
    errH += (this.rnd() - 0.5) * this.p.noise;

    // --- Speed plan -----------------------------------------------------------------------------
    const late = this.mistake > 0 && this.mistakeKind === 0;
    const margin = Math.round(this.p.corner * (late ? 1.1 : 1) * 100) / 100;
    const caps = cornerCaps(track, spec, margin);
    const i0 = mainIndexAt(track, s);
    const brakeA = 24;
    const horizon = Math.ceil((speed * speed) / (2 * brakeA) / track.spacing) + 6;
    const driftBonus = st.driftDir !== 0 ? 1.18 : 1;
    let target = Infinity;
    let maxK = 0;
    for (let k = 0; k < horizon; k++) {
      const idx = (i0 + k) % track.n;
      const cap = caps[idx]! * driftBonus;
      const v = Math.sqrt(cap * cap + 2 * brakeA * k * track.spacing);
      if (v < target) target = v;
      maxK = Math.max(maxK, Math.abs(track.racingLine.curvature[idx]!));
    }
    if (onBranch && st.branch === onBranch.index) target = Math.min(target, 40 - this.maxBranchCurv(onBranch, info.roadS) * 400);
    target = Math.min(target, this.hazardSlow(sim, kart, s, speed));
    const paceCap = st.boostTicks > 0 || st.magnetTicks > 0 ? Infinity : spec.topSpeed * this.p.pace;

    // --- Drift ----------------------------------------------------------------------------------
    const corner = onBranch ? null : this.nextCorner(track, s);
    let drift = false;
    let steer: number;
    if (st.driftDir !== 0) {
      this.driftTicks++;
      // Steer the arc from the direction of travel: pure-pursuit curvature → inside/outside steer.
      const velA = datan2(st.vy, st.vx);
      const errV = wrapAngle(aim - velA);
      const wReq = (2 * dsin(errV) * Math.max(speed, 8)) / look;
      const kNeed = (wReq * st.driftDir) / driftArcRate(spec, speed, 1);
      const along = clamp(((kNeed - 0.18) / 0.87) * 2 - 1, -1, 1);
      steer = along * st.driftDir;
      const stage = driftStage(st);
      const exit = this.cornerExit(track, s, st.driftDir);
      const holdLong = this.mistake > 0 && this.mistakeKind === 2;
      if (kNeed < 0.12) this.straightTicks++;
      else this.straightTicks = 0;
      // Nearly at stage 1 at the exit: hold on a moment longer for the mini-turbo.
      const almost = stage === 0 && st.driftCharge >= DRIFT_STAGE_POINTS[0] - 120;
      const exiting = exit < 3 + speed * 0.12 && !(almost && this.straightTicks < 12);
      const release =
        st.grounded &&
        ((!holdLong && exiting) ||
          (!holdLong && stage >= this.p.driftStage && exit < 10 + speed * 0.2) ||
          this.straightTicks > 10 ||
          kNeed > 1.35 ||
          this.driftTicks > 240);
      drift = !release;
    } else if (this.driftHeld) {
      // Hop in progress: keep the button and the side until the direction locks.
      drift = st.driftArmed && this.driftTicks++ < 30;
      steer = this.driftWant;
    } else {
      this.driftTicks = 0;
      steer = 0;
      if (
        corner &&
        corner.start < 3 + speed * 0.14 &&
        speed > 15 &&
        st.grounded &&
        info.surface === 0 &&
        corner.length > (this.skill === 'easy' ? 45 : 28)
      ) {
        let go = this.cornerPlan.get(corner.id);
        if (go === undefined) {
          go = this.rnd() < this.p.driftChance;
          this.cornerPlan.set(corner.id, go);
          if (this.cornerPlan.size > 64) this.cornerPlan.clear();
        }
        if (go) {
          drift = true;
          this.driftWant = corner.sign;
          this.driftTicks = 0;
          steer = corner.sign;
        }
      }
    }
    if (!drift || st.driftDir === 0) {
      if (!(drift && st.driftDir === 0)) {
        // Grip steering: pure pursuit + curvature feed-forward, damped by the yaw rate.
        const kHere = track.racingLine.curvature[(i0 + 1) % track.n]!;
        const ff = onBranch ? 0 : (speed * kHere) / Math.max(0.3, spec.turnRate * steerFactor(speed, spec.steerTop));
        steer = clamp(ff * 0.5 + errH * 2.3 - st.angVel * 0.06, -1, 1);
      }
    }
    this.driftHeld = drift;

    input.steer = steer;
    input.drift = drift;
    const want = Math.min(target, paceCap);
    if (speed < want) input.throttle = 1;
    else if (speed < want * 1.05) input.throttle = 0.4;
    if (speed > target * 1.1 && speed > 8) {
      input.brake = 1;
      input.throttle = 0;
    }
    if (Math.abs(errH) > 1.3 && speed > 12 && st.driftDir === 0) input.throttle = 0.3;

    this.useItems(sim, kart, input, maxK);
    return input;
  }

  /** True when the kart sits at a road edge with its tail toward that edge. */
  private tailToWall(track: KartTrack, kart: SimKart): boolean {
    const info = kart.info;
    const hw = info.d >= 0 ? track.hwL[mainIndexAt(track, info.s)]! : track.hwR[mainIndexAt(track, info.s)]!;
    if (info.branch >= 0 || Math.abs(info.d) < hw + track.shoulder - 2.5) return false;
    const i = mainIndexAt(track, info.s);
    const side = info.d >= 0 ? 1 : -1;
    const ox = -track.ty[i]! * side;
    const oy = track.tx[i]! * side;
    return dcos(kart.state.heading) * ox + dsin(kart.state.heading) * oy < -0.2;
  }

  /** A solid hazard right in front of the nose: +1 if it's to the left, −1 right, 0 none. */
  private blocker(sim: KartSim, kart: SimKart): number {
    const st = kart.state;
    const fx = dcos(st.heading);
    const fy = dsin(st.heading);
    const track = sim.track;
    for (let i = 0; i < track.hazards.length; i++) {
      const h = track.hazards[i]!;
      if (h.kind !== 'bumper' && h.kind !== 'stomper') continue;
      const dx = h.x - st.x;
      const dy = h.y - st.y;
      const fwd = dx * fx + dy * fy;
      if (fwd < 0 || fwd > h.radius + 3) continue;
      const lat = dx * -fy + dy * fx;
      if (Math.abs(lat) > h.radius + 1.1) continue;
      return lat >= 0 ? 1 : -1;
    }
    return 0;
  }

  private maxCurv(track: KartTrack, s: number, dist: number): number {
    const i0 = mainIndexAt(track, s);
    const n = Math.ceil(dist / track.spacing);
    let m = 0;
    for (let k = 0; k < n; k++) m = Math.max(m, Math.abs(track.racingLine.curvature[(i0 + k) % track.n]!));
    return m;
  }

  private maxBranchCurv(b: BuiltBranch, roadS: number): number {
    const i0 = Math.max(0, Math.floor(roadS / b.spacing));
    let m = 0;
    for (let k = i0; k < Math.min(b.n, i0 + 12); k++) m = Math.max(m, Math.abs(b.curvature[k]!));
    return m;
  }

  /** The next corner on the racing line within ~80 u (start, length, sign, mean curvature). */
  private nextCorner(track: KartTrack, s: number): Corner | null {
    const i0 = mainIndexAt(track, s);
    const scan = Math.ceil(80 / track.spacing);
    const rl = track.racingLine.curvature;
    for (let k = 1; k < scan; k++) {
      const c = rl[(i0 + k) % track.n]!;
      if (Math.abs(c) < KMIN) continue;
      const sign = c > 0 ? 1 : -1;
      let len = 0;
      let sum = 0;
      let j = k;
      while (j < k + 200) {
        const cj = rl[(i0 + j) % track.n]! * sign;
        if (cj < KMIN * 0.45) break;
        sum += cj;
        len++;
        j++;
      }
      return { start: k * track.spacing, length: len * track.spacing, sign, k: sum / Math.max(1, len), id: (i0 + k) % track.n };
    }
    return null;
  }

  /** Distance (u) until the racing line stops turning toward `dir`. */
  private cornerExit(track: KartTrack, s: number, dir: number): number {
    const i0 = mainIndexAt(track, s);
    const rl = track.racingLine.curvature;
    const n = Math.ceil(60 / track.spacing);
    for (let k = 0; k < n; k++) if (rl[(i0 + k) % track.n]! * dir < KMIN * 0.45) return k * track.spacing;
    return 60;
  }

  private tangentAt(track: KartTrack, s: number): [number, number] {
    const i = mainIndexAt(track, s);
    return [track.tx[i]!, track.ty[i]!];
  }

  private trackHeading(track: KartTrack, st: KartState, s: number): number {
    if (st.branch >= 0) {
      const b = track.branches[st.branch]!;
      const i = Math.min(b.n - 1, st.seg);
      return datan2(b.ty[i]!, b.tx[i]!);
    }
    const t = this.tangentAt(track, s);
    return datan2(t[1], t[0]);
  }

  /** Lateral nudge (u) around karts and traps just ahead on the line. */
  private avoidance(sim: KartSim, kart: SimKart, s: number): number {
    const L = sim.track.length;
    let push = 0;
    const st = kart.state;
    const fx = dcos(st.heading);
    const fy = dsin(st.heading);
    for (const o of sim.karts) {
      if (o === kart || o.retired) continue;
      const ahead = loopDelta(s, o.info.s, L);
      if (ahead <= 0.5 || ahead > 10) continue;
      const lat = (o.state.x - st.x) * -fy + (o.state.y - st.y) * fx;
      if (Math.abs(lat) > 2.8) continue;
      push += lat >= 0 ? -2.2 : 2.2;
    }
    if (this.p.items > 0.5) {
      for (const e of sim.entities) {
        if (e.kind !== 'mine' && e.kind !== 'puddle') continue;
        const dx = e.x - st.x;
        const dy = e.y - st.y;
        const fwd = dx * fx + dy * fy;
        if (fwd < 1 || fwd > 22) continue;
        const lat = dx * -fy + dy * fx;
        if (Math.abs(lat) > 3.2) continue;
        push += lat >= 0 ? -3 : 3;
      }
    }
    return clamp(push, -4, 4);
  }

  /** Lateral offset toward a boost pad ahead (relative to the racing line). */
  private padPull(track: KartTrack, s: number, lineD: number): number {
    if (this.p.items < 0.5) return 0;
    for (const p of track.boostPads) {
      const ahead = loopDelta(s, p.s, track.length);
      if (ahead > 2 && ahead < 45) return clamp(p.d - lineD, -6, 6) * (this.skill === 'hard' ? 1 : 0.6);
    }
    return 0;
  }

  /** Sideways dodge (u) around hazards that will be where the bot is going when it gets there. */
  private hazardDodge(sim: KartSim, s: number, speed: number, myD: number, kartD: number): number {
    if (this.p.hazards <= 0) return 0;
    const track = sim.track;
    let push = 0;
    // Rollers: through a roller run, hold the lane none of them can reach (the builder guarantees
    // one). Worst case — every roller of the run on the road — so it works in a pack too.
    const aheadS = s + 8 + speed * 0.3;
    const blocked: Array<[number, number]> = [];
    for (const h of track.hazards) {
      if (h.kind !== 'roller') continue;
      const rel = mod(h.s - aheadS, track.length);
      const relNow = mod(h.s - s, track.length);
      if (rel > h.amp + 12 && relNow > h.amp + 12 && mod(h.s - h.amp - s, track.length) > 70) continue;
      blocked.push([h.d - h.radius - 1.1 - 0.4, h.d + h.radius + 1.1 + 0.4]);
    }
    if (blocked.length) {
      const i = mainIndexAt(track, aheadS);
      const lo = -(track.hwR[i]! - 1.4);
      const hi = track.hwL[i]! - 1.4;
      blocked.sort((a, b) => a[0] - b[0]);
      let edge = lo;
      let target = myD;
      let bestDist = Infinity;
      // Commit to the free lane nearest the kart itself (not its aim point, which swaps sides
      // through a switchback), then keep the aim inside it.
      const consider = (a: number, b: number) => {
        if (b - a < 0.4) return;
        const dist = Math.abs(clamp(kartD, a, b) - kartD);
        if (dist < bestDist) {
          bestDist = dist;
          const m = Math.min(0.8, (b - a) / 3);
          target = clamp(myD, a + m, b - m);
        }
      };
      for (const [a, b] of blocked) {
        consider(edge, Math.min(a, hi));
        edge = Math.max(edge, b);
      }
      consider(edge, hi);
      // Normal/hard bots commit fully; easy bots only partly (they still get caught sometimes).
      push += (target - myD) * (this.p.hazards >= 0.7 ? 1 : 0.6);
    }
    for (let i = 0; i < track.hazards.length; i++) {
      const h = track.hazards[i]!;
      if (h.kind === 'laser' || h.kind === 'roller') continue;
      const ahead = loopDelta(s, h.s, track.length);
      if (ahead < 0 || ahead > 40) continue;
      const eta = Math.round((ahead / Math.max(speed, 8)) * 60);
      const pose = hazardPose(track, i, sim.tick + eta);
      if (!pose.active && h.kind !== 'bumper') continue;
      const need = pose.radius + 1.1 + 1.2;
      // Pass on the side the kart is already on when it's close (no swerving across its face).
      const ref = ahead < 18 ? kartD : myD;
      const side = ref !== pose.d ? Math.sign(ref - pose.d) : pose.d > 0 ? -1 : 1;
      const want = pose.d + side * need;
      const move = side > 0 ? Math.max(0, want - myD) : Math.min(0, want - myD);
      push += move * this.p.hazards;
    }
    return clamp(push, -8, 8);
  }

  /**
   * Speed cap (u/s) to time lasers and blocking stompers, chains included: the fastest constant
   * speed (down to 40 %) that reaches every timed hazard within 60 u in an "off" window; if none
   * works, stop short of the nearest one and go when it opens. Infinity when nothing needs timing.
   */
  private hazardSlow(sim: KartSim, kart: SimKart, s: number, speed: number): number {
    if (this.p.hazards < 0.5) return Infinity;
    const track = sim.track;
    const timed: Array<{ i: number; ahead: number }> = [];
    for (let i = 0; i < track.hazards.length; i++) {
      const h = track.hazards[i]!;
      if (h.kind !== 'laser' && h.kind !== 'stomper') continue;
      const ahead = loopDelta(s, h.s, track.length);
      if (ahead < -(h.kind === 'stomper' ? h.radius + 1.1 : 1) || ahead > 60) continue;
      // Stompers that leave room beside them are dodged (hazardDodge); only time the ones that block.
      if (h.kind === 'stomper') {
        const hi = mainIndexAt(track, h.s);
        const room = Math.max(track.hwL[hi]! - (h.d + h.radius), track.hwR[hi]! + (h.d - h.radius));
        if (room > 3.5) continue;
      }
      timed.push({ i, ahead });
    }
    if (timed.length === 0) return Infinity;
    // Clear if the hazard is off for the whole time the kart overlaps it (centre ± footprint).
    const clearAt = (i: number, eta: number, half: number) => {
      for (let dt = -half - 2; dt <= half + 2; dt += 1) if (hazardPose(track, i, sim.tick + eta + dt).active) return false;
      return true;
    };
    const halfTicks = (i: number, v: number) => {
      const h = track.hazards[i]!;
      return Math.ceil((((h.kind === 'stomper' ? h.radius : 0) + 1.1) / Math.max(v, 1)) * 60);
    };
    const vTop = Math.max(speed, kart.spec.topSpeed * 0.9);
    for (let f = 1; f >= 0.4 - 1e-9; f -= 0.05) {
      const v = vTop * f;
      let ok = true;
      for (const t of timed) {
        const eta = Math.round((t.ahead / v) * 60);
        if (!clearAt(t.i, eta, halfTicks(t.i, v))) {
          ok = false;
          break;
        }
      }
      if (ok) return f === 1 ? Infinity : v;
    }
    // Nothing works at a rolling pace: stop short of the nearest one; go the moment it opens.
    let nearest = timed[0]!;
    for (const t of timed) if (t.ahead < nearest.ahead) nearest = t;
    const v0 = Math.max(0, speed);
    const stopAt = nearest.ahead - (track.hazards[nearest.i]!.kind === 'stomper' ? track.hazards[nearest.i]!.radius + 2 : 2.5);
    if (stopAt < 0) return Infinity; // already under it: go
    const etaGo = Math.round(((-v0 + Math.sqrt(v0 * v0 + 2 * 18 * Math.max(0, nearest.ahead))) / 18) * 60);
    if (clearAt(nearest.i, etaGo, halfTicks(nearest.i, Math.max(v0, 8)))) return Infinity;
    return Math.sqrt(Math.max(0, 2 * 20 * stopAt));
  }

  private useItems(sim: KartSim, kart: SimKart, input: KartInput, maxK: number): void {
    const st = kart.state;
    const id = itemIdOf(st);
    if (!id || st.rouletteTicks > 0 || st.spinTicks > 0) {
      this.itemBtn = false;
      this.itemTicks = 0;
      input.item = false;
      return;
    }
    this.itemTicks++;
    const think = this.itemTicks > 20 + (1 - this.p.items) * 60;
    const L = sim.track.length;
    const tap = () => {
      // A press is a rising edge: release for a frame first when the button is down.
      if (this.itemBtn) {
        this.itemBtn = false;
      } else {
        this.itemBtn = true;
        this.itemTicks = 0;
      }
    };
    const straight = maxK < 0.012;
    const fx = dcos(st.heading);
    const fy = dsin(st.heading);
    const lined = (o: SimKart, maxDist: number, back: boolean): boolean => {
      const dx = o.state.x - st.x;
      const dy = o.state.y - st.y;
      const fwd = (dx * fx + dy * fy) * (back ? -1 : 1);
      if (fwd < 2 || fwd > maxDist) return false;
      const lat = Math.abs(dx * -fy + dy * fx);
      return lat < 1.2 + fwd * 0.06;
    };
    let ahead: SimKart | null = null;
    let behind: SimKart | null = null;
    for (const o of sim.karts) {
      if (o === kart || o.retired || sim.isGhost(o)) continue;
      if (!ahead && lined(o, 45, false)) ahead = o;
      if (!behind && lined(o, 18, true)) behind = o;
    }
    const threatened = sim.entities.some((e) => {
      if (e.owner === kart.slot) return false;
      if (e.kind === 'seeker') return e.target === kart.slot && loopDelta(e.s, kart.info.s, L) < 60;
      if (e.kind !== 'puck') return false;
      const dx = st.x - e.x;
      const dy = st.y - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      return d < 25 && (e.vx * dx + e.vy * dy) / (d * Math.sqrt(e.vx * e.vx + e.vy * e.vy) + 1e-6) > 0.9;
    });
    input.back = false;
    switch (id) {
      case 'turbo':
      case 'turbo3': {
        const onDirt = st.branch >= 0 && sim.track.branches[st.branch]!.surface === 'dirt';
        if (
          think &&
          st.boostTicks < 5 &&
          ((straight && kart.info.forwardSpeed > kart.spec.topSpeed * 0.6) || onDirt || kart.info.surface === 1)
        )
          tap();
        else this.itemBtn = false;
        break;
      }
      case 'puck':
      case 'puck3':
      case 'mine':
      case 'fizz': {
        const trap = id === 'mine' || id === 'fizz';
        // Hold (trail) as a shield; release to fire when there's a target.
        if (!this.itemBtn && !st.trailing) {
          if (this.itemTicks > 8 && this.p.items > 0.3) this.itemBtn = true;
          break;
        }
        let fire = false;
        if (trap) {
          if (behind && this.rnd() < this.p.items * 0.25) {
            fire = true;
            this.releaseBack = true;
          } else if (ahead && ahead.info.s !== undefined && lined(ahead, 25, false) && this.rnd() < this.p.items * 0.1) {
            fire = true;
            this.releaseBack = false;
          }
        } else if (ahead && this.rnd() < this.p.items * 0.3) {
          fire = true;
          this.releaseBack = false;
        } else if (behind && this.rnd() < this.p.items * 0.08) {
          fire = true;
          this.releaseBack = true;
        }
        if (this.itemTicks > 600) fire = true;
        if (fire) {
          this.itemBtn = false;
          this.itemTicks = 0;
          // Pucks: forward unless aimed back. Traps: dropped behind unless lobbed at a kart ahead.
          input.back = this.releaseBack;
          input.ahead = trap && !this.releaseBack;
        }
        break;
      }
      case 'seeker':
        if (think && kart.position > 1) tap();
        else this.itemBtn = false;
        break;
      case 'shield':
        if ((threatened && this.p.items > 0.3) || this.itemTicks > 480) tap();
        else this.itemBtn = false;
        break;
      case 'magnet': {
        const gapAhead = sim.karts.reduce(
          (best, o) => (o !== kart && !o.retired && o.distance > kart.distance ? Math.min(best, o.distance - kart.distance) : best),
          Infinity,
        );
        if (think && ((gapAhead > 25 && gapAhead < 150) || this.itemTicks > 400)) tap();
        else this.itemBtn = false;
        break;
      }
      case 'warp':
        if (think) tap();
        else this.itemBtn = false;
        break;
      case 'pulse': {
        const n = sim.karts.filter(
          (o) => o !== kart && !o.retired && o.distance > kart.distance && o.distance - kart.distance < 120,
        ).length;
        if (think && (n >= (this.skill === 'hard' ? 2 : 1) || this.itemTicks > 300)) tap();
        else this.itemBtn = false;
        break;
      }
    }
    input.item = this.itemBtn;
  }
}
