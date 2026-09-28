/**
 * Jukebox store (zustand). Lives at module scope — outside any React tree — so playback state
 * survives every route change. The UI reads it with `useJukebox(selector)`; only the engine
 * (engine.ts) writes to it. The binding shape is `JukeboxState` below; README.md "Jukebox and audio"
 * describes the behaviour.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { DjState, JukeboxTrack } from '@dascade/shared/jukebox';

export type { DjConfig, DjState, JukeboxTrack } from '@dascade/shared/jukebox';

export type RepeatMode = 'off' | 'all' | 'one';
export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface JukeboxState {
  library: { status: LibraryStatus; tracks: JukeboxTrack[] };
  currentId: string | null;
  /** The element is actually playing (audible unless muted). */
  playing: boolean;
  /** User intent (persisted). */
  wantPlaying: boolean;
  /** Autoplay is blocked → the UI shows "Click to enable audio" (not an error). */
  needsGesture: boolean;
  /** Seconds (UI-rate updates, ≤ 4/s; use `jukebox.currentTime()` for 60 fps progress). */
  position: number;
  duration: number;
  buffering: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Personal "up next" track ids. */
  queue: string[];
  /** Full player open. */
  expanded: boolean;
  /** Local jukebox mute (independent of the master mute). */
  jukeboxMuted: boolean;
  /** 'room' = following the Room DJ right now. */
  source: 'personal' | 'room';
  /** User opted out of room music (personal playback continues). */
  roomOptOut: boolean;
  /** Latest room DJ state (null outside rooms). */
  room: DjState | null;
  /** e.g. a track failed to load (the engine auto-skips). Cleared on the next successful play. */
  error: string | null;
}

export const INITIAL_JUKEBOX_STATE: JukeboxState = {
  library: { status: 'idle', tracks: [] },
  currentId: null,
  playing: false,
  wantPlaying: false,
  needsGesture: false,
  position: 0,
  duration: 0,
  buffering: false,
  shuffle: false,
  repeat: 'all',
  queue: [],
  expanded: false,
  jukeboxMuted: false,
  source: 'personal',
  roomOptOut: false,
  room: null,
  error: null,
};

/**
 * Whether the transport's play/pause button shows "playing" (pause icon). Following the Room DJ,
 * that's the ROOM's playback combined with the local intent: a paused room reads as paused even
 * though the listener still intends to listen.
 */
export function showsPlaying(s: Pick<JukeboxState, 'source' | 'wantPlaying' | 'room'>): boolean {
  if (s.source === 'room') return s.wantPlaying && Boolean(s.room?.playing && s.room.current);
  return s.wantPlaying;
}

export function createJukeboxStore(): UseBoundStore<StoreApi<JukeboxState>> {
  return create<JukeboxState>(() => ({ ...INITIAL_JUKEBOX_STATE, library: { status: 'idle', tracks: [] }, queue: [] }));
}

/** The app-wide jukebox store (one per page, ever). */
export const useJukebox: UseBoundStore<StoreApi<JukeboxState>> = createJukeboxStore();
