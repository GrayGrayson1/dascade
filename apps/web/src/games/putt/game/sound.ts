/**
 * DAS Putt procedural sounds (WebAudio via the shared synth: respects mute/volume and never
 * plays before a user gesture). Every sound is throttled so bouncy pinball holes never spam.
 */
import { sfx, synth } from '../../../audio/audio.ts';

const last = new Map<string, number>();
function gate(key: string, gapMs: number): boolean {
  const now = performance.now();
  if (now - (last.get(key) ?? 0) < gapMs) return false;
  last.set(key, now);
  return true;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const puttSound = {
  /** Club strike — louder and brighter with power (0..1). */
  strike(power: number): void {
    if (!gate('strike', 60)) return;
    const p = clamp01(power);
    synth.tone({ type: 'sine', freq: 1300 + p * 500, to: 700, dur: 0.05, gain: 0.08 + p * 0.1 });
    synth.noise({ dur: 0.035, gain: 0.12 + p * 0.14, freq: 3200, q: 1.4, type: 'highpass' });
    synth.tone({ type: 'triangle', freq: 180, to: 90, dur: 0.08, gain: 0.05 + p * 0.06 });
  },
  /** Cushion bounce; `speed` is the impact speed in units/s. */
  wall(speed: number): void {
    if (!gate('wall', 45)) return;
    const k = clamp01(speed / 900);
    synth.noise({ dur: 0.06, gain: 0.05 + k * 0.2, freq: 420 + k * 500, q: 1.1, type: 'lowpass' });
    synth.tone({ type: 'sine', freq: 190 + k * 90, to: 120, dur: 0.07, gain: 0.03 + k * 0.08 });
  },
  post(speed: number): void {
    if (!gate('post', 45)) return;
    const k = clamp01(speed / 900);
    synth.tone({ type: 'triangle', freq: 520 + k * 200, to: 380, dur: 0.07, gain: 0.04 + k * 0.08 });
  },
  bumper(): void {
    if (!gate('bumper', 50)) return;
    synth.tone({ type: 'square', freq: synth.note(76), to: synth.note(88), dur: 0.09, gain: 0.06 });
    synth.tone({ type: 'sine', freq: synth.note(95), start: 0.03, dur: 0.18, gain: 0.05 });
  },
  blade(speed: number): void {
    if (!gate('blade', 70)) return;
    const k = clamp01(speed / 800);
    synth.tone({ type: 'square', freq: 240, to: 160, dur: 0.07, gain: 0.03 + k * 0.05 });
    synth.noise({ dur: 0.05, gain: 0.08 + k * 0.1, freq: 2600, q: 3 });
  },
  sand(): void {
    if (!gate('sand', 150)) return;
    synth.noise({ dur: 0.22, gain: 0.12, freq: 900, q: 0.6, to: 400, type: 'lowpass' });
  },
  portal(): void {
    if (!gate('portal', 120)) return;
    synth.noise({ dur: 0.3, gain: 0.1, freq: 500, q: 0.7, to: 4200, type: 'bandpass' });
    [79, 86, 91].forEach((n, i) => synth.tone({ type: 'sine', freq: synth.note(n), start: 0.04 + i * 0.05, dur: 0.14, gain: 0.04 }));
  },
  lip(): void {
    if (!gate('lip', 200)) return;
    for (let i = 0; i < 3; i++) synth.tone({ type: 'triangle', freq: 1500 - i * 200, start: i * 0.045, dur: 0.035, gain: 0.05 });
  },
  cup(): void {
    if (!gate('cup', 200)) return;
    for (let i = 0; i < 3; i++) synth.tone({ type: 'triangle', freq: 1700 - i * 250, start: i * 0.04, dur: 0.03, gain: 0.06 });
    synth.tone({ type: 'sine', freq: 150, to: 70, start: 0.14, dur: 0.16, gain: 0.14 });
    synth.noise({ start: 0.13, dur: 0.08, gain: 0.12, freq: 600, q: 1, type: 'lowpass' });
  },
  splash(): void {
    if (!gate('splash', 200)) return;
    synth.noise({ dur: 0.45, gain: 0.26, freq: 1800, q: 0.8, to: 300, type: 'bandpass' });
    synth.noise({ start: 0.05, dur: 0.3, gain: 0.12, freq: 5200, q: 2, to: 2000 });
  },
  fall(): void {
    if (!gate('fall', 200)) return;
    synth.tone({ type: 'sine', freq: 620, to: 90, dur: 0.5, gain: 0.08 });
    synth.noise({ dur: 0.4, gain: 0.08, freq: 1400, to: 200, type: 'lowpass' });
  },
  turn(): void {
    sfx('ready', 300);
  },
  holed(strokes: number, par: number): void {
    if (strokes === 1) sfx('bigwin', 500);
    else if (strokes < par) sfx('win', 500);
    else if (strokes === par) sfx('correct', 500);
    else sfx('ding', 500);
  },
  penalty(): void {
    sfx('wrong', 300);
  },
  timeout(): void {
    sfx('error', 300);
  },
};
