/**
 * Room DJ — pure, deterministic synchronized-playback state for one room.
 *
 * The server never streams audio: it keeps WHICH track plays, whether it plays, and a position
 * anchor (`position` seconds at `anchorServerTime` ms). Every client streams the static MP3 itself
 * and derives the live position with `djPositionAt(state, serverNow)`.
 *
 * This class knows nothing about Colyseus. BaseGameRoom feeds it the current host, the eligible
 * listeners and commands, broadcasts `state()` whenever a call reports a change, and drives the
 * end-of-track timer from `endsAt()`. The clock and entry-id source are injected (unit tests).
 *
 * Permissions (the room resolves the actor; payloads never carry ids):
 *  - host: everything (config, play/pause/resume/seek/next/prev/clearQueue, enqueue [next], dequeue any);
 *    a host skip vote skips immediately.
 *  - listeners (connected, seated players): enqueue when `allowQueue` (append only, ≤ DJ_MAX_QUEUE_PER_LISTENER
 *    pending each), dequeue their own entries, vote to skip when `allowSkipVote`.
 *  - everyone else (spectators, strangers): read-only.
 */
import {
  DJ_MAX_QUEUE,
  DJ_MAX_QUEUE_PER_LISTENER,
  DJ_MAX_TRACK_SECONDS,
  DJ_PREV_RESTART_SECONDS,
  EMPTY_DJ_STATE,
  djPositionAt,
  skipVotesNeeded,
  type DjCommand,
  type DjConfig,
  type DjQueueEntry,
  type DjState,
} from '@dascade/shared/jukebox';

export interface DjDeps {
  /** Server epoch ms (the clock clients sync `serverNow()` against). */
  now: () => number;
  /** Unique short id for queue entries (≤ 32 chars). */
  newId: () => string;
}

export type DjRejectCode = 'disabled' | 'not_host' | 'not_allowed' | 'nothing_playing' | 'queue_full' | 'not_found' | 'duplicate';

export type DjResult = { ok: true; changed: boolean } | { ok: false; code: DjRejectCode; message: string };

interface Track {
  trackId: string;
  duration: number;
  addedBy: string;
}

/** Tracks remembered for `prev`. */
const HISTORY_LIMIT = 20;
/** A timer firing this close to the end counts as the end (timer jitter). */
const END_TOLERANCE_S = 0.25;

const OK_CHANGED: DjResult = { ok: true, changed: true };
const OK_SAME: DjResult = { ok: true, changed: false };
const fail = (code: DjRejectCode, message: string): DjResult => ({ ok: false, code, message });

function clampDuration(d: number): number {
  return Number.isFinite(d) ? Math.min(DJ_MAX_TRACK_SECONDS, Math.max(1, d)) : 1;
}

function clampPosition(p: number | undefined, duration: number): number {
  return Number.isFinite(p) ? Math.min(duration, Math.max(0, p ?? 0)) : 0;
}

export class RoomDj {
  private enabled = false;
  private allowQueue = false;
  private allowSkipVote = false;
  private version = 0;
  private current: Track | null = null;
  private playing = false;
  private position = 0;
  private anchor = 0;
  private queue: DjQueueEntry[] = [];
  private history: Track[] = [];
  private votes = new Set<string>();
  private listeners = new Set<string>();
  private hostId = '';

