/**
 * DAS Ships procedural sounds (WebAudio via the shared synth — respects mute/volume and never
 * plays before a user gesture). Restrained: short, low-mid, no harsh highs.
 */
import { sfx, synth } from '../../audio/audio.ts';

const N = synth.note;
let lastAt = 0;

function gap(ms: number): boolean {
  const now = performance.now();
  if (now - lastAt < ms) return false;
  lastAt = now;
  return true;
}

export const shipsSound = {
  /** Cannon launch: a quick falling thump. */
  fire(count = 1): void {
    for (let i = 0; i < Math.min(count, 4); i++) {
      synth.noise({ start: i * 0.07, dur: 0.18, gain: 0.22, freq: 900, to: 180, type: 'lowpass' });
      synth.tone({ type: 'triangle', freq: 180, to: 70, start: i * 0.07, dur: 0.16, gain: 0.12 });
    }
  },
  /** Water splash (miss). */
  splash(): void {
    synth.noise({ dur: 0.42, gain: 0.16, freq: 1600, to: 300, q: 0.7, type: 'lowpass' });
    synth.tone({ type: 'sine', freq: 620, to: 260, start: 0.05, dur: 0.18, gain: 0.05 });
  },
  /** Hit: crunch + low boom. */
  hit(): void {
    synth.noise({ dur: 0.35, gain: 0.3, freq: 1200, to: 160, q: 0.5, type: 'lowpass' });
    synth.tone({ type: 'square', freq: 110, to: 48, dur: 0.3, gain: 0.08 });
    synth.tone({ type: 'sawtooth', freq: 240, to: 90, start: 0.02, dur: 0.14, gain: 0.04 });
  },
  /** A vessel goes down: descending minor line + rumble. */
  sink(): void {
    [69, 65, 62, 57].forEach((n, i) => synth.tone({ type: 'triangle', freq: N(n), start: 0.12 + i * 0.13, dur: 0.24, gain: 0.08 }));
    synth.noise({ start: 0.05, dur: 0.9, gain: 0.18, freq: 500, to: 70, q: 0.4, type: 'lowpass' });
  },
  /** Sonar ping: your turn. */
  turn(): void {
    if (!gap(400)) return;
    synth.tone({ type: 'sine', freq: N(88), dur: 0.28, gain: 0.07 });
    synth.tone({ type: 'sine', freq: N(88), start: 0.3, dur: 0.4, gain: 0.025 });
  },
  place(): void {
    sfx('pop');
  },
  rotate(): void {
    sfx('click');
  },
  invalid(): void {
    sfx('error', 120);
  },
  ready(): void {
    sfx('ready');
  },
  battle(): void {
    [57, 64, 69, 76].forEach((n, i) => synth.tone({ type: 'square', freq: N(n), start: i * 0.09, dur: 0.16, gain: 0.07 }));
  },
  win(): void {
    sfx('bigwin');
  },
  lose(): void {
    sfx('lose');
  },
};
