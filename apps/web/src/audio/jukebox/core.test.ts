import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, FakeAudioElement, MemoryStorage, flushMicrotasks } from '../testFakes.ts';
import { JUKEBOX_STORAGE_KEY } from './persist.ts';
import { MANIFEST, RECORDS_MANIFEST, seeded, setup, track } from './testHarness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('library / manifest', () => {
  it('loads and validates the manifest, sorted by order', async () => {
    const h = await setup();
    expect(h.state().library.status).toBe('ready');
    expect(h.state().library.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a missing manifest (404) is an empty jukebox with status error, not a crash', async () => {
    const h = await setup({ fetchManifest: () => Promise.resolve(null) });
    expect(h.state().library).toEqual({ status: 'error', tracks: [], records: [] });
    h.engine.play();
    h.engine.next();
    expect(h.el().playCalls).toBe(0);
  });

  it('rejects an invalid manifest and a failed fetch', async () => {
    expect((await setup({ manifest: { version: 2, tracks: [] } })).state().library.status).toBe('error');
    expect((await setup({ manifest: { version: 1, generatedAt: 'x', tracks: [{ id: '../evil', src: 'http://x' }] } })).state().library.status).toBe('error');
    expect((await setup({ fetchManifest: () => Promise.reject(new Error('offline')) })).state().library.status).toBe('error');
  });

  it('reloadLibrary retries after an error', async () => {
    let fail = true;
    const h = await setup({ fetchManifest: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve(MANIFEST)) });
    expect(h.state().library.status).toBe('error');
    fail = false;
    h.engine.reloadLibrary();
    expect(h.state().library.status).toBe('loading');
    await flushMicrotasks();
    expect(h.state().library.status).toBe('ready');
  });

  it('play() before the library is ready is kept as intent and honoured on load', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const h = await setup({ fetchManifest: () => new Promise((r) => (resolve = r)) });
    expect(h.state().library.status).toBe('loading');
    h.engine.play('c');
    expect(h.state().wantPlaying).toBe(true);
    resolve(MANIFEST);
    await flushMicrotasks();
    expect(h.state().currentId).toBe('c');
    expect(h.state().playing).toBe(true);
  });
});

describe('transport', () => {
  it('play() starts the first track; pause() stops; toggle() flips', async () => {
    const h = await setup();
    h.engine.play();
    expect(h.state().currentId).toBe('a');
    expect(h.el().src).toBe('/audio/jukebox/a.mp3');
    expect(h.state()).toMatchObject({ playing: true, wantPlaying: true, needsGesture: false });
    h.engine.pause();
    expect(h.state()).toMatchObject({ playing: false, wantPlaying: false });
    h.engine.toggle();
    expect(h.state().playing).toBe(true);
    h.engine.toggle();
    expect(h.state().playing).toBe(false);
  });

  it('play(id) plays that track; invalid / unknown ids are ignored', async () => {
    const h = await setup();
    h.engine.play('c');
    expect(h.state().currentId).toBe('c');
    h.engine.play('nope');
    h.engine.play('../../etc/passwd');
    h.engine.play(42 as unknown as string);
    expect(h.state().currentId).toBe('c');
    expect(h.state().playing).toBe(true);
  });

  it('next / prev walk the library order; prev after 3 s restarts the track', async () => {
    const h = await setup();
    h.engine.play('a');
    h.engine.next();
    expect(h.state().currentId).toBe('b');
    h.engine.next();
    expect(h.state().currentId).toBe('c');
    h.engine.prev();
    expect(h.state().currentId).toBe('b'); // from history
    h.el().loadMeta(100);
    h.el().tick(10);
    h.engine.prev();
    expect(h.state().currentId).toBe('b');
    expect(h.el().currentTime).toBe(0);
    h.engine.prev();
    expect(h.state().currentId).toBe('a');
    h.engine.prev();
    expect(h.state().currentId).toBe('d'); // wraps
  });

  it('manual next wraps at the end even with repeat off', async () => {
    const h = await setup();
    h.engine.setRepeat('off');
    h.engine.play('d');
    h.engine.next();
    expect(h.state().currentId).toBe('a');
  });

  it('seek: pending until metadata, then applied; clamped; NaN ignored', async () => {
    const h = await setup();
    h.engine.play('a');
    h.engine.seek(30);
    expect(h.state().position).toBe(30);
    expect(h.engine.currentTime()).toBe(30);
    h.el().loadMeta(100);
    expect(h.el().currentTime).toBe(30);
    h.engine.seek(500);
    expect(h.el().currentTime).toBeCloseTo(99.75);
    h.engine.seek(-5);
    expect(h.el().currentTime).toBe(0);
    h.engine.seek(Number.NaN);
    expect(h.el().currentTime).toBe(0);
  });

  it('learns the real duration from metadata', async () => {
    const h = await setup({ manifest: { ...MANIFEST, tracks: [track('a', 1, 0)] } });
    h.engine.play('a');
    expect(h.state().duration).toBe(0);
    h.el().loadMeta(187.5);
    expect(h.state().duration).toBe(187.5);
  });

  it('position updates are throttled to UI rate', async () => {
    const h = await setup();
    h.engine.play('a');
    h.el().loadMeta(100);
    const spy = vi.fn();
    const off = h.store.subscribe((s, p) => s.position !== p.position && spy());
    for (let i = 0; i < 10; i++) {
      h.clock.now += 50;
      h.el().tick(0.05);
    }
    off();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(h.engine.currentTime()).toBeCloseTo(0.5);
  });
});

