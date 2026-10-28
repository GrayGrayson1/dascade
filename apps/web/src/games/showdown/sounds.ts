/**
 * DAS Survey Showdown sounds — the metallic CLANG of a flipping answer, the strike buzzer, steal
 * stings, applause, the intro fanfare and the presenter's cues, in two looks (DAS Showtime and
 * Halloween Night). Presenter Showcase adds its own cues on top: the "correct!" ding before a clang,
 * the special answer's celebration, the wrong-answer buzzer, the cinematic opening, the category
 * sting, the Reveal remaining sting and drumroll, time's up, the board-complete flourish, the
 * holding-card whoosh, and the clock and picker cues (1:00 left, the last ten seconds' ticks, the
 * picker's spin and its landing). Every one is an original motif (no TV themes, no film riffs).
 *
 * Every voice is a pure function of the shared synth kit (tone / noise / note) plus a random source,
 * so it runs on the ONE audio pipeline (src/audio/audio.ts: the shared AudioContext, the SFX bus, the
 * jukebox dip, mute and volume) and is unit-testable with a fake kit. Voices return their length in
 * seconds; long ones hold the jukebox dip while they play (synth.hold).
 *
 * Mixed for a Teams screen share (computer sound on): the weight of every hit sits in the mids a
 * laptop speaker and a voice codec keep (a 200 Hz knock under each kick, a mid crack on the thunder),
 * no single noise burst is longer than the shared 1-second noise buffer, and the impact grows from a
 * found answer (ding + clang) to the board complete (+ flourish + applause) to the special answer
 * (a hit, a fanfare and Brian's applause). Peaks stay well under full scale (see voices.test.ts).
 *
 * RECORDED SOUNDS (optional): drop a file into apps/web/public/audio/showdown/ and map it below in
 * SHOWDOWN_SOUND_FILES, e.g. `clang: '/audio/showdown/clang.mp3'` (or per look:
 * `'halloween:strike': '/audio/showdown/halloween-strike.mp3'`). Files are decoded into the shared
 * AudioContext and played on the SFX bus — never through an <audio> element — and any file that fails
 * to load falls back to the procedural voice. Use only sounds you have the rights to (public repo).
 */
import {
  SHOWDOWN_PICK_LAND_MS,
  type ShowdownCue,
  type ShowdownEvent,
  type ShowdownLook,
  type ShowdownMode,
} from '@dascade/shared/games/showdown';
import type { SfxKit } from '../../audio/voices.ts';
import { synth } from '../../audio/audio.ts';
import { duckThemeMusic } from './themeMusic.ts';

export type ShowdownSound =
  | 'clang'
  | 'clangTop'
  | 'strike'
  | 'stealOpen'
  | 'stealMiss'
  | 'award'
  | 'applause'
  | 'intro'
  | 'drumroll'
  | 'aww'
  | 'ding'
  | 'suspense'
  | 'round'
  | 'question'
  | 'control'
  | 'undo'
  | 'calledIt'
  | 'tap'
  | 'finale'
  // ---- Presenter Showcase ----
  /** The "correct!" ding at the start of a reveal (the clang follows as the tile lands). */
  | 'correct'
  /** A tile flipped by the Reveal remaining sweep (lighter than a found answer). */
  | 'clangLate'
  /** The special answer's celebration: a hit on the flip, a fanfare, the crowd (~3 s). */
  | 'special'
  /** A wrong answer: one short, dramatic buzzer. */
  | 'miss'
  /** The cinematic opening (longer than the Team Showdown intro sting). */
  | 'opening'
  /** A new round's category card (the transition sting). */
  | 'category'
  /** Reveal remaining begins ("here come the answers"). */
  | 'sweepStart'
  /** The sweep's drumroll before the special answer: no crash of its own, it lands on the celebration. */
  | 'rollIn'
  /** The round clock ran out. */
  | 'timeup'
  /** Every answer on the board (a flourish under the applause). */
  | 'complete'
  /** A holding card goes up. */
  | 'cardIn'
  // ---- The clock and the picker (AUD-01) ----
  /** One minute left on the round clock (Halloween: one low tower-bell toll). */
  | 'oneMin'
  /** Each of the last ten seconds (Halloween: a clock "tock"). Quiet: it plays under people talking. */
  | 'tick'
  /** The picker's sweep, from the draw to just before the landing (~3 s). */
  | 'spin'
  /** The picker lands on a name (Halloween: a bell and a D-major organ chord). */
  | 'land'
  /** The presenter's "Pick the Answer" button: Brian's song (recorded); a short jingle if the file can't load. */
  | 'pickAnswer';

/** Recorded overrides: `<sound>` for both looks, `<look>:<sound>` for one look. Empty = all procedural. */
export const SHOWDOWN_SOUND_FILES: Partial<Record<ShowdownSound | `${ShowdownLook}:${ShowdownSound}`, string>> = {
  // Brian's soundboard picks (2026-10-26); sources and licences: apps/web/public/audio/showdown/README.md.
  applause: '/audio/showdown/applause.mp3',
  // The end of the show (the results): Brian's applause, not the organ-and-thunder fanfare, which read as sad.
  finale: '/audio/showdown/applause.mp3',
  aww: '/audio/showdown/aww.mp3',
  ding: '/audio/showdown/ding.mp3',
  drumroll: '/audio/showdown/drumroll.mp3',
  suspense: '/audio/showdown/suspense.mp3',
  pickAnswer: '/audio/showdown/pick-the-answer.mp3',
  // Brian's recordings in place of the built-in claps, dings and rolls (2026-10-26): the "correct!" ding
  // before a found answer's clang, the sweep's roll into the special answer (its cymbal lands ~2.88 s in,
  // as the tile flips at 2.92 s) and Team Showdown's failed steal.
  correct: '/audio/showdown/ding.mp3',
  rollIn: '/audio/showdown/drumroll.mp3',
  stealMiss: '/audio/showdown/aww.mp3',
};

export type Voice = (k: SfxKit, rand: () => number) => number;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A struck metal plate: a hammer click, then inharmonic partials (free-bar modes) ringing out. */
function plate(k: SfxKit, base: number, level = 1, start = 0): void {
  k.noise({ start, dur: 0.04, gain: 0.3 * level, freq: 5200, q: 0.7, type: 'highpass' });
  k.noise({ start, dur: 0.14, gain: 0.16 * level, freq: 1900, q: 2.2, to: 850 });
  const partials: Array<[number, number, number]> = [
    [1, 0.19, 1.7],
    [1.009, 0.12, 1.6],
    [2.756, 0.12, 1.15],
    [5.404, 0.075, 0.8],
    [8.933, 0.045, 0.5],
    [13.34, 0.028, 0.3],
  ];
  for (const [ratio, gain, dur] of partials) k.tone({ type: 'sine', freq: base * ratio, start, dur, gain: gain * level, attack: 0.002 });
  k.tone({ type: 'triangle', freq: base / 2, to: base / 2.7, start, dur: 0.32, gain: 0.15 * level, attack: 0.003 });
}

/** The tile turning over: a short air whoosh. */
function swish(k: SfxKit, start = 0, level = 1): void {
  k.noise({ start, dur: 0.16, gain: 0.12 * level, freq: 700, q: 0.9, to: 3600 });
}

function sparkle(k: SfxKit, notes: number[], start: number, step = 0.06, gain = 0.055): void {
  notes.forEach((n, i) => k.tone({ type: 'sine', freq: k.note(n), start: start + i * step, dur: 0.3, gain, attack: 0.004 }));
}

/** A brassy chord stab (detuned saw + square pairs). */
function stab(k: SfxKit, notes: number[], start: number, dur: number, gain: number): void {
  for (const n of notes) {
    k.tone({ type: 'sawtooth', freq: k.note(n), start, dur, gain, attack: 0.012, detune: 7 });
    k.tone({ type: 'square', freq: k.note(n), start, dur, gain: gain * 0.55, attack: 0.012, detune: -7 });
  }
}

