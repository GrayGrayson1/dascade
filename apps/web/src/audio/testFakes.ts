/**
 * Test doubles for the audio unit tests (never imported by app code): a fake AudioContext graph,
 * a fake HTMLAudioElement, a memory Storage and a manual clock. Kept tiny and explicit so the
 * tests assert behaviour, not browser internals.
 */

export class FakeParam {
  value: number;
  /** Last target written by setTargetAtTime/setValueAtTime (what the ramp heads to). */
  target: number;
  calls: Array<[string, number, number, number?]> = [];
  constructor(v = 1) {
    this.value = v;
    this.target = v;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.calls.push(['target', v, t, tc]);
    this.target = v;
    return this;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(['set', v, t]);
    this.target = v;
    this.value = v;
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', 0, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
    return this;
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  gain = new FakeParam(1);
  threshold = new FakeParam(0);
  ratio = new FakeParam(1);
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  constructor(
    public kind: string,
    public ctx: FakeAudioContext,
  ) {}
  connect(n: FakeNode) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.connections = [];
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode('destination', this);
  nodes: FakeNode[] = [];
  mediaSources = 0;
  refuseMediaSource = false;
  resumeResult: AudioContextState = 'running';
  private stateListeners = new Set<() => void>();
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    if (type === 'statechange') this.stateListeners.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === 'statechange') this.stateListeners.delete(fn);
  }
  /** Test helper: the browser/OS changes the state (e.g. 'suspended' on iOS backgrounding). */
  setState(state: AudioContextState) {
    if (state === this.state) return;
    this.state = state;
    for (const fn of [...this.stateListeners]) fn();
  }
  private make(kind: string) {
    const n = new FakeNode(kind, this);
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.make('gain');
  }
  createDynamicsCompressor() {
    return this.make('compressor');
  }
  createAnalyser() {
    return this.make('analyser');
  }
  createMediaElementSource() {
    if (this.refuseMediaSource) throw new Error('InvalidStateError');
    this.mediaSources++;
    return this.make('mediaSource');
  }
  createBuffer(_ch: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume() {
    this.setState(this.resumeResult);
    return Promise.resolve();
  }
  countOf(kind: string) {
    return this.nodes.filter((n) => n.kind === kind).length;
  }
}

type Listener = () => void;

export class FakeAudioElement {
  static instances: FakeAudioElement[] = [];
  listeners = new Map<string, Set<Listener>>();
  attrs = new Map<string, string>();
  private _src = '';
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  readyState = 0;
  volume = 1;
  muted = false;
  playbackRate = 1;
  preload = '';
  crossOrigin: string | null = null;
  playsInline = false;
  /** MediaError stand-in: set by fail(), cleared by a new load (like the real element). */
  error: { code: number } | null = null;
  /** How the next play() behaves ('defer' = the element starts loading; settle the promise via `deferred`). */
  playBehavior: 'resolve' | 'notAllowed' | 'notSupported' | 'defer' = 'resolve';
  playCalls = 0;
  /** Pending play() promises (playBehavior 'defer'), oldest first. */
  deferred: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  constructor() {
    FakeAudioElement.instances.push(this);
  }
  get src() {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.attrs.set('src', v);
    this.readyState = 0;
    this.paused = true; // the load algorithm pauses without a 'pause' event
    this.currentTime = 0;
    this.duration = Number.NaN;
    this.ended = false;
    this.error = null;
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  setAttribute(n: string, v: string) {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  load() {}
  addEventListener(type: string, fn: Listener) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  listenerCount() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  emit(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.playBehavior === 'notAllowed') return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    if (this.playBehavior === 'notSupported') return Promise.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' }));
    if (this.playBehavior === 'defer') {
      this.paused = false; // play() flips `paused` at once; 'playing' waits for data
      return new Promise((resolve, reject) => this.deferred.push({ resolve, reject }));
    }
    if (this.paused) {
      this.paused = false;
      this.emit('play');
      this.emit('playing');
    }
    return Promise.resolve();
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.emit('pause');
    }
  }
  // ---- test helpers ----
  /** Metadata arrives. */
  loadMeta(duration: number) {
    this.readyState = 1;
    this.duration = duration;
    this.emit('loadedmetadata');
  }
  /** Advance playback time and fire timeupdate. */
  tick(seconds: number) {
    this.currentTime += seconds;
    this.emit('timeupdate');
  }
  end() {
    this.currentTime = Number.isFinite(this.duration) ? this.duration : this.currentTime;
    this.paused = true;
    this.ended = true;
    this.emit('pause');
    this.emit('ended');
  }
  fail() {
    this.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED
    this.emit('error');
  }
  /** The browser/OS pauses playback on its own (audio focus lost, headphones unplugged…). */
  externalPause() {
    this.pause();
  }
}

export class MemoryStorage {
  map = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** Resolve pending promise callbacks. */
export async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
