/**
 * The show's theme music (Presenter Showcase): a looping game-show bed under the opening, the
 * title cards and the holding cards, in each look. One device-wide player; ShowdownView turns it on
 * and off from the show's state. Procedural on the shared synth — never another AudioContext or an
 * <audio> element: every note goes through ONE gain node on the SFX bus, so mute and volume always
 * win, the fades and the dip under show sounds are a single smooth ramp, and a held jukebox dip
 * (synth.hold) keeps the jukebox under it while it plays.
 *
 * Two original 16-bar beds, written to sit UNDER a presenter talking on a Teams call: low level,
 * sparse, nothing busy up high (no hi-hats, no shakers), the tunes in the mid register.
 *  - Halloween Night, "Haunted Swing": D minor, swung, a pizzicato walking bass, organ chops on 2 and
 *    4 with brushes, a celesta tune answered by a theremin, and an owl at the end of the first half.
 *  - DAS Showtime, "Bright Lights": C major, a bouncing bass, off-beat piano stabs, kick and claps,
 *    a glockenspiel hook and a little horn pickup into each half.
 *
 * Scheduling is a lookahead scheduler like `music` in audio.ts: a 50 ms interval schedules the notes
 * due inside the next 0.25 s (1.3 s while the tab is hidden, when browsers run timers about once a
 * second) with `start` offsets on the audio clock. Nothing is scheduled while audio is locked or the
 * OS has the context suspended; the next tick after it runs again picks the beat back up from "now".
 * A timer that stalls skips the notes it missed instead of playing a backlog. A look switch waits for
 * the next bar line. stop() fades the bus out (notes already scheduled ahead fade with it).
 */
import type { ShowdownLook } from '@dascade/shared/games/showdown';
import { synth } from '../../audio/audio.ts';
import type { NoiseSpec, ToneSpec } from '../../audio/voices.ts';

export interface ThemeMusicPlayer {
  /** Plays (or keeps playing) the bed for `look`; a new look takes over at the next bar line. */
  play(look: ShowdownLook): void;
  /** Fades out and stops. Safe to call when already stopped. */
  stop(): void;
  readonly playing: boolean;
}

// ---------------------------------------------------------------------------
// The beds (pure: an 8th-note step in, the notes that start on it out)
// ---------------------------------------------------------------------------

/** One note of a bed: a tone or a noise burst, as the synth kit plays them. */
export type BedNote = { tone: ToneSpec; noise?: undefined } | { noise: NoiseSpec; tone?: undefined };

export interface ThemeBed {
  /** Quarter notes per minute. */
  bpm: number;
  /** Where the off-beat 8th falls inside its beat (0.5 = straight, ~0.64 = swung). */
  swing: number;
  /** Bars in one loop (4/4, eight 8th-note steps a bar). */
  bars: number;
  /** The notes starting on `step` (0 … bars × 8 − 1); `start` is relative to the step's grid time. */
  notes(step: number): BedNote[];
}

export const STEPS_PER_BAR = 8;

