/**
 * DAS Reversi move sounds — a solid "clack" as the disc lands, then a light tick for every disc that
 * turns over, timed with the flip stagger and climbing in pitch with a big capture, and a two-note
 * "skip" when the next player has no move. Kit events (offers, flag, the win/loss fanfare) use the
 * Boardroom kit's sounds. Everything goes through the shared synth.
 */
import { synth } from '../../audio/audio.ts';
import { FLIP_START_MS, FLIP_STEP_MS } from './position.ts';

/** A disc landing on the board. */
function clack(start: number, pitch: number): void {
  synth.tone({ type: 'triangle', freq: 260 * pitch, to: 150 * pitch, start, dur: 0.08, gain: 0.16, attack: 0.002 });
  synth.noise({ start, dur: 0.04, gain: 0.07, freq: 2000 * pitch, q: 1.8 });
}

/** A disc turning over. */
function tick(start: number, pitch: number): void {
  synth.tone({ type: 'square', freq: 640 * pitch, to: 900 * pitch, start, dur: 0.035, gain: 0.035, attack: 0.001 });
  synth.noise({ start, dur: 0.025, gain: 0.04, freq: 4200 * pitch, q: 2.2 });
}

/** Ticks after the first few run together (a 12-disc capture shouldn't last a second). */
const MAX_TICKS = 10;

export const reversiSounds = {
  move(opts: { flips: number; mine: boolean; passed: boolean }): void {
    const pitch = opts.mine ? 1 : 0.9;
    clack(0, pitch);
    const n = Math.min(opts.flips, MAX_TICKS);
    for (let i = 0; i < n; i++) tick(FLIP_START_MS / 1000 + (i * FLIP_STEP_MS * 0.6) / 1000, pitch * (1 + i * 0.04));
    if (opts.passed) {
      const at = FLIP_START_MS / 1000 + (n * FLIP_STEP_MS * 0.6) / 1000 + 0.12;
      [67, 62].forEach((note, i) => synth.tone({ type: 'triangle', freq: synth.note(note), start: at + i * 0.11, dur: 0.12, gain: 0.06 }));
    }
  },
};