/** A church-organ chord (square + sine octave). */
function organ(k: SfxKit, notes: number[], start: number, dur: number, gain: number): void {
  for (const n of notes) {
    k.tone({ type: 'square', freq: k.note(n), start, dur, gain, attack: 0.03 });
    k.tone({ type: 'sine', freq: k.note(n + 12), start, dur, gain: gain * 0.7, attack: 0.03 });
    k.tone({ type: 'sine', freq: k.note(n - 12), start, dur, gain: gain * 0.5, attack: 0.05 });
  }
}

const kick = (k: SfxKit, start: number, gain = 0.3) => k.tone({ type: 'sine', freq: 150, to: 48, start, dur: 0.24, gain, attack: 0.003 });
const snare = (k: SfxKit, start: number, gain = 0.16) => k.noise({ start, dur: 0.15, gain, freq: 2300, q: 0.6 });
const cymbal = (k: SfxKit, start: number, dur = 1.4, gain = 0.15) =>
  k.noise({ start, dur, gain, freq: 6500, q: 0.4, type: 'highpass', attack: 0.01 });
const thunder = (k: SfxKit, start: number, dur = 1.8, gain = 0.22) =>
  k.noise({ start, dur, gain, freq: 160, to: 55, q: 0.7, type: 'lowpass', attack: 0.06 });

/** Individual claps, swelling in and thinning out over `seconds`. */
function claps(k: SfxKit, rand: () => number, start: number, seconds: number, count: number, level = 1): void {
  for (let i = 0; i < count; i++) {
    const t = seconds * Math.pow(rand(), 0.8);
    const tail = t > seconds * 0.6 ? 1 - (t - seconds * 0.6) / (seconds * 0.4) : 1;
    k.noise({
      start: start + t,
      dur: 0.018 + rand() * 0.03,
      gain: Math.min(0.4, (0.12 + rand() * 0.16) * Math.max(0.15, tail) * level),
      freq: 900 + rand() * 1900,
      q: 0.7 + rand() * 0.9,
    });
  }
}

/**
 * How loud the applause sits (AUD-01's loudness pass: no quieter than −30 LUFS-M, so a cheer after
 * the board's last tile still reads through a Teams share). It was −34; now ≈ −28 (≈ −30.5 through
 * the 150 Hz–7 kHz call band), still ~8 dB under a found answer. The claps cap at 0.4 a node.
 */
const APPLAUSE_LEVEL = 2.2;

/** Crowd applause: a bed of noise and a swarm of claps that swells, holds and fades. */
export function applause(k: SfxKit, rand: () => number, seconds = 3.4, count = 110, level = APPLAUSE_LEVEL): number {
  // The bed in overlapping one-second layers (the shared noise buffer is one second long: a longer
  // burst would stop dead after a second).
  for (let t = 0, i = 0; t < seconds - 0.4; t += 0.5, i++) {
    const fade = Math.max(0.25, 1 - t / seconds);
    k.noise({ start: t, dur: 0.98, gain: 0.1 * fade * level, freq: 1600, q: 0.5, attack: i === 0 ? 0.45 : 0.3 });
    if (t < seconds * 0.6)
      k.noise({ start: t + 0.1, dur: 0.9, gain: 0.05 * fade * level, freq: 650, q: 0.6, type: 'lowpass', attack: 0.3 });
  }
  claps(k, rand, 0, seconds, Math.round(count * 1.3), level);
  k.tone({ type: 'sine', freq: 1500, to: 2350, start: 0.35, dur: 0.45, gain: 0.032 * level, attack: 0.05 });
  k.tone({ type: 'sine', freq: 1750, to: 1250, start: 0.95, dur: 0.5, gain: 0.028 * level, attack: 0.04 });
  return seconds;
}

function drumroll(k: SfxKit, rand: () => number, seconds = 2.4): number {
  const hits = Math.round(seconds / 0.034);
  for (let i = 0; i < hits; i++) {
    const t = i * 0.034 + rand() * 0.006;
    const swell = 0.035 + (0.13 * i) / hits;
    k.noise({ start: t, dur: 0.05, gain: swell, freq: 1700 + rand() * 500, q: 0.55 });
  }
  kick(k, seconds + 0.04, 0.34);
  cymbal(k, seconds + 0.04, 1.5, 0.2);
  return seconds + 1.5;
}

// ---------------------------------------------------------------------------
// Presenter Showcase building blocks
// ---------------------------------------------------------------------------

/** A kick that survives a laptop speaker: the sub drop, a 200 Hz knock and a click. */
function thump(k: SfxKit, start: number, gain = 0.22): void {
  k.tone({ type: 'sine', freq: 140, to: 50, start, dur: 0.3, gain, attack: 0.002 });
  k.tone({ type: 'triangle', freq: 240, to: 115, start, dur: 0.09, gain: gain * 0.6, attack: 0.001 });
  k.noise({ start, dur: 0.02, gain: gain * 0.45, freq: 2600, q: 0.7, type: 'lowpass' });
}

/** A crash cymbal: a mid body (what survives a call) and the air above it. */
function crash(k: SfxKit, start: number, gain = 0.11): void {
  k.noise({ start, dur: 0.5, gain: gain * 0.75, freq: 3400, q: 0.6 });
  k.noise({ start, dur: 0.98, gain, freq: 6800, q: 0.5, type: 'highpass', attack: 0.004 });
}

/** A tuned chime (celesta / glockenspiel): a sine, a soft octave and a glassy upper partial. */
function chime(k: SfxKit, freq: number, start: number, dur = 0.6, gain = 0.05): void {
  k.tone({ type: 'sine', freq, start, dur, gain, attack: 0.003 });
  k.tone({ type: 'sine', freq: freq * 2, start, dur: dur * 0.5, gain: gain * 0.3, attack: 0.002 });
  k.tone({ type: 'sine', freq: freq * 4.07, start, dur: dur * 0.22, gain: gain * 0.12, attack: 0.001 });
}

/** A brass section: two detuned saws for the blare, a triangle for the body. */
function horn(k: SfxKit, notes: number[], start: number, dur: number, gain: number, attack = 0.018): void {
  for (const n of notes) {
    const f = k.note(n);
    k.tone({ type: 'sawtooth', freq: f, start, dur, gain: gain * 0.6, attack, detune: 6 });
    k.tone({ type: 'sawtooth', freq: f, start, dur, gain: gain * 0.6, attack, detune: -6 });
    k.tone({ type: 'triangle', freq: f, start, dur: dur * 1.2, gain: gain * 0.8, attack });
  }
}

/** A theatre organ: a triangle flue, a sine octave and a little reed. */
function pipe(k: SfxKit, notes: number[], start: number, dur: number, gain: number, attack = 0.025): void {
  for (const n of notes) {
    const f = k.note(n);
    k.tone({ type: 'triangle', freq: f, start, dur, gain, attack });
    k.tone({ type: 'sine', freq: f * 2, start, dur, gain: gain * 0.55, attack });
    k.tone({ type: 'square', freq: f, start, dur: dur * 0.8, gain: gain * 0.22, attack });
  }
}

/** A short tom (pitched for small speakers). */
function tom(k: SfxKit, start: number, freq: number, gain = 0.12): void {
  k.tone({ type: 'triangle', freq, to: freq * 0.62, start, dur: 0.22, gain, attack: 0.002 });
  k.noise({ start, dur: 0.05, gain: gain * 0.5, freq: freq * 6, q: 0.8 });
}

/** A snare roll that swells from `from` to `to` over `seconds` (no crash: it lands on whatever follows). */
function roll(k: SfxKit, rand: () => number, start: number, seconds: number, from: number, to: number): void {
  const hits = Math.round(seconds / 0.034);
  for (let i = 0; i < hits; i++) {
    const x = i / Math.max(1, hits - 1);
    k.noise({ start: start + i * 0.034 + rand() * 0.006, dur: 0.05, gain: from + (to - from) * x * x, freq: 1600 + rand() * 600, q: 0.55 });
  }
}

