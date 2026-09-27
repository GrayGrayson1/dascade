import { describe, it, expect, beforeEach } from 'vitest';
import { DJ_MAX_QUEUE, DJ_MAX_QUEUE_PER_LISTENER, djPositionAt, skipVotesNeeded, type DjCommand } from '@dascade/shared/jukebox';
import { RoomDj } from './dj.ts';

let now = 1_000_000;
let seq = 0;
let dj: RoomDj;

const A = { trackId: 'track-a', duration: 100 };
const B = { trackId: 'track-b', duration: 60 };
const C = { trackId: 'track-c', duration: 30 };

function cmd(actor: string, c: DjCommand) {
  return dj.command(actor, c);
}
const pos = () => djPositionAt(dj.state(), now);
const tick = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now = 1_000_000;
  seq = 0;
  dj = new RoomDj({ now: () => now, newId: () => `e${++seq}` });
  dj.setHost('host');
  dj.setListeners(['host', 'p1', 'p2', 'p3']);
  expect(dj.configure('host', { enabled: true }).ok).toBe(true);
});

describe('skipVotesNeeded', () => {
  it('is a strict majority', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(skipVotesNeeded)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('RoomDj config', () => {
  it('only the host configures; version bumps on every change and not on no-ops', () => {
    const v = dj.state().version;
    expect(dj.configure('p1', { allowQueue: true })).toMatchObject({ ok: false, code: 'not_host' });
    expect(dj.state().version).toBe(v);
    expect(dj.configure('host', { allowQueue: true })).toEqual({ ok: true, changed: true });
    expect(dj.state().version).toBe(v + 1);
    expect(dj.configure('host', { allowQueue: true })).toEqual({ ok: true, changed: false });
    expect(dj.state().version).toBe(v + 1);
  });

  it('commands are refused while disabled; disabling freezes the position', () => {
    cmd('host', { op: 'play', track: A });
    tick(10_000);
    dj.configure('host', { enabled: false });
    expect(dj.state()).toMatchObject({ enabled: false, playing: false, position: 10 });
    expect(cmd('host', { op: 'resume' })).toMatchObject({ ok: false, code: 'disabled' });
    expect(dj.voteSkip('p1')).toMatchObject({ ok: false, code: 'disabled' });
    expect(dj.endsAt()).toBeNull();
    dj.configure('host', { enabled: true });
    expect(cmd('host', { op: 'resume' }).ok).toBe(true);
    tick(5000);
    expect(pos()).toBeCloseTo(15);
  });

  it('skipNeeded is 0 unless skip voting is on', () => {
    expect(dj.state().skipNeeded).toBe(0);
    dj.configure('host', { allowSkipVote: true });
    expect(dj.state().skipNeeded).toBe(3);
  });
});

describe('RoomDj playback', () => {
  it('play anchors at the server clock and position advances only while playing', () => {
    cmd('host', { op: 'play', track: A, position: 20 });
    const s = dj.state();
    expect(s).toMatchObject({ current: { trackId: 'track-a', duration: 100, addedBy: 'host' }, playing: true, position: 20, anchorServerTime: now });
    tick(5000);
    expect(pos()).toBeCloseTo(25);
    cmd('host', { op: 'pause' });
    tick(60_000);
    expect(pos()).toBeCloseTo(25);
    expect(cmd('host', { op: 'pause' })).toEqual({ ok: true, changed: false });
    cmd('host', { op: 'resume' });
    tick(1000);
    expect(pos()).toBeCloseTo(26);
  });

  it('seek re-anchors and clamps to the track', () => {
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'seek', position: 999 });
    expect(dj.state().position).toBe(100);
    cmd('host', { op: 'seek', position: 42 });
    expect(dj.state()).toMatchObject({ position: 42, anchorServerTime: now });
  });

  it('seek/resume with nothing loaded are rejected', () => {
    expect(cmd('host', { op: 'seek', position: 5 })).toMatchObject({ ok: false, code: 'nothing_playing' });
    expect(cmd('host', { op: 'resume' })).toMatchObject({ ok: false, code: 'nothing_playing' });
  });

  it('clamps durations and play positions', () => {
    cmd('host', { op: 'play', track: { trackId: 'x', duration: 1e9 }, position: 1e9 });
    expect(dj.state().current!.duration).toBe(20 * 60);
    expect(dj.state().position).toBe(20 * 60);
  });

  it('non-hosts cannot drive playback', () => {
    for (const c of [
      { op: 'play', track: A },
      { op: 'pause' },
      { op: 'resume' },
      { op: 'seek', position: 1 },
      { op: 'next' },
      { op: 'prev' },
      { op: 'clearQueue' },
    ] as DjCommand[]) {
      expect(cmd('p1', c)).toMatchObject({ ok: false, code: 'not_host' });
    }
  });

  it('endsAt reports the end of the current track; trackEnded auto-advances only at the real end', () => {
    cmd('host', { op: 'play', track: A, position: 90 });
    cmd('host', { op: 'enqueue', track: B });
    expect(dj.endsAt()).toBe(now + 10_000);
    tick(5000);
    expect(dj.trackEnded()).toBe(false); // stale / early timer
    tick(5000);
    expect(dj.trackEnded()).toBe(true);
    expect(dj.state()).toMatchObject({ current: { trackId: 'track-b' }, playing: true, position: 0, queue: [] });
    tick(60_000);
    expect(dj.trackEnded()).toBe(true);
    expect(dj.state()).toMatchObject({ current: null, playing: false });
    expect(dj.endsAt()).toBeNull();
    expect(dj.trackEnded()).toBe(false);
  });

  it('resume at the very end advances instead', () => {
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'enqueue', track: B });
    cmd('host', { op: 'seek', position: 100 });
    cmd('host', { op: 'pause' });
    cmd('host', { op: 'resume' });
    expect(dj.state().current!.trackId).toBe('track-b');
  });

  it('next goes through the queue then idles', () => {
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'enqueue', track: B });
    cmd('host', { op: 'next' });
    expect(dj.state().current!.trackId).toBe('track-b');
    cmd('host', { op: 'next' });
    expect(dj.state().current).toBeNull();
    expect(cmd('host', { op: 'next' })).toEqual({ ok: true, changed: false });
  });

  it('prev restarts after 3 s, otherwise goes back one track (current returns to the queue front)', () => {
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'play', track: B });
    tick(10_000);
    cmd('host', { op: 'prev' });
    expect(dj.state()).toMatchObject({ current: { trackId: 'track-b' }, position: 0 });
    tick(1000);
    cmd('host', { op: 'prev' });
    expect(dj.state().current!.trackId).toBe('track-a');
    expect(dj.state().queue.map((e) => e.trackId)).toEqual(['track-b']);
    tick(1000);
    // No more history: restart.
    cmd('host', { op: 'prev' });
    expect(dj.state()).toMatchObject({ current: { trackId: 'track-a' }, position: 0 });
  });

  it('prev from idle replays the last track', () => {
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'next' });
    expect(dj.state().current).toBeNull();
    cmd('host', { op: 'prev' });
    expect(dj.state()).toMatchObject({ current: { trackId: 'track-a' }, playing: true });
  });
});

