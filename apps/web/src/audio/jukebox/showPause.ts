/**
 * The show's hold on the jukebox (AUD-04 C, "jukebox for breaks only"): a show (DAS Survey Showdown's
 * Presenter Showcase, in an event room) pauses the jukebox while a question is live and gives it back
 * in the breaks — resuming ONLY what it paused itself.
 *
 *  - `hold(owner)` pauses the jukebox if it is playing (or means to: `wantPlaying`) on the listener's
 *    own player, and remembers that this owner paused it. A jukebox that's already paused or stopped
 *    is left alone, and so is one following the Room DJ (the room's music is the server's to lock).
 *  - `release(owner)` plays it again only if that owner's hold is still standing.
 *  - The listener always wins: pressing play (or picking a song) while the show holds the jukebox
 *    drops the hold, so a later pause of theirs is never undone by the show.
 *  - The hold survives a reload of the tab (sessionStorage), so a console that reloads mid-question
 *    still gets its music back at the next break; a hold from another room is dropped, never resumed.
 *
 * Additive: it only calls the engine's public play()/pause() and reads the store.
 */
import type { StoreApi } from 'zustand';
import type { JukeboxState } from './store.ts';

export const SHOW_PAUSE_STORAGE_KEY = 'dascade:jukebox:show-paused';

export interface ShowPausableJukebox {
  play(): void;
  pause(): void;
}

export interface ShowPauseDeps {
  jukebox: ShowPausableJukebox;
  store: Pick<StoreApi<Pick<JukeboxState, 'wantPlaying' | 'source'>>, 'getState' | 'subscribe'>;
  /** Per-tab storage for the hold (sessionStorage in the app); null = memory only. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface ShowPause {
  /** Pauses a playing jukebox for `owner` (a room code). True while `owner` holds it. */
  hold(owner: string): boolean;
  /** Gives the jukebox back: plays it again if `owner` paused it and nobody touched it since. True if it resumed. */
  release(owner: string): boolean;
  /** Forgets a hold without resuming (a hold left over from another room). */
  forget(): void;
  /** Who holds the jukebox paused right now ('' = nobody). */
  readonly owner: string;
  /** Called whenever the hold changes (for useSyncExternalStore). */
  subscribe(cb: () => void): () => void;
}

export function createShowPause(deps: ShowPauseDeps): ShowPause {
  const { jukebox, store, storage } = deps;
  const listeners = new Set<() => void>();
  let owner = read();
  let resuming = false;

  function read(): string {
    try {
      const v = storage?.getItem(SHOW_PAUSE_STORAGE_KEY);
      return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : '';
    } catch {
      return '';
    }
  }

  function set(next: string): void {
    if (next === owner) return;
    owner = next;
    try {
      if (next) storage?.setItem(SHOW_PAUSE_STORAGE_KEY, next);
      else storage?.removeItem(SHOW_PAUSE_STORAGE_KEY);
    } catch {
      /* storage unavailable: the hold lasts until the tab reloads */
    }
    for (const l of [...listeners]) l();
  }

  // The listener took over (play, a song, a record) while the show held it: the hold is theirs now.
  store.subscribe((s, prev) => {
    if (owner && !resuming && s.wantPlaying && !prev.wantPlaying) set('');
  });

  return {
    hold(who) {
      if (!who) return false;
      if (owner === who) return true;
      // Another room's leftover hold: drop it (that show is gone), then decide afresh.
      if (owner) set('');
      const s = store.getState();
      if (!s.wantPlaying || s.source !== 'personal') return false;
      set(who);
      jukebox.pause();
      return true;
    },
    release(who) {
      if (!who || owner !== who) {
        // A hold from another room is never resumed by this one.
        if (owner && who && owner !== who) set('');
        return false;
      }
      set('');
      if (store.getState().wantPlaying) return false;
      resuming = true;
      try {
        jukebox.play();
      } finally {
        resuming = false;
      }
      return true;
    },
    forget() {
      set('');
    },
    get owner() {
      return owner;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
