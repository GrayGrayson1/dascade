/**
 * Procedural sounds for the wheel: a woody peg clack (pitched by speed), the
 * launch whoosh, and the landing fanfare. All routed through the shared SFX bus,
 * so volume / mute settings apply. A theme may re-voice the three moments
 * (ThemeSkin.wheel.voices, see themes/wheelSkin.ts); without one they play as here.
 */
import { useApp } from '../../app/store.ts';
import { sfx, synth } from '../../audio/audio.ts';
import type { SfxKit } from '../../audio/voices.ts';
import { activeSkin } from '../../themes/registry.ts';
import type { WheelSlice, WheelVoices } from '../../themes/wheelSkin.ts';

let lastTickAt = 0;

/** What a theme's wheel voice plays with: the shared synth (SFX bus, jukebox dip), like the sounds below. */
const KIT: SfxKit = { tone: (o) => synth.tone(o), noise: (o) => synth.noise(o), note: synth.note };

function audible(): boolean {
  const s = useApp.getState().settings;
  return !s.muted && s.masterVolume > 0 && s.sfxVolume > 0;
}

/** The active theme's voice for a wheel moment (null: play the built-in sound). */
function themeVoice<K extends keyof WheelVoices>(name: K): NonNullable<WheelVoices[K]> | null {
  const voice = activeSkin()?.wheel?.voices?.[name];
  return typeof voice === 'function' ? (voice as NonNullable<WheelVoices[K]>) : null;
}

/** Runs a theme voice; a broken one falls back to silence, never to a crash mid-spin. */
function play(run: () => void): void {
  try {
    run();
  } catch {
    /* never let audio break the wheel */
  }
}

/** One peg passing the flapper. `speed` is 0..1 (normalized angular velocity). */
export function pegTick(speed: number): void {
  const now = performance.now();
  // At full speed pegs pass faster than a click can sound; cap at ~35 clicks/s.
  if (now - lastTickAt < 28 || !audible()) return;
  lastTickAt = now;
  const s = Math.max(0, Math.min(1, speed));
  const voice = themeVoice('tick');
  if (voice) return play(() => voice(KIT, s));
  synth.noise({ dur: 0.018, gain: 0.1 + 0.05 * (1 - s), freq: 2600 + 1400 * s, q: 3.5 });
  synth.tone({ type: 'triangle', freq: 1250 + 500 * s, to: 700, dur: 0.035, gain: 0.07 });
}

export function spinLaunch(): void {
  if (!audible()) return;
  const voice = themeVoice('launch');
  if (voice) return play(() => voice(KIT));
  sfx('whoosh');
  synth.tone({ type: 'sawtooth', freq: 90, to: 260, dur: 0.5, gain: 0.035 });
}

export function spinReveal(slice: WheelSlice): void {
  if (!audible()) return;
  const voice = themeVoice('reveal');
  if (voice) return play(() => voice(KIT, { label: slice.label, emoji: slice.emoji, color: slice.color }));
  sfx('ding');
  sfx('win');
  const n = synth.note;
  [67, 72, 76, 79].forEach((m, i) => synth.tone({ type: 'triangle', freq: n(m), start: 0.55 + i * 0.05, dur: 0.6, gain: 0.05 }));
}