describe('track end, repeat, shuffle', () => {
  it('advances on track end (repeat all wraps)', async () => {
    const h = await setup();
    h.engine.play('d');
    h.el().loadMeta(100);
    h.el().end();
    expect(h.state().currentId).toBe('a');
    expect(h.state().playing).toBe(true);
  });

  it('repeat one replays the same track', async () => {
    const h = await setup();
    h.engine.setRepeat('one');
    h.engine.play('b');
    h.el().loadMeta(100);
    h.el().end();
    expect(h.state().currentId).toBe('b');
    expect(h.el().currentTime).toBe(0);
    expect(h.state().playing).toBe(true);
  });

  it('repeat off stops (rewound) after the last track', async () => {
    const h = await setup();
    h.engine.setRepeat('off');
    h.engine.play('d');
    h.el().loadMeta(100);
    h.el().end();
    expect(h.state()).toMatchObject({ currentId: 'd', wantPlaying: false, playing: false });
    expect(h.el().currentTime).toBe(0);
  });

  it('cycleRepeat goes off → all → one → off; setRepeat ignores junk', async () => {
    const h = await setup();
    h.engine.setRepeat('off');
    h.engine.cycleRepeat();
    expect(h.state().repeat).toBe('all');
    h.engine.cycleRepeat();
    expect(h.state().repeat).toBe('one');
    h.engine.cycleRepeat();
    expect(h.state().repeat).toBe('off');
    h.engine.setRepeat('loud' as never);
    expect(h.state().repeat).toBe('off');
  });

  it('shuffle plays every track once per lap and never repeats back-to-back across laps', async () => {
    const tracks = Array.from({ length: 8 }, (_, i) => track(`t${i}`, i));
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = await setup({ manifest: { ...MANIFEST, tracks }, random: seeded(seed) });
      h.engine.setShuffle(true);
      h.engine.play('t0');
      const seen = [h.state().currentId];
      for (let i = 0; i < 31; i++) {
        h.el().loadMeta(100);
        h.el().end();
        seen.push(h.state().currentId);
      }
      for (let lap = 0; lap < 4; lap++) expect(new Set(seen.slice(lap * 8, lap * 8 + 8)).size).toBe(8);
      for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    }
  });

  it('turning shuffle on keeps the current track and shuffles the rest', async () => {
    const h = await setup();
    h.engine.play('c');
    h.engine.setShuffle(true);
    expect(h.state().shuffle).toBe(true);
    expect(h.state().currentId).toBe('c');
    const order = ['c'];
    for (let i = 0; i < 3; i++) {
      h.engine.next();
      order.push(h.state().currentId!);
    }
    expect(new Set(order).size).toBe(4);
  });
});

