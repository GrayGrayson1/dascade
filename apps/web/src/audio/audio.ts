/**
 * DASCADE audio: 100% procedural WebAudio (no audio files).
 *  - The AudioContext is created lazily on the first user gesture (autoplay-safe).
 *  - Master → (SFX bus, Music bus) gain structure driven by app settings.
 *  - `sfx(name)` plays a short synthesized sound; `music.start(mood)` runs a subtle
 *    lookahead-scheduled synthwave loop.
 */
import { useApp, type AppSettings } from '../app/store.ts';

export type SfxName =
  | 'hover'
  | 'click'
  | 'select'
  | 'back'
  | 'coin'
  | 'join'
  | 'leave'
  | 'ready'
  | 'start'
  | 'countdown'
  | 'go'
  | 'win'
  | 'bigwin'
  | 'lose'
  | 'error'
  | 'tick'
  | 'chip'
  | 'card'
  | 'flip'
  | 'spin'
  | 'ding'
  | 'whoosh'
  | 'correct'
  | 'wrong'
  | 'pop'
  | 'dice'
  | 'boost'
  | 'crash'
  | 'bingo'
  | 'message';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unlocked = false;

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus.connect(master);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  applyVolumes(useApp.getState().settings);
  return ctx;
}

function applyVolumes(s: AppSettings): void {
  if (!ctx || !master || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.02);
  sfxBus.gain.setTargetAtTime(s.sfxVolume, t, 0.02);
  musicBus.gain.setTargetAtTime(s.musicEnabled ? s.musicVolume * 0.5 : 0, t, 0.2);
}

/** Call once at startup: unlocks audio on the first gesture and tracks settings. */
export function installAudio(): void {
  const unlock = () => {
    if (unlocked) return;
    const c = ensureContext();
    if (!c) return;
    void c.resume().then(() => {
      unlocked = true;
      if (useApp.getState().settings.musicEnabled) music.start();
    });
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  useApp.subscribe((state, prev) => {
    if (state.settings === prev.settings) return;
    applyVolumes(state.settings);
    if (state.settings.musicEnabled && !prev.settings.musicEnabled) music.start();
    if (!state.settings.musicEnabled && prev.settings.musicEnabled) music.stop();
  });
}

// ---------------------------------------------------------------------------
// Synth primitives
// ---------------------------------------------------------------------------
interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  bus?: GainNode | null;
  detune?: number;
}

