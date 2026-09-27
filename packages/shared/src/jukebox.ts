/**
 * DASCADE Jukebox contracts (isomorphic).
 *
 *  - The music MANIFEST: generated at dev/build time from the MP3s in apps/web/public/audio/jukebox/
 *    and served as /audio/jukebox/manifest.json. Clients fetch it; nothing is bundled into JS.
 *  - ROOM DJ: an optional per-room synchronized playback mode. The server synchronizes playback
 *    STATE (track id, playing, position anchor, queue) — never audio bytes. Every client streams
 *    the same static file itself; local mute/volume/opt-out always win on the client.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Stable track id: lowercase slug of the file name (+ short hash suffix only on collisions). */
export const TRACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const TrackIdSchema = z.string().regex(TRACK_ID_RE);

export const JukeboxTrackSchema = z.object({
  id: TrackIdSchema,
  /** URL-encoded, same-origin path, e.g. "/audio/jukebox/Neon%20Cruising.mp3". */
  src: z.string().min(1).max(512).startsWith('/audio/jukebox/'),
  /** Original file name (relative to the jukebox folder). */
  file: z.string().min(1).max(255),
  title: z.string().min(1).max(160),
  artist: z.string().max(160).optional(),
  album: z.string().max(160).optional(),
  trackNo: z.number().int().min(0).max(9999).optional(),
  /** Seconds; 0 when it couldn't be determined (the player learns it on load). */
  duration: z.number().min(0).max(24 * 3600),
  /** Same-origin URL of cover art (embedded art or sidecar cover), if any. */
  artwork: z.string().max(512).optional(),
  /** Display order (sidecar `order`, then track number, then title). */
  order: z.number().int(),
  /** Bytes, for reporting/deploy sizing. */
  bytes: z.number().int().min(0).optional(),
});
export type JukeboxTrack = z.infer<typeof JukeboxTrackSchema>;

export const JukeboxManifestSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  tracks: z.array(JukeboxTrackSchema).max(2000),
});
export type JukeboxManifest = z.infer<typeof JukeboxManifestSchema>;

export const JUKEBOX_MANIFEST_URL = '/audio/jukebox/manifest.json';

/**
 * Optional sidecar `jukebox.json` in the music folder. Every field optional; an MP3 alone works.
 *   { "tracks": { "Neon Cruising.mp3": { "title": "…", "artist": "…", "order": 1, "cover": "covers/neon.jpg" } } }
 */
export const JukeboxSidecarSchema = z.object({
  defaults: z.object({ artist: z.string().max(160).optional(), album: z.string().max(160).optional() }).optional(),
  tracks: z
    .record(
      z.string().max(255),
      z.object({
        title: z.string().min(1).max(160).optional(),
        artist: z.string().max(160).optional(),
        album: z.string().max(160).optional(),
        order: z.number().int().optional(),
        cover: z.string().max(255).optional(),
        hidden: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type JukeboxSidecar = z.infer<typeof JukeboxSidecarSchema>;

// ---------------------------------------------------------------------------
// Room DJ protocol
// ---------------------------------------------------------------------------

export const DJ = {
  /** client → server (host): enable/disable + permissions. */
  config: 'dj:config',
  /** client → server: playback command (see DjCommandSchema for who may send what). */
  command: 'dj:command',
  /** client → server: vote to skip the current track (when allowSkipVote). */
  skipVote: 'dj:skipVote',
  /** server → client: full DJ state (on change, on join/reconnect). */
  state: 'dj:state',
} as const;

/** Durations are client-reported (the manifest is static); the server clamps them. */
export const DJ_MAX_TRACK_SECONDS = 20 * 60;
export const DJ_MAX_QUEUE = 50;
/** Shared-queue entries one non-host listener may have pending at once (the host is unlimited up to DJ_MAX_QUEUE). */
export const DJ_MAX_QUEUE_PER_LISTENER = 5;
/** `prev` restarts the current track when it is further in than this; otherwise it goes back one track. */
export const DJ_PREV_RESTART_SECONDS = 3;

export const DjConfigSchema = z.object({
  enabled: z.boolean().optional(),
  /** Everyone (not only the host) may add tracks to the shared queue. */
  allowQueue: z.boolean().optional(),
  /** Everyone may vote to skip; a strict majority of connected listeners skips. */
  allowSkipVote: z.boolean().optional(),
});
export type DjConfig = z.infer<typeof DjConfigSchema>;

const Seconds = z.number().finite().min(0).max(DJ_MAX_TRACK_SECONDS);
const DjTrackRef = z.object({ trackId: TrackIdSchema, duration: Seconds.min(1) });

export const DjCommandSchema = z.discriminatedUnion('op', [
  /** host: play a track now (optionally from a position). */
  z.object({ op: z.literal('play'), track: DjTrackRef, position: Seconds.optional() }),
  /** host */
  z.object({ op: z.literal('pause') }),
  z.object({ op: z.literal('resume') }),
  z.object({ op: z.literal('seek'), position: Seconds }),
  z.object({ op: z.literal('next') }),
  z.object({ op: z.literal('prev') }),
  z.object({ op: z.literal('clearQueue') }),
  /** host, or any seated listener when allowQueue (`next` = jump the queue: host only, ignored for others).
   *  Enqueuing while the DJ is idle starts that track immediately. */
  z.object({ op: z.literal('enqueue'), track: DjTrackRef, next: z.boolean().optional() }),
  /** host, or the player who queued the entry */
  z.object({ op: z.literal('dequeue'), entryId: z.string().min(1).max(32) }),
]);
export type DjCommand = z.infer<typeof DjCommandSchema>;

export interface DjQueueEntry {
  entryId: string;
  trackId: string;
  duration: number;
  /** Room player id of whoever queued it. */
  addedBy: string;
}

export interface DjState {
  enabled: boolean;
  allowQueue: boolean;
  allowSkipVote: boolean;
  /** Increments on every change; clients ignore older states. */
  version: number;
  /** Current track or null (idle). */
  current: { trackId: string; duration: number; addedBy: string } | null;
  playing: boolean;
  /** Track position (seconds) at `anchorServerTime`. */
  position: number;
  /** Server epoch ms when `position` was true. Position now = position + (serverNow − anchor)/1000 while playing. */
  anchorServerTime: number;
  queue: DjQueueEntry[];
  skipVotes: number;
  /** Player ids who voted to skip the current track (public; lets a client show "you voted"). */
  skipVoters: string[];
  /** Votes needed to skip (strict majority of connected, non-bot listeners); 0 when vote skip is off. */
  skipNeeded: number;
  /** Player id with DJ authority (always the current room host). */
  djId: string;
}

export const EMPTY_DJ_STATE: DjState = {
  enabled: false,
  allowQueue: false,
  allowSkipVote: false,
  version: 0,
  current: null,
  playing: false,
  position: 0,
  anchorServerTime: 0,
  queue: [],
  skipVotes: 0,
  skipVoters: [],
  skipNeeded: 0,
  djId: '',
};

/** Position of a DJ state at `serverNow` (ms), clamped to the track. */
export function djPositionAt(state: Pick<DjState, 'current' | 'playing' | 'position' | 'anchorServerTime'>, serverNow: number): number {
  if (!state.current) return 0;
  const p = state.playing ? state.position + Math.max(0, serverNow - state.anchorServerTime) / 1000 : state.position;
  return Math.max(0, Math.min(state.current.duration, p));
}

/** Strict majority of `listeners` (0 listeners → 1). */
export function skipVotesNeeded(listeners: number): number {
  return Math.floor(Math.max(0, listeners) / 2) + 1;
}