describe('records', () => {
  const nexts = (h: Awaited<ReturnType<typeof setup>>, n: number) => {
    const seen: (string | null)[] = [];
    for (let i = 0; i < n; i++) {
      h.engine.next();
      seen.push(h.state().currentId);
    }
    return seen;
  };

  it('plays only the record in effect: the main record by default; next wraps inside it', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    expect(h.state().record).toBe('main');
    expect(h.state().library.records.map((r) => r.id)).toEqual(['main', 'halloween']);
    h.engine.play();
    expect(h.state().currentId).toBe('a');
    expect(nexts(h, 4)).toEqual(['b', 'c', 'a', 'b']);
    h.engine.prev();
    expect(h.state().currentId).toBe('a');
    h.el().loadMeta(100);
    h.engine.play('c');
    h.el().loadMeta(100);
    h.el().end();
    expect(h.state().currentId).toBe('a'); // auto-advance wraps inside the record too
  });

  it("without a pick, a theme's paired record is the default; a theme change never cuts the song that's on", async () => {
    const spooky = await setup({ manifest: RECORDS_MANIFEST, theme: 'halloween-night' });
    expect(spooky.state().record).toBe('halloween');
    spooky.engine.play();
    expect(spooky.state().currentId).toBe('h1');

    const h = await setup({ manifest: RECORDS_MANIFEST, theme: 'delta-neon' });
    h.engine.play('b');
    h.el().loadMeta(100);
    const src = h.el().src;
    h.setTheme('halloween-night');
    expect(h.state()).toMatchObject({ record: 'halloween', currentId: 'b', wantPlaying: true, recordPick: null });
    expect(h.el().src).toBe(src); // still the same song, not reloaded
    h.el().end();
    expect(h.state().currentId).toBe('h1'); // the next one comes from the theme's record
    h.setTheme('delta-neon');
    expect(h.state().record).toBe('main');
  });

  it("the listener's pick wins over the theme until they pick 'follow the theme' (null) again", async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST, theme: 'halloween-night' });
    h.engine.setRecord('main');
    expect(h.state()).toMatchObject({ record: 'main', recordPick: 'main' });
    h.setTheme('delta-neon');
    h.setTheme('halloween-night');
    expect(h.state().record).toBe('main');
    h.engine.setRecord(null);
    expect(h.state().record).toBe('halloween');
  });

  it('setRecord(id, { play }) puts the record on from its first song; shuffle starts a random lap inside it', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.play('b');
    h.engine.setRecord('halloween', { play: true });
    expect(h.state()).toMatchObject({ record: 'halloween', currentId: 'h1', wantPlaying: true });
    expect(h.el().src).toContain('h1');

    const s = await setup({ manifest: RECORDS_MANIFEST, random: seeded(3) });
    s.engine.setShuffle(true);
    s.engine.setRecord('halloween', { play: true });
    const lap = [s.state().currentId, ...nexts(s, 2)];
    expect(new Set(lap)).toEqual(new Set(['h1', 'h2', 'h3']));
  });

  it("picking the record that's already playing doesn't restart it; without play it only re-scopes", async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.play('b');
    h.el().loadMeta(100);
    h.engine.seek(42);
    h.engine.setRecord('main', { play: true });
    expect(h.state()).toMatchObject({ currentId: 'b', position: 42 });
    h.engine.setRecord('halloween');
    expect(h.state()).toMatchObject({ record: 'halloween', currentId: 'b', wantPlaying: true });
  });

  it('"All records" plays everything (the mix); with a single record it is just that record', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.setRecord('all', { play: true });
    expect(h.state().record).toBe('all');
    expect([h.state().currentId, ...nexts(h, 6)]).toEqual(['a', 'b', 'c', 'h1', 'h2', 'h3', 'a']);
    // Playing a song from the rack in the mix stays in the mix.
    h.engine.play('h2');
    expect(h.state().record).toBe('all');

    const one = await setup();
    one.engine.setRecord('all');
    expect(one.state()).toMatchObject({ record: 'main', recordPick: 'all' });
  });

  it('playing a song from another record (search) puts that record on, so next carries on there', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.play('a');
    h.engine.play('h2');
    expect(h.state()).toMatchObject({ record: 'halloween', recordPick: 'halloween', currentId: 'h2' });
    expect(nexts(h, 2)).toEqual(['h3', 'h1']);
  });

  it('the queue reaches every record; afterwards the record in effect carries on', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.play('a');
    h.engine.enqueue('h3');
    h.engine.next();
    expect(h.state()).toMatchObject({ currentId: 'h3', record: 'main' });
    h.engine.next();
    expect(h.state().currentId).toBe('a');
  });

  it('ignores junk and records that are not on the shelf', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    for (const bad of ['../evil', 'NOPE', 'missing-record', 42 as unknown as string]) h.engine.setRecord(bad);
    expect(h.state()).toMatchObject({ record: 'main', recordPick: null });
  });

  it('the pick is persisted and restored; a stored pick whose record is gone falls back to the theme (and is kept)', async () => {
    const h = await setup({ manifest: RECORDS_MANIFEST });
    h.engine.setRecord('halloween');
    vi.advanceTimersByTime(1600);
    expect(JSON.parse(h.storage!.getItem(JUKEBOX_STORAGE_KEY)!).record).toBe('halloween');

    const back = await setup({ manifest: RECORDS_MANIFEST, stored: JSON.stringify({ record: 'halloween' }) });
    expect(back.state()).toMatchObject({ record: 'halloween', recordPick: 'halloween' });

    const gone = await setup({ manifest: MANIFEST, stored: JSON.stringify({ record: 'halloween' }), theme: 'halloween-night' });
    expect(gone.state()).toMatchObject({ record: 'main', recordPick: 'halloween' });

    const hostile = await setup({ manifest: RECORDS_MANIFEST, stored: JSON.stringify({ record: '<img onerror>' }) });
    expect(hostile.state().recordPick).toBeNull();
  });

  it('a pick made before the library loads is applied once it does', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const h = await setup({ fetchManifest: () => new Promise((r) => (resolve = r)) });
    h.engine.setRecord('halloween');
    expect(h.state().recordPick).toBe('halloween');
    resolve(RECORDS_MANIFEST);
    await flushMicrotasks();
    expect(h.state().record).toBe('halloween');
  });

  it('an old manifest without records is one main record named after its album', async () => {
    const tracks = [{ ...track('x', 0), album: 'Cyber Nightpulse' }, track('y', 1)];
    const h = await setup({ manifest: { version: 1, generatedAt: 'x', tracks } });
    expect(h.state().library.records).toEqual([{ id: 'main', title: 'Cyber Nightpulse', order: 0, tracks: 2, duration: 200 }]);
    expect(h.state().record).toBe('main');
  });
});

