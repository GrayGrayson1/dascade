/**
 * DASCADE mixer policy — pure numbers, unit-tested (mixPolicy.test.ts). The mixer (mixer.ts)
 * applies these with smooth `setTargetAtTime` ramps; no game adds its own ducking hacks.
 *
 * Graph:  sfx bus ─────────────────────────────┐
 *         gameMusic bus (procedural `music`) ──┼─► master ─► compressor ─► destination
 *         <audio> ─► analyser ─► jukebox bus ─► sfx-priority duck ─┘
 *
 * Policy (why the jukebox never buries gameplay sound):
 *  1. SFX are never attenuated by anything jukebox-related. Only the user's master/SFX/mute apply.
 *  2. The jukebox bus runs with fixed headroom (JUKEBOX_HEADROOM): at 100 % jukebox volume a
 *     mastered MP3 sits well below the synthesized SFX peaks, and the master compressor catches
 *     the rest.
 *  3. SFX priority: any audible game SFX (`sfx()`, `synth.tone/noise` above a quiet threshold)
 *     briefly dips the jukebox by SFX_DUCK_LEVEL (~−3 dB, 15 ms attack, ~300 ms release) so
 *     answer reveals, chess moves, explosions, impacts and phase cues cut through. UI hovers and
 *     ticks don't pump the music.
 *  3b. Sustained SFX (e.g. DASh Circuit's engine hum): a continuous game sound can't use the
 *     transient dip (it would pump), so it HOLDS a gentler dip (SFX_HOLD_LEVEL, slow ramp) for as
 *     long as it runs — `synth.hold(key, on)`. Transient dips release back to the hold level.
 *  4. Game music vs. jukebox: while the jukebox is AUDIBLY playing (playing, not muted, volume > 0,
 *     master not muted), the procedural game music follows `gameMusicWithJukebox`:
 *     'mute' (default) → 0, 'duck' → GAME_MUSIC_DUCK_LEVEL, 'keep' → unchanged. Slow ramps (no pops).
 */

import type { GameMusicWithJukebox, VisualizerPref } from '../app/settings.ts';

export type { GameMusicWithJukebox, VisualizerPref };

export interface MixSettings {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  musicEnabled: boolean;
  muted: boolean;
  jukeboxVolume: number;
  gameMusicWithJukebox: GameMusicWithJukebox;
}

export interface JukeboxMixFlags {
  /** The jukebox element is actually playing. */
  playing: boolean;
  /** Local jukebox mute. */
  muted: boolean;
}

/** The procedural game music has always run at half the slider value. */
export const GAME_MUSIC_SCALE = 0.5;
/** Fixed jukebox headroom under the SFX (see policy 2). */
export const JUKEBOX_HEADROOM = 0.6;
/** Game music level while the jukebox plays, in 'duck' mode. */
export const GAME_MUSIC_DUCK_LEVEL = 0.2;
/** Jukebox dip while an important SFX plays (≈ −3 dB). */
export const SFX_DUCK_LEVEL = 0.7;
export const SFX_DUCK_ATTACK = 0.015;
export const SFX_DUCK_HOLD = 0.12;
export const SFX_DUCK_RELEASE = 0.3;
/** Jukebox level while a sustained game sound holds focus (≈ −5 dB), and its ramp. */
export const SFX_HOLD_LEVEL = 0.55;
export const SFX_HOLD_RAMP = 0.4;
/** synth.tone/noise calls quieter than this don't trigger the SFX-priority dip. */
export const SFX_DUCK_MIN_GAIN = 0.04;

/** Ramp time constants (seconds) for setTargetAtTime. */
export const RAMP = { master: 0.03, sfx: 0.03, gameMusic: 0.35, jukebox: 0.08 } as const;

const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function masterLevel(s: Pick<MixSettings, 'muted' | 'masterVolume'>): number {
  return s.muted ? 0 : unit(s.masterVolume);
}

export function sfxLevel(s: Pick<MixSettings, 'sfxVolume'>): number {
  return unit(s.sfxVolume);
}

/** Jukebox bus level (before master). */
export function jukeboxLevel(s: Pick<MixSettings, 'jukeboxVolume'>, flags: Pick<JukeboxMixFlags, 'muted'>): number {
  return flags.muted ? 0 : unit(s.jukeboxVolume) * JUKEBOX_HEADROOM;
}

/** True while the jukebox can actually be heard. */
export function isJukeboxAudible(s: Pick<MixSettings, 'muted' | 'masterVolume' | 'jukeboxVolume'>, flags: JukeboxMixFlags): boolean {
  return flags.playing && !flags.muted && !s.muted && unit(s.masterVolume) > 0 && unit(s.jukeboxVolume) > 0;
}

/** Game music bus level (before master), applying the jukebox policy. */
export function gameMusicLevel(s: MixSettings, flags: JukeboxMixFlags): number {
  if (!s.musicEnabled) return 0;
  const base = unit(s.musicVolume) * GAME_MUSIC_SCALE;
  if (!isJukeboxAudible(s, flags)) return base;
  if (s.gameMusicWithJukebox === 'mute') return 0;
  if (s.gameMusicWithJukebox === 'duck') return base * GAME_MUSIC_DUCK_LEVEL;
  return base;
}

/** Resting level of the jukebox SFX-priority stage: dipped while a sustained sound holds focus. */
export function jukeboxDuckBase(s: MixSettings, flags: JukeboxMixFlags, holding: boolean): number {
  return holding && isJukeboxAudible(s, flags) ? SFX_HOLD_LEVEL : 1;
}

/**
 * `<audio>.volume` when the element could not be routed through WebAudio (e.g. Safari refused
 * MediaElementSource): master × jukebox, so music still plays and still obeys every control.
 */
export function elementFallbackVolume(s: MixSettings, flags: Pick<JukeboxMixFlags, 'muted'>): number {
  return unit(masterLevel(s) * jukeboxLevel(s, flags));
}

/** 'auto' = on unless reduced motion or effects are off. */
export function visualizerEnabled(s: { visualizer: VisualizerPref; reducedMotion: boolean; fx: 'high' | 'low' | 'off' }): boolean {
  if (s.visualizer === 'on') return true;
  if (s.visualizer === 'off') return false;
  return !s.reducedMotion && s.fx !== 'off';
}