/**
 * An electric buzzer: a dissonant pair re-struck 30 times a second (the rattle of a real buzzer), at a
 * steady level for `dur`, then cut. Repeats cleanly: nothing rings on after it.
 */
function buzzer(k: SfxKit, start: number, dur: number, low: number, gain: number, round = false): void {
  const rate = 30;
  const n = Math.max(3, Math.round(dur * rate));
  for (let i = 0; i < n; i++) {
    const shape = i === 0 ? 1.15 : i >= n - 3 ? (n - i) / 4 : 1;
    const t = start + i / rate;
    k.tone({ type: round ? 'triangle' : 'sawtooth', freq: low, start: t, dur: 2.4 / rate, gain: gain * shape, attack: 0.002 });
    k.tone({ type: 'square', freq: low * 1.0595, start: t, dur: 2.4 / rate, gain: gain * (round ? 0.38 : 0.45) * shape, attack: 0.002 });
  }
}

/**
 * A tuned church bell (hum, prime, tierce, quint, nominal) for the Halloween cascades and tolls. The
 * tierce is a real bell's minor third (1.19); a major-third bell (1.26) rings happy over a major chord.
 */
function churchBell(k: SfxKit, freq: number, start: number, dur = 1.4, gain = 0.05, tierce = 1.19): void {
  const partials: Array<[number, number, number]> = [
    [0.5, 0.45, 1.3],
    [1, 1, 1],
    [tierce, 0.45, 0.8],
    [1.5, 0.22, 0.6],
    [2, 0.35, 0.5],
    [2.98, 0.12, 0.3],
  ];
  for (const [ratio, g, d] of partials) k.tone({ type: 'sine', freq: freq * ratio, start, dur: dur * d, gain: gain * g, attack: 0.002 });
  k.noise({ start, dur: 0.03, gain: gain * 1.4, freq: Math.min(9000, freq * 4), q: 1.2 });
}

/** A theremin-ish glide: a sine and a twin ~5 Hz away (the beating is the wobble). */
function theremin(k: SfxKit, from: number, to: number, start: number, dur: number, gain: number, attack = 0.12): void {
  const wobble = 1200 * Math.log2(1 + 5.5 / from);
  k.tone({ type: 'sine', freq: from, to, start, dur, gain, attack });
  k.tone({ type: 'sine', freq: from, to, start, dur, gain: gain * 0.7, attack, detune: wobble });
}

/** Bat wings: a flutter of short noise flaps. */
function bats(k: SfxKit, start: number, count = 7, gain = 0.06): void {
  for (let i = 0; i < count; i++) {
    k.noise({ start: start + i * 0.034, dur: 0.028, gain: gain * (1 - i / (count * 1.8)), freq: 2300 + (i % 2) * 1100, q: 1.6 });
  }
}

/** Thunder that a laptop speaker can still hear: a mid crack, a rumble with mids in it, the roll. */
function storm(k: SfxKit, start: number, gain = 0.2): void {
  k.noise({ start, dur: 0.16, gain, freq: 1500, to: 600, q: 0.6 });
  k.noise({ start: start + 0.03, dur: 0.97, gain: gain * 0.85, freq: 900, to: 120, q: 0.5, type: 'lowpass', attack: 0.03 });
  k.noise({ start: start + 0.12, dur: 0.86, gain: gain * 0.5, freq: 260, q: 1.1, attack: 0.15 });
}

/** Onset times that slow down like a wheel (or a clock winding down): each gap `grow` times the last. */
function slowing(total: number, first: number, grow: number): number[] {
  const out: number[] = [];
  for (let t = 0, step = first; t < total; t += step, step *= grow) out.push(t);
  return out;
}

/** A heartbeat: lub-dub. */
function heartbeat(k: SfxKit, start: number, gain = 0.12): void {
  for (const [at, g] of [
    [0, 1],
    [0.17, 0.75],
  ] as const) {
    k.tone({ type: 'sine', freq: 90, to: 48, start: start + at, dur: 0.2, gain: gain * g, attack: 0.004 });
    k.tone({ type: 'triangle', freq: 190, to: 110, start: start + at, dur: 0.07, gain: gain * g * 0.5, attack: 0.002 });
  }
}

// ---------------------------------------------------------------------------
// DAS Showtime
// ---------------------------------------------------------------------------

