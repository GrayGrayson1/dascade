/**
 * Procedural sounds for the wheel: a woody peg clack (pitched by speed), the
 * launch whoosh, and the landing fanfare. All routed through the shared SFX bus,
 * so volume / mute settings apply.
 */
import { useApp } from '../../app/store.ts';
import { sfx, synth } from '../../audio/audio.ts';

let lastTickAt = 0;

function audible(): boolean {
  const s = useApp.getState().settings;
  return !s.muted && s.masterVolume > 0 && s.sfxVolume > 0;
}

/** One peg passing the flapper. `speed` is 0..1 (normalized angular velocity). */
export function pegTick(speed: number): void {
  const now = performance.now();
  // At full speed pegs pass faster than a click can sound; cap at ~35 clicks/s.
  if (now - lastTickAt < 28 || !audible()) return;
  lastTickAt = now;
  const s = Math.max(0, Math.min(1, speed));
  synth.noise({ dur: 0.018, gain: 0.1 + 0.05 * (1 - s), freq: 2600 + 1400 * s, q: 3.5 });
  synth.tone({ type: 'triangle', freq: 1250 + 500 * s, to: 700, dur: 0.035, gain: 0.07 });
}

export function spinLaunch(): void {
  if (!audible()) return;
  sfx('whoosh');
  synth.tone({ type: 'sawtooth', freq: 90, to: 260, dur: 0.5, gain: 0.035 });
}

export function spinReveal(): void {
  if (!audible()) return;
  sfx('ding');
  sfx('win');
  const n = synth.note;
  [67, 72, 76, 79].forEach((m, i) => synth.tone({ type: 'triangle', freq: n(m), start: 0.55 + i * 0.05, dur: 0.6, gain: 0.05 }));
}