describe('RoomDj queue', () => {
  it('enqueue while idle plays immediately; host "next" jumps the queue', () => {
    cmd('host', { op: 'enqueue', track: A });
    expect(dj.state()).toMatchObject({ current: { trackId: 'track-a' }, playing: true, queue: [] });
    cmd('host', { op: 'enqueue', track: B });
    cmd('host', { op: 'enqueue', track: C, next: true });
    expect(dj.state().queue.map((e) => e.trackId)).toEqual(['track-c', 'track-b']);
    expect(new Set(dj.state().queue.map((e) => e.entryId)).size).toBe(2);
  });

  it('listeners enqueue only when allowed, append-only, capped per listener', () => {
    cmd('host', { op: 'play', track: A });
    expect(cmd('p1', { op: 'enqueue', track: B })).toMatchObject({ ok: false, code: 'not_allowed' });
    dj.configure('host', { allowQueue: true });
    expect(cmd('stranger', { op: 'enqueue', track: B })).toMatchObject({ ok: false, code: 'not_allowed' });
    cmd('host', { op: 'enqueue', track: C });
    expect(cmd('p1', { op: 'enqueue', track: B, next: true }).ok).toBe(true);
    expect(dj.state().queue.map((e) => e.trackId)).toEqual(['track-c', 'track-b']);
    for (let i = 1; i < DJ_MAX_QUEUE_PER_LISTENER; i++) expect(cmd('p1', { op: 'enqueue', track: B }).ok).toBe(true);
    expect(cmd('p1', { op: 'enqueue', track: B })).toMatchObject({ ok: false, code: 'queue_full' });
  });

  it('caps the whole queue', () => {
    cmd('host', { op: 'play', track: A });
    for (let i = 0; i < DJ_MAX_QUEUE; i++) expect(cmd('host', { op: 'enqueue', track: B }).ok).toBe(true);
    expect(cmd('host', { op: 'enqueue', track: B })).toMatchObject({ ok: false, code: 'queue_full' });
    expect(dj.state().queue).toHaveLength(DJ_MAX_QUEUE);
  });

  it('dequeue: own entries or host; unknown ids rejected; clearQueue', () => {
    dj.configure('host', { allowQueue: true });
    cmd('host', { op: 'play', track: A });
    cmd('p1', { op: 'enqueue', track: B });
    cmd('p2', { op: 'enqueue', track: C });
    const [b, c] = dj.state().queue;
    expect(cmd('p1', { op: 'dequeue', entryId: c!.entryId })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(cmd('p1', { op: 'dequeue', entryId: b!.entryId }).ok).toBe(true);
    expect(cmd('p1', { op: 'dequeue', entryId: b!.entryId })).toMatchObject({ ok: false, code: 'not_found' });
    expect(cmd('host', { op: 'dequeue', entryId: c!.entryId }).ok).toBe(true);
    cmd('host', { op: 'enqueue', track: B });
    cmd('host', { op: 'clearQueue' });
    expect(dj.state().queue).toEqual([]);
  });
});

describe('RoomDj skip votes', () => {
  beforeEach(() => {
    dj.configure('host', { allowSkipVote: true });
    cmd('host', { op: 'play', track: A });
    cmd('host', { op: 'enqueue', track: B });
  });

  it('needs a strict majority of listeners; duplicates never count twice', () => {
    expect(dj.state().skipNeeded).toBe(3); // 4 listeners
    expect(dj.voteSkip('p1').ok).toBe(true);
    expect(dj.voteSkip('p1')).toMatchObject({ ok: false, code: 'duplicate' });
    expect(dj.voteSkip('p2').ok).toBe(true);
    expect(dj.state()).toMatchObject({ skipVotes: 2, skipVoters: ['p1', 'p2'], current: { trackId: 'track-a' } });
    expect(dj.voteSkip('p3').ok).toBe(true);
    expect(dj.state()).toMatchObject({ skipVotes: 0, skipVoters: [], current: { trackId: 'track-b' } });
  });

  it('host vote skips immediately; strangers cannot vote; votes reset per track', () => {
    expect(dj.voteSkip('stranger')).toMatchObject({ ok: false, code: 'not_allowed' });
    dj.voteSkip('p1');
    cmd('host', { op: 'play', track: C });
    expect(dj.state().skipVotes).toBe(0);
    dj.voteSkip('host');
    expect(dj.state().current!.trackId).toBe('track-b');
  });

  it('a leaving voter loses their vote; a shrinking room can tip the vote', () => {
    dj.voteSkip('p1');
    dj.voteSkip('p2');
    dj.setListeners(['host', 'p2', 'p3']); // p1 left: 1 vote of 2 needed
    expect(dj.state()).toMatchObject({ skipVotes: 1, skipNeeded: 2, current: { trackId: 'track-a' } });
    dj.setListeners(['host', 'p2']); // 1 vote, 2 needed still
    expect(dj.state().current!.trackId).toBe('track-a');
    dj.setListeners(['p2']); // 1 of 1 → skip
    expect(dj.state().current!.trackId).toBe('track-b');
  });

  it('vote skip is refused when turned off or nothing plays', () => {
    dj.configure('host', { allowSkipVote: false });
    expect(dj.voteSkip('p1')).toMatchObject({ ok: false, code: 'not_allowed' });
    cmd('host', { op: 'next' });
    cmd('host', { op: 'next' });
    expect(dj.voteSkip('p1')).toMatchObject({ ok: false, code: 'nothing_playing' });
  });
});

describe('RoomDj host authority', () => {
  it('follows the host and keeps the playback state', () => {
    cmd('host', { op: 'play', track: A, position: 30 });
    const before = dj.state();
    expect(dj.setHost('p1')).toBe(true);
    expect(dj.setHost('p1')).toBe(false);
    const after = dj.state();
    expect(after).toMatchObject({ djId: 'p1', current: before.current, position: 30, anchorServerTime: before.anchorServerTime });
    expect(after.version).toBe(before.version + 1);
    expect(cmd('host', { op: 'pause' })).toMatchObject({ ok: false, code: 'not_host' });
    expect(cmd('p1', { op: 'pause' }).ok).toBe(true);
  });

  it('snapshots are copies', () => {
    cmd('host', { op: 'play', track: A });
    const s = dj.state();
    s.current!.trackId = 'hacked';
    s.queue.push({ entryId: 'x', trackId: 'x', duration: 1, addedBy: 'x' });
    expect(dj.state().current!.trackId).toBe('track-a');
    expect(dj.state().queue).toEqual([]);
  });
});
