import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoiseSpec, ToneSpec } from '../../audio/voices.ts';

// The real synth needs a browser AudioContext; the voices only need the kit they're handed.
const mock = vi.hoisted(() => ({
  synth: {
    tone: vi.fn(),
    noise: vi.fn(),
    note: (n: number) => 440 * Math.pow(2, (n - 69) / 12),
    hold: vi.fn(),
    context: null as unknown,
    sfxBus: null as unknown,
  },
}));
vi.mock('../../audio/audio.ts', () => ({ synth: mock.synth }));

const { SHOWDOWN_VOICES, SHOWDOWN_SOUND_FILES, CUE_SOUND, FLIP_LAND_MS, SPIN_MIN_MS, eventSounds, pickSounds, playShowSound } =
  await import('./sounds.ts');
const { SHOWDOWN_CUES, SHOWDOWN_PICK_LAND_MS } = await import('@dascade/shared/games/showdown');
type ShowdownEvent = import('@dascade/shared/games/showdown').ShowdownEvent;
type ShowdownSound = import('./sounds.ts').ShowdownSound;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const LOOKS = ['showtime', 'halloween'] as const;
const MODES = ['classic', 'showcase'] as const;
/** The Presenter Showcase voices (new for DAS-O-Ween). */
const SHOWCASE: ShowdownSound[] = [
  'correct',
  'clangLate',
  'special',
  'miss',
  'opening',
  'category',
  'sweepStart',
  'rollIn',
  'timeup',
  'complete',
  'cardIn',
  // AUD-01: the clock and the picker.
  'oneMin',
  'tick',
  'spin',
  'land',
];
/** AUD-01's new cues (the Haunted Organ in Halloween Night, their own set in DAS Showtime). */
const CLOCK_AND_PICKER: ShowdownSound[] = ['oneMin', 'tick', 'spin', 'land'];

/** A deterministic random source (the voices get Math.random in the app). */
function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function record(look: (typeof LOOKS)[number], name: ShowdownSound, rand = seeded()) {
  const tones: ToneSpec[] = [];
  const noises: NoiseSpec[] = [];
  const seconds = SHOWDOWN_VOICES[look][name]({ tone: (o) => tones.push(o), noise: (o) => noises.push(o), note: NOTE }, rand);
  return { seconds, tones, noises };
}

/** The shared noise buffer is one second long: a burst plays at most that long. */
const NOISE_BUFFER_S = 1;

/** Envelope amplitude at time t, like audio.ts: an exponential ramp up over `attack`, then down to 0.0001 at `dur`. */
function envelope(
  o: { start?: number; dur: number; gain?: number; attack?: number },
  t: number,
  defaultAttack: number,
  maxDur = Infinity,
): number {
  const s = o.start ?? 0;
  const g = o.gain ?? 0.2;
  const a = o.attack ?? defaultAttack;
  if (t < s || t > s + Math.min(o.dur, maxDur)) return 0;
  if (a > 0 && t < s + a) return 0.0001 * Math.pow(g / 0.0001, (t - s) / a);
  return g * Math.pow(0.0001 / g, (t - s - a) / Math.max(1e-6, o.dur - a));
}

/** Roughly how much of a full-scale noise burst its filter lets through (peak ≈ 3 × the RMS of the passband). */
function passed(o: NoiseSpec): number {
  const f = o.freq ?? 2000;
  const q = o.q ?? 1;
  const type = o.type ?? 'bandpass';
  const frac = type === 'lowpass' ? Math.min(1, f / 24000) : type === 'highpass' ? Math.max(0, 1 - f / 24000) : Math.min(1, f / q / 24000);
  return Math.min(1, 1.73 * Math.sqrt(frac));
}

/** The most the voice's envelopes add up to at any instant: tones alone, and tones + filtered noise. */
function peakBudget(tones: ToneSpec[], noises: NoiseSpec[]): { tonal: number; total: number } {
  let tonal = 0;
  let total = 0;
  for (let t = 0; t < 8; t += 0.005) {
    let sT = 0;
    let sN = 0;
    for (const o of tones) sT += envelope(o, t, 0.005);
    for (const o of noises) sN += envelope(o, t, 0, NOISE_BUFFER_S) * passed(o);
    tonal = Math.max(tonal, sT);
    total = Math.max(total, sT + sN);
  }
  return { tonal, total };
}

