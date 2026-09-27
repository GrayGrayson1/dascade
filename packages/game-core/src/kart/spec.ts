/**
 * Racer stats (1..5, summing to 15) → physical parameters. Tuned with the balance test
 * (balance.test.ts): hard bots on the reference tracks lap every racer within a few percent.
 *
 *  speed    → top speed (≈ 28.7–30 u/s; boosts reach ~40)
 *  accel    → thrust (0 → 95 % of top in ≈ 2.7 s … 1.8 s); heavy karts lose a little
 *  handling → peak yaw rate, drift tightness and drift charge speed
 *  grip     → lateral grip and the cornering limit at speed, off-road top speed, ice
 *  weight   → bump mass (heavier pushes lighter karts around)
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
  topPerSpeed: 0.26,
  accelBase: 17.5,
  accelPerAccel: 3.2,
  accelPerWeight: -0.4,
  turnBase: 2.0,
  turnPerHandling: 0.24,
  latBase: 30,
  latPerGrip: 5,
  gripBase: 8.5,
  gripPerGrip: 0.9,
  chargePerHandling: 0.06,
  steerTopBase: 0.44,
  steerTopPerHandling: 0.02,
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
    steerTop: B.steerTopBase + B.steerTopPerHandling * stats.handling,
    latMax: B.latBase + B.latPerGrip * stats.grip,
    grip: B.gripBase + B.gripPerGrip * stats.grip,
    offroadTop: 0.5 + 0.06 * stats.grip,
    offroadAccel: 0.55 + 0.06 * stats.grip,
    iceGrip: 0.1 + 0.05 * stats.grip,
    driftTurn: 1 + 0.02 * (stats.handling - 3),
    chargeRate: 1 + B.chargePerHandling * (stats.handling - 3),
    mass: 0.7 + 0.15 * stats.weight,
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