const SHOWTIME: Record<ShowdownSound, Voice> = {
  clang: (k) => {
    swish(k);
    plate(k, 330, 1, 0.11);
    return 1.8;
  },
  clangTop: (k) => {
    swish(k);
    plate(k, 392, 1.1, 0.11);
    sparkle(k, [84, 88, 91, 96, 100], 0.32);
    k.tone({ type: 'sine', freq: k.note(96), start: 0.62, dur: 0.9, gain: 0.07 });
    return 1.9;
  },
  strike: (k) => {
    for (let i = 0; i < 3; i++) {
      const s = i * 0.24;
      k.tone({ type: 'sawtooth', freq: 98, start: s, dur: 0.34, gain: 0.15, attack: 0.008 });
      k.tone({ type: 'square', freq: 104, start: s, dur: 0.34, gain: 0.09, attack: 0.008 });
      k.tone({ type: 'sawtooth', freq: 147, start: s, dur: 0.34, gain: 0.06, attack: 0.008 });
    }
    k.noise({ dur: 0.78, gain: 0.07, freq: 420, q: 0.8, type: 'lowpass' });
    return 0.85;
  },
  stealOpen: (k) => {
    const notes = [57, 60, 63, 66];
    for (let i = 0; i < 18; i++) {
      const n = notes[i % 4]! + Math.floor(i / 6) * 3;
      k.tone({ type: 'square', freq: k.note(n + 12), start: i * 0.07, dur: 0.08, gain: 0.05 });
    }
    k.tone({ type: 'sawtooth', freq: 55, start: 0, dur: 1.5, gain: 0.07, attack: 0.1 });
    stab(k, [57, 60, 63, 66], 1.28, 0.45, 0.05);
    kick(k, 1.28);
    return 1.8;
  },
  stealMiss: (k) => {
    [63, 62, 61, 58].forEach((n, i) => {
      const last = i === 3;
      k.tone({
        type: 'triangle',
        freq: k.note(n),
        to: last ? k.note(n) * 0.97 : undefined,
        start: i * 0.32,
        dur: last ? 0.9 : 0.3,
        gain: 0.09,
        attack: 0.02,
      });
      k.tone({ type: 'sawtooth', freq: k.note(n - 12), start: i * 0.32, dur: last ? 0.9 : 0.3, gain: 0.04, attack: 0.02 });
    });
    return 1.9;
  },
  award: (k) => {
    sparkle(k, [84, 88, 91, 96, 100, 103], 0, 0.05, 0.06);
    k.noise({ start: 0.32, dur: 0.16, gain: 0.14, freq: 6200, q: 0.5, type: 'highpass' });
    k.tone({ type: 'sine', freq: 2637, start: 0.32, dur: 0.5, gain: 0.07 });
    k.tone({ type: 'square', freq: k.note(79), start: 0.32, dur: 0.35, gain: 0.05 });
    return 0.9;
  },
  applause: (k, rand) => applause(k, rand),
  intro: (k) => {
    kick(k, 0);
    stab(k, [60, 64, 67], 0, 0.16, 0.06);
    stab(k, [60, 64, 67], 0.18, 0.12, 0.05);
    kick(k, 0.32);
    snare(k, 0.32);
    stab(k, [65, 69, 72], 0.32, 0.2, 0.06);
    stab(k, [67, 71, 74], 0.56, 0.18, 0.06);
    [79, 81, 83].forEach((n, i) => k.tone({ type: 'square', freq: k.note(n), start: 0.56 + i * 0.07, dur: 0.12, gain: 0.05 }));
    kick(k, 0.8, 0.36);
    stab(k, [72, 76, 79, 84], 0.8, 1.35, 0.055);
    cymbal(k, 0.8, 1.6, 0.17);
    sparkle(k, [96, 100, 103, 108], 0.9, 0.08, 0.04);
    return 2.4;
  },
  drumroll: (k, rand) => drumroll(k, rand),
  aww: (k) => {
    for (const [f, d] of [
      [392, 0],
      [370, 6],
      [415, -6],
      [349, 3],
    ] as const) {
      k.tone({ type: 'triangle', freq: f, to: f * 0.72, dur: 1.15, gain: 0.05, attack: 0.14, detune: d });
    }
    k.noise({ dur: 1.15, gain: 0.05, freq: 950, to: 480, q: 2.4, attack: 0.14 });
    return 1.2;
  },
  // "Pick the Answer" without its recording: a short game-show jingle (up a major arpeggio, a held chord).
  pickAnswer: (k) => {
    [72, 76, 79, 84].forEach((n, i) => k.tone({ type: 'triangle', freq: k.note(n), start: i * 0.14, dur: 0.22, gain: 0.07 }));
    for (const n of [72, 76, 79, 84]) k.tone({ type: 'square', freq: k.note(n), start: 0.6, dur: 0.9, gain: 0.018, attack: 0.02 });
    k.tone({ type: 'sine', freq: k.note(48), start: 0.6, dur: 0.9, gain: 0.06 });
    return 1.6;
  },
  ding: (k) => {
    k.tone({ type: 'sine', freq: k.note(88), dur: 0.95, gain: 0.13 });
    k.tone({ type: 'sine', freq: k.note(95), dur: 0.6, gain: 0.05 });
    k.tone({ type: 'sine', freq: k.note(100), dur: 0.4, gain: 0.025 });
    return 1;
  },
  suspense: (k) => {
    for (const t of [0, 0.2, 0.95, 1.15, 1.9, 2.1]) kick(k, t, 0.24);
    k.tone({ type: 'sine', freq: 110, to: 233, dur: 2.6, gain: 0.045, attack: 0.4 });
    k.tone({ type: 'sawtooth', freq: 55, to: 58, dur: 2.6, gain: 0.03, attack: 0.6 });
    return 2.7;
  },
  round: (k) => {
    k.noise({ dur: 0.5, gain: 0.14, freq: 320, q: 0.6, to: 3200, type: 'lowpass' });
    sparkle(k, [76, 83, 88], 0.28, 0.08, 0.07);
    return 0.9;
  },
  question: (k) => {
    k.noise({ dur: 0.35, gain: 0.1, freq: 500, q: 0.8, to: 2800 });
    k.tone({ type: 'sine', freq: k.note(81), start: 0.2, dur: 0.6, gain: 0.07 });
    k.tone({ type: 'sine', freq: k.note(88), start: 0.28, dur: 0.6, gain: 0.05 });
    return 0.8;
  },
  control: (k) => {
    k.tone({ type: 'square', freq: k.note(76), dur: 0.08, gain: 0.07 });
    k.tone({ type: 'square', freq: k.note(83), start: 0.07, dur: 0.16, gain: 0.07 });
    return 0.25;
  },
  undo: (k) => {
    k.tone({ type: 'sawtooth', freq: 1200, to: 180, dur: 0.3, gain: 0.05 });
    k.noise({ dur: 0.3, gain: 0.07, freq: 4200, to: 700, q: 1.2 });
    return 0.35;
  },
  calledIt: (k) => {
    sparkle(k, [84, 88, 91, 96], 0, 0.06, 0.07);
    k.tone({ type: 'sine', freq: k.note(100), start: 0.24, dur: 0.5, gain: 0.04 });
    return 0.8;
  },
  tap: (k) => {
    k.tone({ type: 'sine', freq: 620, to: 1250, dur: 0.06, gain: 0.06 });
    return 0.06;
  },
  finale: (k, rand) => {
    stab(k, [72, 76, 79], 0, 0.14, 0.055);
    stab(k, [72, 76, 79], 0.16, 0.14, 0.055);
    stab(k, [74, 77, 81], 0.32, 0.14, 0.055);
    stab(k, [76, 79, 84, 88], 0.5, 1.4, 0.055);
    kick(k, 0.5, 0.36);
    cymbal(k, 0.5, 1.8, 0.16);
    applause(k, rand, 4, 130);
    return 4;
  },

  // ---- Presenter Showcase ----
  // "Ding-DING!": a rising fifth (E6 → B6) on a glassy chime, high above the clang that follows.
  correct: (k) => {
    chime(k, k.note(88), 0, 0.5, 0.14);
    chime(k, k.note(95), 0.075, 0.62, 0.125);
    return 0.7;
  },
  // The sweep's tiles: the same plate, smaller and drier, so ten in a row never tire.
  clangLate: (k) => {
    swish(k, 0, 0.55);
    k.noise({ start: 0.11, dur: 0.03, gain: 0.16, freq: 5200, q: 0.7, type: 'highpass' });
    for (const [ratio, gain, dur] of [
      [1, 0.12, 0.95],
      [1.009, 0.07, 0.9],
      [2.756, 0.07, 0.6],
      [5.404, 0.04, 0.4],
      [8.933, 0.022, 0.25],
    ] as const) {
      k.tone({ type: 'sine', freq: 349 * ratio, start: 0.11, dur, gain, attack: 0.002 });
    }
    k.tone({ type: 'triangle', freq: 175, to: 120, start: 0.11, dur: 0.18, gain: 0.07, attack: 0.003 });
    return 1.1;
  },
  // THE moment (lands on the flip): clang + kick + crash under a C-major blast, a sparkle run, a
  // ta-ta-ta-TAAA brass fanfare (I–IV–V–I) whose last chord rings a second, higher plate and a bell
  // cascade down (Brian's applause comes in under it: cueSounds, eventSounds).
  special: (k) => {
    // The hit's layers are flammed by a few ms (heard as one hit, but their peaks don't stack).
    thump(k, 0, 0.26);
    plate(k, 392, 0.75, 0.008);
    crash(k, 0.014, 0.12);
    horn(k, [48, 60, 64, 67], 0.004, 0.5, 0.06);
    [84, 88, 91, 96, 100, 103].forEach((n, i) => chime(k, k.note(n), 0.06 + i * 0.045, 0.35, 0.055));
    horn(k, [64, 67, 72], 0.52, 0.14, 0.1);
    horn(k, [65, 69, 72], 0.67, 0.14, 0.1);
    horn(k, [67, 71, 74], 0.82, 0.14, 0.1);
    thump(k, 1.0, 0.24);
    horn(k, [48, 60, 64, 67, 72], 1.004, 2.1, 0.075);
    plate(k, 523, 0.45, 1.01);
    crash(k, 1.016, 0.12);
    [96, 91, 88, 84, 79].forEach((n, i) => chime(k, k.note(n), 1.08 + i * 0.09, 0.9, 0.085));
    return 3.2;
  },
  // One dramatic buzz (an A–B♭ cluster, rattling), on a thump that lands with the big ✕.
  miss: (k) => {
    thump(k, 0, 0.18);
    buzzer(k, 0, 0.5, 110, 0.17);
    k.noise({ dur: 0.42, gain: 0.09, freq: 520, q: 0.8, type: 'lowpass' });
    return 0.55;
  },
  // The cold open (~5.5 s): a riser and a snare roll, then a call-and-answer brass fanfare
  // (G G C! · A A D! · E F G) into a big C-major chord that rings out under the theme.
  opening: (k, rand) => {
    k.noise({ dur: 0.98, gain: 0.16, freq: 380, to: 4200, q: 0.9, attack: 0.85 });
    k.tone({ type: 'sine', freq: 196, to: 784, dur: 1.05, gain: 0.06, attack: 0.9 });
    roll(k, rand, 0.45, 0.62, 0.05, 0.2);
    horn(k, [55, 67], 1.1, 0.12, 0.06);
    horn(k, [55, 67], 1.25, 0.12, 0.06);
    horn(k, [48, 60, 64, 67, 72], 1.404, 0.55, 0.045);
    thump(k, 1.4, 0.24);
    crash(k, 1.4, 0.09);
    horn(k, [57, 69], 1.95, 0.12, 0.06);
    horn(k, [57, 69], 2.1, 0.12, 0.06);
    horn(k, [55, 65, 71, 74], 2.254, 0.55, 0.045);
    thump(k, 2.25, 0.22);
    snare(k, 2.25, 0.1);
    horn(k, [76], 2.82, 0.11, 0.06);
    horn(k, [77], 2.95, 0.11, 0.06);
    horn(k, [79], 3.08, 0.11, 0.06);
    tom(k, 2.82, 220, 0.11);
    tom(k, 2.95, 180, 0.12);
    tom(k, 3.08, 150, 0.13);
    horn(k, [48, 60, 64, 67, 72, 76], 3.254, 2.4, 0.034);
    thump(k, 3.25, 0.26);
    crash(k, 3.25, 0.12);
    [84, 88, 91, 96].forEach((n, i) => chime(k, k.note(n), 3.3 + i * 0.07, 0.5, 0.05));
    chime(k, k.note(96), 3.62, 2.0, 0.05);
    return 5.6;
  },
  // A round's category card: a whoosh up, a tom fill, then a suspended chord that opens to C major
  // with a glockenspiel answer.
  category: (k) => {
    k.noise({ dur: 0.5, gain: 0.2, freq: 420, to: 3600, q: 0.8, attack: 0.42 });
    tom(k, 0.3, 230, 0.12);
    tom(k, 0.39, 190, 0.13);
    tom(k, 0.48, 155, 0.15);
    thump(k, 0.58, 0.22);
    horn(k, [60, 65, 67, 72], 0.584, 0.34, 0.042);
    crash(k, 0.59, 0.1);
    horn(k, [60, 64, 67, 72], 0.92, 1.3, 0.042, 0.04);
    [79, 84, 88, 91].forEach((n, i) => chime(k, k.note(n), 0.98 + i * 0.09, 0.7, 0.06));
    return 2.4;
  },
  // "Here come the answers": a snare build and a dominant stab that leaves the door open.
  sweepStart: (k, rand) => {
    roll(k, rand, 0, 0.42, 0.07, 0.32);
    k.tone({ type: 'sine', freq: 330, to: 660, dur: 0.45, gain: 0.07, attack: 0.38 });
    thump(k, 0.45, 0.22);
    horn(k, [55, 59, 65, 74], 0.454, 0.55, 0.05);
    chime(k, k.note(91), 0.47, 0.5, 0.07);
    return 1.05;
  },
  // The beat before the special tile: a snare roll swelling over a rising sine (no crash: the
  // celebration's hit is the landing). Ends ~2.9 s, as the special tile lands.
  rollIn: (k, rand) => {
    roll(k, rand, 0, 2.9, 0.05, 0.4);
    k.tone({ type: 'sine', freq: 220, to: 523, dur: 2.9, gain: 0.1, attack: 2.4 });
    k.tone({ type: 'triangle', freq: 98, to: 131, dur: 2.9, gain: 0.11, attack: 2.2 });
    return 2.95;
  },
  // Time! A boxing-ring bell, struck three times.
  timeup: (k) => {
    for (const t of [0, 0.19, 0.38]) {
      k.noise({ start: t, dur: 0.02, gain: 0.16, freq: 6000, q: 0.8, type: 'highpass' });
      for (const [ratio, gain, dur] of [
        [1, 0.17, 1.4],
        [2.32, 0.085, 1],
        [4.25, 0.05, 0.6],
        [6.63, 0.025, 0.35],
      ] as const) {
        k.tone({ type: 'sine', freq: 784 * ratio, start: t, dur: t === 0.38 ? dur : dur * 0.5, gain, attack: 0.002 });
      }
    }
    k.tone({ type: 'sine', freq: 196, start: 0, dur: 0.9, gain: 0.09, attack: 0.004 });
    return 1.8;
  },
  // The board's last tile: "ta-DAAA!" — a G pickup into C major, a glockenspiel run up and a crash
  // (Brian's applause follows).
  complete: (k) => {
    horn(k, [55, 67, 71, 74], 0, 0.11, 0.06);
    thump(k, 0.13, 0.24);
    horn(k, [48, 60, 64, 67, 72], 0.134, 1.6, 0.06);
    crash(k, 0.142, 0.12);
    [84, 88, 91, 96, 100].forEach((n, i) => chime(k, k.note(n), 0.16 + i * 0.05, 0.5, 0.06));
    chime(k, k.note(96), 0.45, 1.2, 0.06);
    return 1.8;
  },
  // A holding card slides up: a soft whoosh and a faint chime.
  cardIn: (k) => {
    k.noise({ dur: 0.5, gain: 0.4, freq: 300, to: 2600, q: 0.7, type: 'lowpass', attack: 0.28 });
    k.noise({ dur: 0.5, gain: 0.26, freq: 900, to: 2200, q: 1, attack: 0.3 });
    chime(k, k.note(91), 0.4, 0.5, 0.03);
    return 0.9;
  },

  // ---- The clock and the picker (AUD-01) ----
  // 1:00 left: an announcement "ding-dong" (E6 → C6) over a soft C-major pad.
  oneMin: (k) => {
    chime(k, k.note(88), 0, 0.9, 0.2);
    chime(k, k.note(84), 0.36, 1.3, 0.22);
    for (const n of [72, 76, 79]) k.tone({ type: 'triangle', freq: k.note(n), start: 0.36, dur: 1.2, gain: 0.045, attack: 0.05 });
    return 1.7;
  },
  // The last ten seconds: a dry wood block.
  tick: (k) => {
    k.tone({ type: 'sine', freq: 1320, to: 1180, dur: 0.08, gain: 0.24, attack: 0.001 });
    k.tone({ type: 'triangle', freq: 660, dur: 0.07, gain: 0.12, attack: 0.001 });
    k.noise({ dur: 0.025, gain: 0.13, freq: 2600, q: 2 });
    return 0.12;
  },
  // The picker's sweep: a prize wheel's clicks slowing down over a rising hum (ends before the landing).
  spin: (k) => {
    k.tone({ type: 'sine', freq: 330, to: 660, dur: 3, gain: 0.075, attack: 1.8 });
    for (const t of slowing(2.95, 0.05, 1.085)) {
      k.tone({ type: 'sine', freq: 2100, start: t, dur: 0.03, gain: 0.1, attack: 0.001 });
      k.noise({ start: t, dur: 0.015, gain: 0.09, freq: 3600, q: 2 });
    }
    return 3.05;
  },
  // The landing: three quick bells, then a C-major horn chord with a glint on top.
  land: (k) => {
    for (const t of [0, 0.09, 0.18]) chime(k, k.note(84), t, 0.5, 0.11);
    thump(k, 0.27, 0.22);
    horn(k, [60, 64, 67, 72], 0.274, 0.9, 0.055);
    chime(k, k.note(96), 0.3, 0.9, 0.075);
    return 1.5;
  },
};