describe('queue', () => {
  it('enqueue / play next / dequeue / move / clear; next() drains the queue first', async () => {
    const h = await setup();
    h.engine.play('a');
    h.engine.enqueue('d');
    h.engine.enqueue('c');
    h.engine.enqueue('b', { next: true });
    expect(h.state().queue).toEqual(['b', 'd', 'c']);
    h.engine.moveInQueue(2, 0);
    expect(h.state().queue).toEqual(['c', 'b', 'd']);
    h.engine.dequeue(1);
    expect(h.state().queue).toEqual(['c', 'd']);
    h.engine.next();
    expect(h.state().currentId).toBe('c');
    expect(h.state().queue).toEqual(['d']);
    h.engine.clearQueue();
    expect(h.state().queue).toEqual([]);
  });

  it('rejects invalid ids and indices', async () => {
    const h = await setup();
    h.engine.enqueue('zzz');
    h.engine.enqueue('');
    expect(h.state().queue).toEqual([]);
    h.engine.enqueue('a');
    h.engine.dequeue(5);
    h.engine.dequeue(-1);
    h.engine.dequeue(0.5);
    h.engine.moveInQueue(9, 0);
    expect(h.state().queue).toEqual(['a']);
  });

  it('queued tracks play on track end', async () => {
    const h = await setup();
    h.engine.play('a');
    h.engine.enqueue('d');
    h.el().loadMeta(100);
    h.el().end();
    expect(h.state().currentId).toBe('d');
  });
});

