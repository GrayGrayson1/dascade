import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../testFakes.ts';
import { createShowPause, SHOW_PAUSE_STORAGE_KEY } from './showPause.ts';
import { setup } from './testHarness.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The real jukebox engine (test harness) with a show's hold on it. */
async function rig(storage = new MemoryStorage()) {
  const h = await setup();
  const show = createShowPause({ jukebox: h.engine, store: h.store, storage });
  return { ...h, show, tabStorage: storage };
}

describe('the show holds the jukebox (AUD-04: breaks only)', () => {
  it('pauses a playing jukebox while a question is live and plays it again in the break', async () => {
    const r = await rig();
    r.engine.play('b');
    expect(r.state().playing).toBe(true);
    expect(r.show.hold('ROOM1')).toBe(true);
    expect(r.state()).toMatchObject({ playing: false, wantPlaying: false });
    expect(r.show.owner).toBe('ROOM1');
    expect(r.show.release('ROOM1')).toBe(true);
    expect(r.state()).toMatchObject({ playing: true, wantPlaying: true, currentId: 'b' });
    expect(r.show.owner).toBe('');
  });

  it('never starts a jukebox that was paused or stopped before the question went live', async () => {
    const r = await rig();
    // Never played.
    expect(r.show.hold('ROOM1')).toBe(false);
    expect(r.show.release('ROOM1')).toBe(false);
    expect(r.state().wantPlaying).toBe(false);
    // Played, then paused on purpose.
    r.engine.play('a');
    r.engine.pause();
    expect(r.show.hold('ROOM1')).toBe(false);
    expect(r.show.release('ROOM1')).toBe(false);
    expect(r.state()).toMatchObject({ playing: false, wantPlaying: false });
  });

  it('the listener wins: play during the question drops the hold, so their later pause stays a pause', async () => {
    const r = await rig();
    r.engine.play('a');
    r.show.hold('ROOM1');
    r.engine.play();
    expect(r.show.owner).toBe('');
    r.engine.pause();
    expect(r.show.release('ROOM1')).toBe(false);
    expect(r.state()).toMatchObject({ playing: false, wantPlaying: false });
  });

  it('picking a song (or toggling) while held is the listener taking over too', async () => {
    const r = await rig();
    r.engine.play('a');
    r.show.hold('ROOM1');
    r.engine.play('c');
    expect(r.show.owner).toBe('');
    expect(r.show.release('ROOM1')).toBe(false);
    expect(r.state().currentId).toBe('c');

    r.show.hold('ROOM1');
    r.engine.toggle();
    expect(r.show.owner).toBe('');
  });

  it('holding twice is one hold; releasing twice resumes once', async () => {
    const r = await rig();
    r.engine.play('a');
    const pause = vi.spyOn(r.engine, 'pause');
    const play = vi.spyOn(r.engine, 'play');
    expect(r.show.hold('ROOM1')).toBe(true);
    expect(r.show.hold('ROOM1')).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(r.show.release('ROOM1')).toBe(true);
    expect(r.show.release('ROOM1')).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('leaves a jukebox that follows the Room DJ alone (the room’s music is the server’s to lock)', async () => {
    const r = await rig();
    r.engine.play('a');
    r.store.setState({ source: 'room' });
    const pause = vi.spyOn(r.engine, 'pause');
    expect(r.show.hold('ROOM1')).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });

  it('survives a reload of the tab: the next break still gives the music back', async () => {
    const storage = new MemoryStorage();
    const first = await rig(storage);
    first.engine.play('b');
    first.show.hold('ROOM1');
    expect(storage.getItem(SHOW_PAUSE_STORAGE_KEY)).toBe('ROOM1');
    // The reloaded tab: a fresh engine (restored paused) and a fresh hold read from the tab's storage.
    const again = await rig(storage);
    expect(again.show.owner).toBe('ROOM1');
    expect(again.show.release('ROOM1')).toBe(true);
    expect(again.state().wantPlaying).toBe(true);
    expect(storage.getItem(SHOW_PAUSE_STORAGE_KEY)).toBeNull();
  });

  it('a hold left over from another room is dropped, never resumed', async () => {
    const r = await rig();
    r.engine.play('a');
    r.show.hold('OLD01');
    expect(r.show.release('NEW02')).toBe(false);
    expect(r.show.owner).toBe('');
    expect(r.state().wantPlaying).toBe(false);
    // And a new room's question decides afresh (the jukebox is paused now: nothing to hold).
    expect(r.show.hold('NEW02')).toBe(false);
  });

  it('tells subscribers when the hold changes, and shrugs off broken storage', async () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const h = await setup();
    const show = createShowPause({ jukebox: h.engine, store: h.store, storage: broken });
    const seen: string[] = [];
    show.subscribe(() => seen.push(show.owner));
    h.engine.play('a');
    expect(show.hold('ROOM1')).toBe(true);
    expect(show.release('ROOM1')).toBe(true);
    expect(seen).toEqual(['ROOM1', '']);
    // A hostile stored value is ignored.
    const odd = new MemoryStorage();
    odd.setItem(SHOW_PAUSE_STORAGE_KEY, 'x'.repeat(500));
    expect(createShowPause({ jukebox: h.engine, store: h.store, storage: odd }).owner).toBe('');
  });
});
