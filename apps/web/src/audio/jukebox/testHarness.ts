/** Shared harness for the jukebox engine tests (not app code). */
import type { JukeboxManifest, JukeboxTrack } from '@dascade/shared/jukebox';
import { createMixer, DEFAULT_MIX_SETTINGS } from '../mixer.ts';
import { FakeAudioContext, FakeAudioElement, MemoryStorage, flushMicrotasks } from '../testFakes.ts';
import { createJukeboxEngine, type EngineSettings, type MediaSessionLike } from './core.ts';
import { JUKEBOX_STORAGE_KEY } from './persist.ts';
import { createJukeboxStore } from './store.ts';

export const track = (id: string, order: number, duration = 100): JukeboxTrack => ({
  id,
  src: `/audio/jukebox/${id}.mp3`,
  file: `${id}.mp3`,
  title: id.toUpperCase(),
  duration,
  order,
});

export const MANIFEST: JukeboxManifest = {
  version: 1,
  generatedAt: '2026-09-27T00:00:00Z',
  // Deliberately out of order: the engine sorts by `order`.
  tracks: [track('c', 3), track('a', 1), track('d', 4), track('b', 2)],
};

export class FakeMediaSession implements MediaSessionLike {
  metadata: MediaMetadata | null = null;
  playbackState: MediaSessionPlaybackState = 'none';
  handlers = new Map<string, MediaSessionActionHandler | null>();
  setCalls = 0;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    this.setCalls++;
    if (handler) this.handlers.set(action, handler);
    else this.handlers.delete(action);
  }
}

export interface HarnessOptions {
  manifest?: unknown;
  fetchManifest?: () => Promise<unknown>;
  stored?: string;
  storage?: MemoryStorage | null;
  gesture?: boolean;
  settings?: Partial<EngineSettings>;
  random?: () => number;
}

/** Deterministic PRNG (mulberry32). */
export function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function setup(opts: HarnessOptions = {}) {
  FakeAudioContext.instances = [];
  FakeAudioElement.instances = [];
  const store = createJukeboxStore();
  const storage = opts.storage === undefined ? new MemoryStorage() : opts.storage;
  if (opts.stored !== undefined && storage) storage.setItem(JUKEBOX_STORAGE_KEY, opts.stored);
  if (storage) storage.writes = 0;
  let settings: EngineSettings = { ...DEFAULT_MIX_SETTINGS, visualizer: 'on', reducedMotion: false, fx: 'high', ...opts.settings };
  const settingsSubs = new Set<() => void>();
  const mixer = createMixer({ AudioContextCtor: () => FakeAudioContext as unknown as typeof AudioContext, random: () => 0.5 });
  mixer.setSettings(settings);
  const clock = { now: 0 };
  const notes: string[] = [];
  const mediaSession = new FakeMediaSession();
  const setSettings = (patch: Partial<EngineSettings>) => {
    settings = { ...settings, ...patch };
    mixer.setSettings(settings);
    for (const cb of [...settingsSubs]) cb();
  };
  const engine = createJukeboxEngine({
    store,
    mixer,
    createElement: () => new FakeAudioElement() as unknown as HTMLAudioElement,
    fetchManifest: opts.fetchManifest ?? (() => Promise.resolve(opts.manifest === undefined ? MANIFEST : opts.manifest)),
    storage,
    settings: {
      get: () => settings,
      update: (patch) => setSettings(patch),
      subscribe: (cb) => {
        settingsSubs.add(cb);
        return () => settingsSubs.delete(cb);
      },
    },
    now: () => clock.now,
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    },
    random: opts.random ?? seeded(7),
    mediaSession,
    createMetadata: (init) => init as unknown as MediaMetadata,
    notify: (m) => notes.push(m),
  });
  engine.init();
  await flushMicrotasks();
  if (opts.gesture !== false) {
    engine.unlock();
    await flushMicrotasks();
  }
  const el = () => FakeAudioElement.instances[0]!;
  const state = () => store.getState();
  const ctx = () => FakeAudioContext.instances[0];
  return { engine, store, storage, mixer, clock, notes, mediaSession, el, state, ctx, setSettings, settings: () => settings, settingsSubs };
}
