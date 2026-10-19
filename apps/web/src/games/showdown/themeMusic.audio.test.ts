import { describe, expect, it, vi } from 'vitest';
import type { NoiseSpec, ToneSpec } from '../../audio/voices.ts';
import { FakeAudioContext, type FakeNode } from '../../audio/testFakes.ts';

// The module's default player is wired to the real synth; these tests drive their own engine.
vi.mock('../../audio/audio.ts', () => ({
  synth: { tone: vi.fn(), noise: vi.fn(), note: (n: number) => n, hold: vi.fn(), context: null, sfxBus: null },
}));

const { createThemeMusic, stepSeconds, STEPS_PER_BAR, THEME_BEDS, THEME_DUCK, THEME_LEVEL, themeMusic } = await import('./themeMusic.ts');
type ThemeBed = import('./themeMusic.ts').ThemeBed;
type BedContext = import('./themeMusic.ts').BedContext;

const LOOKS = ['halloween', 'showtime'] as const;

/** A controllable world: a fake context (locked until `unlock()`), manual timers, recorded notes. */
function rig(opts: { beds?: Record<(typeof LOOKS)[number], ThemeBed>; hidden?: boolean } = {}) {
  const ctx = new FakeAudioContext();
  ctx.currentTime = 10;
  const out = ctx.createGain();
  let unlocked = false;
  let hidden = opts.hidden ?? false;
  let now = 0;
  const intervals = new Map<number, () => void>();
  const timeouts: Array<{ at: number; fn: () => void }> = [];
  let ids = 0;
  const notes: Array<{ kind: 'tone' | 'noise'; at: number; o: (ToneSpec | NoiseSpec) & { bus: unknown } }> = [];
  const holds: Array<[string, boolean]> = [];
  const cleared: number[] = [];
  const engine = createThemeMusic({
    context: () => (unlocked ? (ctx as unknown as BedContext) : null),
    output: () => (unlocked ? (out as unknown as AudioNode) : null),
    tone: (o) => notes.push({ kind: 'tone', at: ctx.currentTime + (o.start ?? 0), o }),
    noise: (o) => notes.push({ kind: 'noise', at: ctx.currentTime + (o.start ?? 0), o }),
    hold: (key, on) => holds.push([key, on]),
    hidden: () => hidden,
    setInterval: (fn) => {
      intervals.set(++ids, fn);
      return ids;
    },
    clearInterval: (id) => {
      cleared.push(id as number);
      intervals.delete(id as number);
    },
    setTimeout: (fn, ms) => {
      timeouts.push({ at: now + ms, fn });
      return ++ids;
    },
    now: () => now,
    beds: opts.beds,
  });
  return {
    ctx,
    out,
    engine,
    notes,
    holds,
    cleared,
    intervals,
    unlock: () => (unlocked = true),
    lock: () => (unlocked = false),
    hide: (h: boolean) => (hidden = h),
    /** Advances the audio clock and wall clock by `seconds` in 50 ms ticks (each tick runs the interval). */
    run(seconds: number, tick = 0.05) {
      for (let t = 0; t < seconds - 1e-9; t += tick) {
        ctx.currentTime += tick;
        now += tick * 1000;
        for (const fn of [...intervals.values()]) fn();
        for (const x of timeouts.splice(0))
          if (x.at <= now) x.fn();
          else timeouts.push(x);
      }
    },
    /** A stall: both clocks jump without the timer running. */
    stall(seconds: number) {
      ctx.currentTime += seconds;
      now += seconds * 1000;
    },
    gains: () => ctx.nodes.filter((n) => n.kind === 'gain' && n !== out) as FakeNode[],
  };
}

/** Two marker beds: every step plays one tone, 100 Hz (Halloween) or 200 Hz (Showtime). */
const MARKERS: Record<(typeof LOOKS)[number], ThemeBed> = {
  halloween: {
    bpm: 120,
    swing: 0.5,
    bars: 4,
    notes: (step) => [{ tone: { freq: 100, dur: 0.1, gain: 0.05, start: 0, attack: 0.01, detune: step } }],
  },
  showtime: {
    bpm: 120,
    swing: 0.5,
    bars: 4,
    notes: (step) => [{ tone: { freq: 200, dur: 0.1, gain: 0.05, start: 0, attack: 0.01, detune: step } }],
  },
};

