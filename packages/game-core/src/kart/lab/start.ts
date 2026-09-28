/* Start lab: distance 5 s after GO for a neutral start (gas at GO), a timed start, and gas held through the countdown. */
import { NEUTRAL_KART_INPUT, type KartRacerId } from '@dascade/shared/games/kart';
import { createKartState, stepKart } from '../kart.ts';
import { racerSpec } from '../spec.ts';
import { getLabTrack } from './feel.ts';

export function startDistance(racer: KartRacerId, holdTicks: number, countdown = 240, after = 300): number {
  const track = getLabTrack();
  const spec = racerSpec(racer);
  let st = createKartState(track, { x: 20, y: 0, z: 0, heading: 0, s: 20, d: 0 });
  for (let t = 0; t < countdown; t++)
    st = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: t >= countdown - holdTicks ? 1 : 0 }, spec, track, {
      locked: true,
      tick: t,
    }).state;
  for (let t = 0; t < after; t++)
    st = stepKart(st, { ...NEUTRAL_KART_INPUT, throttle: 1 }, spec, track, { locked: false, tick: countdown + t }).state;
  return st.x - 20;
}

/** Seconds gained (+) or lost (−) vs a neutral start, at the racer's top speed. */
export function startGain(racer: KartRacerId, holdTicks: number): number {
  return (startDistance(racer, holdTicks) - startDistance(racer, 0)) / racerSpec(racer).topSpeed;
}

if ((globalThis as { process?: { argv: string[] } }).process?.argv[1]?.endsWith('start.ts')) {
  for (const r of ['byte', 'nova', 'brick'] as const) {
    console.log(
      r,
      'timed(30)',
      startGain(r, 30).toFixed(2),
      's | held all countdown',
      startGain(r, 240).toFixed(2),
      's | held 1.5 s',
      startGain(r, 90).toFixed(2),
      's',
    );
  }
}