/** Seconds per 8th-note step. */
export function stepSeconds(bed: ThemeBed): number {
  return 60 / bed.bpm / 2;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** A melody note: [step in bar, MIDI note, length in steps]. */
type Tune = Array<[number, number, number]>;

/** Gathers one step's notes. */
function collector() {
  const out: BedNote[] = [];
  return {
    out,
    tone: (o: ToneSpec) => out.push({ tone: o }),
    noise: (o: NoiseSpec) => out.push({ noise: o }),
  };
}

// ---- Halloween Night: "Haunted Swing" (D minor, swung) ----

const HAUNT_CHORDS: Record<string, number[]> = {
  Dm: [62, 65, 69],
  Gm: [62, 67, 70],
  Bb7: [62, 65, 68],
  A7: [61, 64, 67],
};
const HAUNT_FORM = ['Dm', 'Dm', 'Gm', 'Dm', 'Bb7', 'A7', 'Dm', 'A7', 'Dm', 'Dm', 'Gm', 'Gm', 'Bb7', 'A7', 'Dm', 'A7'];
/** A walking bass, one note a beat (each bar's last note leads into the next chord). */
const HAUNT_BASS = [
  [38, 41, 45, 48],
  [50, 48, 45, 42],
  [43, 46, 50, 49],
  [50, 45, 41, 45],
  [46, 50, 53, 44],
  [45, 49, 52, 49],
  [50, 45, 41, 44],
  [45, 47, 49, 37],
  [38, 41, 45, 48],
  [50, 48, 45, 42],
  [43, 46, 50, 46],
  [43, 50, 46, 45],
  [46, 50, 53, 44],
  [45, 49, 52, 49],
  [50, 45, 41, 44],
  [45, 47, 49, 37],
];
const HAUNT_A: Tune[] = [
  [
    [0, 74, 1],
    [1, 77, 1],
    [2, 81, 2],
    [5, 80, 1],
    [6, 81, 2],
  ],
  [
    [0, 82, 2],
    [3, 81, 1],
    [4, 77, 2],
    [6, 74, 2],
  ],
  [
    [0, 79, 1],
    [1, 82, 1],
    [2, 86, 2],
    [5, 85, 1],
    [6, 86, 2],
  ],
  [
    [0, 81, 2],
    [2, 77, 1],
    [3, 76, 1],
    [4, 74, 3],
  ],
];
const HAUNT_TUNE: Array<Tune | null> = [
  ...HAUNT_A,
  null,
  null,
  null,
  null,
  HAUNT_A[0]!,
  HAUNT_A[1]!,
  HAUNT_A[2]!,
  [
    [0, 82, 2],
    [3, 79, 1],
    [4, 74, 2],
    [6, 70, 2],
  ],
  null,
  null,
  null,
  null,
];
/** The theremin's answer in bars 5–8 and 13–16: [from, to] glides, one a bar. */
const HAUNT_THEREMIN: Array<[number, number] | null> = [
  null,
  null,
  null,
  null,
  [77, 80],
  [79, 76],
  [74, 77],
  [76, 73],
  null,
  null,
  null,
  null,
  [74, 77],
  [73, 76],
  [77, 74],
  [76, 69],
];

function hauntedSwing(): ThemeBed {
  const bed: ThemeBed = { bpm: 126, swing: 0.64, bars: 16, notes: () => [] };
  const sec = stepSeconds(bed);
  const late = (bed.swing - 0.5) * 2 * sec;
  bed.notes = (step) => {
    const { out, tone, noise } = collector();
    const bar = Math.floor(step / STEPS_PER_BAR) % bed.bars;
    const s = step % STEPS_PER_BAR;
    const at = s % 2 ? late : 0;
    const chord = HAUNT_CHORDS[HAUNT_FORM[bar]!]!;
    if (s % 2 === 0) {
      // Pizzicato walking bass (a sine octave up so laptop speakers hear the line).
      const f = hz(HAUNT_BASS[bar]![s / 2]!);
      tone({ type: 'triangle', freq: f, start: at, dur: 0.32, gain: 0.068, attack: 0.004 });
      tone({ type: 'sine', freq: f * 2, start: at, dur: 0.18, gain: 0.03, attack: 0.004 });
    }
    if (s === 0) {
      tone({ type: 'sine', freq: 105, to: 55, start: at, dur: 0.2, gain: 0.05, attack: 0.003 });
      tone({ type: 'triangle', freq: 180, to: 100, start: at, dur: 0.05, gain: 0.018, attack: 0.002 });
    }
    if (s === 2 || s === 6) {
      // Organ chops and brushes on 2 and 4.
      for (const n of chord) {
        tone({ type: 'triangle', freq: hz(n), start: at, dur: 0.17, gain: 0.014, attack: 0.01 });
        tone({ type: 'sine', freq: hz(n) * 2, start: at, dur: 0.14, gain: 0.006, attack: 0.01 });
      }
      noise({ start: at, dur: 0.1, gain: 0.02, freq: 1900, q: 0.7 });
    }
    if (s === 7 && bar % 2 === 1) {
      for (const n of chord) tone({ type: 'triangle', freq: hz(n), start: at, dur: 0.1, gain: 0.008, attack: 0.008 });
    }
    // The celesta tune.
    for (const [at8, n, len] of HAUNT_TUNE[bar] ?? []) {
      if (at8 !== s) continue;
      tone({ type: 'sine', freq: hz(n), start: at, dur: len * sec + 0.25, gain: 0.034, attack: 0.004 });
      tone({ type: 'sine', freq: hz(n) * 2, start: at, dur: 0.2, gain: 0.008, attack: 0.003 });
    }
    // The theremin answers.
    const glide = HAUNT_THEREMIN[bar];
    if (glide && s === 0) {
      const [from, to] = glide;
      const dur = STEPS_PER_BAR * sec * 0.95;
      const wobble = 1200 * Math.log2(1 + 5.5 / hz(from));
      tone({ type: 'sine', freq: hz(from), to: hz(to), start: 0, dur, gain: 0.022, attack: 0.4 });
      tone({ type: 'sine', freq: hz(from), to: hz(to), start: 0, dur, gain: 0.015, attack: 0.4, detune: wobble });
    }
    // An owl at the end of the first half: hoo … hoo.
    if (bar === 7 && s === 4) {
      tone({ type: 'sine', freq: 392, to: 370, start: 0, dur: 0.22, gain: 0.02, attack: 0.04 });
      tone({ type: 'sine', freq: 392, to: 349, start: 0.3, dur: 0.32, gain: 0.018, attack: 0.05 });
    }
    return out;
  };
  return bed;
}

// ---- DAS Showtime: "Bright Lights" (C major, straight 8ths) ----

const SHOW_CHORDS: Record<string, { root: number; notes: number[] }> = {
  C: { root: 36, notes: [60, 64, 67] },
  Am: { root: 45, notes: [60, 64, 69] },
  F: { root: 41, notes: [60, 65, 69] },
  G: { root: 43, notes: [59, 62, 67] },
  Dm7: { root: 38, notes: [60, 65, 69] },
  G7: { root: 43, notes: [59, 62, 65] },
  Em7: { root: 40, notes: [59, 62, 67] },
};
const SHOW_FORM = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'G7', 'F', 'G', 'Em7', 'Am', 'Dm7', 'G7', 'C', 'G7'];
const SHOW_HOOK: Tune[] = [
  [
    [0, 76, 1],
    [1, 79, 1],
    [3, 84, 2],
    [6, 83, 1],
    [7, 84, 1],
  ],
  [
    [0, 81, 3],
    [4, 79, 1],
    [5, 76, 1],
    [6, 72, 2],
  ],
];
const SHOW_TUNE: Tune[] = [
  SHOW_HOOK[0]!,
  SHOW_HOOK[1]!,
  [
    [0, 77, 1],
    [1, 81, 1],
    [3, 84, 2],
    [6, 86, 1],
    [7, 84, 1],
  ],
  [
    [0, 83, 2],
    [2, 79, 2],
    [4, 74, 4],
  ],
  SHOW_HOOK[0]!,
  SHOW_HOOK[1]!,
  [
    [0, 77, 1],
    [1, 81, 1],
    [3, 84, 2],
    [5, 83, 1],
    [6, 81, 2],
  ],
  [
    [0, 79, 2],
    [2, 77, 1],
    [3, 74, 1],
    [4, 71, 2],
    [6, 74, 2],
  ],
  [
    [0, 81, 4],
    [4, 84, 4],
  ],
  [
    [0, 83, 4],
    [4, 79, 4],
  ],
  [
    [0, 79, 4],
    [4, 83, 4],
  ],
  [
    [0, 84, 4],
    [4, 81, 4],
  ],
  [
    [0, 81, 2],
    [2, 77, 2],
    [4, 74, 2],
    [6, 77, 2],
  ],
  [
    [0, 79, 2],
    [2, 83, 2],
    [4, 86, 4],
  ],
  [
    [0, 88, 2],
    [2, 84, 2],
    [4, 79, 2],
    [6, 76, 2],
  ],
  [
    [0, 74, 2],
    [2, 77, 1],
    [3, 79, 1],
    [4, 83, 4],
  ],
];
/** The bass bounce: [step in bar, semitones above the root]. */
const SHOW_BASS: Array<[number, number]> = [
  [0, 0],
  [3, 7],
  [4, 12],
  [6, 7],
];

