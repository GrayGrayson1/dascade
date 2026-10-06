import { describe, expect, it } from 'vitest';
import type { NoiseSpec, SfxKit, ToneSpec } from '../../audio/voices.ts';
import { REACTIONS } from './wheelReactions.ts';
import { HALLOWEEN_WHEEL_VOICES, REACTION_STINGS } from './wheelSounds.ts';

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function recorder() {
  const tones: ToneSpec[] = [];
  const noises: NoiseSpec[] = [];
  const kit: SfxKit = { tone: (o) => tones.push(o), noise: (o) => noises.push(o), note: NOTE };
  return { kit, tones, noises };
}

const end = (o: { start?: number; dur: number }) => (o.start ?? 0) + o.dur;
const span = (r: ReturnType<typeof recorder>) => Math.max(...r.tones.map(end), ...r.noises.map(end));
const pitchClass = (freq: number) => ((Math.round(12 * Math.log2(freq / 440) + 69) % 12) + 12) % 12;

/** Every sound stays audible, sane and inside the shared 1 s noise buffer. */
function expectSane(r: ReturnType<typeof recorder>, label: string) {
  expect(r.tones.length + r.noises.length, label).toBeGreaterThan(0);
  for (const t of r.tones) {
    expect(t.gain ?? 0.2, label).toBeLessThanOrEqual(0.13);
    expect(t.freq, label).toBeGreaterThanOrEqual(20);
    expect(t.freq, label).toBeLessThanOrEqual(12_000);
    expect(t.attack ?? 0, label).toBeLessThan(t.dur);
  }
  for (const n of r.noises) {
    expect(n.gain ?? 0.2, label).toBeLessThanOrEqual(0.35);
    expect(n.dur, label).toBeLessThanOrEqual(0.9);
  }
}

describe('Halloween Night wheel sounds', () => {
  it('re-voices the launch, the pegs and the landing', () => {
    expect(Object.keys(HALLOWEEN_WHEEL_VOICES).sort()).toEqual(['launch', 'reveal', 'tick']);
  });

  it('launch: a creak, a whoosh and a "woo" in about the built-in launch time', () => {
    const r = recorder();
    HALLOWEEN_WHEEL_VOICES.launch!(r.kit);
    expectSane(r, 'launch');
    expect(span(r)).toBeGreaterThanOrEqual(0.4);
    expect(span(r)).toBeLessThanOrEqual(0.75);
  });

  it('pegs: every knock, snap and sigh stays under 50 ms at any speed', () => {
    for (const speed of [1, 0.6, 0.3, 0.1, 0.02]) {
      for (let i = 0; i < 12; i++) {
        const r = recorder();
        HALLOWEEN_WHEEL_VOICES.tick!(r.kit, speed);
        expectSane(r, `tick @${speed}`);
        expect(span(r), `tick @${speed}`).toBeLessThan(0.05);
        expect(r.tones.length + r.noises.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('every reaction has its own short sting', () => {
    expect(Object.keys(REACTION_STINGS).sort()).toEqual(Object.keys(REACTIONS).sort());
    for (const [kind, sting] of Object.entries(REACTION_STINGS)) {
      const r = recorder();
      sting(r.kit);
      expectSane(r, kind);
      expect(span(r), kind).toBeLessThanOrEqual(3);
      // The show outlasts its sound, so the caption is up the whole time it plays.
      expect(span(r) * 1000, kind).toBeLessThanOrEqual(REACTIONS[kind as keyof typeof REACTIONS].ms);
    }
  });

  it('a landing plays its reaction’s sting', () => {
    const a = recorder();
    HALLOWEEN_WHEEL_VOICES.reveal!(a.kit, { label: 'Pumpkin Jackpot', emoji: '🎃', color: '#ffd23f' });
    const b = recorder();
    REACTION_STINGS.jackpot(b.kit);
    expect(a.tones).toEqual(b.tones);
    expect(a.noises).toEqual(b.noises);
  });

  it('any other landing gets the Halloween chime and jingle, ending in C major like the built-in fanfare', () => {
    const r = recorder();
    HALLOWEEN_WHEEL_VOICES.reveal!(r.kit, { label: 'Pizza', emoji: '🍕', color: '#ffb020' });
    expectSane(r, 'plain');
    expect(r.tones.length).toBeGreaterThan(6);
    const last = [...r.tones].sort((x, y) => end(x) - end(y)).at(-1)!;
    expect([0, 4, 7]).toContain(pitchClass(last.to ?? last.freq));
  });
});
