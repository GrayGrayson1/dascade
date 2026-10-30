/** DAS Chess variant sounds (shared synth, so mute/volume apply): an Atomic explosion and a Crazyhouse drop. */
import { synth } from '../../audio/audio.ts';

export const chessSounds = {
  explode(): void {
    synth.noise({ dur: 0.38, gain: 0.5, freq: 900, to: 120, q: 0.7, type: 'lowpass' });
    synth.tone({ type: 'sine', freq: 110, to: 38, dur: 0.42, gain: 0.22 });
  },
  drop(): void {
    synth.tone({ type: 'triangle', freq: 520, to: 260, dur: 0.08, gain: 0.1 });
    synth.noise({ start: 0.05, dur: 0.045, gain: 0.3, freq: 1400, q: 3, type: 'bandpass' });
  },
};
