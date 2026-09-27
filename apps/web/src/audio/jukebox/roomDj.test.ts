import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DJ, EMPTY_DJ_STATE, type DjState } from '@dascade/shared/jukebox';
import { flushMicrotasks } from '../testFakes.ts';
import { DJ_HARD_DRIFT, DJ_NUDGE_RATE, DJ_RESYNC_THRESHOLD, DJ_SEEK_COOLDOWN_MS, isDjState, planDjSync, type DjLocal } from './djSync.ts';
import { DJ_SEEK_MIN_GAP_MS } from './core.ts';
import { connectRoomDj, type DjSessionPort } from './roomDj.ts';
import { showsPlaying } from './store.ts';
import { setup } from './testHarness.ts';

const NOW = 1_000_000;
const djState = (patch: Partial<DjState> = {}): DjState => ({
  ...EMPTY_DJ_STATE,
  enabled: true,
  version: 1,
  current: { trackId: 'c', duration: 100, addedBy: 'host' },
  playing: true,
  position: 10,
  anchorServerTime: NOW,
  djId: 'host',
  ...patch,
});
const local = (patch: Partial<DjLocal> = {}): DjLocal => ({ trackId: 'c', position: 10, lastSeekAt: -Infinity, now: 0, canNudge: true, ...patch });
const has = () => true;