describe('theme music player', () => {
  it('schedules nothing while audio is locked, and starts from "now" once it unlocks', () => {
    const r = rig({ beds: MARKERS });
    r.engine.play('halloween');
    expect(r.engine.playing).toBe(true);
    r.run(2);
    expect(r.notes).toHaveLength(0);
    expect(r.gains()).toHaveLength(0);
    // The jukebox dip is held from the moment the show asks for music.
    expect(r.holds).toEqual([['showdown:theme', true]]);
    r.unlock();
    const t0 = r.ctx.currentTime;
    r.run(0.05);
    expect(r.notes.length).toBeGreaterThan(0);
    // No backlog from the locked seconds: the first note is within the lookahead of the unlock.
    expect(Math.min(...r.notes.map((n) => n.at))).toBeGreaterThanOrEqual(t0);
    expect(Math.max(...r.notes.map((n) => n.at))).toBeLessThanOrEqual(r.ctx.currentTime + 0.3);
    // Every note goes through the player's one gain node, which is connected to the SFX bus.
    const [bus] = r.gains();
    expect(bus!.connections).toContain(r.out);
    expect(r.notes.every((n) => n.o.bus === bus)).toBe(true);
  });

  it('play is idempotent and stop is safe to repeat (or call when never started)', () => {
    const r = rig({ beds: MARKERS });
    r.engine.stop();
    expect(r.holds).toHaveLength(0);
    r.unlock();
    r.engine.play('showtime');
    r.engine.play('showtime');
    r.engine.play('showtime');
    expect(r.intervals.size).toBe(1);
    expect(r.holds).toEqual([['showdown:theme', true]]);
    r.run(1);
    expect(r.gains()).toHaveLength(1);
    r.engine.stop();
    r.engine.stop();
    expect(r.engine.playing).toBe(false);
    expect(r.cleared).toHaveLength(1);
    expect(r.intervals.size).toBe(0);
    expect(r.holds).toEqual([
      ['showdown:theme', true],
      ['showdown:theme', false],
    ]);
  });

  it('stop fades the bus out (notes already scheduled fade with it), schedules no more, and lets the bus go', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.play('halloween');
    r.run(1);
    const [bus] = r.gains();
    const before = r.notes.length;
    r.engine.stop();
    const last = bus!.gain.calls.at(-1)!;
    expect(last[0]).toBe('target');
    expect(last[1]).toBe(0);
    r.run(5);
    expect(r.notes.length).toBe(before);
    expect(bus!.connections).toHaveLength(0);
  });

  it('fades in to its level when it starts', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.play('showtime');
    const [bus] = r.gains();
    expect(bus!.gain.calls[0]).toEqual(['set', 0, 10]);
    expect(bus!.gain.target).toBe(THEME_LEVEL);
    expect(bus!.gain.calls.some(([op, v, , tc]) => op === 'target' && v === THEME_LEVEL && (tc ?? 0) >= 0.3)).toBe(true);
  });

  it('a stalled timer skips what it missed instead of playing a backlog', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.play('halloween');
    r.run(1);
    const before = r.notes.length;
    r.stall(6);
    r.run(0.05);
    const fresh = r.notes.slice(before);
    // 0.25 s (+ one tick) of lookahead at 0.25 s a step: a couple of notes, all in the future.
    expect(fresh.length).toBeLessThanOrEqual(3);
    expect(fresh.every((n) => n.at >= r.ctx.currentTime - 0.05)).toBe(true);
    // And the beat kept its place in the loop (the steps it skipped still count).
    const steps = fresh.map((n) => (n.o as ToneSpec).detune);
    expect(steps[0]).toBeGreaterThan(8);
  });

  it('pauses while the OS suspends audio and picks the beat up from "now" when it comes back', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.play('showtime');
    r.run(1);
    r.lock();
    const before = r.notes.length;
    r.run(3);
    expect(r.notes.length).toBe(before);
    r.unlock();
    const back = r.ctx.currentTime;
    r.run(0.05);
    const fresh = r.notes.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(3);
    expect(Math.min(...fresh.map((n) => n.at))).toBeGreaterThanOrEqual(back);
  });

  it('switches looks on the next bar line', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.play('halloween');
    r.run(0.8); // a bar is 2 s at 120 bpm: we're mid-bar
    r.engine.play('showtime');
    r.run(3);
    const seq = r.notes.map((n) => [(n.o as ToneSpec).freq, (n.o as ToneSpec).detune] as const);
    const first = seq.findIndex(([f]) => f === 200);
    expect(first).toBeGreaterThan(0);
    // The last Halloween step before the switch closes its bar, and Showtime starts on its bar 1.
    expect(seq[first - 1]).toEqual([100, STEPS_PER_BAR - 1]);
    expect(seq[first]).toEqual([200, 0]);
    expect(seq.slice(first).every(([f]) => f === 200)).toBe(true);
  });

  it('schedules further ahead in a background tab (timers run about once a second there)', () => {
    const r = rig({ beds: MARKERS, hidden: true });
    r.unlock();
    r.engine.play('halloween');
    const until = Math.max(...r.notes.map((n) => n.at)) - r.ctx.currentTime;
    expect(until).toBeGreaterThanOrEqual(1);
    expect(until).toBeLessThanOrEqual(1.5);
  });

  it('dips under a show sound and comes back after it — even one asked for before the bed started', () => {
    const r = rig({ beds: MARKERS });
    r.unlock();
    r.engine.duck(4); // the opening fanfare plays; the bed comes in under it
    r.run(1);
    r.engine.play('showtime');
    const [bus] = r.gains();
    const targets = bus!.gain.calls.filter(([op]) => op === 'target');
    expect(targets[0]![1]).toBeCloseTo(THEME_LEVEL * THEME_DUCK);
    // Back up when the 4 s are over (3 s from now, on the audio clock).
    expect(targets[1]![1]).toBe(THEME_LEVEL);
    expect(targets[1]![2]).toBeCloseTo(r.ctx.currentTime + 3);
    r.engine.duck(0);
    r.engine.duck(Number.NaN);
    expect(bus!.gain.calls.filter(([op]) => op === 'target')).toHaveLength(2);
  });

  it('the module player is stopped by default and stop() is harmless', () => {
    expect(themeMusic.playing).toBe(false);
    themeMusic.stop();
    expect(themeMusic.playing).toBe(false);
  });
});