describe('volume, mute, mixer integration', () => {
  it('setVolume writes the jukeboxVolume setting (clamped); junk ignored', async () => {
    const h = await setup();
    h.engine.setVolume(0.3);
    expect(h.settings().jukeboxVolume).toBe(0.3);
    h.engine.setVolume(7);
    expect(h.settings().jukeboxVolume).toBe(1);
    h.engine.setVolume(Number.NaN);
    expect(h.settings().jukeboxVolume).toBe(1);
  });

  it('local mute silences the jukebox bus and releases game music; SFX untouched', async () => {
    const h = await setup({ settings: { musicEnabled: true } });
    h.engine.play('a');
    expect(h.mixer.jukeboxAudible()).toBe(true);
    expect(h.mixer.gameMusicSilenced()).toBe(true);
    const sfxTarget = (h.mixer.buses()!.sfx.gain as unknown as { target: number }).target;
    h.engine.toggleMute();
    expect(h.state().jukeboxMuted).toBe(true);
    expect(h.mixer.jukeboxAudible()).toBe(false);
    expect(h.mixer.gameMusicSilenced()).toBe(false);
    expect((h.mixer.buses()!.jukebox.gain as unknown as { target: number }).target).toBe(0);
    expect((h.mixer.buses()!.sfx.gain as unknown as { target: number }).target).toBe(sfxTarget);
  });

  it('routed element stays at unity volume (gains do the work)', async () => {
    const h = await setup();
    h.engine.play('a');
    await flushMicrotasks();
    expect(h.mixer.isRouted(h.el() as unknown as HTMLMediaElement)).toBe(true);
    expect(h.el().volume).toBe(1);
    expect(h.el().muted).toBe(false);
  });

  it('Safari fallback: if MediaElementSource is refused, music plays via element.volume and obeys mute', async () => {
    const h = await setup({ gesture: false });
    h.engine.unlock();
    h.ctx()!.refuseMediaSource = true;
    await flushMicrotasks();
    h.engine.play('a');
    await flushMicrotasks();
    expect(h.state().playing).toBe(true);
    expect(h.engine.analyser()).toBeNull();
    expect(h.el().volume).toBeCloseTo(0.8 * 0.7 * 0.6);
    h.engine.toggleMute();
    expect(h.el().muted).toBe(true);
    h.engine.toggleMute();
    h.setSettings({ muted: true });
    expect(h.el().muted).toBe(true);
  });
});

