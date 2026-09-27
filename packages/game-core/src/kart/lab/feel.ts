/**
 * Feel lab: headless scripted drives that turn the physics into numbers (speed curves, yaw rate,
 * slip angle, turn/drift radius, stage timing, wall hits, air time). feel.test.ts pins the targets;
 * `pnpm exec tsx packages/game-core/src/kart/lab/run.ts` prints the full report.
 */
import { NEUTRAL_KART_INPUT, type KartInput, type KartRacerId } from '@dascade/shared/games/kart';
import { createKartState, driftStage, stepKart, type KartState, type KartStepInfo } from '../kart.ts';
import { datan2, dhypot, wrapAngle } from '../math.ts';
import { racerSpec, type KartSpec } from '../spec.ts';
import { buildTrack, type KartTrack } from '../track.ts';
import type { KartTrackDef } from '../trackdef.ts';

/** A long, very wide rounded rectangle: 700 u straights, room to circle and drift freely. */
export const LAB_DEF: KartTrackDef = {
  id: 'pixel-plaza',
  biome: 'city',
  points: [
    [0, 0],
    [350, 0],
    [700, 0],
    [800, 60],
    [800, 240],
    [700, 300],
    [350, 300],
    [0, 300],
    [-100, 240],
    [-100, 60],
  ],
  halfWidth: 16,
  shoulder: 20,
  offroad: 'grass',
  edge: 'wall',
  decorSeed: 1,
  parLapMs: 60000,
};

/** The same layout with the wall right at the road edge (wall-hit tests). */
export const LAB_WALL_DEF: KartTrackDef = { ...LAB_DEF, shoulder: 0 };

let labTrack: KartTrack | null = null;
let wallTrack: KartTrack | null = null;
export function getLabTrack(): KartTrack {
  return (labTrack ??= buildTrack(LAB_DEF));
}
export function getWallTrack(): KartTrack {
  return (wallTrack ??= buildTrack(LAB_WALL_DEF));
}

export interface Frame {
  t: number;
  state: KartState;
  info: KartStepInfo;
}

export type Script = (tick: number, st: KartState, info: KartStepInfo | null) => Partial<KartInput>;

/** Run a scripted drive from a pose (default: stopped at s = 20 on the lab straight). */
export function drive(
  script: Script,
  ticks: number,
  opts: { racer?: KartRacerId; track?: KartTrack; start?: KartState; spec?: KartSpec } = {},
): Frame[] {
  const track = opts.track ?? getLabTrack();
  const spec = opts.spec ?? racerSpec(opts.racer ?? 'nova');
  let st = opts.start ?? createKartState(track, { x: 20, y: 0, z: 0, heading: 0, s: 20, d: 0 });
  let info: KartStepInfo | null = null;
  const out: Frame[] = [];
  for (let t = 0; t < ticks; t++) {
    const input: KartInput = { ...NEUTRAL_KART_INPUT, ...script(t, st, info) };
    const r = stepKart(st, input, spec, track, { locked: false, tick: t });
    st = r.state;
    info = r.info;
    out.push({ t, state: st, info });
  }
  return out;
}

export const speedOf = (st: KartState) => dhypot(st.vx, st.vy);

/** A kart already moving at `v` u/s along the lab straight. */
export function rolling(v: number, x = 20, y = 0, track: KartTrack = getLabTrack()): KartState {
  const st = createKartState(track, { x, y, z: 0, heading: 0, s: x, d: y });
  st.vx = v;
  return st;
}

/** Time (s) until speed first reaches `v` (Infinity if never). */
export function timeTo(frames: Frame[], v: number): number {
  const f = frames.find((fr) => speedOf(fr.state) >= v);
  return f ? (f.t + 1) / 60 : Infinity;
}

/** Path radius from the velocity direction's turn rate, averaged over a window of frames. */
export function pathRadius(frames: Frame[], from: number, to: number): number {
  let turn = 0;
  let dist = 0;
  for (let i = from + 1; i < to; i++) {
    const a = frames[i - 1]!.state;
    const b = frames[i]!.state;
    turn += Math.abs(wrapAngle(datan2(b.vy, b.vx) - datan2(a.vy, a.vx)));
    dist += speedOf(b) / 60;
  }
  return turn > 1e-9 ? dist / turn : Infinity;
}

/** Mean |slip angle| (degrees) over a window. */
export function meanSlipDeg(frames: Frame[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += Math.abs(frames[i]!.info.slip);
  return ((sum / (to - from)) * 180) / Math.PI;
}

/** First tick at which a drift reached `stage`. */
export function stageTick(frames: Frame[], stage: number): number {
  const f = frames.find((fr) => driftStage(fr.state) >= stage);
  return f ? f.t : Infinity;
}