// ---------------------------------------------------------------------------
// Halloween Night: a haunted bell instead of a plate, ghostly buzzers, organ and thunder
// ---------------------------------------------------------------------------

/** A cracked church bell: plate partials over a minor-third hum. */
function bell(k: SfxKit, base: number, level = 1, start = 0): void {
  plate(k, base, 0.75 * level, start);
  k.tone({ type: 'sine', freq: base * 0.5, start, dur: 2.2, gain: 0.09 * level, attack: 0.004 });
  k.tone({ type: 'sine', freq: base * 1.189, start, dur: 1.6, gain: 0.07 * level, attack: 0.004 });
  k.tone({ type: 'sine', freq: base * 1.498, start, dur: 1.2, gain: 0.04 * level, attack: 0.004 });
  // A rattle of chains as it settles.
  for (let i = 0; i < 5; i++) k.noise({ start: start + 0.06 + i * 0.045, dur: 0.03, gain: 0.05 * level, freq: 3800 + i * 300, q: 4 });
}

function ghost(k: SfxKit, start: number, from: number, to: number, dur: number, gain = 0.05): void {
  for (const d of [-9, 0, 11]) k.tone({ type: 'sine', freq: from, to, start, dur, gain, attack: 0.18, detune: d });
}

const HALLOWEEN: Partial<Record<ShowdownSound, Voice>> = {
  clang: (k) => {
    swish(k, 0, 0.8);
    bell(k, 247, 1, 0.11);
    return 2.3;
  },
  clangTop: (k) => {
    swish(k, 0, 0.8);
    bell(k, 294, 1.1, 0.11);
    sparkle(k, [81, 84, 88, 93, 96], 0.34, 0.07);
    ghost(k, 0.5, 880, 1320, 0.7, 0.025);
    return 2.4;
  },
  strike: (k) => {
    for (let i = 0; i < 3; i++) {
      const s = i * 0.24;
      k.tone({ type: 'sawtooth', freq: 87, start: s, dur: 0.34, gain: 0.12, attack: 0.008 });
      k.tone({ type: 'square', freq: 92, start: s, dur: 0.34, gain: 0.07, attack: 0.008 });
    }
    ghost(k, 0.2, 720, 340, 1.0, 0.05);
    return 1.25;
  },
  stealOpen: (k) => {
    thunder(k, 0, 1.9, 0.24);
    organ(k, [50, 53, 56, 59], 0.15, 1.5, 0.028);
    ghost(k, 0.6, 500, 900, 0.9, 0.03);
    return 2;
  },
  stealMiss: (k) => {
    [62, 61, 60, 57].forEach((n, i) => organ(k, [n], i * 0.3, i === 3 ? 1 : 0.28, 0.035));
    ghost(k, 1.0, 600, 300, 1.0, 0.035);
    return 2.1;
  },
  award: (k) => {
    sparkle(k, [81, 84, 88, 93, 96], 0, 0.06, 0.055);
    for (let i = 0; i < 6; i++) k.noise({ start: 0.32 + i * 0.04, dur: 0.03, gain: 0.07, freq: 4200 + i * 250, q: 4 });
    k.tone({ type: 'sine', freq: k.note(93), start: 0.34, dur: 0.8, gain: 0.06 });
    return 1.1;
  },
  intro: (k) => {
    // A little organ toccata, then thunder under a D-minor chord.
    const melody: Array<[number, number, number]> = [
      [69, 0, 0.14],
      [67, 0.14, 0.14],
      [69, 0.28, 0.5],
      [67, 0.86, 0.1],
      [65, 0.96, 0.1],
      [64, 1.06, 0.1],
      [62, 1.16, 0.1],
      [61, 1.26, 0.24],
      [62, 1.52, 0.4],
    ];
    for (const [n, t, d] of melody) organ(k, [n], t, d, 0.04);
    thunder(k, 1.9, 2.2, 0.26);
    organ(k, [50, 53, 57, 62], 1.95, 1.6, 0.026);
    ghost(k, 2.3, 600, 1100, 0.9, 0.025);
    return 3.6;
  },
  aww: (k) => {
    ghost(k, 0, 520, 300, 1.3, 0.05);
    k.noise({ dur: 1.2, gain: 0.04, freq: 900, to: 450, q: 2.4, attack: 0.15 });
    return 1.3;
  },
  suspense: (k) => {
    for (const t of [0, 0.2, 0.95, 1.15, 1.9, 2.1]) kick(k, t, 0.22);
    organ(k, [45, 48, 51], 0, 2.6, 0.018);
    ghost(k, 1.2, 400, 700, 1.3, 0.025);
    return 2.7;
  },
  round: (k) => {
    // Bat wings, then a low organ chord.
    for (let i = 0; i < 7; i++) k.noise({ start: i * 0.035, dur: 0.03, gain: 0.08, freq: 2600 + (i % 2) * 900, q: 1.5 });
    organ(k, [57, 60, 64], 0.28, 0.6, 0.03);
    return 0.95;
  },
  question: (k) => {
    // A creaky door.
    for (let i = 0; i < 14; i++) k.noise({ start: i * 0.03, dur: 0.025, gain: 0.05, freq: 500 + i * 60, q: 6 });
    k.tone({ type: 'sawtooth', freq: 210, to: 280, dur: 0.45, gain: 0.03, attack: 0.05 });
    return 0.55;
  },
  undo: (k) => {
    ghost(k, 0, 900, 300, 0.45, 0.04);
    return 0.5;
  },
  finale: (k, rand) => {
    organ(k, [62, 65, 69], 0, 0.3, 0.03);
    organ(k, [64, 67, 71], 0.32, 0.3, 0.03);
    organ(k, [65, 69, 72, 77], 0.64, 1.6, 0.03);
    thunder(k, 0.64, 1.8, 0.2);
    applause(k, rand, 4, 130);
    return 4;
  },

  // ---- Presenter Showcase ----
  // A haunted music box: A5 → E6 with an eerie detuned twin on the answer.
  correct: (k) => {
    k.tone({ type: 'triangle', freq: k.note(81), dur: 0.42, gain: 0.17, attack: 0.003 });
    k.tone({ type: 'sine', freq: k.note(93), dur: 0.2, gain: 0.045, attack: 0.002 });
    k.tone({ type: 'triangle', freq: k.note(88), start: 0.08, dur: 0.6, gain: 0.155, attack: 0.003 });
    k.tone({ type: 'sine', freq: k.note(88), start: 0.08, dur: 0.6, gain: 0.065, attack: 0.003, detune: 16 });
    k.tone({ type: 'sine', freq: k.note(100), start: 0.08, dur: 0.25, gain: 0.035, attack: 0.002 });
    return 0.7;
  },
  // The sweep's tiles: a small hand bell instead of the big one.
  clangLate: (k) => {
    swish(k, 0, 0.5);
    k.noise({ start: 0.11, dur: 0.03, gain: 0.14, freq: 5200, q: 0.7, type: 'highpass' });
    churchBell(k, 392, 0.11, 1.3, 0.11);
    k.tone({ type: 'triangle', freq: 131, to: 98, start: 0.11, dur: 0.18, gain: 0.06, attack: 0.003 });
    return 1.4;
  },
  // THE moment: thunder and the big bell on the flip, a D-major organ fanfare (the spooky turned
  // happy), a bell cascade, bats and a ghostly "woo-OOO" (Brian's applause comes in under it).
  special: (k) => {
    thump(k, 0, 0.24);
    storm(k, 0.006, 0.2);
    bell(k, 294, 0.8, 0.012);
    pipe(k, [50, 62, 66, 69], 0.004, 0.5, 0.07);
    bats(k, 0.12, 8, 0.07);
    [86, 90, 93, 98].forEach((n, i) => chime(k, k.note(n), 0.1 + i * 0.05, 0.35, 0.055));
    pipe(k, [62, 69], 0.52, 0.14, 0.1);
    pipe(k, [66, 74], 0.67, 0.14, 0.1);
    pipe(k, [69, 78], 0.82, 0.14, 0.1);
    pipe(k, [50, 57, 62, 66, 69, 74], 1.0, 2.1, 0.07);
    thump(k, 1.0, 0.24);
    crash(k, 1.012, 0.11);
    [98, 93, 90, 86, 81].forEach((n, i) => churchBell(k, k.note(n), 1.06 + i * 0.1, 1.1, 0.08));
    theremin(k, 523, 1046, 1.15, 1.4, 0.07, 0.35);
    return 3.2;
  },
  // A lower, rounder buzz, then a ghost wails away (quiet enough to run into the next press).
  miss: (k) => {
    thump(k, 0, 0.16);
    buzzer(k, 0, 0.46, 98, 0.18, true);
    k.noise({ dur: 0.4, gain: 0.08, freq: 480, q: 0.8, type: 'lowpass' });
    theremin(k, 760, 380, 0.3, 0.65, 0.045, 0.08);
    return 0.95;
  },
  // The cold open (~5.8 s): thunder, two tolls of the bell and a theremin rising over the organ
  // pedal, a creeping organ line (A B♭ A G♯ A · D F E C♯), then the landing on D minor (the theme's
  // key: the bed fades in under it) with thunder, a bell cascade and the bats.
  opening: (k) => {
    storm(k, 0, 0.2);
    bell(k, 294, 0.9, 0.4);
    bell(k, 294, 0.75, 1.3);
    pipe(k, [38, 45], 0.45, 1.7, 0.045, 1.1);
    theremin(k, 440, 660, 0.7, 1.3, 0.045, 0.55);
    bats(k, 1.55, 8, 0.06);
    const line: Array<[number, number, number]> = [
      [69, 0, 0.13],
      [70, 0.15, 0.13],
      [69, 0.3, 0.13],
      [68, 0.45, 0.13],
      [69, 0.6, 0.32],
      [74, 1.0, 0.13],
      [77, 1.15, 0.13],
      [76, 1.3, 0.13],
      [73, 1.45, 0.13],
    ];
    for (const [n, t, d] of line) pipe(k, [n], 1.9 + t, d, 0.08);
    pipe(k, [50], 1.9, 0.9, 0.05);
    pipe(k, [45], 2.9, 0.6, 0.05);
    const end = 3.55;
    storm(k, end, 0.15);
    thump(k, end, 0.24);
    pipe(k, [50, 57, 62, 65, 69], end + 0.004, 2.3, 0.046);
    crash(k, end, 0.09);
    [86, 81, 77, 74].forEach((n, i) => churchBell(k, k.note(n), end + 0.08 + i * 0.11, 1.2, 0.055));
    theremin(k, 587, 880, end + 0.3, 1.4, 0.035, 0.4);
    bats(k, end + 0.5, 7, 0.05);
    return 5.8;
  },
  // A round's category card: bat wings rush past, then the organ goes iv – V – i in D minor with a
  // bell on the landing and a theremin sigh.
  category: (k) => {
    bats(k, 0, 10, 0.08);
    k.noise({ dur: 0.5, gain: 0.18, freq: 450, to: 1600, q: 1.1, attack: 0.35 });
    pipe(k, [55, 67, 70, 74], 0.5, 0.2, 0.05);
    pipe(k, [57, 69, 73, 76], 0.72, 0.2, 0.05);
    thump(k, 0.95, 0.22);
    pipe(k, [50, 62, 65, 69, 74], 0.954, 1.4, 0.042);
    churchBell(k, k.note(74), 0.97, 1.4, 0.08);
    theremin(k, 587, 440, 1.2, 1.2, 0.045, 0.3);
    return 2.6;
  },
  // "Here come the answers": a quick organ run up D minor into a bell and an A7 chord.
  sweepStart: (k) => {
    [62, 64, 65, 67, 69, 70, 73, 74].forEach((n, i) => pipe(k, [n], i * 0.045, 0.08, 0.065, 0.006));
    bats(k, 0.1, 6, 0.07);
    thump(k, 0.42, 0.2);
    pipe(k, [45, 57, 61, 67], 0.424, 0.6, 0.05);
    churchBell(k, k.note(81), 0.43, 0.9, 0.08);
    return 1.05;
  },
  // The beat before the special tile: a snare roll over a quickening heartbeat and a theremin rising.
  rollIn: (k, rand) => {
    roll(k, rand, 0, 2.9, 0.045, 0.38);
    for (const t of [0, 0.62, 1.16, 1.62, 2.02, 2.36, 2.64]) heartbeat(k, t, 0.22);
    theremin(k, 330, 880, 0.2, 2.7, 0.075, 2.2);
    return 2.95;
  },
  // Midnight: a tick and a tock, then the clock tower strikes twice.
  timeup: (k) => {
    for (const [t, f] of [
      [0, 1800],
      [0.3, 1250],
    ] as const) {
      k.tone({ type: 'sine', freq: f, start: t, dur: 0.06, gain: 0.07, attack: 0.001 });
      k.noise({ start: t, dur: 0.025, gain: 0.08, freq: f * 1.6, q: 3 });
    }
    bell(k, 196, 0.85, 0.62);
    bell(k, 196, 0.7, 1.55);
    k.noise({ start: 0.7, dur: 0.95, gain: 0.03, freq: 1100, q: 3, attack: 0.3 });
    return 2.9;
  },
  // The board's last tile: an organ "ta-DAAA" in D major, a bell cascade up and the bats (Brian's applause follows).
  complete: (k) => {
    pipe(k, [57, 69, 73, 76], 0, 0.11, 0.06);
    thump(k, 0.13, 0.24);
    pipe(k, [50, 62, 66, 69, 74], 0.134, 1.6, 0.06);
    crash(k, 0.142, 0.11);
    [74, 78, 81, 86, 90].forEach((n, i) => churchBell(k, k.note(n), 0.16 + i * 0.07, 0.9, 0.065));
    bats(k, 0.5, 7, 0.05);
    return 1.8;
  },
  // A holding card drifts up: a gust of wind and a faint flutter.
  cardIn: (k) => {
    k.noise({ dur: 0.6, gain: 0.4, freq: 450, to: 1300, q: 1.3, attack: 0.3 });
    k.noise({ start: 0.05, dur: 0.55, gain: 0.24, freq: 800, to: 1900, q: 1.2, attack: 0.28 });
    bats(k, 0.32, 5, 0.05);
    return 0.75;
  },

  // ---- The clock and the picker (AUD-01): the Haunted Organ ----
  // 1:00 left (~2.2 s): one low tower-bell toll on D3 (the cracked bell, with a twin a few cents
  // sharp so it beats slowly like an old tower bell) over an open-fifth organ pedal. The plate's
  // partials keep it audible on a laptop speaker; no minor third against the round's music.
  oneMin: (k) => {
    bell(k, 147, 0.7);
    k.tone({ type: 'sine', freq: 147 * 1.004, dur: 2.1, gain: 0.05, attack: 0.006 });
    pipe(k, [50, 57], 0.06, 1.4, 0.016, 0.3);
    return 2.2;
  },
  // The last ten seconds: a clock's "tock" with a little echo off the crypt walls.
  tick: (k) => {
    k.tone({ type: 'triangle', freq: 620, dur: 0.09, gain: 0.28, attack: 0.001 });
    k.tone({ type: 'sine', freq: 1240, dur: 0.04, gain: 0.07, attack: 0.001 });
    k.noise({ dur: 0.04, gain: 0.17, freq: 1500, q: 3 });
    k.tone({ type: 'triangle', freq: 620, start: 0.18, dur: 0.07, gain: 0.09, attack: 0.001 });
    k.noise({ start: 0.18, dur: 0.03, gain: 0.06, freq: 1500, q: 3 });
    return 0.3;
  },
  // The picker's sweep (~3 s, over before the landing): a theremin wobbling up D4 → A4 in four
  // overlapping swells (their beating is the wobble) over a clock ticking and tocking slower and slower.
  spin: (k) => {
    const swells: Array<[number, number, number, number]> = [
      [0, 294, 330, 0.08],
      [0.75, 330, 370, 0.09],
      [1.5, 370, 415, 0.1],
      [2.2, 415, 440, 0.11],
    ];
    for (const [at, from, to, gain] of swells) theremin(k, from, to, at, at === 2.2 ? 0.85 : 1, gain, 0.25);
    slowing(2.9, 0.07, 1.09).forEach((t, i) => {
      const f = i % 2 ? 1250 : 1800;
      k.tone({ type: 'sine', freq: f, start: t, dur: 0.04, gain: 0.09, attack: 0.001 });
      k.noise({ start: t, dur: 0.02, gain: 0.07, freq: f * 1.6, q: 3 });
    });
    return 3.05;
  },
  // The landing: a bright bell on D5 (a major-third bell) and a D-major organ chord, bats scattering.
  land: (k) => {
    thump(k, 0, 0.2);
    churchBell(k, k.note(74), 0.004, 1.4, 0.11, 1.26);
    pipe(k, [50, 62, 66, 69], 0.01, 1.1, 0.05);
    bats(k, 0.12, 6, 0.05);
    return 1.8;
  },
};

