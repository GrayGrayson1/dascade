/**
 * Halloween Night floor ambience, pure half: the sounds (recipes on a synth kit) and the scheduler
 * (injected timers/random, so it is tested with fake timers). ambience.ts wires it to the app.
 *
 * Rules: rare and quiet. The first event comes 15–30 s after arriving, then one every 40–90 s (up to
 * 30% more often at full haunt), never the same one twice in a row, and every gain stays below the
 * mixer's dip threshold (mixPolicy SFX_DUCK_MIN_GAIN = 0.04), so the jukebox is never ducked for it.
 * Noise layers stay ≤ 0.9 s: the shared noise buffer is 1 s long and doesn't loop.
 */
import type { SfxKit } from '../../audio/voices.ts';

export type AmbienceEventName = 'thunder' | 'owl' | 'wind' | 'ghost';
export type AmbienceEvent = (kit: SfxKit) => void;

/** Loudest single sound the ambience may play (below the mixer's 0.04 dip threshold). */
export const AMBIENCE_MAX_GAIN = 0.035;
/** Longest noise layer (the shared noise buffer is 1 s and doesn't loop). */
export const AMBIENCE_MAX_NOISE_S = 0.9;

export const AMBIENCE: Readonly<Record<AmbienceEventName, AmbienceEvent>> = {
  // Distant thunder: overlapping low rumbling layers that fade into the distance.
  thunder: ({ noise }) => {
    [0, 0.45, 0.9, 1.35, 1.8].forEach((start, i) =>
      noise({ start, dur: 0.9, attack: 0.3, gain: 0.032 - i * 0.004, freq: 220 - i * 25, q: 0.7, type: 'lowpass' }),
    );
  },
  // An owl: "hoo… hoooo".
  owl: ({ tone, note }) => {
    [0, 0.42].forEach((start, i) => {
      const dur = i ? 0.5 : 0.3;
      tone({ type: 'sine', freq: note(64), to: note(62), start, dur, gain: 0.03, attack: 0.06 });
      tone({ type: 'sine', freq: note(64), to: note(62), start, dur, gain: 0.012, attack: 0.06, detune: 9 });
    });
  },
  // A gust of wind through the rafters.
  wind: ({ noise }) => {
    noise({ dur: 0.9, attack: 0.35, gain: 0.03, freq: 380, to: 1200, q: 1.4 });
    noise({ start: 0.8, dur: 0.9, attack: 0.3, gain: 0.025, freq: 1200, to: 420, q: 1.4 });
  },
  // A friendly ghost somewhere in the hall: "ooOOoo".
  ghost: ({ tone, note }) => {
    tone({ type: 'sine', freq: note(69), to: note(74), dur: 0.7, gain: 0.03, attack: 0.35 });
    tone({ type: 'triangle', freq: note(69), to: note(74), dur: 0.7, gain: 0.01, attack: 0.35, detune: 12 });
    tone({ type: 'sine', freq: note(74), to: note(67), start: 0.65, dur: 0.8, gain: 0.025, attack: 0.2 });
  },
};

export const AMBIENCE_EVENTS = Object.keys(AMBIENCE) as readonly AmbienceEventName[];

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Delay before the first event after arriving on the floor (ms), 15–30 s. */
export function firstDelayMs(r: number): number {
  return Math.round((15 + 15 * clamp01(r)) * 1000);
}

/** Delay between events (ms): 40–90 s, up to 30% shorter at full haunt (`level` 0–1). */
export function nextDelayMs(level: number, r: number): number {
  return Math.round((40 + 50 * clamp01(r)) * (1 - 0.3 * clamp01(level)) * 1000);
}

export interface AmbienceDeps {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  /** 0 ≤ r < 1. */
  random(): number;
  /** May an event play right now (audio unlocked, tab visible, not muted, music quiet…)? */
  canPlay(): boolean;
  play(name: AmbienceEventName): void;
  /** Haunt intensity 0–1, read at every scheduling step. */
  level(): number;
}

/**
 * Starts the schedule; returns `stop`. An event that can't play right now is simply skipped (no
 * catching up later), and no event follows itself.
 */
export function startAmbience(deps: AmbienceDeps): () => void {
  let timer: unknown = null;
  let stopped = false;
  let last: AmbienceEventName | null = null;
  const pick = (): AmbienceEventName => {
    const pool = AMBIENCE_EVENTS.filter((n) => n !== last);
    return pool[Math.min(pool.length - 1, Math.floor(clamp01(deps.random()) * pool.length))]!;
  };
  const tick = () => {
    timer = null;
    if (stopped) return;
    if (deps.canPlay()) {
      last = pick();
      deps.play(last);
    }
    timer = deps.setTimeout(tick, nextDelayMs(deps.level(), deps.random()));
  };
  timer = deps.setTimeout(tick, firstDelayMs(deps.random()));
  return () => {
    stopped = true;
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };
}