function brightLights(): ThemeBed {
  const bed: ThemeBed = { bpm: 116, swing: 0.5, bars: 16, notes: () => [] };
  const sec = stepSeconds(bed);
  bed.notes = (step) => {
    const { out, tone, noise } = collector();
    const bar = Math.floor(step / STEPS_PER_BAR) % bed.bars;
    const s = step % STEPS_PER_BAR;
    const chord = SHOW_CHORDS[SHOW_FORM[bar]!]!;
    for (const [at8, up] of SHOW_BASS) {
      if (at8 !== s) continue;
      const f = hz(chord.root + up);
      tone({ type: 'triangle', freq: f, dur: 0.22, gain: 0.075, attack: 0.004 });
      tone({ type: 'sine', freq: f * 2, dur: 0.14, gain: 0.028, attack: 0.004 });
    }
    if (s === 0 || s === 4) {
      tone({ type: 'sine', freq: 120, to: 52, dur: 0.16, gain: 0.06, attack: 0.003 });
      tone({ type: 'triangle', freq: 200, to: 110, dur: 0.05, gain: 0.02, attack: 0.002 });
    }
    if (s === 2 || s === 6) {
      noise({ dur: 0.09, gain: 0.024, freq: 1400, q: 0.8 });
      noise({ dur: 0.04, gain: 0.01, freq: 2600, q: 1.4 });
    }
    if (s === 1 || s === 5) {
      // Off-beat piano stabs.
      for (const n of chord.notes) {
        tone({ type: 'triangle', freq: hz(n), dur: 0.14, gain: 0.013, attack: 0.004 });
        tone({ type: 'sine', freq: hz(n) * 2, dur: 0.1, gain: 0.006, attack: 0.003 });
      }
    }
    // The glockenspiel.
    for (const [at8, n, len] of SHOW_TUNE[bar] ?? []) {
      if (at8 !== s) continue;
      tone({ type: 'sine', freq: hz(n), dur: len * sec + 0.2, gain: 0.03, attack: 0.003 });
      tone({ type: 'sine', freq: hz(n) * 2.76, dur: 0.12, gain: 0.0035, attack: 0.002 });
    }
    // A little horn pickup ("bap-bap") into each half.
    if ((bar === 7 || bar === 15) && s >= 6) {
      for (const n of [67, 71, 74]) {
        tone({ type: 'triangle', freq: hz(n), dur: 0.1, gain: 0.012, attack: 0.012 });
        tone({ type: 'sawtooth', freq: hz(n), dur: 0.09, gain: 0.004, attack: 0.012 });
      }
    }
    return out;
  };
  return bed;
}

