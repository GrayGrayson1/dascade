/**
 * The ONE WebAudio mixer: a single AudioContext (created lazily on the first user gesture),
 * master → compressor → destination, with buses sfx / gameMusic / jukebox and one shared
 * AnalyserNode for the jukebox visualizer. Gains follow mixPolicy.ts with smooth ramps.
 *
 * Framework-free and injectable (createMixer) so it's unit-tested with a fake AudioContext.
 */
import {
  RAMP,
  SFX_DUCK_ATTACK,
  SFX_DUCK_HOLD,
  SFX_DUCK_LEVEL,
  SFX_DUCK_RELEASE,
  SFX_HOLD_RAMP,
  gameMusicLevel,
  jukeboxDuckBase,
  isJukeboxAudible,
  jukeboxLevel,
  masterLevel,
  sfxLevel,
  type JukeboxMixFlags,
  type MixSettings,
} from './mixPolicy.ts';

export interface MixerBuses {
  master: GainNode;
  sfx: GainNode;
  gameMusic: GainNode;
  jukebox: GainNode;
  /** SFX-priority dip, after the jukebox bus. */
  jukeboxDuck: GainNode;
  analyser: AnalyserNode;
}

export interface Mixer {
  /** Creates the context + graph once. Call from a user gesture. Null if WebAudio is unavailable. */
  ensureContext(): AudioContext | null;
  /** The context if it exists (never creates one). */
  context(): AudioContext | null;
  /** Resumes a suspended/interrupted context; resolves true when running. Call inside the gesture. */
  resume(): Promise<boolean>;
  isRunning(): boolean;
  buses(): MixerBuses | null;
  noiseBuffer(): AudioBuffer | null;
  /** The shared analyser (null until the context exists). */
  analyser(): AnalyserNode | null;
  /**
   * Routes the (single) jukebox element through analyser → jukebox bus. Idempotent per element;
   * returns false if routing isn't possible (no context, not running, or the browser refused).
   */
  routeElement(el: HTMLMediaElement): boolean;
  isRouted(el: HTMLMediaElement): boolean;
  setSettings(s: MixSettings): void;
  setJukeboxFlags(f: JukeboxMixFlags): void;
  jukeboxAudible(): boolean;
  /** True while the policy has the game music fully silenced (the scheduler may skip notes). */
  gameMusicSilenced(): boolean;
  /** SFX priority: briefly dip the jukebox (no-op when it isn't audible). */
  sfxPriority(): void;
  /**
   * Sustained SFX focus (policy 3b): while any key holds, the jukebox rests at SFX_HOLD_LEVEL
   * (only while it's audible). Idempotent per key; safe to call every frame.
   */
  sfxHold(key: string, on: boolean): void;
  /** Keys currently holding focus (diagnostics/tests). */
  sfxHolds(): number;
  /** Subscribe to "context created" (fires immediately if it already exists). */
  onContext(cb: (ctx: AudioContext) => void): () => void;
  /**
   * Subscribe to the context's state changes (suspended / interrupted by the OS, e.g. iOS
   * backgrounding or a call, and running again). Read the state with isRunning().
   */
  onStateChange(cb: () => void): () => void;
}

export interface MixerDeps {
  AudioContextCtor: () => (new (opts?: AudioContextOptions) => AudioContext) | undefined;
  random?: () => number;
}

export const DEFAULT_MIX_SETTINGS: MixSettings = {
  masterVolume: 0.8,
  sfxVolume: 0.7,
  musicVolume: 0.35,
  musicEnabled: false,
  muted: false,
  jukeboxVolume: 0.7,
  gameMusicWithJukebox: 'mute',
};

