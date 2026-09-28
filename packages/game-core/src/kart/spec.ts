/**
 * Racer stats (1..5, summing to 15) → physical parameters. Tuned against 8-kart pack races
 * (lab/pack.ts, balance.test.ts) with solo pace (lab/solotune.ts) and per-stat value
 * (lab/statvalue.ts) as guides. Every stat-3 value is the same as nova's, so a stat only moves
 * the racers that differ from 3.
 *
 *  speed    → top speed (29.4–30.6 u/s for Speed 2–5, a 4 % spread; boosts reach ~40)
 *  accel    → thrust (0 → 95 % of top in ≈ 2.1 s at Accel 4 … 4.1 s at Accel 1); heavy karts lose a little.
 *             Accel also sets how fast a racer recovers from hits, bumps and walls.
 *  handling → peak yaw rate (tight corners, low speed), drift tightness and drift charge speed
 *  grip     → cornering at speed: the lateral-acceleration limit and steering authority near top
 *             speed; lateral grip, off-road top speed, ice
 *  weight   → bump mass (heavier pushes lighter karts around)
 *
 * Measured value of a stat point (lab/statvalue.ts: stat 1 → 5, lap time, solo): speed ~4.3 %,
 * handling ~2.5 %, grip ~1.7 %, accel ~1.0 % solo (more in traffic and item races), weight 0 solo.
 */
import { KART_RACERS, type KartRacerId, type KartRacerStats } from '@dascade/shared/games/kart';

export interface KartSpec {
  racer: KartRacerId;
  stats: KartRacerStats;
  /** Top speed on road (u/s). */
  topSpeed: number;
  /** Thrust coefficient (u/s²): dv/dt = accel · (1 − (v/top)²). */
  accel: number;
  /** Braking deceleration (u/s²). */
  brake: number;
  reverseMax: number;
  /** Peak yaw rate (rad/s) at full steer, mid speed. */
  turnRate: number;
  /** Steering authority left at top speed (fraction of turnRate). */
  steerTop: number;
  /** Lateral velocity decay rate (1/s). */
  grip: number;
  /** Off-road top-speed multiplier. */
  offroadTop: number;
  /** Off-road thrust multiplier. */
  offroadAccel: number;
  /** Grip multiplier on ice. */
  iceGrip: number;
  /** Drift yaw multiplier. */
  driftTurn: number;
  /** Drift charge speed multiplier (handling: drifters reach the stages sooner). */
  chargeRate: number;
  /** Lateral acceleration limit (u/s²) in grip turns: caps the yaw rate at speed. */
  latMax: number;
  /** Collision mass. */
  mass: number;
  /** Collision radius (u). */
  radius: number;
}

const cache = new Map<KartRacerId, KartSpec>();

/** Stat → physics coefficients (tuned with lab/balance.ts; see balance.test.ts). */
export const BALANCE = {
  topBase: 28.6,
  topPerSpeed: 0.4,
  accelBase: 13.9,
  accelPerAccel: 3.3,
  accelPerWeight: -0.4,
  turnBase: 2.075,
  turnPerHandling: 0.175,
  latBase: 28,
  latPerGrip: 5,
  gripBase: 8.5,
  gripPerGrip: 0.9,
  chargePerHandling: 0.1,
  steerTopBase: 0.425,
  steerTopPerHandling: 0.005,
  steerTopPerGrip: 0.025,
  massBase: 0.7,
  massPerWeight: 0.03,
};

export function specFromStats(racer: KartRacerId, stats: KartRacerStats): KartSpec {
  const B = BALANCE;
  return {
    racer,
    stats,
    topSpeed: B.topBase + B.topPerSpeed * stats.speed,
    accel: B.accelBase + B.accelPerAccel * stats.accel + B.accelPerWeight * (stats.weight - 3),
    brake: 40,
    reverseMax: 8,
    turnRate: B.turnBase + B.turnPerHandling * stats.handling,
    steerTop: B.steerTopBase + B.steerTopPerHandling * stats.handling + B.steerTopPerGrip * stats.grip,
    latMax: B.latBase + B.latPerGrip * stats.grip,
    grip: B.gripBase + B.gripPerGrip * stats.grip,
    offroadTop: 0.5 + 0.06 * stats.grip,
    offroadAccel: 0.55 + 0.06 * stats.grip,
    iceGrip: 0.1 + 0.05 * stats.grip,
    driftTurn: 1 + 0.02 * (stats.handling - 3),
    chargeRate: 1 + B.chargePerHandling * (stats.handling - 3),
    mass: B.massBase + B.massPerWeight * stats.weight,
    radius: 1.1,
  };
}

/** Forget cached specs (the balance lab mutates BALANCE). */
export function clearSpecCache(): void {
  cache.clear();
}

/** Physical spec of a racer (cached). */
export function racerSpec(id: KartRacerId): KartSpec {
  let spec = cache.get(id);
  if (!spec) {
    const info = KART_RACERS[id] ?? KART_RACERS.nova;
    spec = specFromStats(info.id, info.stats);
    cache.set(id, spec);
  }
  return spec;
}
