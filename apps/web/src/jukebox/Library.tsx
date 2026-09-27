/** Library tab: search, sort, click to play, "play next", "add to queue". */
import { useDeferredValue, useId, useMemo, useState } from 'react';
import type { JukeboxTrack } from '@dascade/shared';
import { jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { Art } from './Art.tsx';
import { formatTime, sortTracks, type LibrarySort } from './format.ts';
import { Glyph } from './icons.tsx';

export interface LibraryActions {
  /** Main row action. */
  play: (id: string) => void;
  playLabel: (t: JukeboxTrack) => string;
  playNext?: (id: string) => void;
  queue?: (id: string) => void;
  /** Id shown as "now playing" (personal or room track). */
  currentId: string | null;
}

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'order', label: 'Jukebox order' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'duration', label: 'Length' },
];

let rememberedSort: LibrarySort = 'order';

export function Library({ actions, compact }: { actions: LibraryActions; compact?: boolean }) {
  const status = useJukebox((s) => s.library.status);
  const tracks = useJukebox((s) => s.library.tracks);
  const playing = useJukebox((s) => s.playing);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<LibrarySort>(rememberedSort);
  const deferred = useDeferredValue(query);
  const list = useMemo(() => sortTracks(tracks, sort, deferred), [tracks, sort, deferred]);
  const searchId = useId();
  const sortId = useId();
  const setSort = (s: LibrarySort) => {
    rememberedSort = s;
    setSortState(s);
  };

  return (
    <div className="jb-library" data-part="library" data-compact={compact ? 'true' : undefined}>
      <div className="jb-library__tools">
        <label className="jb-search" htmlFor={searchId}>
          <Glyph name="search" size={14} />
          <span className="visually-hidden">Search tracks</span>
          <input
            id={searchId}
            data-part="search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search tracks"
            value={query}
            maxLength={80}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
        </label>
        <label className="jb-sort" htmlFor={sortId}>
          <span className="visually-hidden">Sort by</span>
          <select id={sortId} data-part="sort" value={sort} onChange={(e) => setSort(e.currentTarget.value as LibrarySort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {status === 'loading' || status === 'idle' ? (
        <p className="jb-empty" role="status">
          Loading the jukebox…
        </p>
      ) : status === 'error' ? (
        <div className="jb-empty" role="status">
          <p>The track list didn’t load.</p>
          <button type="button" className="jb-btn jb-btn--text" onClick={() => jukebox.reloadLibrary()}>
            Try again
          </button>
        </div>
      ) : tracks.length === 0 ? (
        <p className="jb-empty">The jukebox is empty — no tracks have been installed yet.</p>
      ) : list.length === 0 ? (
        <p className="jb-empty" role="status">
          No tracks match “{deferred}”.
        </p>
      ) : (
        <ul className="jb-tracks" data-part="track-list" aria-label={`${list.length} track${list.length === 1 ? '' : 's'}`}>
          {list.map((t) => {
            const current = t.id === actions.currentId;
            return (
              <li
                key={t.id}
                className="jb-track"
                data-part="track"
                data-current={current ? 'true' : undefined}
                data-playing={current && playing ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="jb-track__main"
                  onClick={() => actions.play(t.id)}
                  aria-label={actions.playLabel(t)}
                  aria-current={current ? 'true' : undefined}
                >
                  <Art track={t} size="sm" />
                  <span className="jb-track__text">
                    <span className="jb-track__title">{t.title}</span>
                    {t.artist ? <span className="jb-track__artist">{t.artist}</span> : null}
                  </span>
                  {current ? (
                    <span className="jb-eq jb-eq--row" data-active={playing ? 'true' : undefined} aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}
                  <span className="jb-track__dur">{t.duration > 0 ? formatTime(t.duration) : '—'}</span>
                </button>
                {actions.playNext ? (
                  <button
                    type="button"
                    className="jb-btn jb-btn--icon jb-btn--row"
                    onClick={() => actions.playNext!(t.id)}
                    aria-label={`Play next: ${t.title}`}
                    title="Play next"
                  >
                    <Glyph name="playNext" />
                  </button>
                ) : null}
                {actions.queue ? (
                  <button
                    type="button"
                    className="jb-btn jb-btn--icon jb-btn--row"
                    onClick={() => actions.queue!(t.id)}
                    aria-label={`Add to queue: ${t.title}`}
                    title="Add to queue"
                  >
                    <Glyph name="queue" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