  constructor(private readonly deps: DjDeps) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** A fresh, JSON-safe snapshot (safe to broadcast). */
  state(): DjState {
    return {
      ...EMPTY_DJ_STATE,
      enabled: this.enabled,
      allowQueue: this.allowQueue,
      allowSkipVote: this.allowSkipVote,
      version: this.version,
      current: this.current ? { ...this.current } : null,
      playing: this.playing,
      position: this.position,
      anchorServerTime: this.anchor,
      queue: this.queue.map((e) => ({ ...e })),
      skipVotes: this.votes.size,
      skipVoters: [...this.votes],
      skipNeeded: this.skipNeeded(),
      djId: this.hostId,
    };
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Server ms when the current track ends, or null when nothing is playing (the room schedules auto-advance). */
  endsAt(): number | null {
    if (!this.enabled || !this.current || !this.playing) return null;
    return this.anchor + Math.max(0, this.current.duration - this.position) * 1000;
  }

  private positionNow(): number {
    return djPositionAt({ current: this.current, playing: this.playing, position: this.position, anchorServerTime: this.anchor }, this.deps.now());
  }

  private skipNeeded(): number {
    return this.enabled && this.allowSkipVote ? skipVotesNeeded(this.listeners.size) : 0;
  }

  // ---------------------------------------------------------------------------
  // Room membership
  // ---------------------------------------------------------------------------

  /** The room host changed (DJ authority follows the host; the playback state is kept). */
  setHost(id: string): boolean {
    if (id === this.hostId) return false;
    this.hostId = id;
    this.bump();
    return true;
  }

  /**
   * The eligible skip-vote listeners changed (connected, seated, human players). Votes of anyone who
   * left are dropped; if the remaining votes now reach the threshold, the track skips.
   */
  setListeners(ids: Iterable<string>): boolean {
    const next = new Set(ids);
    const same = next.size === this.listeners.size && [...next].every((id) => this.listeners.has(id));
    if (same) return false;
    const neededBefore = this.skipNeeded();
    const votesBefore = this.votes.size;
    this.listeners = next;
    for (const v of [...this.votes]) if (!next.has(v)) this.votes.delete(v);
    if (this.maybeSkipByVote()) return true;
    // Only a visible change (threshold or tally) is a new state version.
    if (this.skipNeeded() === neededBefore && this.votes.size === votesBefore) return false;
    this.bump();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Host config
  // ---------------------------------------------------------------------------

  configure(actorId: string, config: DjConfig): DjResult {
    if (actorId !== this.hostId) return fail('not_host', 'Only the host controls the Room DJ.');
    let changed = false;
    if (config.enabled !== undefined && config.enabled !== this.enabled) {
      this.enabled = config.enabled;
      changed = true;
      if (!this.enabled) {
        // Freeze where it was; turning DJ back on resumes paused at the same spot.
        this.position = this.positionNow();
        this.anchor = this.deps.now();
        this.playing = false;
        this.votes.clear();
      }
    }
    if (config.allowQueue !== undefined && config.allowQueue !== this.allowQueue) {
      this.allowQueue = config.allowQueue;
      changed = true;
    }
    if (config.allowSkipVote !== undefined && config.allowSkipVote !== this.allowSkipVote) {
      this.allowSkipVote = config.allowSkipVote;
      if (!this.allowSkipVote) this.votes.clear();
      changed = true;
    }
    if (!changed) return OK_SAME;
    this.bump();
    return OK_CHANGED;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  command(actorId: string, cmd: DjCommand): DjResult {
    if (!this.enabled) return fail('disabled', 'The Room DJ is off.');
    const isHost = actorId === this.hostId;
    switch (cmd.op) {
      case 'enqueue':
        return this.enqueue(actorId, isHost, cmd.track.trackId, cmd.track.duration, Boolean(cmd.next));
      case 'dequeue': {
        const i = this.queue.findIndex((e) => e.entryId === cmd.entryId);
        if (i < 0) return fail('not_found', 'That song is no longer in the queue.');
        if (!isHost && this.queue[i]!.addedBy !== actorId) return fail('not_allowed', 'You can only remove songs you added.');
        this.queue.splice(i, 1);
        this.bump();
        return OK_CHANGED;
      }
      default:
        break;
    }
    if (!isHost) return fail('not_host', 'Only the host controls Room DJ playback.');
    const now = this.deps.now();
    switch (cmd.op) {
      case 'play': {
        const duration = clampDuration(cmd.track.duration);
        this.startTrack({ trackId: cmd.track.trackId, duration, addedBy: actorId }, clampPosition(cmd.position, duration), true);
        return OK_CHANGED;
      }
      case 'pause':
        if (!this.current || !this.playing) return OK_SAME;
        this.position = this.positionNow();
        this.anchor = now;
        this.playing = false;
        this.bump();
        return OK_CHANGED;
      case 'resume':
        if (!this.current) return fail('nothing_playing', 'Nothing is queued to play.');
        if (this.playing) return OK_SAME;
        if (this.position >= this.current.duration - END_TOLERANCE_S) {
          this.advance();
          return OK_CHANGED;
        }
        this.anchor = now;
        this.playing = true;
        this.bump();
        return OK_CHANGED;
      case 'seek':
        if (!this.current) return fail('nothing_playing', 'Nothing is playing.');
        this.position = clampPosition(cmd.position, this.current.duration);
        this.anchor = now;
        this.bump();
        return OK_CHANGED;
      case 'next':
        if (!this.current && this.queue.length === 0) return OK_SAME;
        this.advance();
        return OK_CHANGED;
      case 'prev':
        return this.prev();
      case 'clearQueue':
        if (this.queue.length === 0) return OK_SAME;
        this.queue = [];
        this.bump();
        return OK_CHANGED;
      default:
        return OK_SAME;
    }
  }

  /** A listener votes to skip the current track (host vote = immediate skip). */
  voteSkip(actorId: string): DjResult {
    if (!this.enabled) return fail('disabled', 'The Room DJ is off.');
    if (!this.current) return fail('nothing_playing', 'Nothing is playing.');
    if (actorId === this.hostId) {
      this.advance();
      return OK_CHANGED;
    }
    if (!this.allowSkipVote) return fail('not_allowed', 'Skip voting is off in this room.');
    if (!this.listeners.has(actorId)) return fail('not_allowed', 'Only players in the room can vote to skip.');
    if (this.votes.has(actorId)) return fail('duplicate', 'You already voted to skip this song.');
    this.votes.add(actorId);
    if (!this.maybeSkipByVote()) this.bump();
    return OK_CHANGED;
  }

  /**
   * The room's end-of-track timer fired. Advances only if the current track really ended (a stale
   * timer after a seek/pause does nothing). Returns true when the state changed.
   */
  trackEnded(): boolean {
    if (!this.enabled || !this.current || !this.playing) return false;
    if (this.positionNow() < this.current.duration - END_TOLERANCE_S) return false;
    this.advance();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private enqueue(actorId: string, isHost: boolean, trackId: string, rawDuration: number, next: boolean): DjResult {
    if (!isHost) {
      if (!this.allowQueue) return fail('not_allowed', 'Only the host can add songs right now.');
      if (!this.listeners.has(actorId)) return fail('not_allowed', 'Only players in the room can add songs.');
      if (this.queue.filter((e) => e.addedBy === actorId).length >= DJ_MAX_QUEUE_PER_LISTENER) {
        return fail('queue_full', `You can have ${DJ_MAX_QUEUE_PER_LISTENER} songs in the queue at a time.`);
      }
    }
    const duration = clampDuration(rawDuration);
    // Idle jukebox: the song plays straight away.
    if (!this.current) {
      this.startTrack({ trackId, duration, addedBy: actorId }, 0, true);
      return OK_CHANGED;
    }
    if (this.queue.length >= DJ_MAX_QUEUE) return fail('queue_full', 'The queue is full.');
    const entry: DjQueueEntry = { entryId: this.deps.newId().slice(0, 32), trackId, duration, addedBy: actorId };
    if (next && isHost) this.queue.unshift(entry);
    else this.queue.push(entry);
    this.bump();
    return OK_CHANGED;
  }

  private prev(): DjResult {
    if (!this.current) {
      const last = this.history.pop();
      if (!last) return OK_SAME;
      this.setCurrent(last, 0, true);
      return OK_CHANGED;
    }
    if (this.positionNow() > DJ_PREV_RESTART_SECONDS || this.history.length === 0) {
      this.position = 0;
      this.anchor = this.deps.now();
      this.bump();
      return OK_CHANGED;
    }
    const back = this.history.pop()!;
    // The track we leave goes back to the front of the queue, so `next` returns to it.
    if (this.queue.length < DJ_MAX_QUEUE) {
      this.queue.unshift({ entryId: this.deps.newId().slice(0, 32), ...this.current });
    }
    this.setCurrent(back, 0, this.playing);
    return OK_CHANGED;
  }

  /** Start a new track now, remembering the one it replaces for `prev`. */
  private startTrack(track: Track, position: number, playing: boolean): void {
    if (this.current) this.remember(this.current);
    this.setCurrent(track, position, playing);
  }

  /** Current track ended or was skipped: play the next queue entry, or go idle. */
  private advance(): void {
    const next = this.queue.shift();
    if (this.current) this.remember(this.current);
    if (next) this.setCurrent({ trackId: next.trackId, duration: next.duration, addedBy: next.addedBy }, 0, true);
    else this.setCurrent(null, 0, false);
  }

  private setCurrent(track: Track | null, position: number, playing: boolean): void {
    this.current = track;
    this.position = track ? position : 0;
    this.playing = Boolean(track) && playing;
    this.anchor = this.deps.now();
    this.votes.clear();
    this.bump();
  }

  private remember(track: Track): void {
    this.history.push({ ...track });
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
  }

  /** Skip when the votes reach a strict majority. Returns true if it skipped (state already bumped). */
  private maybeSkipByVote(): boolean {
    if (!this.enabled || !this.allowSkipVote || !this.current || this.votes.size === 0) return false;
    if (this.votes.size < this.skipNeeded()) return false;
    this.advance();
    return true;
  }

  private bump(): void {
    this.version = (this.version + 1) >>> 0;
  }
}
