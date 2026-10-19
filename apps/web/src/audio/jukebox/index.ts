/** Public jukebox API (contract §3). UI code imports from here. */
export { jukebox, installJukebox } from './engine.ts';
export {
  useJukebox,
  showsPlaying,
  INITIAL_JUKEBOX_STATE,
  type JukeboxState,
  type RepeatMode,
  type LibraryStatus,
  type DjConfig,
  type DjState,
  type JukeboxRecord,
  type JukeboxTrack,
} from './store.ts';
export type { DjPermissions, JukeboxEngine } from './core.ts';
export { ALL_RECORDS, MAIN_RECORD_ID, hasShelf, scopeTracks, trackRecord } from './records.ts';
export { visualizerEnabled } from '../mixPolicy.ts';