describe('errors', () => {
  it('a broken track sets a toast-able error and auto-skips', async () => {
    const h = await setup();
    h.engine.play('a');
    h.el().fail();
    expect(h.state().error).toMatch(/A/);
    expect(h.notes).toHaveLength(1);
    expect(h.state().currentId).toBe('b');
    expect(h.state().playing).toBe(true);
    h.engine.clearError();
    expect(h.state().error).toBeNull();
  });

  it('broken tracks are skipped later; when every track fails the jukebox stops', async () => {
    const h = await setup();
    h.engine.play('a');
    for (let i = 0; i < 4; i++) h.el().fail();
    expect(h.state().wantPlaying).toBe(false);
    expect(h.state().error).toMatch(/any tracks/);
    expect(h.el().playCalls).toBeLessThanOrEqual(5);
  });

  it("a failed load's late NotSupportedError rejection never breaks the track the error handler moved on to", async () => {
    // Per spec (Firefox/WebKit): 'error' fires first — the engine skips A → B — and only then is the
    // ORIGINAL play() promise for A rejected with NotSupportedError.
    const h = await setup();
    h.el().playBehavior = 'defer';
    h.engine.play('a');
    h.el().playBehavior = 'resolve';
    h.el().fail();
    expect(h.state()).toMatchObject({ currentId: 'b', playing: true });
    h.el().deferred[0]!.reject(Object.assign(new Error('bad'), { name: 'NotSupportedError' }));
    await flushMicrotasks();
    expect(h.state()).toMatchObject({ currentId: 'b', playing: true, wantPlaying: true });
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toMatch(/A/);
    // B is not marked broken: it's still reachable later.
    h.engine.play('a');
    h.engine.next();
    expect(h.state().currentId).toBe('b');
  });

  it('a stale play() rejection from an earlier track is ignored (no gesture prompt, no skip)', async () => {
    const h = await setup();
    h.el().playBehavior = 'defer';
    h.engine.play('a');
    h.el().playBehavior = 'resolve';
    h.engine.play('c');
    h.el().deferred[0]!.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    await flushMicrotasks();
    expect(h.state()).toMatchObject({ currentId: 'c', playing: true, needsGesture: false, error: null });
  });

  it('NotSupportedError from play() is treated as a broken track', async () => {
    const h = await setup();
    h.el().playBehavior = 'notSupported';
    h.engine.play('a');
    await flushMicrotasks();
    h.el().playBehavior = 'resolve';
    expect(h.state().error).not.toBeNull();
    expect(h.state().currentId).not.toBe('a');
  });
});

describe('autoplay / gestures', () => {
  it('never calls play() before a gesture; raises needsGesture and keeps intent', async () => {
    const h = await setup({ gesture: false });
    h.engine.play('b');
    expect(h.el().playCalls).toBe(0);
    expect(h.state()).toMatchObject({ needsGesture: true, wantPlaying: true, playing: false, error: null });
    expect(FakeAudioContext.instances).toHaveLength(0);
    h.engine.unlock();
    expect(h.el().playCalls).toBe(1);
    expect(h.state()).toMatchObject({ needsGesture: false, playing: true });
  });

  it('a rejected play() (autoplay policy) is the gentle prompt state, not an error', async () => {
    const h = await setup();
    h.el().playBehavior = 'notAllowed';
    h.engine.play('a');
    await flushMicrotasks();
    expect(h.state()).toMatchObject({ needsGesture: true, wantPlaying: true, playing: false, error: null });
    h.el().playBehavior = 'resolve';
    h.engine.unlock();
    expect(h.state()).toMatchObject({ needsGesture: false, playing: true });
  });

  it('a pause the engine did not cause (audio focus, headphones, iOS) clears the intent; the next tap does not restart', async () => {
    const h = await setup();
    h.engine.play('a');
    h.el().loadMeta(100);
    expect(h.state()).toMatchObject({ playing: true, wantPlaying: true });
    h.el().externalPause();
    expect(h.state()).toMatchObject({ playing: false, wantPlaying: false, needsGesture: false });
    expect(h.mediaSession.playbackState).toBe('paused');
    const calls = h.el().playCalls;
    h.engine.unlock(); // an unrelated tap somewhere in the app
    expect(h.el().playCalls).toBe(calls);
    expect(h.state().playing).toBe(false);
    // Play resumes normally.
    h.engine.toggle();
    expect(h.state()).toMatchObject({ playing: true, wantPlaying: true });
  });

  it("the engine's own pauses and track ends are not mistaken for interruptions", async () => {
    const h = await setup();
    h.engine.setRepeat('all');
    h.engine.play('a');
    h.el().loadMeta(100);
    h.el().end(); // 'pause' then 'ended'
    expect(h.state()).toMatchObject({ currentId: 'b', wantPlaying: true, playing: true });
    h.engine.next(); // switching tracks while playing
    expect(h.state()).toMatchObject({ currentId: 'c', wantPlaying: true, playing: true });
  });

  it('a suspended/interrupted context (iOS backgrounding) raises the tap prompt; resuming clears it', async () => {
    const h = await setup();
    h.engine.play('a');
    await flushMicrotasks();
    expect(h.mixer.isRouted(h.el() as unknown as HTMLMediaElement)).toBe(true);
    h.ctx()!.setState('suspended');
    expect(h.state()).toMatchObject({ needsGesture: true, wantPlaying: true });
    // The next tap resumes the context (the element never stopped): the prompt goes away.
    h.engine.unlock();
    await flushMicrotasks();
    expect(h.ctx()!.state).toBe('running');
    expect(h.state()).toMatchObject({ needsGesture: false, wantPlaying: true, playing: true });
    // A paused jukebox isn't prompted.
    h.engine.pause();
    h.ctx()!.setState('suspended');
    expect(h.state().needsGesture).toBe(false);
  });

  it('pausing clears a pending gesture prompt', async () => {
    const h = await setup({ gesture: false });
    h.engine.play('a');
    h.engine.pause();
    expect(h.state().needsGesture).toBe(false);
    h.engine.unlock();
    expect(h.el().playCalls).toBe(0);
  });
});