export function createMixer(deps: MixerDeps): Mixer {
  let ctx: AudioContext | null = null;
  let buses: MixerBuses | null = null;
  let noise: AudioBuffer | null = null;
  let settings: MixSettings = { ...DEFAULT_MIX_SETTINGS };
  let flags: JukeboxMixFlags = { playing: false, muted: false };
  let lastDuck = -1;
  const holds = new Set<string>();
  /** Last resting level applied to the jukeboxDuck stage. */
  let duckBase = 1;
  const routed = new WeakSet<HTMLMediaElement>();
  const refused = new WeakSet<HTMLMediaElement>();
  const contextListeners = new Set<(ctx: AudioContext) => void>();
  const stateListeners = new Set<() => void>();
  const random = deps.random ?? Math.random;

  function apply(immediate = false): void {
    if (!ctx || !buses) return;
    const t = ctx.currentTime;
    const set = (node: GainNode, value: number, tc: number) => {
      if (immediate) {
        node.gain.cancelScheduledValues(t);
        node.gain.setValueAtTime(value, t);
      } else node.gain.setTargetAtTime(value, t, tc);
    };
    set(buses.master, masterLevel(settings), RAMP.master);
    set(buses.sfx, sfxLevel(settings), RAMP.sfx);
    set(buses.gameMusic, gameMusicLevel(settings, flags), RAMP.gameMusic);
    set(buses.jukebox, jukeboxLevel(settings, flags), RAMP.jukebox);
    applyDuckBase();
  }

  /** Moves the SFX-priority stage's resting level only when it changes (never disturbs a dip in flight). */
  function applyDuckBase(): void {
    if (!ctx || !buses) return;
    const next = jukeboxDuckBase(settings, flags, holds.size > 0);
    if (next === duckBase) return;
    duckBase = next;
    // A dip from sfxPriority() queues its release to the OLD resting level at lastDuck + SFX_DUCK_HOLD.
    // Started any earlier, this change would be overridden by that stale release (the jukebox stuck
    // at the hold level, or the hold lost), so it starts no earlier than the release and wins.
    const at = Math.max(ctx.currentTime, lastDuck + SFX_DUCK_HOLD);
    buses.jukeboxDuck.gain.setTargetAtTime(next, at, SFX_HOLD_RAMP);
  }

  const mixer: Mixer = {
    ensureContext() {
      if (ctx) return ctx;
      const AC = deps.AudioContextCtor();
      if (!AC) return null;
      let created: AudioContext;
      try {
        created = new AC({ latencyHint: 'interactive' });
      } catch {
        return null;
      }
      ctx = created;
      if (typeof created.addEventListener === 'function') {
        created.addEventListener('statechange', () => {
          for (const cb of [...stateListeners]) cb();
        });
      }
      const master = created.createGain();
      const comp = created.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(created.destination);
      const sfx = created.createGain();
      const gameMusic = created.createGain();
      const jukebox = created.createGain();
      const jukeboxDuck = created.createGain();
      const analyser = created.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      sfx.connect(master);
      gameMusic.connect(master);
      // Visualizer taps the signal before the volume so its motion doesn't depend on the slider.
      analyser.connect(jukebox);
      jukebox.connect(jukeboxDuck).connect(master);
      buses = { master, sfx, gameMusic, jukebox, jukeboxDuck, analyser };
      noise = created.createBuffer(1, created.sampleRate, created.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
      apply(true);
      for (const cb of [...contextListeners]) cb(created);
      return created;
    },
    context: () => ctx,
    async resume() {
      if (!ctx) return false;
      if (ctx.state === 'running') return true;
      try {
        await ctx.resume();
      } catch {
        return false;
      }
      return (ctx.state as AudioContextState) === 'running';
    },
    isRunning: () => ctx?.state === 'running',
    buses: () => buses,
    noiseBuffer: () => noise,
    analyser: () => buses?.analyser ?? null,
    routeElement(el) {
      if (routed.has(el)) return true;
      if (refused.has(el) || !ctx || !buses || ctx.state !== 'running') return false;
      try {
        const src = ctx.createMediaElementSource(el);
        src.connect(buses.analyser);
        routed.add(el);
        return true;
      } catch {
        // Some browsers/devices refuse (or the element was already captured): never retry, fall
        // back to element.volume so music still plays (visualizer off).
        refused.add(el);
        return false;
      }
    },
    isRouted: (el) => routed.has(el),
    setSettings(s) {
      settings = { ...s };
      apply();
    },
    setJukeboxFlags(f) {
      if (f.playing === flags.playing && f.muted === flags.muted) return;
      flags = { ...f };
      apply();
    },
    jukeboxAudible: () => isJukeboxAudible(settings, flags),
    gameMusicSilenced: () => gameMusicLevel(settings, flags) === 0,
    sfxPriority() {
      if (!ctx || !buses || !isJukeboxAudible(settings, flags)) return;
      const t = ctx.currentTime;
      if (t - lastDuck < 0.04) return;
      lastDuck = t;
      const g = buses.jukeboxDuck.gain;
      // No cancelScheduledValues: cancelling an in-flight ramp can jump the value (a click).
      // Overlapping dips simply queue; the release starts from wherever the curve is.
      g.setTargetAtTime(duckBase * SFX_DUCK_LEVEL, t, SFX_DUCK_ATTACK);
      g.setTargetAtTime(duckBase, t + SFX_DUCK_HOLD, SFX_DUCK_RELEASE);
    },
    sfxHold(key, on) {
      if (on === holds.has(key)) return;
      if (on) holds.add(key);
      else holds.delete(key);
      applyDuckBase();
    },
    sfxHolds: () => holds.size,
    onContext(cb) {
      contextListeners.add(cb);
      if (ctx) cb(ctx);
      return () => contextListeners.delete(cb);
    },
    onStateChange(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
  };
  return mixer;
}

function browserAudioContext(): (new (opts?: AudioContextOptions) => AudioContext) | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** The app-wide mixer (one AudioContext per page, ever). */
export const mixer: Mixer = createMixer({ AudioContextCtor: browserAudioContext });
