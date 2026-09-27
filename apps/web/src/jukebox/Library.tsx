/**
 * The selection rack: the library as a real jukebox's title strips. Every track keeps its selection
 * code (A1, A2 … B1 — see strips.ts) and the rack shows one letter at a time; the letter keys flip
 * it, and typing a code on the keyboard ("B3") finds that strip. Pressing a strip plays it now; its
 * side buttons line it up next or add it to the queue. Searching shows every match at once.
 */
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { JukeboxTrack } from '@dascade/shared';
import { jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { sortTracks } from './format.ts';
import { Glyph } from './icons.tsx';
import { PER_PAGE, pageCount, pageLetter, pageOf, parseCode, selectionCode } from './strips.ts';

export interface LibraryActions {
  /** Main row action. */
  play: (id: string) => void;
  playLabel: (t: JukeboxTrack) => string;
  playNext?: (id: string) => void;
  queue?: (id: string) => void;
  /** Id shown as "now playing" (personal or room track). */
  currentId: string | null;
}

/** The rack stays on the page you left it on (per mount point: player vs Room DJ panel). */
const rememberedPage: Record<'player' | 'dj', number | null> = { player: null, dj: null };

export function Library({ actions, compact }: { actions: LibraryActions; compact?: boolean }) {
  const status = useJukebox((s) => s.library.status);
  const tracks = useJukebox((s) => s.library.tracks);
  const playing = useJukebox((s) => s.playing);
  const slot = compact ? 'dj' : 'player';
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const deferred = useDeferredValue(query);
  const searchId = useId();
  const rackRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // Catalogue order is the jukebox order; codes come from it, so they never change with a search.
  const catalogue = useMemo(() => sortTracks(tracks, 'order'), [tracks]);
  const codeOf = useMemo(() => new Map(catalogue.map((t, i) => [t.id, selectionCode(i)])), [catalogue]);
  const pages = pageCount(catalogue.length);
  const currentIndex = actions.currentId ? catalogue.findIndex((t) => t.id === actions.currentId) : -1;
  const [page, setPageState] = useState(() => rememberedPage[slot] ?? (currentIndex >= 0 ? pageOf(currentIndex) : 0));
  const setPage = (p: number) => {
    const next = Math.max(0, Math.min(pages - 1, p));
    rememberedPage[slot] = next;
    setPageState(next);
  };
  const shownPage = Math.min(page, pages - 1);

  const searching = deferred.trim().length > 0;
  const list = useMemo(
    () => (searching ? sortTracks(catalogue, 'order', deferred) : catalogue.slice(shownPage * PER_PAGE, (shownPage + 1) * PER_PAGE)),
    [catalogue, searching, deferred, shownPage],
  );

  // Focus a strip after the rack flips to it from a typed code.
  const focusCode = useRef<string | null>(null);
  useEffect(() => {
    const code = focusCode.current;
    if (!code || !rackRef.current) return;
    focusCode.current = null;
    rackRef.current.querySelector<HTMLButtonElement>(`[data-code="${code}"] .jb-track__main`)?.focus();
  });

  /** Letter/number keys on the rack: "B" flips to page B, "B3" (typed within a second) finds that strip. */
  const onRackKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || searching) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const key = e.key.toUpperCase();
    if (!/^[A-Z1-8]$/.test(key)) return;
    const now = performance.now();
    const text = (now - typed.current.at < 1200 ? typed.current.text : '') + key;
    typed.current = { text: /^[A-Z]+[1-8]?$/.test(text) ? text : key, at: now };
    const index = parseCode(typed.current.text, catalogue.length);
    if (index !== null) {
      e.preventDefault();
      setPage(pageOf(index));
      focusCode.current = selectionCode(index);
      typed.current = { text: '', at: 0 };
      return;
    }
    const letterPage = parseCode(`${typed.current.text}1`, catalogue.length);
    if (letterPage !== null && /^[A-Z]+$/.test(typed.current.text)) {
      e.preventDefault();
      setPage(pageOf(letterPage));
    }
  };

  return (
    <div
      className="jb-library jb-rack"
      data-part="library"
      data-compact={compact ? 'true' : undefined}
      data-searching={searching ? 'true' : undefined}
      ref={rackRef}
      onKeyDown={onRackKeys}
    >
      <div className="jb-rack__head" data-part="rack-head">
        {pages > 1 && !searching ? (
          <div className="jb-rack__keys" role="group" aria-label="Title strip pages">
            <button
              type="button"
              className="jb-btn jb-btn--icon jb-key"
              data-part="rack-prev"
              disabled={shownPage === 0}
              onClick={() => setPage(shownPage - 1)}
              aria-label="Previous title strips"
            >
              <Glyph name="prev" size={12} />
            </button>
            {Array.from({ length: pages }, (_, p) => (
              <button
                key={p}
                type="button"
                className="jb-key jb-key--letter"
                data-part="rack-page"
                aria-pressed={p === shownPage}
                onClick={() => setPage(p)}
                aria-label={`Selections ${pageLetter(p)}1 to ${pageLetter(p)}${Math.min(PER_PAGE, catalogue.length - p * PER_PAGE)}`}
              >
                {pageLetter(p)}
              </button>
            ))}
            <button
              type="button"
              className="jb-btn jb-btn--icon jb-key"
              data-part="rack-next"
              disabled={shownPage >= pages - 1}
              onClick={() => setPage(shownPage + 1)}
              aria-label="Next title strips"
            >
              <Glyph name="next" size={12} />
            </button>
          </div>
        ) : (
          <span className="jb-rack__caption" aria-hidden>
            {searching ? 'Matches' : `Selections ${pageLetter(shownPage)}`}
          </span>
        )}
        {finding || query ? (
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
              placeholder="Find a song"
              value={query}
              maxLength={80}
              // Opened from the Find key: the field is what the user asked for.
              autoFocus={finding && !query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onBlur={() => !query && setFinding(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (query || finding)) {
                  e.stopPropagation();
                  setQuery('');
                  setFinding(false);
                }
              }}
            />
          </label>
        ) : (
          <button
            type="button"
            className="jb-btn jb-btn--icon jb-key"
            data-part="find"
            onClick={() => setFinding(true)}
            aria-label="Search tracks"
            title="Find a song"
          >
            <Glyph name="search" size={14} />
          </button>
        )}
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
        <p className="jb-empty">The jukebox is empty — no records have been loaded yet.</p>
      ) : list.length === 0 ? (
        <p className="jb-empty" role="status">
          No songs match “{deferred}”.
        </p>
      ) : (
        <ul
          className="jb-tracks jb-strips"
          data-part="track-list"
          aria-label={searching ? `${list.length} match${list.length === 1 ? '' : 'es'}` : `Selections ${pageLetter(shownPage)}`}
        >
          {list.map((t) => {
            const current = t.id === actions.currentId;
            const code = codeOf.get(t.id) ?? '';
            return (
              <li
                key={t.id}
                className="jb-track jb-strip"
                data-part="track"
                data-code={code}
                data-current={current ? 'true' : undefined}
                data-playing={current && playing ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="jb-track__main"
                  onClick={() => actions.play(t.id)}
                  aria-label={`${code}: ${actions.playLabel(t)}`}
                  aria-current={current ? 'true' : undefined}
                >
                  <span className="jb-strip__code" aria-hidden>
                    {code}
                  </span>
                  <span className="jb-track__text">
                    <span className="jb-track__title">{t.title}</span>
                    <span className="jb-track__artist">{t.artist ?? 'DASCADE Jukebox'}</span>
                  </span>
                  {current ? (
                    <span className="jb-eq jb-eq--row" data-active={playing ? 'true' : undefined} aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}
                </button>
                {actions.playNext || actions.queue ? (
                  <span className="jb-strip__actions">
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
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