export const THEME_BEDS: Record<ShowdownLook, ThemeBed> = {
  halloween: hauntedSwing(),
  showtime: brightLights(),
};

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

/** The bed's level on the SFX bus (its notes are written ~0.15 at their loudest). */
export const THEME_LEVEL = 0.9;
/** Under a show sound, the bed dips to this share of its level. */
export const THEME_DUCK = 0.4;
const FADE_IN = 0.55;
const FADE_OUT = 0.4;
const TICK_MS = 50;
const AHEAD = 0.25;
const AHEAD_HIDDEN = 1.3;
const HOLD_KEY = 'showdown:theme';

/** The bits of an AudioContext the player uses. */
export interface BedContext {
  readonly currentTime: number;
  createGain(): GainNode;
}

export interface ThemeMusicDeps {
  /** The running context, or null while audio is locked or the OS has it suspended. */
  context(): BedContext | null;
  /** Where the bed's gain node connects (the SFX bus). */
  output(): AudioNode | null;
  tone(o: ToneSpec & { bus: GainNode }): void;
  noise(o: NoiseSpec & { bus: GainNode }): void;
  /** Holds (or releases) the jukebox dip. */
  hold(key: string, on: boolean): void;
  /** The tab is in the background (timers throttled). */
  hidden(): boolean;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  /** Wall clock in ms (for a dip asked for before the bed has a context). */
  now(): number;
  beds?: Record<ShowdownLook, ThemeBed>;
}

export interface ThemeMusicEngine extends ThemeMusicPlayer {
  /** Tucks the bed under a show sound for `seconds` (remembered if the bed isn't running yet). */
  duck(seconds: number): void;
}

