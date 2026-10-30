/**
 * DAS Tic-Tac-Toe sounds: a marker scratch for each X stroke, a quick swirl for an O, a falling
 * blip for Gravity, a soft thunk when a Nesting piece covers another, a puff when a Vanishing mark
 * fades, and a chime when a small board is decided. Kit events (offers, flag, the win/loss fanfare)
 * use the Boardroom kit's sounds. Everything goes through the shared synth.
 */
import { synth } from '../../audio/audio.ts';

function scratch(start: number, pitch = 1): void {
  synth.noise({ start, dur: 0.07, gain: 0.12, freq: 2600 * pitch, q: 1.2, type: 'bandpass' });
  synth.tone({ type: 'triangle', freq: 420 * pitch, to: 300 * pitch, start, dur: 0.05, gain: 0.04 });
}

function swirl(start: number, pitch = 1): void {
  synth.noise({ start, dur: 0.16, gain: 0.1, freq: 1700 * pitch, q: 1.6, type: 'bandpass' });
  synth.tone({ type: 'sine', freq: 300 * pitch, to: 520 * pitch, start, dur: 0.14, gain: 0.05 });
}

export const tttSounds = {
  place(opts: { mark: 'x' | 'o' | 'num'; mine: boolean; drop?: boolean; cover?: boolean }): void {
    const pitch = opts.mine ? 1 : 0.88;
    let at = 0;
    if (opts.drop) {
      synth.tone({ type: 'square', freq: 880 * pitch, to: 220 * pitch, dur: 0.16, gain: 0.04 });
      at = 0.15;
    }
    if (opts.cover) synth.tone({ type: 'triangle', freq: 150, to: 90, start: at, dur: 0.12, gain: 0.14 });
    if (opts.mark === 'x') {
      scratch(at, pitch);
      scratch(at + 0.09, pitch * 1.06);
    } else if (opts.mark === 'o') swirl(at, pitch);
    else synth.tone({ type: 'triangle', freq: synth.note(opts.mine ? 76 : 72), start: at, dur: 0.1, gain: 0.08 });
  },
  vanish(): void {
    synth.noise({ start: 0.12, dur: 0.22, gain: 0.07, freq: 900, to: 300, q: 0.8 });
  },
  board(): void {
    [79, 84].forEach((n, i) => synth.tone({ type: 'triangle', freq: synth.note(n), start: 0.12 + i * 0.07, dur: 0.16, gain: 0.06 }));
  },
};
