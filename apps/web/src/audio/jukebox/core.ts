/**
 * Jukebox engine core — framework-free and fully injectable (createJukeboxEngine) so every path
 * is unit-tested with a fake <audio>, fake mixer, fake clock and fake storage (core.test.ts).
 * The app-wide singleton is wired in engine.ts.
 *
 * Invariants:
 *  - ONE HTMLAudioElement per engine, created once in init(); never recreated.
 *  - Playback never starts before a user gesture: intent is kept (`wantPlaying`) and the store
 *    raises `needsGesture` (a gentle prompt, not an error). A rejected play() does the same.
 *  - The element is routed through the shared mixer (analyser → jukebox bus) once the context
 *    runs; if the browser refuses, music still plays via element.volume (visualizer off).
 *  - Local mute / volume / pause / room opt-out always win over the Room DJ.
 *  - A pause the engine didn't cause (audio focus lost, headphones unplugged, an iOS interruption)
 *    counts as the user pausing: the transport stops claiming "playing" and no later tap restarts it.
 */
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  DJ,
  DJ_MAX_TRACK_SECONDS,
  JukeboxManifestSchema,
  type DjCommand,
  type DjConfig,
  type DjQueueEntry,
  type DjState,
  type JukeboxTrack,
} from '@dascade/shared/jukebox';
import { elementFallbackVolume, visualizerEnabled, type MixSettings, type VisualizerPref } from '../mixPolicy.ts';
import type { Mixer } from '../mixer.ts';
import { planDjSync } from './djSync.ts';
import { moveItem, nextInOrder, prevInOrder, reshuffleAvoiding, shuffleOrder } from './order.ts';
import { loadPersisted, savePersisted, type PersistedJukebox, type StorageLike } from './persist.ts';
import { showsPlaying, type JukeboxState, type RepeatMode } from './store.ts';

export interface EngineSettings extends MixSettings {
  visualizer: VisualizerPref;
  reducedMotion: boolean;
  fx: 'high' | 'low' | 'off';
}

export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState?(state?: MediaPositionState): void;
}

/** What the Room DJ bridge (roomDj.ts) provides once a room is joined. */
export interface DjTransport {
  send(type: string, payload: unknown): void;
  playerId(): string | null;
  /** Current room host (the server only sends dj:state once the DJ is enabled). */
  hostId(): string | null;
  /** The local player is a spectator (read-only for the DJ: no queueing, no skip votes). */
  isSpectator?(): boolean;
  /** Stable id of the current room (same across reconnects); scopes the listener's opt-out. */
  roomKey?(): string | null;
  serverNow(): number;
}

export type JukeboxMixer = Pick<Mixer, 'ensureContext' | 'resume' | 'isRunning' | 'routeElement' | 'isRouted' | 'analyser' | 'setJukeboxFlags' | 'onStateChange'>;

export interface JukeboxEngineDeps {
  store: UseBoundStore<StoreApi<JukeboxState>>;
  mixer: JukeboxMixer;
  createElement: () => HTMLAudioElement;
  /** Resolves the parsed manifest JSON; resolves null when there is none (404); rejects on failure. */
  fetchManifest: () => Promise<unknown>;
  storage: StorageLike | null;
  settings: {
    get(): EngineSettings;
    update(patch: { jukeboxVolume: number }): void;
    subscribe(cb: () => void): () => void;
  };
  now: () => number;
  timers: TimerApi;
  random: () => number;
  mediaSession?: MediaSessionLike | null;
  createMetadata?: ((init: MediaMetadataInit) => MediaMetadata) | null;
  /** Toast hook for track errors. */
  notify?: (message: string) => void;
}

export interface DjPermissions {
  /** Host: play/pause/seek/next/prev/clear/configure. */
  control: boolean;
  /** May add to the shared queue. */
  queue: boolean;
  /** May vote to skip. */
  vote: boolean;
}

export interface JukeboxEngine {
  init(): void;
  play(trackId?: string): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  setRepeat(m: RepeatMode): void;
  enqueue(trackId: string, opts?: { next?: boolean }): void;
  dequeue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setExpanded(open: boolean): void;
  setRoomOptOut(optOut: boolean): void;
  unlock(): void;
  currentTime(): number;
  analyser(): AnalyserNode | null;
  dj: {
    configure(c: DjConfig): void;
    play(id: string, pos?: number): void;
    pause(): void;
    resume(): void;
    seek(s: number): void;
    next(): void;
    prev(): void;
    enqueue(id: string, next?: boolean): void;
    dequeue(entryId: string): void;
    clearQueue(): void;
    voteSkip(): void;
  };
  // ---- additive extensions (beyond contract §3) ----
  /** Re-fetch the manifest (e.g. a "Retry" button after status 'error'). */
  reloadLibrary(): void;
  /** What the local player may do in the current room's DJ (all false outside rooms). */
  djPermissions(): DjPermissions;
  /** Track lookup by id from the loaded library. */
  track(id: string | null | undefined): JukeboxTrack | null;
  /** Clears `error` (after the UI showed it). */
  clearError(): void;
  /** Room DJ bridge hooks (roomDj.ts). */
  attachRoom(transport: DjTransport | null): void;
  receiveRoomState(state: DjState | null): void;
  /** Flush persistence now (pagehide). */
  flush(): void;
  /** Tear down listeners/timers (tests). The singleton is never disposed. */
  dispose(): void;
  /** Diagnostics for tests/QA. */
  readonly element: HTMLAudioElement | null;
}