export function createThemeMusic(deps: ThemeMusicDeps): ThemeMusicEngine {
  const beds = deps.beds ?? THEME_BEDS;
  let want: ShowdownLook | null = null;
  let cur: ShowdownLook | null = null;
  let timer: unknown = null;
  let bus: GainNode | null = null;
  let busCtx: BedContext | null = null;
  let synced = false;
  let next = 0;
  let step = 0;
  let duckUntil = 0;

  /** Heads the bus for its level: dipped while a show sound plays, back up after it. */
  function aim(ctx: BedContext, g: GainNode): void {
    const t = ctx.currentTime;
    const left = (duckUntil - deps.now()) / 1000;
    try {
      g.gain.cancelScheduledValues(t);
      if (left > 0) {
        g.gain.setTargetAtTime(THEME_LEVEL * THEME_DUCK, t, 0.06);
        g.gain.setTargetAtTime(THEME_LEVEL, t + left, FADE_IN);
      } else g.gain.setTargetAtTime(THEME_LEVEL, t, FADE_IN);
    } catch {
      /* context closed */
    }
  }

  function openBus(ctx: BedContext, out: AudioNode): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.connect(out);
    bus = g;
    busCtx = ctx;
    aim(ctx, g);
    return g;
  }

  function tick(): void {
    if (!want) return;
    const ctx = deps.context();
    const out = deps.output();
    if (!ctx || !out) {
      // Locked, or suspended by the OS: schedule nothing, and pick the beat up from "now" later.
      synced = false;
      return;
    }
    const g = bus && busCtx === ctx ? bus : openBus(ctx, out);
    const now = ctx.currentTime;
    if (!synced) {
      next = now + 0.06;
      synced = true;
    } else if (next < now) {
      // The timer stalled (a busy main thread, a throttled tab): skip what it missed, never a backlog.
      const sec = stepSeconds(beds[cur ?? want]);
      const missed = Math.ceil((now - next) / sec);
      step += missed;
      next += missed * sec;
    }
    const until = now + (deps.hidden() ? AHEAD_HIDDEN : AHEAD);
    for (let guard = 0; next < until && guard < 64; guard++) {
      // A new look (or the first bar) starts on a bar line.
      if (cur !== want && (cur === null || step % STEPS_PER_BAR === 0)) {
        cur = want;
        step = 0;
      }
      const bed = beds[cur!];
      const total = bed.bars * STEPS_PER_BAR;
      step %= total;
      const at = Math.max(0, next - now);
      for (const n of bed.notes(step)) {
        if (n.tone) deps.tone({ ...n.tone, start: at + (n.tone.start ?? 0), bus: g });
        else deps.noise({ ...n.noise, start: at + (n.noise.start ?? 0), bus: g });
      }
      step = (step + 1) % total;
      next += stepSeconds(bed);
    }
  }

  return {
    play(look) {
      want = look;
      if (timer === null) {
        timer = deps.setInterval(tick, TICK_MS);
        deps.hold(HOLD_KEY, true);
      }
      tick();
    },
    stop() {
      if (want === null && timer === null) return;
      want = null;
      cur = null;
      synced = false;
      step = 0;
      if (timer !== null) deps.clearInterval(timer);
      timer = null;
      deps.hold(HOLD_KEY, false);
      const g = bus;
      const ctx = busCtx;
      bus = null;
      busCtx = null;
      if (!g || !ctx) return;
      try {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, FADE_OUT);
      } catch {
        /* context closed */
      }
      // Notes already scheduled ahead play into the fading bus; let go of it once it's silent.
      deps.setTimeout(
        () => {
          try {
            g.disconnect();
          } catch {
            /* already disconnected */
          }
        },
        (FADE_OUT * 7 + AHEAD_HIDDEN) * 1000,
      );
    },
    get playing() {
      return want !== null;
    },
    duck(seconds) {
      if (!(seconds > 0)) return;
      duckUntil = Math.max(duckUntil, deps.now() + seconds * 1000);
      if (bus && busCtx) aim(busCtx, bus);
    },
  };
}

const engine = createThemeMusic({
  context: () => synth.context,
  output: () => synth.sfxBus,
  tone: (o) => synth.tone(o),
  noise: (o) => synth.noise(o),
  hold: (key, on) => synth.hold(key, on),
  hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
});

export const themeMusic: ThemeMusicPlayer = {
  play: (look) => engine.play(look),
  stop: () => engine.stop(),
  get playing() {
    return engine.playing;
  },
};

/** Tucks the theme music under a show sound for `seconds` (sounds.ts calls it for every sound). */
export function duckThemeMusic(seconds: number): void {
  engine.duck(seconds);
}