/** When the voice's last node ends (as written: a classic cymbal may outlast the noise buffer). */
const span = (tones: ToneSpec[], noises: NoiseSpec[]) => Math.max(0, ...[...tones, ...noises].map((o) => (o.start ?? 0) + o.dur));

describe('show voices', () => {
  it('every sound in both looks plays sane nodes and reports its length', () => {
    for (const look of LOOKS) {
      for (const name of Object.keys(SHOWDOWN_VOICES[look]) as ShowdownSound[]) {
        const { seconds, tones, noises } = record(look, name);
        const id = `${look}:${name}`;
        expect(seconds, id).toBeGreaterThan(0);
        expect(seconds, id).toBeLessThanOrEqual(7);
        expect(tones.length + noises.length, id).toBeGreaterThan(0);
        // The reported length (the jukebox dip, the theme-music dip) covers the sound: no more than a
        // tail past it, and never far longer than what plays.
        const s = span(tones, noises);
        expect(seconds, id).toBeGreaterThanOrEqual(s * 0.6);
        expect(seconds, id).toBeLessThanOrEqual(s + 0.35);
        for (const o of [...tones, ...noises]) {
          expect(o.dur > 0 && Number.isFinite(o.dur), id).toBe(true);
          expect(o.start ?? 0, id).toBeGreaterThanOrEqual(0);
          expect(o.gain ?? 0.2, id).toBeGreaterThan(0);
          expect(o.gain ?? 0.2, id).toBeLessThanOrEqual(0.4);
          if (o.attack !== undefined) expect(o.attack, id).toBeLessThan(o.dur);
        }
        for (const o of tones) {
          for (const f of [o.freq, o.to ?? o.freq]) {
            expect(Number.isFinite(f) && f >= 20 && f <= 18000, `${id} tone ${f} Hz`).toBe(true);
          }
        }
        for (const o of noises) {
          for (const f of [o.freq ?? 2000, o.to ?? o.freq ?? 2000]) {
            expect(Number.isFinite(f) && f >= 20 && f <= 18000, `${id} noise filter ${f} Hz`).toBe(true);
          }
        }
      }
    }
  });

  it('stays inside the SFX bus’s headroom (sum of simultaneous envelopes)', () => {
    // The rendered peaks are measured in .scratch/das-o-ween/audio (render.mjs); this guards the
    // arithmetic: no voice stacks enough envelopes at one instant to approach clipping.
    for (const look of LOOKS) {
      for (const name of Object.keys(SHOWDOWN_VOICES[look]) as ShowdownSound[]) {
        const { tones, noises } = record(look, name);
        const { tonal, total } = peakBudget(tones, noises);
        expect(tonal, `${look}:${name} tonal`).toBeLessThanOrEqual(1.3);
        expect(total, `${look}:${name} total`).toBeLessThanOrEqual(1.7);
      }
    }
  });

  it('the showcase voices fit the shared noise buffer and keep the jukebox light', () => {
    for (const look of LOOKS) {
      for (const name of SHOWCASE) {
        const { tones, noises } = record(look, name);
        for (const o of noises) expect(o.dur, `${look}:${name}`).toBeLessThanOrEqual(NOISE_BUFFER_S);
        // A few hundred short-lived nodes at most (the crowd in the celebration is the biggest).
        expect(tones.length + noises.length, `${look}:${name}`).toBeLessThanOrEqual(300);
      }
    }
  });

  it('each look has its own showcase voices, and they are deterministic for a given random source', () => {
    for (const name of SHOWCASE) {
      expect(SHOWDOWN_VOICES.halloween[name], name).not.toBe(SHOWDOWN_VOICES.showtime[name]);
      for (const look of LOOKS) expect(record(look, name, seeded(3)), `${look}:${name}`).toEqual(record(look, name, seeded(3)));
    }
  });

  it('the cues have the lengths the show is paced for', () => {
    for (const look of LOOKS) {
      const len = (name: ShowdownSound) => record(look, name).seconds;
      expect(len('miss'), look).toBeGreaterThanOrEqual(0.5);
      expect(len('miss'), look).toBeLessThanOrEqual(1);
      expect(len('special'), look).toBeGreaterThanOrEqual(2.6);
      expect(len('special'), look).toBeLessThanOrEqual(3.6);
      expect(len('opening'), look).toBeGreaterThanOrEqual(5);
      expect(len('opening'), look).toBeLessThanOrEqual(6.2);
      expect(len('category'), look).toBeGreaterThanOrEqual(2);
      expect(len('category'), look).toBeLessThanOrEqual(3);
      // The first sweep tile lands 0.9 s + the flip after the sting starts.
      expect(len('sweepStart'), look).toBeLessThanOrEqual(0.9 + FLIP_LAND_MS / 1000);
      // The sweep's drumroll runs into the special tile: the server flips it 2.6 s after the
      // suspense beat (ShowdownRoom SWEEP_MS.suspense) and the celebration hits as it lands.
      expect(Math.abs(len('rollIn') - (2.6 + FLIP_LAND_MS / 1000)), look).toBeLessThanOrEqual(0.1);
      expect(len('cardIn'), look).toBeLessThanOrEqual(1);
      expect(len('correct'), look).toBeLessThanOrEqual(0.8);
    }
  });

  it('the clock and picker cues (AUD-01) end, stay finite and fit the shared noise buffer', () => {
    for (const look of LOOKS) {
      for (const name of CLOCK_AND_PICKER) {
        const id = `${look}:${name}`;
        const { seconds, tones, noises } = record(look, name);
        expect(Number.isFinite(seconds) && seconds > 0, id).toBe(true);
        for (const o of [...tones, ...noises]) {
          for (const v of [o.start ?? 0, o.dur, o.gain ?? 0.2, o.attack ?? 0]) expect(Number.isNaN(v), id).toBe(false);
        }
        for (const o of tones) expect(Number.isNaN(o.freq) || Number.isNaN(o.to ?? 0) || Number.isNaN(o.detune ?? 0), id).toBe(false);
        // Each noise layer plays whole: none outlasts the shared noise buffer.
        for (const o of noises) expect(o.dur, id).toBeLessThanOrEqual(NOISE_BUFFER_S);
        // Everything has stopped by the length the voice reports (plus the envelope's last 50 ms).
        expect(span(tones, noises), id).toBeLessThanOrEqual(seconds + 0.05);
      }
    }
  });

  it('the clock and picker cues are paced for the show', () => {
    for (const look of LOOKS) {
      const len = (name: ShowdownSound) => record(look, name).seconds;
      // 1:00 left: one toll (the studio's Haunted Organ prototype: 2.2 s).
      expect(len('oneMin'), look).toBeGreaterThanOrEqual(1.5);
      expect(len('oneMin'), look).toBeLessThanOrEqual(2.4);
      // A tick is over well before the next one, a second later.
      const tick = record(look, 'tick');
      expect(tick.seconds, look).toBeLessThanOrEqual(0.5);
      expect(span(tick.tones, tick.noises), look).toBeLessThanOrEqual(0.5);
      // The spin runs under the stage's sweep and is over before the landing (SHOWDOWN_PICK_LAND_MS).
      const spin = record(look, 'spin');
      expect(spin.seconds, look).toBeGreaterThanOrEqual(2.5);
      expect(span(spin.tones, spin.noises), look).toBeLessThanOrEqual(SHOWDOWN_PICK_LAND_MS / 1000 - 0.3);
      // The land: a short hit, never as long as the special's celebration.
      expect(len('land'), look).toBeGreaterThanOrEqual(1);
      expect(len('land'), look).toBeLessThan(len('special'));
    }
  });

  it('the clock and picker cues sit under the big moments: a tick is quiet, the toll and the land stay under the special', () => {
    // Energy proxy over the loudest 400 ms window (the render check in .scratch/das-o-ween/audio measures LUFS).
    const loudest = (look: (typeof LOOKS)[number], name: ShowdownSound) => {
      const { tones, noises } = record(look, name);
      const step = 0.005;
      const frame: number[] = [];
      for (let t = 0; t < 4; t += step) {
        let e = 0;
        for (const o of tones) e += envelope(o, t, 0.005) ** 2;
        for (const o of noises) e += (envelope(o, t, 0, NOISE_BUFFER_S) * passed(o)) ** 2;
        frame.push(e);
      }
      const win = Math.round(0.4 / step);
      let best = 0;
      for (let i = 0; i + win <= frame.length; i++) {
        let sum = 0;
        for (let j = i; j < i + win; j++) sum += frame[j]!;
        best = Math.max(best, sum);
      }
      return best;
    };
    for (const look of LOOKS) {
      const special = loudest(look, 'special');
      const found = loudest(look, 'clang');
      expect(loudest(look, 'oneMin'), look).toBeLessThan(special);
      expect(loudest(look, 'land'), look).toBeLessThan(special);
      expect(loudest(look, 'spin'), look).toBeLessThan(found);
      // A tick is at least ~10 dB under a found answer.
      expect(loudest(look, 'tick'), look).toBeLessThan(found / 10);
    }
  });

  it('a Halloween wail resolves: the land is a D-major chord (F♯, never F)', () => {
    const { tones } = record('halloween', 'land');
    const has = (midi: number) => tones.some((o) => Math.abs(o.freq - NOTE(midi)) < 0.5);
    expect(has(62) && has(66) && has(69), 'D F♯ A').toBe(true);
    expect(has(65) || has(77), 'no F natural').toBe(false);
  });

  it('a miss repeats cleanly: nothing loud rings past its buzz', () => {
    for (const look of LOOKS) {
      const { tones, noises } = record(look, 'miss');
      // Anything still sounding at 0.6 s (the ghost's wail in Halloween) is quiet.
      for (const o of tones) if ((o.start ?? 0) + o.dur > 0.6) expect(o.gain ?? 0.2, look).toBeLessThanOrEqual(0.05);
      for (const o of noises) expect((o.start ?? 0) + o.dur, look).toBeLessThanOrEqual(0.6);
    }
  });

  it('every presenter cue has a sound, and no recorded file is mapped by default', () => {
    for (const cue of SHOWDOWN_CUES) expect(SHOWDOWN_VOICES.showtime[CUE_SOUND[cue]]).toBeTypeOf('function');
    expect(CUE_SOUND.celebrate).toBe('special');
    expect(SHOWDOWN_SOUND_FILES).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// eventSounds
// ---------------------------------------------------------------------------

const reveal = (o: Partial<Extract<ShowdownEvent, { type: 'reveal' }>> = {}): ShowdownEvent => ({
  type: 'reveal',
  rev: 1,
  slot: 3,
  text: 'Pumpkin',
  points: 20,
  top: false,
  late: false,
  callers: 0,
  cleared: false,
  special: false,
  sweep: false,
  ...o,
});

/** One of every event (and the variants that sound different). */
const EVERY_EVENT: ShowdownEvent[] = [
  { type: 'intro', rev: 1 },
  { type: 'round', rev: 1, round: 0, multiplier: 1, answers: 10 },
  { type: 'question', rev: 1 },
  { type: 'control', rev: 1, team: 0 },
  reveal(),
  reveal({ top: true, slot: 0 }),
  reveal({ cleared: true }),
  reveal({ special: true }),
  reveal({ special: true, cleared: true }),
  reveal({ late: true }),
  reveal({ late: true, sweep: true }),
  reveal({ late: true, sweep: true, special: true }),
  reveal({ late: true, sweep: true, cleared: true }),
  { type: 'strike', rev: 1, strikes: 1, steal: false, stealFailed: false },
  { type: 'strike', rev: 1, strikes: 3, steal: true, stealFailed: false },
  { type: 'strike', rev: 1, strikes: 3, steal: false, stealFailed: true },
  { type: 'award', rev: 1, team: 0, points: 50, how: 'sweep' },
  { type: 'award', rev: 1, team: 1, points: 50, how: 'steal' },
  { type: 'award', rev: 1, team: -1, points: 0, how: 'none' },
  { type: 'adjust', rev: 1, team: 0, delta: 5 },
  { type: 'undo', rev: 1 },
  { type: 'miss', rev: 1, round: 0, n: 1 },
  { type: 'sweep', rev: 1, on: true },
  { type: 'sweep', rev: 1, on: false },
  { type: 'suspense', rev: 1, slot: 4 },
  { type: 'timeup', rev: 1, round: 0 },
  { type: 'restart', rev: 1, round: 0 },
  { type: 'reset', rev: 1 },
  { type: 'clockWarn', rev: 1, round: 0 },
  { type: 'tick', rev: 1, round: 0, n: 10 },
  { type: 'tick', rev: 1, round: 0, n: 1 },
  { type: 'pick', rev: 1, drawNo: 1, winnerId: 'p1', name: 'Priya', poolSize: 12, landAt: 1_000_000, reroll: false },
  { type: 'pick', rev: 1, drawNo: 2, winnerId: 'p2', name: 'Sam', poolSize: 11, landAt: 1_000_000, reroll: true },
  { type: 'pickEnd', rev: 1, drawNo: 1, playerId: 'p1', how: 'done' },
  { type: 'station', rev: 1, playerId: '', lost: true },
];

describe('eventSounds', () => {
  it('covers every event type in both modes with real sounds and sane delays', () => {
    const types = new Set(EVERY_EVENT.map((e) => e.type));
    expect(types.size).toBe(20);
    for (const mode of MODES) {
      for (const e of EVERY_EVENT) {
        const list = eventSounds(e, mode);
        expect(Array.isArray(list)).toBe(true);
        for (const [sound, delay] of list) {
          for (const look of LOOKS) expect(SHOWDOWN_VOICES[look][sound], `${mode}:${e.type}:${sound}`).toBeTypeOf('function');
          expect(Number.isFinite(delay) && delay >= 0 && delay <= 4000, `${mode}:${e.type} ${delay}`).toBe(true);
        }
        // Silent only where it should be.
        const silent = e.type === 'adjust' || (e.type === 'sweep' && !e.on) || e.type === 'pickEnd' || e.type === 'station';
        if (silent) expect(list, `${mode}:${e.type}`).toEqual([]);
        else expect(list.length, `${mode}:${e.type}`).toBeGreaterThan(0);
      }
    }
  });

  it('Team Showdown keeps its mappings', () => {
    expect(eventSounds({ type: 'intro', rev: 1 })).toEqual([['intro', 0]]);
    expect(eventSounds({ type: 'round', rev: 1, round: 0, multiplier: 1, answers: 8 }, 'classic')).toEqual([['round', 0]]);
    expect(eventSounds(reveal(), 'classic')).toEqual([['clang', 0]]);
    expect(eventSounds(reveal({ top: true }), 'classic')).toEqual([['clangTop', 0]]);
    expect(eventSounds(reveal({ cleared: true }), 'classic')).toEqual([
      ['clang', 0],
      ['applause', 600],
    ]);
    expect(eventSounds({ type: 'strike', rev: 1, strikes: 3, steal: true, stealFailed: false }, 'classic')).toEqual([
      ['strike', 0],
      ['stealOpen', 950],
    ]);
    expect(eventSounds({ type: 'strike', rev: 1, strikes: 3, steal: false, stealFailed: true }, 'classic')).toEqual([['stealMiss', 0]]);
    expect(eventSounds({ type: 'award', rev: 1, team: 1, points: 9, how: 'steal' }, 'classic')).toEqual([
      ['award', 300],
      ['applause', 700],
    ]);
    expect(eventSounds({ type: 'award', rev: 1, team: -1, points: 0, how: 'none' }, 'classic')).toEqual([['aww', 0]]);
    expect(eventSounds({ type: 'undo', rev: 1 }, 'classic')).toEqual([['undo', 0]]);
    expect(eventSounds({ type: 'adjust', rev: 1, team: 0, delta: 1 }, 'classic')).toEqual([]);
  });

  it('a found answer dings, then clangs as the tile lands', () => {
    const list = eventSounds(reveal(), 'showcase');
    expect(list[0]).toEqual(['correct', 0]);
    const clang = list.find(([s]) => s === 'clang');
    // The clang voice strikes its plate 110 ms in (after the swish): the strike is the flip's landing.
    expect(clang![1] + 110).toBe(FLIP_LAND_MS);
    expect(FLIP_LAND_MS).toBeGreaterThanOrEqual(280);
    expect(FLIP_LAND_MS).toBeLessThanOrEqual(400);
  });

  it('the special answer sets off the celebration on the landing, with no second clang under it', () => {
    for (const e of [reveal({ special: true }), reveal({ special: true, late: true, sweep: true })]) {
      const list = eventSounds(e, 'showcase');
      expect(list).toContainEqual(['special', FLIP_LAND_MS]);
      expect(list.some(([s]) => s === 'clang' || s === 'clangLate' || s === 'clangTop')).toBe(false);
    }
    // Found by hand: the ding comes first; in the sweep (the drumroll led in) it doesn't.
    expect(eventSounds(reveal({ special: true }), 'showcase')[0]).toEqual(['correct', 0]);
    expect(eventSounds(reveal({ special: true, late: true, sweep: true }), 'showcase').some(([s]) => s === 'correct')).toBe(false);
  });

  it('the sweep’s tiles only clang (lighter), and the board’s last tile adds the flourish and applause', () => {
    expect(eventSounds(reveal({ late: true, sweep: true }), 'showcase')).toEqual([['clangLate', FLIP_LAND_MS - 110]]);
    const last = eventSounds(reveal({ late: true, sweep: true, cleared: true }), 'showcase');
    const at = (s: ShowdownSound) => last.find(([x]) => x === s)?.[1] ?? -1;
    expect(at('clangLate')).toBeGreaterThanOrEqual(0);
    // The flourish follows the impact, and the applause follows the flourish.
    expect(at('complete')).toBeGreaterThan(FLIP_LAND_MS);
    expect(at('applause')).toBeGreaterThan(at('complete'));
    // A special answer that completes the board: the flourish waits for the celebration's fanfare.
    const both = eventSounds(reveal({ special: true, cleared: true }), 'showcase');
    expect(both.find(([s]) => s === 'complete')![1]).toBeGreaterThanOrEqual(FLIP_LAND_MS + 2000);
  });

  it('showcase cues: the opening, the category sting, the sweep, the drumroll into the special, the clock', () => {
    expect(eventSounds({ type: 'intro', rev: 1 }, 'showcase')).toEqual([['opening', 0]]);
    expect(eventSounds({ type: 'round', rev: 1, round: 1, multiplier: 1, answers: 10 }, 'showcase')).toEqual([['category', 0]]);
    expect(eventSounds({ type: 'miss', rev: 1, round: 0, n: 2 }, 'showcase')).toEqual([['miss', 0]]);
    expect(eventSounds({ type: 'sweep', rev: 1, on: true }, 'showcase')).toEqual([['sweepStart', 0]]);
    expect(eventSounds({ type: 'sweep', rev: 1, on: false }, 'showcase')).toEqual([]);
    expect(eventSounds({ type: 'suspense', rev: 1, slot: 4 }, 'showcase')).toEqual([['rollIn', 0]]);
    expect(eventSounds({ type: 'timeup', rev: 1, round: 0 }, 'showcase')).toEqual([['timeup', 0]]);
  });

  it('the clock: 1:00 left tolls once, each of the last ten seconds ticks', () => {
    for (const mode of MODES) {
      expect(eventSounds({ type: 'clockWarn', rev: 1, round: 1 }, mode)).toEqual([['oneMin', 0]]);
      for (let n = 10; n >= 1; n--) expect(eventSounds({ type: 'tick', rev: 1, round: 1, n }, mode)).toEqual([['tick', 0]]);
    }
  });

  it('the picker: the spin at once, the land as the stage lands (landAt); the end of a turn and a station move are silent', () => {
    const landAt = 5_000_000;
    const pick: ShowdownEvent = { type: 'pick', rev: 1, drawNo: 3, winnerId: 'p', name: 'Priya', poolSize: 9, landAt, reroll: false };
    expect(eventSounds(pick, 'showcase')).toEqual([
      ['spin', 0],
      ['land', SHOWDOWN_PICK_LAND_MS],
    ]);
    // A reroll draws again: the same sweep.
    expect(eventSounds({ ...pick, reroll: true } as ShowdownEvent, 'showcase')).toEqual(eventSounds(pick, 'showcase'));
    expect(eventSounds({ type: 'pickEnd', rev: 1, drawNo: 3, playerId: 'p', how: 'noAnswer' }, 'showcase')).toEqual([]);
    expect(eventSounds({ type: 'station', rev: 1, playerId: 'tv', lost: false }, 'showcase')).toEqual([]);
  });

  it('pickSounds times the land against the server clock, and drops the spin when it is too late for it', () => {
    const landAt = 9_000_000;
    // Heard the moment it was drawn.
    expect(pickSounds(landAt, landAt - 3500)).toEqual([
      ['spin', 0],
      ['land', 3500],
    ]);
    // 400 ms late on a slow link: the land still lands with the stage.
    expect(pickSounds(landAt, landAt - 3100)).toEqual([
      ['spin', 0],
      ['land', 3100],
    ]);
    // Too late for the sweep: the land alone.
    expect(pickSounds(landAt, landAt - (SPIN_MIN_MS - 1))).toEqual([['land', SPIN_MIN_MS - 1]]);
    // After the landing (a tab that woke up late): the land at once, never a negative delay.
    expect(pickSounds(landAt, landAt + 800)).toEqual([['land', 0]]);
    // A wild clock never schedules a land far in the future, and a bad value never throws.
    expect(pickSounds(landAt, landAt - 60_000)[1]).toEqual(['land', 2 * SHOWDOWN_PICK_LAND_MS]);
    expect(pickSounds(Number.NaN, landAt)).toEqual([['land', 0]]);
  });

  it('builds the crescendo: a found answer < the board complete < the special answer (more sound, for longer)', () => {
    for (const look of LOOKS) {
      // Energy proxy: the sum over time of the envelopes (tones + filtered noise), 3 s window.
      const energy = (e: ShowdownEvent) => {
        let sum = 0;
        for (const [sound, delay] of eventSounds(e, 'showcase')) {
          const { tones, noises } = record(look, sound);
          for (let t = 0; t < 3; t += 0.01) {
            const at = t - delay / 1000;
            for (const o of tones) sum += envelope(o, at, 0.005) ** 2;
            for (const o of noises) sum += (envelope(o, at, 0, NOISE_BUFFER_S) * passed(o)) ** 2;
          }
        }
        return sum;
      };
      const found = energy(reveal());
      const complete = energy(reveal({ cleared: true }));
      const special = energy(reveal({ special: true }));
      expect(complete, look).toBeGreaterThan(found);
      expect(special, look).toBeGreaterThan(complete);
    }
  });
});

// ---------------------------------------------------------------------------
// Playback: recorded overrides fall back to the procedural voice
// ---------------------------------------------------------------------------

describe('playShowSound', () => {
  const files = SHOWDOWN_SOUND_FILES as Record<string, string>;
  afterEach(() => {
    for (const key of Object.keys(files)) delete files[key];
    mock.synth.context = null;
    mock.synth.sfxBus = null;
    mock.synth.tone.mockClear();
    mock.synth.noise.mockClear();
    vi.unstubAllGlobals();
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('does nothing while audio is locked', () => {
    playShowSound('clang', 'showtime');
    expect(mock.synth.tone).not.toHaveBeenCalled();
  });

  it('plays the procedural voice on the synth', () => {
    mock.synth.context = {};
    playShowSound('miss', 'halloween');
    expect(mock.synth.tone).toHaveBeenCalled();
  });

  it('a mapped file that fails to load falls back to the voice', async () => {
    mock.synth.context = { decodeAudioData: () => Promise.reject(new Error('bad')) };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
    files['halloween:clang'] = '/audio/showdown/missing.mp3';
    playShowSound('clang', 'halloween');
    expect(mock.synth.tone).not.toHaveBeenCalled();
    await flush();
    expect(mock.synth.tone).toHaveBeenCalled();
  });

  it('a mapped file that loads plays on the SFX bus instead of the voice', async () => {
    const src = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
    const ctx = { decodeAudioData: () => Promise.resolve({ duration: 0.8 }), createBufferSource: () => src };
    mock.synth.context = ctx;
    mock.synth.sfxBus = {};
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    files.miss = '/audio/showdown/buzzer.mp3';
    playShowSound('miss', 'showtime');
    await flush();
    expect(src.start).toHaveBeenCalled();
    expect(src.connect).toHaveBeenCalledWith(mock.synth.sfxBus);
    expect(mock.synth.tone).not.toHaveBeenCalled();
  });
});
