/**
 * DAS Checkers move sounds — a landing "tock" plus one "clack" per jumped piece, timed with the
 * hop animation, and a short arpeggio on crowning. Kit events (offers, flag, end, take-backs) use
 * the Boardroom kit's sounds. Everything goes through the shared synth (respects mute/volume and
 * stays silent until audio is unlocked by a user gesture).
 */
import { synth } from '../../audio/audio.ts';

/** A soft "tock" of a disc landing on the board. */
function tock(start = 0, pitch = 1): void {
  synth.tone({ type: 'triangle', freq: 330 * pitch, to: 180 * pitch, start, dur: 0.07, gain: 0.14, attack: 0.002 });
  synth.noise({ start, dur: 0.035, gain: 0.05, freq: 2400 * pitch, q: 2 });
}

/** A brighter "clack" for each piece jumped. */
function clack(start = 0): void {
  synth.tone({ type: 'square', freq: 520, to: 260, start, dur: 0.06, gain: 0.07, attack: 0.001 });
  synth.noise({ start, dur: 0.05, gain: 0.09, freq: 3200, q: 1.4 });
}

export const checkersSounds = {
  move(opts: { hops: number; captures: number; crowned: boolean; mine: boolean; hopMs: number }): void {
    const step = opts.hopMs / 1000;
    if (opts.captures > 0) {
      for (let i = 0; i < opts.captures; i++) clack(step * (i + 0.6));
      tock(step * Math.max(1, opts.hops), opts.mine ? 1 : 0.9);
    } else {
      tock(0.08, opts.mine ? 1 : 0.9);
    }
    if (opts.crowned) {
      const t = step * Math.max(1, opts.hops) + 0.08;
      [72, 76, 79, 84].forEach((n, i) => synth.tone({ type: 'square', freq: synth.note(n), start: t + i * 0.06, dur: 0.12, gain: 0.05 }));
    }
  },
};
