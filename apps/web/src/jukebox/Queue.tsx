/** Personal "up next" queue: reorder (buttons + drag), remove, clear. */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { Art } from './Art.tsx';
import { formatTime } from './format.ts';
import { Glyph } from './icons.tsx';

export function Queue({ announce }: { announce: (msg: string) => void }) {
  const queue = useJukebox((s) => s.queue);
  const tracks = useJukebox((s) => s.library.tracks);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const focusAfter = useRef<{ index: number; which: 'up' | 'down' | 'remove' } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Keep keyboard focus on the moved row's control after a reorder/removal.
  useEffect(() => {
    const f = focusAfter.current;
    if (!f || !listRef.current) return;
    focusAfter.current = null;
    const rows = listRef.current.querySelectorAll<HTMLElement>('[data-part="queue-item"]');
    const row = rows[Math.min(f.index, rows.length - 1)];
    const btn =
      row?.querySelector<HTMLButtonElement>(`[data-q="${f.which}"]:not(:disabled)`) ??
      row?.querySelector<HTMLButtonElement>('[data-q="remove"]');
    btn?.focus();
  }, [queue]);

  const move = (from: number, to: number, which: 'up' | 'down' | null) => {
    if (to < 0 || to >= queue.length || from === to) return;
    const title = byId.get(queue[from]!)?.title ?? 'Track';
    jukebox.moveInQueue(from, to);
    if (which) focusAfter.current = { index: to, which };
    announce(`${title} moved to position ${to + 1} of ${queue.length}`);
  };

  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    const from = dragFrom ?? Number(e.dataTransfer.getData('text/x-jukebox-index'));
    setDragFrom(null);
    setDragOver(null);
    if (Number.isInteger(from)) move(from, to, null);
  };

  if (queue.length === 0) {
    return (
      <div className="jb-queue" data-part="queue">
        <p className="jb-empty">
          Nothing queued. Use <Glyph name="playNext" size={12} /> <span className="visually-hidden">Play next</span> or{' '}
          <Glyph name="queue" size={12} />
          <span className="visually-hidden">Add to queue</span> in the library to line up tracks.
        </p>
      </div>
    );
  }

  return (
    <div className="jb-queue" data-part="queue">
      <div className="jb-queue__head">
        <span className="jb-queue__count">{queue.length} up next</span>
        <button
          type="button"
          className="jb-btn jb-btn--text"
          onClick={() => {
            jukebox.clearQueue();
            announce('Queue cleared');
          }}
        >
          Clear queue
        </button>
      </div>
      <ol className="jb-tracks jb-tracks--queue" ref={listRef} aria-label="Up next">
        {queue.map((id, i) => {
          const t = byId.get(id);
          const title = t?.title ?? id;
          return (
            <li
              key={`${id}:${i}`}
              className="jb-track jb-qitem"
              data-part="queue-item"
              data-dragging={dragFrom === i ? 'true' : undefined}
              data-drop={dragOver === i && dragFrom !== null && dragFrom !== i ? (dragFrom > i ? 'before' : 'after') : undefined}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOver !== i) setDragOver(i);
              }}
              onDragLeave={() => dragOver === i && setDragOver(null)}
              onDrop={(e) => onDrop(e, i)}
            >
              <span
                className="jb-qitem__grip"
                draggable
                title="Drag to reorder"
                aria-hidden
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/x-jukebox-index', String(i));
                  const row = e.currentTarget.closest('li');
                  if (row) e.dataTransfer.setDragImage(row, 16, 20);
                }}
                onDragEnd={() => {
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <Glyph name="grip" size={14} />
              </span>
              <button type="button" className="jb-track__main" onClick={() => jukebox.play(id)} aria-label={`Play ${title} now`}>
                <span className="jb-qitem__pos">{i + 1}</span>
                <Art track={t ?? null} size="sm" />
                <span className="jb-track__text">
                  <span className="jb-track__title">{title}</span>
                  {t?.artist ? <span className="jb-track__artist">{t.artist}</span> : null}
                </span>
                <span className="jb-track__dur">{t && t.duration > 0 ? formatTime(t.duration) : '—'}</span>
              </button>
              <span className="jb-qitem__actions">
                <button
                  type="button"
                  data-q="up"
                  className="jb-btn jb-btn--icon jb-btn--row"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1, 'up')}
                  aria-label={`Move ${title} up`}
                  title="Move up"
                >
                  <Glyph name="up" />
                </button>
                <button
                  type="button"
                  data-q="down"
                  className="jb-btn jb-btn--icon jb-btn--row"
                  disabled={i === queue.length - 1}
                  onClick={() => move(i, i + 1, 'down')}
                  aria-label={`Move ${title} down`}
                  title="Move down"
                >
                  <Glyph name="down" />
                </button>
                <button
                  type="button"
                  data-q="remove"
                  className="jb-btn jb-btn--icon jb-btn--row"
                  onClick={() => {
                    jukebox.dequeue(i);
                    focusAfter.current = { index: i, which: 'remove' };
                    announce(`${title} removed from the queue`);
                  }}
                  aria-label={`Remove ${title} from the queue`}
                  title="Remove"
                >
                  <Glyph name="trash" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