function tone({ type = 'square', freq, to, start = 0, dur, gain = 0.2, attack = 0.005, bus = sfxBus, detune = 0 }: ToneOpts): void {
  if (!ctx || !bus) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(bus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ start = 0, dur, gain = 0.2, freq = 2000, q = 1, type = 'bandpass' as BiquadFilterType, to }: { start?: number; dur: number; gain?: number; freq?: number; q?: number; type?: BiquadFilterType; to?: number }): void {
  if (!ctx || !sfxBus || !noiseBuffer) return;
  const t0 = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (to) filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const SOUNDS: Record<SfxName, () => void> = {
  hover: () => tone({ type: 'sine', freq: 1400, dur: 0.04, gain: 0.03 }),
  click: () => tone({ type: 'square', freq: 660, to: 880, dur: 0.06, gain: 0.08 }),
  select: () => {
    tone({ type: 'square', freq: NOTE(76), dur: 0.07, gain: 0.08 });
    tone({ type: 'square', freq: NOTE(83), start: 0.06, dur: 0.1, gain: 0.08 });
  },
  back: () => tone({ type: 'square', freq: 520, to: 300, dur: 0.1, gain: 0.07 }),
  coin: () => {
    tone({ type: 'square', freq: NOTE(83), dur: 0.08, gain: 0.1 });
    tone({ type: 'square', freq: NOTE(88), start: 0.07, dur: 0.28, gain: 0.1 });
  },
  join: () => [72, 76, 79].forEach((n, i) => tone({ type: 'triangle', freq: NOTE(n), start: i * 0.06, dur: 0.14, gain: 0.12 })),
  leave: () => [79, 74, 67].forEach((n, i) => tone({ type: 'triangle', freq: NOTE(n), start: i * 0.06, dur: 0.14, gain: 0.1 })),
  ready: () => tone({ type: 'square', freq: NOTE(79), to: NOTE(86), dur: 0.12, gain: 0.08 }),
  start: () => [60, 64, 67, 72].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: i * 0.08, dur: 0.18, gain: 0.09 })),
  countdown: () => tone({ type: 'square', freq: NOTE(69), dur: 0.14, gain: 0.12 }),
  go: () => {
    tone({ type: 'square', freq: NOTE(81), dur: 0.4, gain: 0.13 });
    tone({ type: 'square', freq: NOTE(88), dur: 0.4, gain: 0.06, detune: 8 });
  },
  win: () =>
    [72, 76, 79, 84, 79, 84].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: i * 0.09, dur: 0.16, gain: 0.09 })),
  bigwin: () => {
    [72, 76, 79, 84, 88, 91, 96].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: i * 0.07, dur: 0.2, gain: 0.09 }));
    [60, 67, 72].forEach((n) => tone({ type: 'triangle', freq: NOTE(n), start: 0.5, dur: 0.9, gain: 0.1 }));
  },
  lose: () => [67, 63, 60, 55].forEach((n, i) => tone({ type: 'triangle', freq: NOTE(n), start: i * 0.14, dur: 0.22, gain: 0.1 })),
  error: () => {
    tone({ type: 'square', freq: 180, dur: 0.12, gain: 0.07 });
    tone({ type: 'square', freq: 140, start: 0.1, dur: 0.16, gain: 0.07 });
  },
  tick: () => tone({ type: 'square', freq: 2200, dur: 0.018, gain: 0.05 }),
  chip: () => {
    noise({ dur: 0.05, gain: 0.25, freq: 4200, q: 3 });
    tone({ type: 'sine', freq: 3100, dur: 0.05, gain: 0.04 });
  },
  card: () => noise({ dur: 0.08, gain: 0.25, freq: 3000, q: 0.7, to: 1200 }),
  flip: () => noise({ dur: 0.12, gain: 0.2, freq: 1800, q: 0.8, to: 5000 }),
  spin: () => noise({ dur: 0.5, gain: 0.12, freq: 600, q: 2, to: 2400 }),
  ding: () => {
    tone({ type: 'sine', freq: NOTE(88), dur: 0.6, gain: 0.12 });
    tone({ type: 'sine', freq: NOTE(95), dur: 0.5, gain: 0.05 });
  },
  whoosh: () => noise({ dur: 0.35, gain: 0.18, freq: 400, q: 0.6, to: 3000, type: 'lowpass' }),
  correct: () => [79, 84, 88].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: i * 0.07, dur: 0.14, gain: 0.09 })),
  wrong: () => tone({ type: 'sawtooth', freq: 220, to: 150, dur: 0.2, gain: 0.06 }),
  pop: () => tone({ type: 'sine', freq: 500, to: 1100, dur: 0.07, gain: 0.1 }),
  dice: () => {
    for (let i = 0; i < 5; i++) noise({ start: i * 0.06, dur: 0.04, gain: 0.25, freq: 2500 + i * 300, q: 4 });
  },
  boost: () => {
    noise({ dur: 0.5, gain: 0.18, freq: 300, to: 2400, type: 'lowpass' });
    tone({ type: 'sawtooth', freq: 110, to: 330, dur: 0.45, gain: 0.05 });
  },
  crash: () => noise({ dur: 0.3, gain: 0.35, freq: 900, q: 0.5, to: 200, type: 'lowpass' }),
  bingo: () => {
    [72, 76, 79, 84].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: i * 0.1, dur: 0.2, gain: 0.1 }));
    [84, 88, 91, 96].forEach((n, i) => tone({ type: 'square', freq: NOTE(n), start: 0.45 + i * 0.07, dur: 0.18, gain: 0.08 }));
  },
  message: () => tone({ type: 'sine', freq: NOTE(84), dur: 0.08, gain: 0.05 }),
};