describe('theme beds', () => {
  for (const look of LOOKS) {
    const bed = THEME_BEDS[look];
    const steps = bed.bars * STEPS_PER_BAR;
    const all = Array.from({ length: steps }, (_, s) => bed.notes(s));

    it(`${look}: a 16-bar loop at a game-show tempo, deterministic`, () => {
      expect(bed.bars).toBe(16);
      expect(bed.bpm).toBeGreaterThanOrEqual(100);
      expect(bed.bpm).toBeLessThanOrEqual(140);
      const loop = steps * stepSeconds(bed);
      expect(loop).toBeGreaterThan(25);
      expect(loop).toBeLessThan(40);
      expect(Array.from({ length: steps }, (_, s) => bed.notes(s))).toEqual(all);
      // Step numbers past the loop wrap (the player keeps counting).
      expect(bed.notes(steps + 5)).toEqual(all[5]);
      // Every bar has a bass note on its downbeat.
      for (let bar = 0; bar < bed.bars; bar++) {
        expect(
          all[bar * STEPS_PER_BAR]!.some((n) => n.tone && n.tone.freq < 200 && (n.tone.gain ?? 0) >= 0.05),
          `bar ${bar + 1}`,
        ).toBe(true);
      }
    });

    it(`${look}: sane, light notes that sit under speech`, () => {
      let maxPerStep = 0;
      for (const notes of all) {
        maxPerStep = Math.max(maxPerStep, notes.length);
        for (const n of notes) {
          const o = n.tone ?? n.noise!;
          expect(o.dur).toBeGreaterThan(0);
          expect(o.start ?? 0).toBeGreaterThanOrEqual(0);
          expect(o.start ?? 0).toBeLessThan(stepSeconds(bed) * 2);
          expect(o.gain ?? 0.2).toBeLessThanOrEqual(0.1);
          if (o.attack !== undefined) expect(o.attack).toBeLessThan(o.dur);
          if (n.tone) {
            for (const f of [n.tone.freq, n.tone.to ?? n.tone.freq]) expect(f >= 20 && f <= 4000, `${f} Hz`).toBe(true);
          } else {
            // No hi-hats: percussion noise stays out of the top octaves and short.
            expect(n.noise!.type ?? 'bandpass').toBe('bandpass');
            expect(n.noise!.freq ?? 2000).toBeLessThanOrEqual(3000);
            expect(n.noise!.dur).toBeLessThanOrEqual(0.15);
          }
        }
      }
      // Very light CPU: a handful of oscillators per 8th note.
      expect(maxPerStep).toBeLessThanOrEqual(14);
      // Level: the most the notes starting on one step add up to, at the bed's level, stays far
      // under the show's cues (which peak around 0.5–0.8 on the SFX bus).
      for (const notes of all) {
        const sum = notes.reduce((a, n) => a + ((n.tone ?? n.noise!).gain ?? 0.2), 0);
        expect(sum * THEME_LEVEL).toBeLessThanOrEqual(0.25);
      }
    });
  }

  it('Halloween swings its off-beats; Showtime plays them straight', () => {
    expect(THEME_BEDS.halloween.swing).toBeGreaterThan(0.55);
    expect(THEME_BEDS.showtime.swing).toBe(0.5);
    const late = THEME_BEDS.halloween.notes(1).find((n) => n.tone);
    expect(late?.tone?.start ?? 0).toBeGreaterThan(0);
  });
});