export const SHOWDOWN_VOICES: Record<ShowdownLook, Record<ShowdownSound, Voice>> = {
  showtime: SHOWTIME,
  halloween: { ...SHOWTIME, ...HALLOWEEN },
};

export const CUE_SOUND: Record<ShowdownCue, ShowdownSound> = {
  intro: 'intro',
  drumroll: 'drumroll',
  applause: 'applause',
  aww: 'aww',
  ding: 'ding',
  suspense: 'suspense',
  celebrate: 'special',
  pickAnswer: 'pickAnswer',
};

/** Brian's applause comes in this long after the celebration starts (where the built-in crowd used to). */
export const SPECIAL_CROWD_MS = 250;

/** The sounds of a presenter's cue: Celebrate! is the special answer's celebration, applause and all. */
export function cueSounds(cue: ShowdownCue): Array<[ShowdownSound, number]> {
  const sound = CUE_SOUND[cue];
  return sound === 'special'
    ? [
        [sound, 0],
        ['applause', SPECIAL_CROWD_MS],
      ]
    : [[sound, 0]];
}

// ---------------------------------------------------------------------------
// Which sounds each board event plays
// ---------------------------------------------------------------------------

/**
 * When the stage's 3D flip lands, in ms after the reveal event: the tile's 0.75 s overshooting
 * transition passes 180° at ~0.28 s, plus a frame or two to render. Showcase clangs hit here.
 */