describe('persistence', () => {
  it('restores track + position after reload but only resumes after a gesture', async () => {
    const stored = JSON.stringify({ currentId: 'c', position: 42, wantPlaying: true, shuffle: true, repeat: 'one', queue: ['a', 'zz', 'b'], jukeboxMuted: true, roomOptOut: true });
    const h = await setup({ stored, gesture: false });
    expect(h.state()).toMatchObject({ currentId: 'c', wantPlaying: true, playing: false, needsGesture: true, shuffle: true, repeat: 'one', jukeboxMuted: true, roomOptOut: true });
    expect(h.state().queue).toEqual(['a', 'b']); // unknown id dropped
    expect(h.el().src).toBe('/audio/jukebox/c.mp3');
    expect(h.el().playCalls).toBe(0);
    h.el().loadMeta(100);
    expect(h.el().currentTime).toBe(42);
    h.engine.unlock();
    expect(h.state().playing).toBe(true);
    expect(h.el().currentTime).toBe(42);
  });

  it('a restored paused session stays paused after a gesture', async () => {
    const h = await setup({ stored: JSON.stringify({ currentId: 'b', position: 5, wantPlaying: false }), gesture: false });
    h.engine.unlock();
    expect(h.el().playCalls).toBe(0);
    expect(h.state()).toMatchObject({ currentId: 'b', needsGesture: false });
  });

  it('corrupt / hostile storage restores defaults; a throwing storage is ignored', async () => {
    for (const stored of ['{nope', '[]', 'null', JSON.stringify({ currentId: '<script>', position: -4, repeat: 'x', queue: 'a', shuffle: 'yes' })]) {
      const h = await setup({ stored });
      expect(h.state()).toMatchObject({ currentId: null, position: 0, repeat: 'all', queue: [], shuffle: false });
    }
    const throwing = new MemoryStorage();
    throwing.getItem = () => {
      throw new Error('SecurityError');
    };
    throwing.setItem = () => {
      throw new Error('QuotaExceeded');
    };
    const h = await setup({ storage: throwing });
    h.engine.play('a');
    vi.advanceTimersByTime(5000);
    h.engine.flush();
    expect(h.state().playing).toBe(true);
  });

  it('a stored track that no longer exists is dropped (no zombie resume)', async () => {
    const h = await setup({ stored: JSON.stringify({ currentId: 'gone', position: 9, wantPlaying: true }), gesture: false });
    expect(h.state()).toMatchObject({ currentId: null, wantPlaying: false, needsGesture: false });
  });

  it('writes are throttled and contain the contract fields', async () => {
    const h = await setup();
    h.engine.play('a');
    h.engine.enqueue('b');
    h.engine.setShuffle(true);
    h.engine.toggleMute();
    expect(h.storage!.writes).toBe(0);
    vi.advanceTimersByTime(1600);
    expect(h.storage!.writes).toBe(1);
    const saved = JSON.parse(h.storage!.getItem(JUKEBOX_STORAGE_KEY)!);
    expect(saved).toEqual({ currentId: 'a', position: 0, wantPlaying: true, shuffle: true, repeat: 'all', queue: ['b'], jukeboxMuted: true, roomOptOut: false, optOutRoom: null, record: null });
  });

  it('does not overwrite the stored session before the library has loaded', async () => {
    const stored = JSON.stringify({ currentId: 'c', position: 42, wantPlaying: true });
    const h = await setup({ stored, fetchManifest: () => new Promise(() => undefined) });
    h.engine.toggleMute();
    vi.advanceTimersByTime(5000);
    h.engine.flush();
    expect(h.storage!.getItem(JUKEBOX_STORAGE_KEY)).toBe(stored);
  });
});

