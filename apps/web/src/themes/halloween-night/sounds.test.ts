import { describe, expect, it } from 'vitest';
import type { NoiseSpec, SfxVoice, ToneSpec } from '../../audio/voices.ts';
import { HALLOWEEN_SOUNDS } from './sounds.ts';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function record(voice: SfxVoice) {
  const tones: ToneSpec[] = [];
  const noises: NoiseSpec[] = [];
  voice({ tone: (o) => tones.push(o), noise: (o) => noises.push(o), note: NOTE });
  return { tones, noises };
}

const end = (o: { start?: number; dur: number }) => (o.start ?? 0) + o.dur;
const pitchClass = (freq: number) => ((Math.round(12 * Math.log2(freq / 440) + 69) % 12) + 12) % 12;

/** How long the built-in sounds last (audio.ts SOUNDS): the Halloween voices stay close to them. */
const BUILTIN_SPAN: Record<string, number> = { coin: 0.35, pop: 0.07, ding: 0.6, join: 0.26, win: 0.61, bigwin: 1.4 };

describe('Halloween Night sound voices', () => {
  it('re-voices exactly coin, pop, ding, join, win and bigwin', () => {
    expect(Object.keys(HALLOWEEN_SOUNDS).sort()).toEqual(['bigwin', 'coin', 'ding', 'join', 'pop', 'win']);
  });

  for (const [name, voice] of Object.entries(HALLOWEEN_SOUNDS)) {
    it(`${name}: deterministic, about as long and as loud as the built-in sound`, () => {
      const a = record(voice!);
      expect(a.tones.length + a.noises.length).toBeGreaterThan(0);
      expect(record(voice!)).toEqual(a);
      const span = Math.max(...a.tones.map(end), ...a.noises.map(end));
      expect(span).toBeLessThanOrEqual(BUILTIN_SPAN[name]! + 0.15);
      expect(span).toBeGreaterThanOrEqual(BUILTIN_SPAN[name]! * 0.5);
      for (const t of a.tones) {
        expect(t.gain ?? 0.2).toBeLessThanOrEqual(0.13);
        expect(t.attack ?? 0).toBeLessThan(t.dur);
      }
      for (const n of a.noises) {
        expect(n.gain ?? 0.2).toBeLessThanOrEqual(0.3);
        expect(n.dur).toBeLessThanOrEqual(0.9);
      }
    });
  }

  it('win lands on a C-major tone (it plays together with the wheel’s C-major arpeggio)', () => {
    const { tones } = record(HALLOWEEN_SOUNDS.win!);
    const last = [...tones].sort((x, y) => (x.start ?? 0) - (y.start ?? 0)).at(-1)!;
    expect([0, 4, 7]).toContain(pitchClass(last.to ?? last.freq));
  });
});