export const FLIP_LAND_MS = 320;
/** clang / clangLate strike their plate this far into the voice (the swish leads in). */
const STRIKE_MS = 110;
/** A special answer that also completes the board: the flourish waits for the fanfare to ring. */
const SPECIAL_RING_MS = 2500;

/** The sounds of one board event: [sound, delay in ms]. */
export function eventSounds(e: ShowdownEvent, mode: ShowdownMode = 'classic'): Array<[ShowdownSound, number]> {
  const showcase = mode === 'showcase';
  switch (e.type) {
    case 'intro':
      return [[showcase ? 'opening' : 'intro', 0]];
    case 'round':
      return [[showcase ? 'category' : 'round', 0]];
    case 'question':
      return [['question', 0]];
    case 'control':
      return [['control', 0]];
    case 'reveal': {
      if (showcase) {
        // The crescendo: a found answer goes ding … CLANG (as the tile lands); the special one goes
        // ding … into the celebration; the sweep's tiles (and other late ones) only clang, lighter;
        // the board's last tile adds the flourish and the applause.
        const list: Array<[ShowdownSound, number]> = e.late ? [] : [['correct', 0]];
        if (e.special) list.push(['special', FLIP_LAND_MS], ['applause', FLIP_LAND_MS + SPECIAL_CROWD_MS]);
        else list.push([e.late ? 'clangLate' : 'clang', FLIP_LAND_MS - STRIKE_MS]);
        if (e.cleared) {
          // A special answer that completes the board: its applause is still going, so only the flourish.
          if (e.special) list.push(['complete', FLIP_LAND_MS + SPECIAL_RING_MS]);
          else list.push(['complete', FLIP_LAND_MS + 380], ['applause', FLIP_LAND_MS + 630]);
        }
        return list;
      }
      return e.cleared
        ? [
            [e.top ? 'clangTop' : 'clang', 0],
            ['applause', 600],
          ]
        : [[e.top ? 'clangTop' : 'clang', 0]];
    }
    case 'miss':
      return [['miss', 0]];
    case 'sweep':
      return e.on ? [['sweepStart', 0]] : [];
    case 'suspense':
      // The server flips the special tile 2.6 s later: the roll runs into its celebration.
      return [[showcase ? 'rollIn' : 'drumroll', 0]];
    case 'timeup':
      return [['timeup', 0]];
    case 'restart':
    case 'reset':
      return [['undo', 0]];
    case 'strike':
      if (e.stealFailed) return [['stealMiss', 0]];
      return e.steal
        ? [
            ['strike', 0],
            ['stealOpen', 950],
          ]
        : [['strike', 0]];
    case 'award':
      if (e.how === 'none') return [['aww', 0]];
      return e.how === 'steal'
        ? [
            ['award', 300],
            ['applause', 700],
          ]
        : [['award', 300]];
    case 'undo':
      return [['undo', 0]];
    case 'adjust':
      return [];
    case 'clockWarn':
      return [['oneMin', 0]];
    case 'tick':
      return [['tick', 0]];
    case 'pick':
      // As scheduled the moment the draw is made (the live show times the landing against the
      // server clock: pickSounds(e.landAt, serverNow()) in useShowSync).
      return pickSounds(e.landAt, e.landAt - SHOWDOWN_PICK_LAND_MS);
    case 'finale':
      // The paced finale: a drumroll into 3rd and 2nd, the big finish for 1st, applause for the medals.
      return e.kind === 'first' ? [['finale', 0]] : e.kind === 'medals' ? [['applause', 0]] : e.kind === 'wrap' ? [] : [['drumroll', 0]];
    case 'pickEnd':
    case 'station':
      return [];
  }
}

