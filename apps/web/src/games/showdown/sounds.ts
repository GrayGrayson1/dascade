/**
 * DAS Survey Showdown sounds — the metallic CLANG of a flipping answer, the strike buzzer, steal
 * stings, applause, the intro fanfare and the presenter's cues, in two looks (DAS Showtime and
 * Halloween Night).
 *
 * Every voice is a pure function of the shared synth kit (tone / noise / note) plus a random source,
 * so it runs on the ONE audio pipeline (src/audio/audio.ts: the shared AudioContext, the SFX bus, the
 * jukebox dip, mute and volume) and is unit-testable with a fake kit. Voices return their length in
 * seconds; long ones hold the jukebox dip while they play (synth.hold).
 *
 * RECORDED SOUNDS (optional): drop a file into apps/web/public/audio/showdown/ and map it below in
 * SHOWDOWN_SOUND_FILES, e.g. `clang: '/audio/showdown/clang.mp3'` (or per look:
 * `'halloween:strike': '/audio/showdown/halloween-strike.mp3'`). Files are decoded into the shared
 * AudioContext and played on the SFX bus — never through an <audio> element — and any file that fails
 * to load falls back to the procedural voice. Use only sounds you have the rights to (public repo).
 */
import type { ShowdownCue, ShowdownLook } from '@dascade/shared/games/showdown';
import type { SfxKit } from '../../audio/voices.ts';
import { synth } from '../../audio/audio.ts';

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
  | 'finale';

/** Recorded overrides: `<sound>` for both looks, `<look>:<sound>` for one look. Empty = all procedural. */
export const SHOWDOWN_SOUND_FILES: Partial<Record<ShowdownSound | `${ShowdownLook}:${ShowdownSound}`, string>> = {};

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
const cymbal = (k: SfxKit, start: number, dur = 1.4, gain = 0.15) => k.noise({ start, dur, gain, freq: 6500, q: 0.4, type: 'highpass', attack: 0.01 });
const thunder = (k: SfxKit, start: number, dur = 1.8, gain = 0.22) => k.noise({ start, dur, gain, freq: 160, to: 55, q: 0.7, type: 'lowpass', attack: 0.06 });

/** Crowd applause: a bed of noise and a swarm of claps that swells, holds and fades. */
export function applause(k: SfxKit, rand: () => number, seconds = 3.4, claps = 110): number {
  k.noise({ dur: seconds, gain: 0.05, freq: 1600, q: 0.5, attack: 0.45 });
  k.noise({ dur: seconds * 0.9, gain: 0.028, freq: 650, q: 0.6, type: 'lowpass', attack: 0.3 });
  for (let i = 0; i < claps; i++) {
    const t = seconds * Math.pow(rand(), 0.8);
    const tail = t > seconds * 0.6 ? 1 - (t - seconds * 0.6) / (seconds * 0.4) : 1;
    k.noise({ start: t, dur: 0.018 + rand() * 0.03, gain: (0.055 + rand() * 0.08) * Math.max(0.15, tail), freq: 900 + rand() * 1900, q: 0.7 + rand() * 0.9 });
  }
  k.tone({ type: 'sine', freq: 1500, to: 2350, start: 0.35, dur: 0.45, gain: 0.032, attack: 0.05 });
  k.tone({ type: 'sine', freq: 1750, to: 1250, start: 0.95, dur: 0.5, gain: 0.028, attack: 0.04 });
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
      k.tone({ type: 'triangle', freq: k.note(n), to: last ? k.note(n) * 0.97 : undefined, start: i * 0.32, dur: last ? 0.9 : 0.3, gain: 0.09, attack: 0.02 });
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
};

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

/** Holds the jukebox dip for a long sound. */
function hold(seconds: number): void {
  if (seconds < 1.2) return;
  const key = `showdown:${++holdSeq}`;
  synth.hold(key, true);
  setTimeout(() => synth.hold(key, false), seconds * 1000);
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
