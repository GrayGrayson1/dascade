/**
 * The Classics sound palette — short, restrained, procedural (WebAudio via audio.ts), so it
 * honours mute/volume and never plays before a user gesture.
 *
 *   classicSfx('brick', { pitch: 3 })   // pitch = semitone offset for variety / combos
 */
import { sfx, synth } from '../../audio/audio.ts';

export type ClassicSound =
  | 'move'
  | 'rotate'
  | 'lock'
  | 'harddrop'
  | 'hold'
  | 'line'
  | 'quad'
  | 'levelup'
  | 'gameover'
  | 'bounce'
  | 'wall'
  | 'brick'
  | 'armor'
  | 'steel'
  | 'explode'
  | 'powerup'
  | 'laser'
  | 'lifelost'
  | 'launch'
  | 'tile'
  | 'wrong'
  | 'correct'
  | 'count'
  | 'go'
  | 'record'
  | 'pause';

const last = new Map<string, number>();
const N = (m: number) => synth.note(m);

export function classicSfx(name: ClassicSound, opts: { pitch?: number; gap?: number; index?: number } = {}): void {
  const now = performance.now();
  const key = name;
  if (now - (last.get(key) ?? 0) < (opts.gap ?? 28)) return;
  last.set(key, now);
  const p = opts.pitch ?? 0;
  const tone = synth.tone;
  const noise = synth.noise;
  switch (name) {
    case 'move':
      tone({ type: 'square', freq: N(84), dur: 0.025, gain: 0.025 });
      break;
    case 'rotate':
      tone({ type: 'square', freq: N(76), to: N(83), dur: 0.05, gain: 0.04 });
      break;
    case 'lock':
      tone({ type: 'triangle', freq: N(45), to: N(36), dur: 0.09, gain: 0.16 });
      noise({ dur: 0.05, gain: 0.05, freq: 900, q: 0.8 });
      break;
    case 'harddrop':
      noise({ dur: 0.12, gain: 0.08, freq: 2400, to: 300, q: 0.7 });
      tone({ type: 'triangle', freq: N(40), to: N(28), dur: 0.14, gain: 0.2 });
      break;
    case 'hold':
      tone({ type: 'sine', freq: N(79), dur: 0.06, gain: 0.07 });
      tone({ type: 'sine', freq: N(74), start: 0.05, dur: 0.08, gain: 0.06 });
      break;
    case 'line': {
      const lines = Math.max(1, Math.min(3, opts.index ?? 1));
      for (let i = 0; i < lines + 1; i++) tone({ type: 'square', freq: N(72 + p + [0, 4, 7, 12][i]!), start: i * 0.045, dur: 0.1, gain: 0.06 });
      break;
    }
    case 'quad':
      [0, 4, 7, 12, 16, 19].forEach((n, i) => tone({ type: 'square', freq: N(72 + p + n), start: i * 0.04, dur: 0.12, gain: 0.06 }));
      tone({ type: 'sawtooth', freq: N(48 + p), dur: 0.4, gain: 0.05, attack: 0.02 });
      break;
    case 'levelup':
      [0, 5, 9, 12, 17].forEach((n, i) => tone({ type: 'triangle', freq: N(69 + n), start: i * 0.06, dur: 0.16, gain: 0.1 }));
      break;
    case 'gameover':
      [12, 7, 3, 0, -5].forEach((n, i) => tone({ type: 'square', freq: N(60 + n), start: i * 0.14, dur: 0.2, gain: 0.07 }));
      break;
    case 'bounce':
      tone({ type: 'square', freq: N(67 + p), dur: 0.05, gain: 0.07 });
      break;
    case 'wall':
      tone({ type: 'square', freq: N(55 + p), dur: 0.035, gain: 0.04 });
      break;
    case 'brick':
      tone({ type: 'square', freq: N(79 + p), to: N(84 + p), dur: 0.06, gain: 0.06 });
      break;
    case 'armor':
      tone({ type: 'triangle', freq: N(88 + p), dur: 0.08, gain: 0.07 });
      noise({ dur: 0.05, gain: 0.04, freq: 5200, q: 3, type: 'highpass' });
      break;
    case 'steel':
      tone({ type: 'sine', freq: N(96), dur: 0.12, gain: 0.05 });
      tone({ type: 'sine', freq: N(103), dur: 0.08, gain: 0.03 });
      break;
    case 'explode':
      noise({ dur: 0.35, gain: 0.16, freq: 1600, to: 90, q: 0.6, type: 'lowpass' });
      tone({ type: 'triangle', freq: N(40), to: N(24), dur: 0.3, gain: 0.14 });
      break;
    case 'powerup':
      tone({ type: 'square', freq: N(72), to: N(96), dur: 0.22, gain: 0.06 });
      tone({ type: 'triangle', freq: N(84), start: 0.1, dur: 0.18, gain: 0.07 });
      break;
    case 'laser':
      tone({ type: 'sawtooth', freq: N(100), to: N(76), dur: 0.09, gain: 0.04 });
      break;
    case 'lifelost':
      [7, 3, 0, -4].forEach((n, i) => tone({ type: 'triangle', freq: N(64 + n), start: i * 0.11, dur: 0.16, gain: 0.1 }));
      break;
    case 'launch':
      tone({ type: 'square', freq: N(60), to: N(79), dur: 0.08, gain: 0.05 });
      break;
    case 'tile': {
      // Pentatonic pitch per tile index, so patterns have a melody.
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
      const i = Math.max(0, opts.index ?? 0) % scale.length;
      tone({ type: 'triangle', freq: N(64 + scale[i]!), dur: 0.22, gain: 0.12, attack: 0.01 });
      tone({ type: 'sine', freq: N(76 + scale[i]!), dur: 0.14, gain: 0.04 });
      break;
    }
    case 'wrong':
      tone({ type: 'sawtooth', freq: N(43), dur: 0.28, gain: 0.07 });
      tone({ type: 'square', freq: N(42), dur: 0.28, gain: 0.04, detune: 20 });
      break;
    case 'correct':
      tone({ type: 'triangle', freq: N(84), dur: 0.08, gain: 0.08 });
      tone({ type: 'triangle', freq: N(91), start: 0.07, dur: 0.14, gain: 0.08 });
      break;
    case 'count':
      tone({ type: 'square', freq: N(69), dur: 0.09, gain: 0.07 });
      break;
    case 'go':
      tone({ type: 'square', freq: N(81), dur: 0.22, gain: 0.08 });
      tone({ type: 'triangle', freq: N(93), dur: 0.22, gain: 0.05 });
      break;
    case 'record':
      sfx('bigwin');
      break;
    case 'pause':
      tone({ type: 'sine', freq: N(72), dur: 0.08, gain: 0.06 });
      tone({ type: 'sine', freq: N(67), start: 0.07, dur: 0.1, gain: 0.05 });
      break;
  }
}