/** With less than this left before the landing, the sweep's spin is left out (it would ring over the land). */
export const SPIN_MIN_MS = 1500;

/**
 * A pick's sounds, heard at `now` (server epoch ms): the spin at once, the land as the stage lands
 * on the name at `landAt`. Late (a slow link, a tab waking up) means a shorter wait for the land; too
 * late for the sweep means the land alone (at once, if the landing has passed).
 */
export function pickSounds(landAt: number, now: number): Array<[ShowdownSound, number]> {
  const left = landAt - now;
  const land = Number.isFinite(left) ? Math.min(2 * SHOWDOWN_PICK_LAND_MS, Math.max(0, Math.round(left))) : 0;
  return land >= SPIN_MIN_MS
    ? [
        ['spin', 0],
        ['land', land],
      ]
    : [['land', land]];
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

const KIT: SfxKit = { tone: (o) => synth.tone(o), noise: (o) => synth.noise(o), note: (n) => synth.note(n) };
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let holdSeq = 0;

function fileFor(sound: ShowdownSound, look: ShowdownLook): string | undefined {
  return SHOWDOWN_SOUND_FILES[`${look}:${sound}`] ?? SHOWDOWN_SOUND_FILES[sound];
}

function decode(url: string, ctx: AudioContext): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

/** Holds the jukebox dip for a long sound, and tucks the theme music under every show sound. */
function hold(seconds: number): void {
  duckThemeMusic(seconds);
  if (seconds < 1.2) return;
  const key = `showdown:${++holdSeq}`;
  synth.hold(key, true);
  setTimeout(() => synth.hold(key, false), seconds * 1000);
}

/**
 * Decodes this look's recorded sounds ahead of time (once the AudioContext exists), so the first press
 * of a recorded cue isn't late. Safe to call often: decode() caches per file.
 */
export function preloadShowSounds(look: ShowdownLook): void {
  const ctx = synth.context;
  if (!ctx) return;
  const urls = new Set<string>();
  for (const [key, url] of Object.entries(SHOWDOWN_SOUND_FILES)) {
    if (!url) continue;
    const [scope] = key.split(':');
    if (!key.includes(':') || scope === look) urls.add(url);
  }
  for (const url of urls) void decode(url, ctx);
}

/** Plays a show sound now (a recorded override if one is mapped, else the procedural voice). */
export function playShowSound(sound: ShowdownSound, look: ShowdownLook): void {
  const ctx = synth.context;
  if (!ctx) return; // not unlocked yet (no gesture) or suspended by the OS
  const url = fileFor(sound, look);
  if (url) {
    void decode(url, ctx).then((buffer) => {
      const bus = synth.sfxBus;
      if (!buffer || !bus || synth.context !== ctx) return playVoice(sound, look);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(bus);
      src.start();
      hold(buffer.duration);
    });
    return;
  }
  playVoice(sound, look);
}

function playVoice(sound: ShowdownSound, look: ShowdownLook): void {
  try {
    hold(SHOWDOWN_VOICES[look][sound](KIT, Math.random));
  } catch {
    /* never let audio break the show */
  }
}