const PERSIST_THROTTLE_MS = 1500;
const POSITION_UI_MS = 250;
const DJ_TICK_MS = 1000;
const PREV_RESTART_AFTER = 3;
const MAX_QUEUE = 200;
/** Room seeks are coalesced (held arrow keys, fast clicks) to stay well under the server's 4/s command limit. */
export const DJ_SEEK_MIN_GAP_MS = 300;

type Pending = { kind: 'none' } | { kind: 'play'; id: string | null };

export function createJukeboxEngine(deps: JukeboxEngineDeps): JukeboxEngine {
  const { store, mixer, timers } = deps;
  let initialized = false;
  let disposed = false;
  let el: HTMLAudioElement | null = null;
  let gestureSeen = false;
  let tracks: JukeboxTrack[] = [];
  let byId = new Map<string, JukeboxTrack>();
  const learnedDuration = new Map<string, number>();
  const broken = new Set<string>();
  let brokenStreak = 0;
  let shuffleOrderIds: string[] | null = null;
  let history: string[] = [];
  let pendingSeek: number | null = null;
  let pending: Pending = { kind: 'none' };
  let lastPositionUi = -Infinity;
  let persistTimer: unknown = null;
  let persistReady = false;
  let libraryGeneration = 0;
  /** Bumped by every loadTrack(): a play() rejection or element error from an earlier load is stale. */
  let loadSeq = 0;
  /** The load already reported broken (its 'error' event AND its rejected play() report one failure). */
  let brokenSeq = -1;
  /** Set when the engine pauses a playing element itself: the (async) 'pause' event it causes isn't an interruption. */
  let selfPause = false;
  /**
   * The user paused the music (this session, or a restored paused session) — also set by pauses the
   * browser/OS made. Decides whether joining a Room DJ starts the room's music (see evaluateRoom).
   */
  let userPaused = false;
  // Room DJ
  let transport: DjTransport | null = null;
  let lastRoomVersion = -1;
  let personal: { currentId: string | null; position: number; wantPlaying: boolean } | null = null;
  let lastSeekAt = -Infinity;
  let djTimer: unknown = null;
  let missingNotified: string | null = null;
  let lastDjSeekAt = -Infinity;
  let djSeekTimer: unknown = null;
  let djSeekPending: number | null = null;
  const unsubs: Array<() => void> = [];
  const elListeners: Array<[string, () => void]> = [];

  const get = () => store.getState();
  const set = (patch: Partial<JukeboxState>) => store.setState(patch);

  // ---------------------------------------------------------------------------
  // Library
  // ---------------------------------------------------------------------------
  function setLibrary(list: JukeboxTrack[]): void {
    tracks = [...list].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    byId = new Map(tracks.map((t) => [t.id, t]));
    broken.clear();
    brokenStreak = 0;
    if (shuffleOrderIds) shuffleOrderIds = shuffleOrder(ids(), deps.random, get().currentId);
  }

  const ids = () => tracks.map((t) => t.id);
  const libraryReady = () => get().library.status === 'ready';
  const durationOf = (id: string) => learnedDuration.get(id) || byId.get(id)?.duration || 0;

  function loadLibrary(): void {
    const gen = ++libraryGeneration;
    set({ library: { status: 'loading', tracks: get().library.tracks } });
    deps
      .fetchManifest()
      .then((json) => {
        if (gen !== libraryGeneration || disposed) return;
        if (json === null) {
          // No manifest (yet): an empty jukebox, not a crash.
          set({ library: { status: 'error', tracks: [] } });
          return;
        }
        const parsed = JukeboxManifestSchema.safeParse(json);
        if (!parsed.success) {
          set({ library: { status: 'error', tracks: [] } });
          return;
        }
        onLibraryReady(parsed.data.tracks);
      })
      .catch(() => {
        if (gen !== libraryGeneration || disposed) return;
        set({ library: { status: 'error', tracks: [] } });
      });
  }

  function onLibraryReady(list: JukeboxTrack[]): void {
    setLibrary(list);
    const s = get();
    const queue = s.queue.filter((id) => byId.has(id));
    const currentId = s.currentId && byId.has(s.currentId) ? s.currentId : null;
    set({ library: { status: 'ready', tracks }, queue, currentId, ...(currentId ? {} : { position: 0, duration: 0 }) });
    persistReady = true;
    if (s.source === 'room') {
      // syncRoom() below picks the room's track.
    } else if (pending.kind === 'play') {
      const id = pending.id;
      pending = { kind: 'none' };
      play(id ?? undefined);
    } else if (currentId && currentId !== loadedId) {
      loadTrack(currentId, get().position);
      if (get().wantPlaying) attemptPlay();
    } else if (!currentId && s.wantPlaying) {
      // The remembered track is gone: nothing to resume.
      set({ wantPlaying: false, needsGesture: false });
    }
    evaluateRoom();
  }

  // ---------------------------------------------------------------------------
  // Element
  // ---------------------------------------------------------------------------
  let loadedId: string | null = null;

  function ensureElement(): HTMLAudioElement {
    if (el) return el;
    const a = deps.createElement();
    a.preload = 'metadata';
    a.crossOrigin = null; // same-origin files; no CORS mode needed
    (a as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    a.setAttribute('playsinline', '');
    a.setAttribute('aria-hidden', 'true');
    const on = (type: string, fn: () => void) => {
      a.addEventListener(type, fn);
      elListeners.push([type, fn]);
    };
    on('playing', onPlaying);
    on('pause', onPause);
    on('waiting', () => set({ buffering: true }));
    on('stalled', () => set({ buffering: !a.paused }));
    on('canplay', () => set({ buffering: false }));
    on('loadedmetadata', onMetadata);
    on('durationchange', onMetadata);
    on('timeupdate', onTimeUpdate);
    on('seeked', () => {
      set({ position: safeTime() });
      updatePositionState();
    });
    on('ended', onEnded);
    on('error', onElementError);
    el = a;
    applyElementVolume();
    return a;
  }

  function safeTime(): number {
    const t = el?.currentTime ?? 0;
    return Number.isFinite(t) && t >= 0 ? t : 0;
  }

  function loadTrack(id: string, position: number, opts: { pushHistory?: boolean } = {}): void {
    const t = byId.get(id);
    if (!t) return;
    const a = ensureElement();
    const prevId = get().currentId;
    if (opts.pushHistory && prevId && prevId !== id) history = [...history.slice(-49), prevId];
    loadedId = id;
    loadSeq++;
    pendingSeek = position > 0 ? position : null;
    // Some engines fire 'pause' when a playing element's source changes: that one is ours.
    if (!a.paused) selfPause = true;
    try {
      a.playbackRate = 1;
    } catch {
      /* not supported */
    }
    a.src = t.src; // setting src starts loading (preload="metadata") and pauses the element (no event)
    // While switching tracks with intent to play, `playing` stays true (no game-music blip between songs).
    const keep = get().wantPlaying;
    set({ currentId: id, position: Math.max(0, position), duration: durationOf(id), buffering: keep, playing: get().playing && keep });
    pushMixFlags();
    lastPositionUi = -Infinity;
    updateMediaSession(t);
  }

  function seekElement(seconds: number): void {
    const a = el;
    const dur = get().duration || durationOf(get().currentId ?? '');
    const target = Math.max(0, dur > 0 ? Math.min(seconds, Math.max(0, dur - 0.25)) : seconds);
    if (a && a.readyState >= 1) {
      try {
        a.currentTime = target;
      } catch {
        pendingSeek = target;
      }
    } else pendingSeek = target;
    set({ position: target });
  }

  function onMetadata(): void {
    const a = el;
    if (!a) return;
    const d = a.duration;
    const id = get().currentId;
    if (id && Number.isFinite(d) && d > 0) {
      learnedDuration.set(id, d);
      if (get().duration !== d) set({ duration: d });
    }
    if (pendingSeek !== null && a.readyState >= 1) {
      const target = pendingSeek;
      pendingSeek = null;
      seekElement(target);
    }
    updatePositionState();
    if (get().source === 'room') syncRoom();
  }

  function onTimeUpdate(): void {
    const now = deps.now();
    if (now - lastPositionUi < POSITION_UI_MS) return;
    lastPositionUi = now;
    set({ position: safeTime() });
    schedulePersist();
  }

  function onPlaying(): void {
    brokenStreak = 0;
    selfPause = false; // any pause we caused was dispatched before this
    set({ playing: true, buffering: false, needsGesture: false });
    pushMixFlags();
    if (deps.mediaSession) deps.mediaSession.playbackState = 'playing';
    updateDjTimer();
  }

  function onPause(): void {
    const ours = selfPause;
    selfPause = false;
    set({ playing: false });
    pushMixFlags();
    if (deps.mediaSession) deps.mediaSession.playbackState = get().currentId ? 'paused' : 'none';
    updateDjTimer();
    // Neither ours nor the end of the track (that pause comes with `ended`): the browser/OS paused it
    // (audio focus lost, headphones unplugged, an iOS interruption). Treat it as a pause — otherwise
    // the transport keeps showing "playing" while silent and unlock() restarts the music on the next
    // unrelated tap.
    if (!ours && !disposed && el && el.paused && !el.ended && shouldBePlaying()) {
      pending = { kind: 'none' };
      userPaused = true;
      set({ wantPlaying: false, needsGesture: false, buffering: false });
      schedulePersist();
    }
  }

  function onEnded(): void {
    set({ playing: false });
    pushMixFlags();
    if (get().source === 'room') return; // the server advances the room's queue
    if (get().repeat === 'one') {
      seekElement(0);
      attemptPlay();
      return;
    }
    advance(true);
  }

  function onElementError(): void {
    // A newer load clears the element's error: an error still dispatching for an earlier source is stale.
    if (el && el.error === null) return;
    onBroken(loadSeq);
  }

  /** `seq` = the load that failed. One failure is reported at most once, and only for the current load. */
  function onBroken(seq: number): void {
    // Per spec a failed load fires 'error' first (whose handler already skips to the next track) and
    // then rejects the ORIGINAL play() promise with NotSupportedError: that must not break the next track.
    if (seq !== loadSeq || seq === brokenSeq) return;
    brokenSeq = seq;
    const id = get().currentId;
    if (!id || !el || !el.getAttribute('src')) return;
    const t = byId.get(id);
    broken.add(id);
    brokenStreak++;
    const message = `Couldn’t play “${t?.title ?? id}” — skipping.`;
    set({ error: message, playing: false, buffering: false });
    pushMixFlags();
    deps.notify?.(message);
    if (get().source === 'room') return;
    const playable = tracks.filter((x) => !broken.has(x.id)).length;
    if (playable === 0 || brokenStreak >= tracks.length) {
      set({ wantPlaying: false, needsGesture: false, error: 'The jukebox couldn’t play any tracks.' });
      return;
    }
    advance(true, true);
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  function shouldBePlaying(): boolean {
    const s = get();
    if (!s.wantPlaying || !s.currentId || loadedId !== s.currentId) return false;
    if (s.source === 'room') return Boolean(s.room?.playing && s.room.current?.trackId === s.currentId);
    return true;
  }

  function routeIfPossible(): void {
    if (el && mixer.isRunning() && !mixer.isRouted(el)) mixer.routeElement(el);
    applyElementVolume();
  }

  function attemptPlay(): void {
    if (!shouldBePlaying() || !el) return;
    if (!gestureSeen) {
      if (!get().needsGesture) set({ needsGesture: true });
      return;
    }
    // Inside the gesture (Safari/iOS): create/resume the context AND call play() synchronously.
    mixer.ensureContext();
    routeIfPossible();
    void mixer.resume().then((ok) => {
      if (ok && !disposed) routeIfPossible();
    });
    const seq = loadSeq;
    const rejected = (err: unknown) => onPlayRejected(err, seq);
    let p: Promise<void> | undefined;
    try {
      p = el.play();
    } catch (err) {
      rejected(err);
      return;
    }
    if (p && typeof p.catch === 'function') p.catch(rejected);
  }

  /** `seq` = the load this play() was for. */
  function onPlayRejected(err: unknown, seq: number): void {
    if (seq !== loadSeq) return; // an earlier track's play(): superseded (or its failure already handled)
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') return; // superseded by a newer load/pause
    if (name === 'NotSupportedError') {
      onBroken(seq);
      return;
    }
    // NotAllowedError (autoplay policy) or anything else: keep the intent, ask for a gesture.
    if (get().wantPlaying) set({ needsGesture: true, playing: false, buffering: false });
    pushMixFlags();
  }

  function currentOrder(): string[] {
    if (get().shuffle) {
      if (!shuffleOrderIds || shuffleOrderIds.length !== tracks.length) shuffleOrderIds = shuffleOrder(ids(), deps.random, get().currentId);
      return shuffleOrderIds;
    }
    return ids();
  }

  /** Next id after the current (queue first). `auto` = track ended / broken skip. */
  function pickNext(auto: boolean): string | null {
    const s = get();
    let queue = s.queue;
    while (queue.length) {
      const [head, ...rest] = queue;
      queue = rest;
      if (head && byId.has(head) && !broken.has(head)) {
        set({ queue });
        return head;
      }
    }
    if (queue !== s.queue) set({ queue });
    const wrap = auto ? s.repeat === 'all' : true;
    let cursor = s.currentId;
    for (let i = 0; i < tracks.length; i++) {
      let order = currentOrder();
      let id = nextInOrder(order, cursor, false);
      if (id === null) {
        if (!wrap) return null;
        if (s.shuffle) {
          shuffleOrderIds = reshuffleAvoiding(ids(), deps.random, s.currentId);
          order = shuffleOrderIds;
          id = order[0] ?? null;
        } else id = order[0] ?? null;
      }
      if (id === null) return null;
      if (!broken.has(id)) return id;
      cursor = id;
    }
    return null;
  }

  function advance(auto: boolean, skipBroken = false): void {
    const id = pickNext(auto || skipBroken);
    if (!id) {
      // End of the list with repeat off: stop on the current track, rewound.
      set({ wantPlaying: false });
      halt();
      seekElement(0);
      return;
    }
    loadTrack(id, 0, { pushHistory: true });
    attemptPlay();
  }

  function play(trackId?: string): void {
    if (trackId !== undefined) {
      if (typeof trackId !== 'string') return;
      if (!libraryReady()) {
        if (get().library.status === 'loading' || get().library.status === 'idle') {
          pending = { kind: 'play', id: trackId };
          set({ wantPlaying: true });
        }
        return;
      }
      if (!byId.has(trackId)) return; // invalid ids are ignored
      userPaused = false;
      if (get().source === 'room') setRoomOptOut(true);
      broken.delete(trackId);
      set({ error: null, wantPlaying: true });
      // Picking a track restarts the shuffle lap from it.
      if (get().shuffle) shuffleOrderIds = shuffleOrder(ids(), deps.random, trackId);
      if (trackId !== get().currentId || loadedId !== trackId) loadTrack(trackId, 0, { pushHistory: true });
      else if (el?.ended) seekElement(0);
      attemptPlay();
      return;
    }
    if (!libraryReady()) {
      if (get().library.status === 'loading' || get().library.status === 'idle') {
        pending = { kind: 'play', id: get().currentId };
        set({ wantPlaying: true });
      }
      return;
    }
    userPaused = false;
    set({ wantPlaying: true });
    if (get().source === 'room') {
      syncRoom();
      return;
    }
    const s = get();
    if (!s.currentId || loadedId !== s.currentId) {
      const id = s.currentId && byId.has(s.currentId) ? s.currentId : pickNext(false);
      if (!id) {
        set({ wantPlaying: false });
        return;
      }
      loadTrack(id, s.currentId === id ? s.position : 0);
    }
    attemptPlay();
  }

  function halt(): void {
    if (el && !el.paused) selfPause = true;
    el?.pause();
    // A loading element is already paused (no 'pause' event): reflect it explicitly.
    if (get().playing || get().buffering) set({ playing: false, buffering: false });
    pushMixFlags();
  }

  function pause(): void {
    pending = { kind: 'none' };
    userPaused = true;
    set({ wantPlaying: false, needsGesture: false });
    halt();
    schedulePersist();
  }

  function unlock(): void {
    if (disposed) return;
    gestureSeen = true;
    if (get().needsGesture && !shouldBePlaying()) set({ needsGesture: false });
    // Create/resume the context in the gesture even if nothing plays yet (cheap after the first).
    if (el || get().wantPlaying) {
      mixer.ensureContext();
      routeIfPossible();
      void mixer.resume().then((ok) => {
        if (!ok || disposed) return;
        routeIfPossible();
        onContextState();
      });
    }
    if (shouldBePlaying() && el?.paused) attemptPlay();
  }

  /**
   * The shared AudioContext was suspended/interrupted (iOS backgrounding, a call…) or runs again. A
   * routed element is silent while the context is down even though it still "plays": ask for a tap
   * (unlock() resumes the context inside the gesture) and drop the prompt once it runs.
   */
  function onContextState(): void {
    if (disposed || !el || !mixer.isRouted(el)) return; // an unrouted element doesn't depend on the context
    if (mixer.isRunning()) {
      if (get().needsGesture && !el.paused) set({ needsGesture: false });
    } else if (shouldBePlaying() && !get().needsGesture) set({ needsGesture: true });
  }

  // ---------------------------------------------------------------------------
  // Volume / mix
  // ---------------------------------------------------------------------------
  function pushMixFlags(): void {
    mixer.setJukeboxFlags({ playing: get().playing, muted: get().jukeboxMuted });
  }

  function applyElementVolume(): void {
    if (!el) return;
    const s = deps.settings.get();
    const muted = get().jukeboxMuted;
    if (mixer.isRouted(el)) {
      // WebAudio gains do the work (smooth ramps); the element stays at unity.
      if (el.volume !== 1) el.volume = 1;
      if (el.muted) el.muted = false;
      return;
    }
    const v = elementFallbackVolume(s, { muted });
    try {
      el.volume = v;
    } catch {
      /* iOS: volume is read-only — muted still works */
    }
    el.muted = v <= 0;
  }

  // ---------------------------------------------------------------------------
  // Media Session
  // ---------------------------------------------------------------------------
  function updateMediaSession(t: JukeboxTrack): void {
    const ms = deps.mediaSession;
    if (!ms || !deps.createMetadata) return;
    try {
      ms.metadata = deps.createMetadata({
        title: t.title,
        artist: t.artist ?? 'DASCADE Jukebox',
        album: t.album ?? 'DASCADE',
        artwork: t.artwork ? [{ src: t.artwork }] : [],
      });
    } catch {
      /* metadata is cosmetic */
    }
  }

  function updatePositionState(): void {
    const ms = deps.mediaSession;
    const a = el;
    if (!ms?.setPositionState || !a) return;
    const duration = a.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      ms.setPositionState({ duration, position: Math.min(duration, safeTime()), playbackRate: a.playbackRate || 1 });
    } catch {
      /* cosmetic */
    }
  }

  function installMediaSession(): void {
    const ms = deps.mediaSession;
    if (!ms) return;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => api.play()],
      ['pause', () => api.pause()],
      ['nexttrack', () => api.next()],
      ['previoustrack', () => api.prev()],
      ['seekto', (d) => typeof d.seekTime === 'number' && api.seek(d.seekTime)],
      ['seekbackward', (d) => api.seek(api.currentTime() - (d.seekOffset ?? 10))],
      ['seekforward', (d) => api.seek(api.currentTime() + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action unsupported on this browser */
      }
    }
    unsubs.push(() => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function snapshotForStorage(): PersistedJukebox {
    const s = get();
    const base = personal && s.source === 'room' ? personal : { currentId: s.currentId, position: currentTime(), wantPlaying: s.wantPlaying };
    return {
      currentId: base.currentId,
      position: base.position,
      wantPlaying: base.wantPlaying,
      shuffle: s.shuffle,
      repeat: s.repeat,
      queue: s.queue,
      jukeboxMuted: s.jukeboxMuted,
      roomOptOut: s.roomOptOut,
      optOutRoom,
    };
  }

  function flush(): void {
    if (persistTimer !== null) {
      timers.clearTimeout(persistTimer);
      persistTimer = null;
    }
    // Never overwrite the stored session with a half-restored one (library not loaded yet).
    if (!persistReady) return;
    savePersisted(deps.storage, snapshotForStorage());
  }

  function schedulePersist(): void {
    if (!persistReady || persistTimer !== null || disposed) return;
    persistTimer = timers.setTimeout(() => {
      persistTimer = null;
      flush();
    }, PERSIST_THROTTLE_MS);
  }

  // ---------------------------------------------------------------------------
  // Room DJ
  // ---------------------------------------------------------------------------
  function shouldFollowRoom(): boolean {
    const s = get();
    return Boolean(transport && s.room?.enabled && !s.roomOptOut);
  }

  function evaluateRoom(): void {
    if (!initialized || disposed) return;
    const follow = shouldFollowRoom();
    const s = get();
    if (follow && s.source === 'personal') {
      personal = { currentId: s.currentId, position: currentTime(), wantPlaying: s.wantPlaying };
      pending = { kind: 'none' };
      // Following the room means listening — unless the user had paused the music themselves (this
      // session, or a restored paused session): then the room's track is cued silently and their play
      // button joins in. Anyone with music on, and a visitor who never touched the jukebox, hear the
      // room straight away. Local pause/mute still win afterwards.
      set({ source: 'room', wantPlaying: s.wantPlaying || !userPaused, error: null });
      missingNotified = null;
      syncRoom();
    } else if (!follow && s.source === 'room') {
      restorePersonal();
    } else if (follow) {
      syncRoom();
    }
    updateDjTimer();
  }

  function restorePersonal(): void {
    const snap = personal;
    personal = null;
    missingNotified = null;
    set({ source: 'personal' });
    try {
      if (el) el.playbackRate = 1;
    } catch {
      /* ignore */
    }
    if (!snap) {
      halt();
      return;
    }
    set({ wantPlaying: snap.wantPlaying });
    if (snap.currentId && byId.has(snap.currentId)) {
      if (snap.currentId !== loadedId) loadTrack(snap.currentId, snap.position);
      else seekElement(snap.position);
    } else if (!snap.currentId) {
      set({ currentId: null, position: 0, duration: 0 });
    }
    if (snap.wantPlaying) attemptPlay();
    else halt();
    schedulePersist();
  }

  function syncRoom(): void {
    const s = get();
    const room = s.room;
    if (s.source !== 'room' || !room || !transport || !libraryReady()) return;
    const action = planDjSync(
      room,
      transport.serverNow(),
      { trackId: loadedId, position: safeTime(), lastSeekAt, now: deps.now(), canNudge: true },
      (id) => byId.has(id),
    );
    switch (action.kind) {
      case 'idle':
        halt();
        setRate(1);
        break;
      case 'missing':
        halt();
        if (missingNotified !== action.trackId) {
          missingNotified = action.trackId;
          set({ error: 'The room is playing a track this device doesn’t have.' });
        }
        break;
      case 'load':
        missingNotified = null;
        loadTrack(action.trackId, action.position);
        lastSeekAt = deps.now();
        if (action.play && get().wantPlaying) attemptPlay();
        else halt();
        break;
      case 'sync':
        if (action.seekTo !== null) {
          seekElement(action.seekTo);
          lastSeekAt = deps.now();
        }
        setRate(action.rate);
        if (action.play && get().wantPlaying) {
          if (el?.paused) attemptPlay();
        } else if (el && (!el.paused || get().playing)) halt();
        break;
    }
  }

  function setRate(rate: number): void {
    if (!el) return;
    try {
      if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
      // Keep pitch natural while nudging (where supported).
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    } catch {
      /* playbackRate unsupported */
    }
  }

  function updateDjTimer(): void {
    const s = get();
    const want = !disposed && s.source === 'room' && Boolean(s.room?.playing) && s.playing;
    if (want && djTimer === null) djTimer = timers.setInterval(syncRoom, DJ_TICK_MS);
    else if (!want && djTimer !== null) {
      timers.clearInterval(djTimer);
      djTimer = null;
    }
  }

  function djPermissions(): DjPermissions {
    const room = get().room;
    const me = transport?.playerId() ?? null;
    if (!transport || !me) return { control: false, queue: false, vote: false };
    // Before the DJ is first enabled there is no dj:state: the room host may still configure it.
    // DJ authority is always the room host. The synchronized room state is the live source (a
    // host hand-over while the DJ is off sends no dj:state, so `djId` can be stale); djId is the
    // fallback until the room state has arrived.
    const host = transport.hostId() || room?.djId || null;
    const control = host === me;
    if (!room) return { control, queue: false, vote: false };
    // Server rule: only seated players are listeners who may queue / vote (spectators are read-only).
    const listener = !transport.isSpectator?.();
    return {
      control,
      queue: room.enabled && (control || (room.allowQueue && listener)),
      // The host's skip "vote" is an immediate skip (server rule), so the host may always use it.
      vote: room.enabled && room.current !== null && (control || (room.allowSkipVote && listener)),
    };
  }

  function sendCommand(cmd: DjCommand): void {
    transport?.send(DJ.command, cmd);
  }

  /** The host starting the room's music is an explicit "play": they hear it too (even after a local pause). */
  function listenToRoom(): void {
    if (get().source === 'room' && !get().wantPlaying) play();
  }

  function trackRef(id: string): { trackId: string; duration: number } | null {
    if (!byId.has(id)) return null;
    const d = durationOf(id);
    if (!(d >= 1)) {
      set({ error: 'That track’s length isn’t known yet — play it once, then share it.' });
      return null;
    }
    return { trackId: id, duration: Math.min(DJ_MAX_TRACK_SECONDS, d) };
  }

  const clampPos = (s: number) => (Number.isFinite(s) ? Math.max(0, Math.min(DJ_MAX_TRACK_SECONDS, s)) : 0);

  const dj: JukeboxEngine['dj'] = {
    configure(c) {
      if (!djPermissions().control) return;
      transport?.send(DJ.config, c);
    },
    play(id, pos) {
      if (!djPermissions().control || !get().room?.enabled) return;
      const ref = trackRef(id);
      if (!ref) return;
      sendCommand(pos !== undefined ? { op: 'play', track: ref, position: clampPos(pos) } : { op: 'play', track: ref });
      listenToRoom();
    },
    pause() {
      if (djPermissions().control && get().room?.enabled) sendCommand({ op: 'pause' });
    },
    resume() {
      if (!djPermissions().control || !get().room?.enabled) return;
      sendCommand({ op: 'resume' });
      listenToRoom();
    },
    seek(s) {
      if (!djPermissions().control || !get().room?.enabled) return;
      const position = clampPos(s);
      if (djSeekTimer === null && deps.now() - lastDjSeekAt >= DJ_SEEK_MIN_GAP_MS) {
        lastDjSeekAt = deps.now();
        sendCommand({ op: 'seek', position });
        return;
      }
      // Leading edge sent already: keep only the latest target and send it once the gap has passed.
      djSeekPending = position;
      if (djSeekTimer !== null) return;
      djSeekTimer = timers.setTimeout(() => {
        djSeekTimer = null;
        const target = djSeekPending;
        djSeekPending = null;
        if (target === null || disposed || !djPermissions().control || !get().room?.enabled) return;
        lastDjSeekAt = deps.now();
        sendCommand({ op: 'seek', position: target });
      }, DJ_SEEK_MIN_GAP_MS);
    },
    next() {
      if (djPermissions().control && get().room?.enabled) sendCommand({ op: 'next' });
    },
    prev() {
      if (djPermissions().control && get().room?.enabled) sendCommand({ op: 'prev' });
    },
    enqueue(id, next) {
      if (!djPermissions().queue) return;
      const ref = trackRef(id);
      if (!ref) return;
      sendCommand(next ? { op: 'enqueue', track: ref, next: true } : { op: 'enqueue', track: ref });
    },
    dequeue(entryId) {
      const room = get().room;
      if (!room?.enabled || typeof entryId !== 'string') return;
      const entry = room.queue.find((e: DjQueueEntry) => e.entryId === entryId);
      const perms = djPermissions();
      if (!entry || !(perms.control || entry.addedBy === transport?.playerId())) return;
      sendCommand({ op: 'dequeue', entryId });
    },
    clearQueue() {
      if (djPermissions().control && get().room?.enabled) sendCommand({ op: 'clearQueue' });
    },
    voteSkip() {
      if (djPermissions().vote) transport?.send(DJ.skipVote, {});
    },
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function currentTime(): number {
    if (el && loadedId && loadedId === get().currentId && el.readyState >= 1 && pendingSeek === null) return safeTime();
    return get().position;
  }

  let optOutRoom: string | null = null;

  function setRoomOptOut(optOut: boolean): void {
    if (get().roomOptOut === optOut) return;
    optOutRoom = optOut ? (transport?.roomKey?.() ?? null) : null;
    set({ roomOptOut: optOut });
    evaluateRoom();
    schedulePersist();
  }

  const api: JukeboxEngine = {
    init() {
      if (initialized || disposed) return;
      initialized = true;
      ensureElement();
      const p = loadPersisted(deps.storage);
      optOutRoom = p.optOutRoom;
      // A restored session that was left paused counts as the user's pause (see evaluateRoom).
      userPaused = !p.wantPlaying && p.currentId !== null;
      set({
        currentId: p.currentId,
        position: p.position,
        wantPlaying: p.wantPlaying,
        shuffle: p.shuffle,
        repeat: p.repeat,
        queue: p.queue,
        jukeboxMuted: p.jukeboxMuted,
        roomOptOut: p.roomOptOut,
        // A restored "was playing" waits for the first gesture (no autoplay).
        needsGesture: p.wantPlaying && !gestureSeen,
      });
      if (p.shuffle) shuffleOrderIds = null;
      installMediaSession();
      unsubs.push(
        mixer.onStateChange(onContextState),
        deps.settings.subscribe(() => applyElementVolume()),
        store.subscribe((s, prev) => {
          if (s.jukeboxMuted !== prev.jukeboxMuted) {
            pushMixFlags();
            applyElementVolume();
          }
          if (
            s.currentId !== prev.currentId ||
            s.wantPlaying !== prev.wantPlaying ||
            s.shuffle !== prev.shuffle ||
            s.repeat !== prev.repeat ||
            s.queue !== prev.queue ||
            s.jukeboxMuted !== prev.jukeboxMuted ||
            s.roomOptOut !== prev.roomOptOut
          )
            schedulePersist();
        }),
      );
      pushMixFlags();
      loadLibrary();
    },
    play,
    pause,
    toggle() {
      const s = get();
      if (s.source === 'room' && s.room) {
        // Following the room: the host's play/pause drives the ROOM (everyone pauses); a listener's
        // is local only (the room keeps playing for everyone else).
        const control = djPermissions().control;
        if (showsPlaying(s)) {
          if (control) dj.pause();
          else pause();
          return;
        }
        if (!s.wantPlaying) play();
        if (control && s.room.current && !s.room.playing) dj.resume();
        return;
      }
      if (s.wantPlaying) pause();
      else play();
    },
    next() {
      if (get().source === 'room') {
        dj.next();
        return;
      }
      if (!libraryReady()) return;
      advance(false);
    },
    prev() {
      if (get().source === 'room') {
        dj.prev();
        return;
      }
      if (!libraryReady()) return;
      if (currentTime() > PREV_RESTART_AFTER || !tracks.length) {
        seekElement(0);
        return;
      }
      let id: string | null = null;
      while (history.length && !id) {
        const h = history[history.length - 1]!;
        history = history.slice(0, -1);
        if (byId.has(h) && h !== get().currentId) id = h;
      }
      id ??= prevInOrder(currentOrder(), get().currentId);
      if (!id) return;
      loadTrack(id, 0);
      attemptPlay();
    },
    seek(seconds) {
      if (!Number.isFinite(seconds)) return;
      if (get().source === 'room') {
        dj.seek(seconds);
        return;
      }
      if (!get().currentId) return;
      seekElement(seconds);
      schedulePersist();
    },
    setShuffle(on) {
      const v = Boolean(on);
      if (get().shuffle === v) return;
      shuffleOrderIds = v ? shuffleOrder(ids(), deps.random, get().currentId) : null;
      set({ shuffle: v });
    },
    cycleRepeat() {
      const r = get().repeat;
      set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
    },
    setRepeat(m) {
      if (m === 'off' || m === 'all' || m === 'one') set({ repeat: m });
    },
    enqueue(trackId, opts) {
      if (!libraryReady() || !byId.has(trackId)) return;
      const q = get().queue;
      if (q.length >= MAX_QUEUE) return;
      set({ queue: opts?.next ? [trackId, ...q] : [...q, trackId] });
    },
    dequeue(index) {
      const q = get().queue;
      if (!Number.isInteger(index) || index < 0 || index >= q.length) return;
      set({ queue: q.filter((_, i) => i !== index) });
    },
    moveInQueue(from, to) {
      const q = get().queue;
      const moved = moveItem(q, from, to);
      if (moved.some((id, i) => id !== q[i])) set({ queue: moved });
    },
    clearQueue() {
      if (get().queue.length) set({ queue: [] });
    },
    setVolume(v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      deps.settings.update({ jukeboxVolume: Math.min(1, Math.max(0, v)) });
    },
    toggleMute() {
      set({ jukeboxMuted: !get().jukeboxMuted });
    },
    setExpanded(open) {
      set({ expanded: Boolean(open) });
    },
    setRoomOptOut,
    unlock,
    currentTime,
    analyser() {
      if (!el || !mixer.isRouted(el) || !visualizerEnabled(deps.settings.get())) return null;
      return mixer.analyser();
    },
    dj,
    reloadLibrary() {
      if (initialized && !disposed) loadLibrary();
    },
    djPermissions,
    track: (id) => (id ? (byId.get(id) ?? null) : null),
    clearError() {
      if (get().error !== null) set({ error: null });
    },
    attachRoom(t) {
      transport = t;
      // Opting out is per room: entering a different room follows its DJ again (reconnects keep the choice).
      const key = t?.roomKey?.() ?? null;
      if (key && get().roomOptOut && optOutRoom !== key) {
        optOutRoom = null;
        set({ roomOptOut: false });
        schedulePersist();
      }
      if (!t) {
        lastRoomVersion = -1;
        if (get().room) set({ room: null });
      }
      evaluateRoom();
    },
    receiveRoomState(state) {
      if (state === null) {
        lastRoomVersion = -1;
        if (get().room !== null) set({ room: null });
        evaluateRoom();
        return;
      }
      if (state.version <= lastRoomVersion) return; // stale / duplicate
      lastRoomVersion = state.version;
      set({ room: state });
      evaluateRoom();
    },
    flush,
    dispose() {
      if (disposed) return;
      flush();
      disposed = true;
      if (djTimer !== null) timers.clearInterval(djTimer);
      djTimer = null;
      if (djSeekTimer !== null) timers.clearTimeout(djSeekTimer);
      djSeekTimer = null;
      for (const u of unsubs.splice(0)) u();
      if (el) for (const [type, fn] of elListeners.splice(0)) el.removeEventListener(type, fn);
      el?.pause();
    },
    get element() {
      return el;
    },
  };
  return api;
}