describe('planDjSync (pure policy)', () => {
  it('idle / missing / load', () => {
    expect(planDjSync(djState({ current: null }), NOW, local(), has)).toEqual({ kind: 'idle' });
    expect(planDjSync(djState(), NOW, local(), () => false)).toEqual({ kind: 'missing', trackId: 'c' });
    expect(planDjSync(djState(), NOW + 5000, local({ trackId: 'a' }), has)).toEqual({ kind: 'load', trackId: 'c', position: 15, play: true });
  });

  it('in sync → nothing; small drift → gentle rate nudge (no seek)', () => {
    expect(planDjSync(djState(), NOW, local({ position: 10.05 }), has)).toEqual({ kind: 'sync', seekTo: null, rate: 1, play: true });
    expect(planDjSync(djState(), NOW, local({ position: 10.4 }), has)).toEqual({ kind: 'sync', seekTo: null, rate: 1 - DJ_NUDGE_RATE, play: true });
    expect(planDjSync(djState(), NOW, local({ position: 9.6 }), has)).toEqual({ kind: 'sync', seekTo: null, rate: 1 + DJ_NUDGE_RATE, play: true });
    expect(planDjSync(djState(), NOW, local({ position: 10.4, canNudge: false }), has)).toMatchObject({ seekTo: null, rate: 1 });
  });

  it('drift beyond the threshold → one seek; no seek spam inside the cooldown unless wildly off', () => {
    const off = 10 + DJ_RESYNC_THRESHOLD + 0.25;
    expect(planDjSync(djState(), NOW, local({ position: off }), has)).toMatchObject({ seekTo: 10 });
    expect(planDjSync(djState(), NOW, local({ position: off, lastSeekAt: 0, now: DJ_SEEK_COOLDOWN_MS - 1 }), has)).toMatchObject({ seekTo: null });
    expect(planDjSync(djState(), NOW, local({ position: off, lastSeekAt: 0, now: DJ_SEEK_COOLDOWN_MS }), has)).toMatchObject({ seekTo: 10 });
    expect(planDjSync(djState(), NOW, local({ position: 10 + DJ_HARD_DRIFT + 1, lastSeekAt: 0, now: 1 }), has)).toMatchObject({ seekTo: 10 });
  });

  it('paused room → pause locally; seek only if off', () => {
    expect(planDjSync(djState({ playing: false }), NOW + 9999, local(), has)).toEqual({ kind: 'sync', seekTo: null, rate: 1, play: false });
    expect(planDjSync(djState({ playing: false }), NOW, local({ position: 30 }), has)).toEqual({ kind: 'sync', seekTo: 10, rate: 1, play: false });
  });

  it('isDjState rejects junk', () => {
    expect(isDjState(djState())).toBe(true);
    for (const junk of [null, 1, 'x', {}, { ...djState(), version: 'x' }, { ...djState(), queue: null }, { ...djState(), current: { trackId: 3 } }]) {
      expect(isDjState(junk)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Bridge + engine integration
// ---------------------------------------------------------------------------
function fakePort() {
  const roomListeners = new Set<() => void>();
  const msgListeners = new Map<string, Set<(p: unknown) => void>>();
  const last = new Map<string, unknown>();
  const port = {
    room: null as object | null,
    me: 'host' as string | null,
    serverTime: NOW,
    sent: [] as Array<[string, unknown]>,
    currentRoom: () => port.room,
    subscribeRoom: (cb: () => void) => {
      roomListeners.add(cb);
      return () => roomListeners.delete(cb);
    },
    subscribeMessage: (type: string, cb: (p: unknown) => void) => {
      let s = msgListeners.get(type);
      if (!s) msgListeners.set(type, (s = new Set()));
      s.add(cb);
      return () => s.delete(cb);
    },
    getLastMessage: (type: string) => last.get(type),
    send: (type: string, payload: unknown) => port.sent.push([type, payload]),
    playerId: () => port.me,
    host: 'host' as string | null,
    hostId: () => port.host,
    spectator: false,
    isSpectator: () => port.spectator,
    key: 'room-1',
    roomKey: () => (port.room ? port.key : null),
    serverNow: () => port.serverTime,
    // helpers
    join(initial?: DjState) {
      port.room = {};
      last.clear();
      if (initial) last.set(DJ.state, initial);
      for (const cb of [...roomListeners]) cb();
    },
    leave() {
      port.room = null;
      last.clear();
      for (const cb of [...roomListeners]) cb();
    },
    push(state: unknown) {
      last.set(DJ.state, state);
      for (const cb of [...(msgListeners.get(DJ.state) ?? [])]) cb(state);
    },
    listenerCount: () => roomListeners.size + [...msgListeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return port satisfies DjSessionPort & Record<string, unknown>;
}

async function roomSetup(opts: Parameters<typeof setup>[0] = {}) {
  const h = await setup(opts);
  const port = fakePort();
  const disconnect = connectRoomDj(h.engine, port);
  return { ...h, port, disconnect };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Room DJ bridge', () => {
  it('follows the room (track + position) and restores personal playback on leave', async () => {
    const h = await roomSetup();
    h.engine.play('a');
    h.el().loadMeta(100);
    h.el().tick(20);
    h.engine.pause();
    h.port.join(djState());
    expect(h.state().source).toBe('room');
    expect(h.state().currentId).toBe('c');
    expect(h.state().playing).toBe(true);
    h.el().loadMeta(100);
    expect(h.el().currentTime).toBeCloseTo(10);
    // Leave → personal track 'a' at 20 s, paused as it was.
    h.port.leave();
    expect(h.state()).toMatchObject({ source: 'personal', currentId: 'a', wantPlaying: false, playing: false, room: null });
    h.el().loadMeta(100);
    expect(h.el().currentTime).toBeCloseTo(20);
  });

  it('late join: replays the last dj:state delivered before the bridge noticed the room', async () => {
    const h = await roomSetup();
    h.port.serverTime = NOW + 30_000;
    h.port.join(djState());
    expect(h.state().currentId).toBe('c');
    expect(h.state().position).toBeCloseTo(40);
  });

  it('ignores stale and duplicate versions; a new room resets the version counter', async () => {
    const h = await roomSetup();
    h.port.join(djState({ version: 5 }));
    h.port.push(djState({ version: 4, current: { trackId: 'a', duration: 100, addedBy: 'host' } }));
    h.port.push(djState({ version: 5, current: { trackId: 'a', duration: 100, addedBy: 'host' } }));
    expect(h.state().currentId).toBe('c');
    h.port.push(djState({ version: 6, current: { trackId: 'b', duration: 100, addedBy: 'host' } }));
    expect(h.state().currentId).toBe('b');
    h.port.leave();
    h.port.join(djState({ version: 1, current: { trackId: 'd', duration: 100, addedBy: 'host' } }));
    expect(h.state().currentId).toBe('d');
    h.port.push({ junk: true });
    expect(h.state().room?.version).toBe(1);
  });

  it('small drift is nudged with playbackRate; big drift seeks once (no seek spam)', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.el().loadMeta(100);
    // 0.3 s ahead → nudge, no seek.
    h.el().currentTime = 10.3;
    h.clock.now = 10_000;
    vi.advanceTimersByTime(1000);
    expect(h.el().playbackRate).toBeCloseTo(1 - DJ_NUDGE_RATE);
    expect(h.el().currentTime).toBeCloseTo(10.3);
    // Back in sync → rate restored.
    h.el().currentTime = 10;
    vi.advanceTimersByTime(1000);
    expect(h.el().playbackRate).toBe(1);
    // 2 s behind → one seek…
    h.el().currentTime = 8;
    vi.advanceTimersByTime(1000);
    expect(h.el().currentTime).toBeCloseTo(10);
    // …and inside the cooldown a new 2 s drift is only nudged.
    h.el().currentTime = 8;
    h.clock.now += 500;
    vi.advanceTimersByTime(1000);
    expect(h.el().currentTime).toBeCloseTo(8);
    expect(h.el().playbackRate).toBeCloseTo(1 + DJ_NUDGE_RATE);
  });

  it('room pause / resume / idle are followed', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.port.push(djState({ version: 2, playing: false }));
    expect(h.state().playing).toBe(false);
    h.port.push(djState({ version: 3, playing: true }));
    expect(h.state().playing).toBe(true);
    h.port.push(djState({ version: 4, current: null, playing: false }));
    expect(h.state().playing).toBe(false);
  });

  it('local pause wins: room updates never restart a locally paused listener', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.engine.pause();
    h.port.push(djState({ version: 2, current: { trackId: 'b', duration: 100, addedBy: 'host' } }));
    expect(h.state().currentId).toBe('b');
    expect(h.state().playing).toBe(false);
    h.engine.play();
    expect(h.state().playing).toBe(true);
  });

  it('local mute wins: a muted listener stays inaudible while following', async () => {
    const h = await roomSetup();
    h.engine.toggleMute();
    h.port.join(djState());
    expect(h.state().source).toBe('room');
    expect(h.state().jukeboxMuted).toBe(true);
    expect(h.mixer.jukeboxAudible()).toBe(false);
    h.port.push(djState({ version: 2 }));
    expect(h.state().jukeboxMuted).toBe(true);
  });

  it('opt-out restores personal playback; opting back in follows again', async () => {
    const h = await roomSetup();
    h.engine.play('a');
    h.port.join(djState());
    expect(h.state().source).toBe('room');
    h.engine.setRoomOptOut(true);
    expect(h.state()).toMatchObject({ source: 'personal', currentId: 'a', playing: true, roomOptOut: true });
    h.port.push(djState({ version: 2 }));
    expect(h.state().currentId).toBe('a');
    h.engine.setRoomOptOut(false);
    expect(h.state()).toMatchObject({ source: 'room', currentId: 'c' });
  });

  it('play(trackId) while following = opt out and play personally', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.engine.play('d');
    expect(h.state()).toMatchObject({ source: 'personal', roomOptOut: true, currentId: 'd', playing: true });
  });

  it('opting out is per room: kept across a reconnect, reset in a different room', async () => {
    const h = await roomSetup();
    h.engine.play('a');
    h.port.join(djState());
    h.engine.setRoomOptOut(true);
    expect(h.state()).toMatchObject({ source: 'personal', roomOptOut: true });
    // Reconnect: a new room object, same room id → still opted out.
    h.port.join(djState({ version: 2 }));
    expect(h.state()).toMatchObject({ source: 'personal', roomOptOut: true, currentId: 'a' });
    // A different room → follows its DJ again.
    h.port.leave();
    h.port.key = 'room-2';
    h.port.join(djState());
    expect(h.state()).toMatchObject({ source: 'room', roomOptOut: false });
  });

  it('a disabled room DJ leaves personal playback alone', async () => {
    const h = await roomSetup();
    h.engine.play('b');
    h.port.join(djState({ enabled: false }));
    expect(h.state()).toMatchObject({ source: 'personal', currentId: 'b', playing: true });
    h.port.push(djState({ version: 2, enabled: true }));
    expect(h.state().source).toBe('room');
    h.port.push(djState({ version: 3, enabled: false }));
    expect(h.state()).toMatchObject({ source: 'personal', currentId: 'b' });
  });

  it('a room track missing from the local manifest pauses gracefully with one error', async () => {
    const h = await roomSetup();
    h.port.join(djState({ current: { trackId: 'not-here', duration: 100, addedBy: 'host' } }));
    expect(h.state().playing).toBe(false);
    expect(h.state().error).toMatch(/doesn’t have/);
    h.engine.clearError();
    h.port.push(djState({ version: 2, current: { trackId: 'not-here', duration: 100, addedBy: 'host' } }));
    expect(h.state().error).toBeNull();
  });

  it('persists the PERSONAL session while following the room', async () => {
    const h = await roomSetup();
    h.engine.play('a');
    h.port.join(djState());
    vi.advanceTimersByTime(2000);
    h.engine.flush();
    const saved = JSON.parse(h.storage!.getItem('dascade:v1:jukebox')!);
    expect(saved.currentId).toBe('a');
  });

  it('personal next/prev/seek forward to dj.* for the host and are no-ops for listeners', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.engine.next();
    h.engine.seek(42);
    expect(h.port.sent).toEqual([
      [DJ.command, { op: 'next' }],
      [DJ.command, { op: 'seek', position: 42 }],
    ]);
    h.port.me = 'guest';
    h.port.sent.length = 0;
    h.engine.next();
    h.engine.prev();
    h.engine.seek(1);
    expect(h.port.sent).toEqual([]);
    expect(h.state().currentId).toBe('c');
  });

  it('host seek spam (held arrow key) is coalesced: leading send + one trailing send of the latest target', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.clock.now = 10_000;
    for (let i = 1; i <= 12; i++) h.engine.seek(i * 5);
    expect(h.port.sent).toEqual([[DJ.command, { op: 'seek', position: 5 }]]);
    h.clock.now += DJ_SEEK_MIN_GAP_MS;
    vi.advanceTimersByTime(DJ_SEEK_MIN_GAP_MS);
    expect(h.port.sent).toEqual([
      [DJ.command, { op: 'seek', position: 5 }],
      [DJ.command, { op: 'seek', position: 60 }],
    ]);
    // Spaced-out seeks go straight through.
    h.clock.now += DJ_SEEK_MIN_GAP_MS;
    h.engine.seek(7);
    expect(h.port.sent.at(-1)).toEqual([DJ.command, { op: 'seek', position: 7 }]);
    expect(h.port.sent).toHaveLength(3);
  });

  it('dj commands honour permissions (host / allowQueue / own entry / allowSkipVote)', async () => {
    const h = await roomSetup();
    h.port.join(djState({ queue: [{ entryId: 'e1', trackId: 'a', duration: 100, addedBy: 'guest' }, { entryId: 'e2', trackId: 'b', duration: 100, addedBy: 'host' }] }));
    expect(h.engine.djPermissions()).toEqual({ control: true, queue: true, vote: true });
    h.engine.dj.play('b', 12);
    h.engine.dj.enqueue('d', true);
    h.engine.dj.configure({ allowQueue: true });
    h.engine.dj.dequeue('e1');
    h.engine.dj.play('nope');
    expect(h.port.sent).toEqual([
      [DJ.command, { op: 'play', track: { trackId: 'b', duration: 100 }, position: 12 }],
      [DJ.command, { op: 'enqueue', track: { trackId: 'd', duration: 100 }, next: true }],
      [DJ.config, { allowQueue: true }],
      [DJ.command, { op: 'dequeue', entryId: 'e1' }],
    ]);
    // A guest: no control, no queue until allowQueue, can remove only their own entry.
    h.port.me = 'guest';
    h.port.sent.length = 0;
    h.engine.dj.play('a');
    h.engine.dj.pause();
    h.engine.dj.enqueue('a');
    h.engine.dj.voteSkip();
    h.engine.dj.dequeue('e2');
    h.engine.dj.dequeue('e1');
    expect(h.port.sent).toEqual([[DJ.command, { op: 'dequeue', entryId: 'e1' }]]);
    h.port.push(djState({ version: 2, allowQueue: true, allowSkipVote: true, skipNeeded: 2 }));
    h.port.sent.length = 0;
    h.engine.dj.enqueue('a');
    h.engine.dj.voteSkip();
    expect(h.port.sent).toEqual([
      [DJ.command, { op: 'enqueue', track: { trackId: 'a', duration: 100 } }],
      [DJ.skipVote, {}],
    ]);
  });

  it('before the DJ is first enabled (no dj:state yet) only the room host may configure it', async () => {
    const h = await roomSetup();
    h.engine.dj.configure({ enabled: true });
    expect(h.port.sent).toEqual([]); // not in a room
    h.port.join();
    expect(h.engine.djPermissions()).toEqual({ control: true, queue: false, vote: false });
    h.engine.dj.configure({ enabled: true });
    h.engine.dj.play('a'); // not enabled yet
    expect(h.port.sent).toEqual([[DJ.config, { enabled: true }]]);
    h.port.me = 'guest';
    expect(h.engine.djPermissions().control).toBe(false);
    h.engine.dj.configure({ enabled: false });
    expect(h.port.sent).toHaveLength(1);
  });

  it('DJ authority follows the live room host even when a hand-over sent no dj:state (DJ off)', async () => {
    const h = await roomSetup();
    // The DJ was on once (djId=host), then switched off; the host left while it was off.
    h.port.join(djState({ enabled: false, playing: false, djId: 'host' }));
    h.port.host = 'guest';
    h.port.me = 'host';
    expect(h.engine.djPermissions().control).toBe(false);
    h.engine.dj.configure({ enabled: true });
    expect(h.port.sent).toEqual([]);
    h.port.me = 'guest';
    expect(h.engine.djPermissions().control).toBe(true);
    h.engine.dj.configure({ enabled: true });
    expect(h.port.sent).toEqual([[DJ.config, { enabled: true }]]);
    // Before the room state has synced (no hostId yet) the DJ state's djId is the fallback.
    h.port.host = null;
    expect(h.engine.djPermissions().control).toBe(false);
    h.port.me = 'host';
    expect(h.engine.djPermissions().control).toBe(true);
  });

  it("the host's play/pause drives the ROOM; a listener's is local only", async () => {
    const h = await roomSetup();
    h.port.join(djState());
    expect(showsPlaying(h.state())).toBe(true);
    // Host pause → a room pause command; the host keeps listening intent (so resume is heard).
    h.engine.toggle();
    expect(h.port.sent).toEqual([[DJ.command, { op: 'pause' }]]);
    expect(h.state().wantPlaying).toBe(true);
    h.port.push(djState({ version: 2, playing: false }));
    expect(showsPlaying(h.state())).toBe(false);
    expect(h.state().playing).toBe(false);
    h.engine.toggle();
    expect(h.port.sent.at(-1)).toEqual([DJ.command, { op: 'resume' }]);
    // Host who had paused locally: play resumes locally (room already playing → no command).
    h.port.push(djState({ version: 3, playing: true }));
    h.engine.pause();
    h.port.sent.length = 0;
    h.engine.toggle();
    expect(h.state().wantPlaying).toBe(true);
    expect(h.port.sent).toEqual([]);
    // Listener: pause/play stay on this device.
    h.port.me = 'guest';
    h.engine.toggle();
    expect(h.state()).toMatchObject({ wantPlaying: false, playing: false, source: 'room' });
    h.engine.toggle();
    expect(h.state()).toMatchObject({ wantPlaying: true, playing: true });
    expect(h.port.sent).toEqual([]);
  });

  it('host migration mid-track: music keeps playing, control moves, the old host becomes a listener', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.el().loadMeta(100);
    // Server: host leaves → djId moves, version bumps; playback anchor unchanged.
    h.port.host = 'guest';
    h.port.push(djState({ version: 2, djId: 'guest' }));
    expect(h.state()).toMatchObject({ source: 'room', currentId: 'c', playing: true });
    expect(h.engine.djPermissions().control).toBe(false);
    h.engine.toggle(); // now a local pause only
    expect(h.port.sent).toEqual([]);
    expect(h.state().playing).toBe(false);
  });

  it('a reconnect (same room, same versions) is a no-op; a new room object starts fresh', async () => {
    const h = await roomSetup();
    h.port.join(djState({ version: 7 }));
    h.el().loadMeta(100);
    const src = h.el().src;
    h.port.push(djState({ version: 7 })); // welcome replay after an SDK reconnect
    expect(h.el().src).toBe(src);
    expect(h.state().playing).toBe(true);
  });

  it('spectators are read-only: no queueing or skip votes even when the host allows them', async () => {
    const h = await roomSetup();
    h.port.me = 'watcher';
    h.port.spectator = true;
    h.port.join(djState({ allowQueue: true, allowSkipVote: true, skipNeeded: 2 }));
    expect(h.engine.djPermissions()).toEqual({ control: false, queue: false, vote: false });
    h.engine.dj.enqueue('a');
    h.engine.dj.voteSkip();
    expect(h.port.sent).toEqual([]);
    // …but they still hear the room.
    expect(h.state()).toMatchObject({ source: 'room', currentId: 'c', playing: true });
    h.port.spectator = false;
    expect(h.engine.djPermissions()).toEqual({ control: false, queue: true, vote: true });
  });

  it('dj commands are no-ops outside rooms and for tracks with unknown length', async () => {
    const h = await roomSetup({ manifest: { version: 1, generatedAt: 'x', tracks: [{ id: 'z', src: '/audio/jukebox/z.mp3', file: 'z.mp3', title: 'Z', duration: 0, order: 1 }] } });
    h.engine.dj.play('z');
    expect(h.port.sent).toEqual([]);
    h.port.join(djState({ current: null }));
    h.engine.dj.play('z');
    expect(h.port.sent).toEqual([]);
    expect(h.state().error).toMatch(/length/);
  });

  it('an engine fault inside a dj:state delivery never propagates into the session dispatch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = {
      attachRoom: vi.fn(),
      receiveRoomState: vi.fn((s: DjState | null) => {
        if (s) throw new Error('boom');
      }),
    };
    const port = fakePort();
    connectRoomDj(engine, port);
    expect(() => port.join(djState())).not.toThrow();
    expect(() => port.push(djState({ version: 2 }))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('disconnect removes every subscription (no leaks across mounts)', async () => {
    const h = await roomSetup();
    h.port.join(djState());
    h.disconnect();
    expect(h.port.listenerCount()).toBe(0);
    expect(h.state().source).toBe('personal');
  });

  it('the resync interval only runs while following a playing room', async () => {
    const h = await roomSetup();
    const before = vi.getTimerCount();
    h.port.join(djState());
    expect(vi.getTimerCount()).toBeGreaterThan(before);
    h.port.push(djState({ version: 2, playing: false }));
    await flushMicrotasks();
    // Only the (throttled) persistence timer may remain.
    h.engine.flush();
    expect(vi.getTimerCount()).toBe(before);
    h.port.leave();
    h.engine.flush();
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('Room DJ session registration (net/session.ts ↔ engine)', () => {
  const hooks = () => ({ attachRoom: vi.fn(), receiveRoomState: vi.fn() });
  const port = (room: unknown = null): DjSessionPort => ({
    currentRoom: () => room,
    subscribeRoom: vi.fn(() => () => undefined),
    subscribeMessage: vi.fn(() => () => undefined),
    getLastMessage: () => undefined,
    send: vi.fn(),
    playerId: () => 'p',
    hostId: () => 'p',
    serverNow: () => 0,
  });

  it('connects whichever side registers last, exactly once', async () => {
    vi.resetModules();
    const mod = await import('./roomDj.ts');
    const engine = hooks();
    const p = port({});
    mod.registerDjSession(p); // session first (it loads lazily, but order must not matter)
    expect(engine.attachRoom).not.toHaveBeenCalled();
    mod.installRoomDj(engine);
    expect(engine.attachRoom).toHaveBeenCalledTimes(1);
    expect(engine.attachRoom.mock.calls[0]![0]).not.toBeNull();
    mod.installRoomDj(engine);
    mod.registerDjSession(p);
    expect(engine.attachRoom).toHaveBeenCalledTimes(1);
    expect(p.subscribeMessage).toHaveBeenCalledTimes(1);
  });

  it('a re-registered session (HMR) replaces the old bridge instead of stacking a second one', async () => {
    vi.resetModules();
    const mod = await import('./roomDj.ts');
    const engine = hooks();
    const offMsg = vi.fn();
    const first: DjSessionPort = { ...port({}), subscribeMessage: vi.fn(() => offMsg) };
    mod.installRoomDj(engine);
    mod.registerDjSession(first);
    const second = port({});
    mod.registerDjSession(second);
    expect(offMsg).toHaveBeenCalledTimes(1);
    expect(second.subscribeMessage).toHaveBeenCalledTimes(1);
  });
});