describe('singletons & leaks', () => {
  it('init is idempotent and never creates a second element, context or analyser', async () => {
    const h = await setup();
    h.engine.init();
    h.engine.init();
    for (let i = 0; i < 5; i++) {
      h.engine.unlock();
      h.engine.play(['a', 'b', 'c'][i % 3]);
      h.engine.setExpanded(i % 2 === 0);
      h.engine.analyser();
      await flushMicrotasks();
    }
    expect(FakeAudioElement.instances).toHaveLength(1);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(h.ctx()!.countOf('analyser')).toBe(1);
    expect(h.ctx()!.mediaSources).toBe(1);
  });

  it('analyser() is the shared node when routed + visualizer on; null when the setting is off', async () => {
    const h = await setup();
    h.engine.play('a');
    await flushMicrotasks();
    const a = h.engine.analyser();
    expect(a).not.toBeNull();
    expect(h.engine.analyser()).toBe(a);
    h.setSettings({ visualizer: 'off' });
    expect(h.engine.analyser()).toBeNull();
    h.setSettings({ visualizer: 'auto', reducedMotion: true });
    expect(h.engine.analyser()).toBeNull();
    h.setSettings({ visualizer: 'auto', reducedMotion: false });
    expect(h.engine.analyser()).toBe(a);
  });

  it('element listener count is constant across many track switches; dispose removes them all', async () => {
    const h = await setup();
    const n = h.el().listenerCount();
    for (let i = 0; i < 20; i++) h.engine.next();
    expect(h.el().listenerCount()).toBe(n);
    h.engine.dispose();
    expect(h.el().listenerCount()).toBe(0);
    expect(h.settingsSubs.size).toBe(0);
  });

  it('media session: metadata per track, handlers registered once, removed on dispose', async () => {
    const h = await setup();
    const calls = h.mediaSession.setCalls;
    h.engine.play('b');
    h.engine.next();
    expect((h.mediaSession.metadata as unknown as { title: string }).title).toBe('C');
    expect(h.mediaSession.setCalls).toBe(calls);
    h.mediaSession.handlers.get('pause')!({ action: 'pause' });
    expect(h.state().playing).toBe(false);
    h.mediaSession.handlers.get('nexttrack')!({ action: 'nexttrack' });
    expect(h.state().currentId).toBe('d');
    h.engine.dispose();
    expect(h.mediaSession.handlers.size).toBe(0);
  });

  it('expanded is UI state only', async () => {
    const h = await setup();
    h.engine.setExpanded(true);
    expect(h.state().expanded).toBe(true);
    expect(h.el().playCalls).toBe(0);
  });
});
