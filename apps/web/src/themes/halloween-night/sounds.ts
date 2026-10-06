/**
 * Halloween Night's voices for a few sfx() names (see audio/voices.ts): same moments, same length and
 * loudness as the built-in sounds, spooky-cute flavour. Quiet UI chatter (hover, click, tick, message)
 * and every functional cue (countdown, error, go…) keep their own sounds.
 */
import type { SfxVoices } from '../../audio/voices.ts';

export const HALLOWEEN_SOUNDS: SfxVoices = {
  // Candy-wrapper crinkle, then a little "ting" (built-in coin: 0.35 s).
  coin: ({ noise, tone, note }) => {
    [0, 0.035, 0.065, 0.1, 0.12, 0.155, 0.19].forEach((start, i) =>
      noise({ start, dur: 0.028, gain: 0.1 + (i % 3) * 0.04, freq: 3600 + ((i * 1700) % 2500), q: 5 }),
    );
    tone({ type: 'triangle', freq: note(88), start: 0.2, dur: 0.16, gain: 0.07 });
  },
  // Cauldron "blorp": a bubble rising and popping (built-in pop: 0.07 s).
  pop: ({ tone, noise }) => {
    tone({ type: 'sine', freq: 170, to: 520, dur: 0.06, gain: 0.1 });
    tone({ type: 'sine', freq: 260, to: 760, start: 0.05, dur: 0.07, gain: 0.08 });
    noise({ dur: 0.05, gain: 0.06, freq: 400, q: 0.8, type: 'lowpass' });
  },
  // Music-box chime: E6 then G6, with a faint detuned shimmer (built-in ding: 0.6 s, E6).
  ding: ({ tone, note }) => {
    tone({ type: 'triangle', freq: note(88), dur: 0.5, gain: 0.1 });
    tone({ type: 'triangle', freq: note(91), start: 0.11, dur: 0.5, gain: 0.06 });
    tone({ type: 'sine', freq: note(100), dur: 0.35, gain: 0.025, detune: 12 });
  },
  // A friendly ghost's "ooo": a soft rising glide with a wobbly twin (built-in join: 0.26 s).
  join: ({ tone, note }) => {
    tone({ type: 'sine', freq: note(67), to: note(74), dur: 0.2, gain: 0.1, attack: 0.04 });
    tone({ type: 'sine', freq: note(67), to: note(74), dur: 0.2, gain: 0.05, attack: 0.04, detune: 14 });
    tone({ type: 'sine', freq: note(74), to: note(71), start: 0.18, dur: 0.16, gain: 0.08 });
  },
  // Minor jingle, theremin swoop, and a happy C-major ending (wheel landings play ding + win + a
  // C-major arpeggio together, so it must land in C major).
  win: ({ tone, note }) => {
    [72, 75, 79, 78].forEach((n, i) => tone({ type: 'square', freq: note(n), start: i * 0.09, dur: 0.14, gain: 0.08 }));
    tone({ type: 'sine', freq: note(79), to: note(84), start: 0.36, dur: 0.22, gain: 0.09, attack: 0.03 });
    tone({ type: 'sine', freq: note(79), to: note(84), start: 0.36, dur: 0.22, gain: 0.045, attack: 0.03, detune: 18 });
    tone({ type: 'triangle', freq: note(88), start: 0.56, dur: 0.18, gain: 0.08 });
  },
  // Minor run up, a big theremin swoop and a bright C-major chord (built-in bigwin: 1.4 s).
  bigwin: ({ tone, note }) => {
    [72, 75, 79, 84, 87, 91].forEach((n, i) => tone({ type: 'square', freq: note(n), start: i * 0.07, dur: 0.18, gain: 0.085 }));
    tone({ type: 'sine', freq: note(84), to: note(96), start: 0.42, dur: 0.35, gain: 0.07, attack: 0.04 });
    tone({ type: 'sine', freq: note(84), to: note(96), start: 0.42, dur: 0.35, gain: 0.035, attack: 0.04, detune: 16 });
    [60, 64, 67, 72].forEach((n) => tone({ type: 'triangle', freq: note(n), start: 0.55, dur: 0.85, gain: 0.08 }));
  },
};
