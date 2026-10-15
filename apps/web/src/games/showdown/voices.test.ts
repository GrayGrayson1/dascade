import { describe, expect, it, vi } from 'vitest';

// The real synth needs a browser AudioContext; the voices only need the kit they're handed.
vi.mock('../../audio/audio.ts', () => ({ synth: { tone: vi.fn(), noise: vi.fn(), note: (n: number) => n, hold: vi.fn(), context: null, sfxBus: null } }));

const { SHOWDOWN_VOICES, SHOWDOWN_SOUND_FILES, CUE_SOUND } = await import('./sounds.ts');
const { SHOWDOWN_CUES } = await import('@dascade/shared/games/showdown');

function fakeKit() {
  const calls = { tone: 0, noise: 0, bad: 0 };
  const check = (o: { dur: number; gain?: number; start?: number; freq?: number }) => {
    if (!(o.dur > 0) || (o.gain ?? 0.2) > 0.4 || (o.start ?? 0) < 0 || (o.freq !== undefined && !(o.freq > 0))) calls.bad++;
  };
  return {
    calls,
    kit: {
      tone: (o: { dur: number; gain?: number; start?: number; freq: number }) => (calls.tone++, check(o)),
      noise: (o: { dur: number; gain?: number; start?: number; freq?: number }) => (calls.noise++, check(o)),
      note: (n: number) => 440 * Math.pow(2, (n - 69) / 12),
    },
  };
}

describe('show voices', () => {
  it('every sound in both looks plays sane nodes and reports its length', () => {
    for (const look of ['showtime', 'halloween'] as const) {
      for (const [name, voice] of Object.entries(SHOWDOWN_VOICES[look])) {
        const { kit, calls } = fakeKit();
        const seconds = voice(kit, () => 0.5);
        expect(seconds, `${look}:${name}`).toBeGreaterThan(0);
        expect(calls.tone + calls.noise, `${look}:${name}`).toBeGreaterThan(0);
        expect(calls.bad, `${look}:${name}`).toBe(0);
      }
    }
  });

  it('Halloween re-voices the signature moments', () => {
    for (const name of ['clang', 'strike', 'intro'] as const) expect(SHOWDOWN_VOICES.halloween[name]).not.toBe(SHOWDOWN_VOICES.showtime[name]);
  });

  it('every presenter cue has a sound, and no recorded file is mapped by default', () => {
    for (const cue of SHOWDOWN_CUES) expect(SHOWDOWN_VOICES.showtime[CUE_SOUND[cue]]).toBeTypeOf('function');
    expect(SHOWDOWN_SOUND_FILES).toEqual({});
  });
});