const lastPlayed = new Map<SfxName, number>();

/** Play a UI/game sound effect. Safe to call anywhere; no-ops until audio is unlocked. */
export function sfx(name: SfxName, minGapMs = 30): void {
  if (!unlocked || !ctx) return;
  const s = useApp.getState().settings;
  if (s.muted || s.masterVolume <= 0 || s.sfxVolume <= 0) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < minGapMs) return;
  lastPlayed.set(name, now);
  try {
    SOUNDS[name]();
  } catch {
    /* never let audio break gameplay */
  }
}

/** Direct synth access for games that want custom procedural sounds. */
export const synth = {
  tone: (opts: ToneOpts) => {
    if (unlocked) tone(opts);
  },
  noise: (opts: Parameters<typeof noise>[0]) => {
    if (unlocked) noise(opts);
  },
  note: NOTE,
  get context(): AudioContext | null {
    return unlocked ? ctx : null;
  },
  get sfxBus(): GainNode | null {
    return sfxBus;
  },
};

// ---------------------------------------------------------------------------
// Music: subtle procedural synthwave loop with a lookahead scheduler.
// ---------------------------------------------------------------------------
type Mood = 'arcade' | 'chill' | 'casino' | 'race' | 'quest';
const MOODS: Record<Mood, { bpm: number; root: number; prog: number[][] }> = {
  arcade: { bpm: 100, root: 45, prog: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]] },
  chill: { bpm: 84, root: 50, prog: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]] },
  casino: { bpm: 92, root: 48, prog: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]] },
  race: { bpm: 128, root: 40, prog: [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [-4, 0, 3]] },
  quest: { bpm: 76, root: 43, prog: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -2, 2]] },
};

let musicTimer: ReturnType<typeof setInterval> | null = null;
let nextNoteTime = 0;
let step = 0;
let mood: Mood = 'arcade';

function scheduleStep(time: number): void {
  if (!ctx || !musicBus) return;
  const m = MOODS[mood];
  const bar = Math.floor(step / 16) % m.prog.length;
  const chord = m.prog[bar] ?? [0, 3, 7];
  const s16 = step % 16;
  const offset = time - ctx.currentTime;
  if (s16 % 4 === 0) tone({ type: 'triangle', freq: NOTE(m.root + (chord[0] ?? 0) - 12), start: offset, dur: 0.35, gain: 0.16, bus: musicBus });
  if (s16 % 2 === 0) {
    const n = chord[(step / 2) % chord.length] ?? 0;
    tone({ type: 'square', freq: NOTE(m.root + 24 + n), start: offset, dur: 0.12, gain: 0.035, bus: musicBus });
  }
  if (s16 === 0) chord.forEach((n) => tone({ type: 'sawtooth', freq: NOTE(m.root + 12 + n), start: offset, dur: 2.2, gain: 0.018, attack: 0.4, bus: musicBus, detune: 6 }));
  step++;
}

export const music = {
  start(next: Mood = mood): void {
    mood = next;
    if (!unlocked || !ctx || musicTimer) return;
    if (!useApp.getState().settings.musicEnabled) return;
    nextNoteTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(() => {
      if (!ctx) return;
      const secPer16 = 60 / MOODS[mood].bpm / 4;
      while (nextNoteTime < ctx.currentTime + 0.2) {
        scheduleStep(nextNoteTime);
        nextNoteTime += secPer16;
      }
    }, 50);
  },
  stop(): void {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  },
  setMood(next: Mood): void {
    if (next === mood) return;
    mood = next;
    step = 0;
  },
};
