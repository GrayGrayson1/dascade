/**
 * Theme voices for sfx(): a skin may re-voice some named sound effects (ThemeSkin.sounds). A voice is
 * a plain function of a small synth kit (tone / noise / note) — no AudioContext of its own, so it stays
 * pure and testable — and sfx() still decides mute, volume, rate limiting and the jukebox dip exactly as
 * it does for the built-in sounds. Only the ACTIVE skin's voices play (ThemeHost sets and clears them);
 * a name without a voice plays its built-in sound, byte for byte.
 */
import type { SfxName } from './audio.ts';

export interface ToneSpec {
  type?: OscillatorType;
  freq: number;
  to?: number;
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  detune?: number;
}

export interface NoiseSpec {
  start?: number;
  dur: number;
  gain?: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
  to?: number;
  /** Fade-in time in seconds (default: starts at full gain). */
  attack?: number;
}

/** What a voice can play: the same primitives the built-in sounds use, on the SFX bus. */
export interface SfxKit {
  tone(o: ToneSpec): void;
  noise(o: NoiseSpec): void;
  /** MIDI note number → frequency in Hz. */
  note(midi: number): number;
}

export type SfxVoice = (kit: SfxKit) => void;
export type SfxVoices = Partial<Record<SfxName, SfxVoice>>;

let voices: SfxVoices | null = null;

/** The active skin's voices (null = built-in sounds only). */
export function setSfxVoices(next: SfxVoices | null | undefined): void {
  voices = next ?? null;
}

export function activeSfxVoices(): SfxVoices | null {
  return voices;
}

/** The active voice for `name`, ignoring anything that isn't a function. */
export function themeVoice(name: SfxName): SfxVoice | null {
  const voice = voices?.[name];
  return typeof voice === 'function' ? voice : null;
}

/** Plays the active skin's voice for `name`, or the built-in sound. */
export function playSfxVoice(name: SfxName, builtin: Readonly<Record<SfxName, () => void>>, kit: SfxKit): void {
  const voice = themeVoice(name);
  if (voice) voice(kit);
  else builtin[name]();
}
