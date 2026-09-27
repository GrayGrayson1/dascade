/**
 * Letter Grid board: drag across touching tiles (mouse, touch, pen), or tap tiles one by one,
 * or type — the server always re-checks the path. Keeps per-move work out of React state except
 * the path itself (≤ 25 tiles).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { lengthPoints, tileLabel, tilesTouch } from '@dascade/shared/games/words';
import { Button, IconButton, cx } from '@dascade/ui';
import { sfx } from '../../audio/audio.ts';

/** Client-side path search for the typed-word preview (display only; the server decides). */
export function previewPath(tiles: readonly string[], word: string): number[] | null {
  if (!word) return null;
  const size = Math.round(Math.sqrt(tiles.length));
  const used = new Array<boolean>(tiles.length).fill(false);
  const path: number[] = [];
  const dfs = (t: number, pos: number): boolean => {
    const text = tiles[t] ?? '';
    if (!word.startsWith(text, pos)) {
      // Allow a partial "q" typed on the Qu tile at the end of the word.
      if (!(text === 'qu' && pos === word.length - 1 && word[pos] === 'q')) return false;
    }
    used[t] = true;
    path.push(t);
    const next = pos + text.length;
    if (next >= word.length) return true;
    for (let n = 0; n < tiles.length; n++) if (!used[n] && tilesTouch(t, n, size) && dfs(n, next)) return true;
    used[t] = false;
    path.pop();
    return false;
  };
  for (let t = 0; t < tiles.length; t++) if (dfs(t, 0)) return path;
  return null;
}

export interface GridBoardProps {
  tiles: string[];
  disabled?: boolean;
  /** Tiles to highlight (typed-word preview or a hovered word). */
  highlight?: number[] | null;
  /** Feedback flash for the last submission. */
  flash?: { path: number[]; tone: 'good' | 'bad' } | null;
  onSubmit: (word: string, path: number[]) => void;
  minLength: number;
}

type Mode = 'drag' | 'tap' | null;

export function GridBoard({ tiles, disabled, highlight, flash, onSubmit, minLength }: GridBoardProps) {
  const size = Math.round(Math.sqrt(tiles.length)) || 4;
  const [path, setPath] = useState<number[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; moved: boolean; rect: DOMRect } | null>(null);
  const pathRef = useRef<number[]>([]);
  pathRef.current = path;

  // New board / disabled → reset.
  useEffect(() => {
    setPath([]);
    setMode(null);
  }, [tiles, disabled]);

  const word = path.map((i) => tiles[i] ?? '').join('');
  const letters = word.length;

  const submit = useCallback(
    (p: number[]) => {
      const w = p.map((i) => tiles[i] ?? '').join('');
      setPath([]);
      setMode(null);
      if (w.length < minLength) {
        if (p.length > 1) sfx('pop');
        return;
      }
      onSubmit(w, p);
    },
    [tiles, minLength, onSubmit],
  );

  const tileAt = (x: number, y: number, rect: DOMRect): number | null => {
    const cw = rect.width / size;
    const ch = rect.height / size;
    const col = Math.floor((x - rect.left) / cw);
    const row = Math.floor((y - rect.top) / ch);
    if (col < 0 || row < 0 || col >= size || row >= size) return null;
    // Only the middle of a tile counts, so diagonal moves don't clip a neighbour's corner.
    const dx = Math.abs(x - (rect.left + (col + 0.5) * cw)) / cw;
    const dy = Math.abs(y - (rect.top + (row + 0.5) * ch)) / ch;
    if (dx > 0.4 || dy > 0.4) return null;
    return row * size + col;
  };

  /** Applies a tap / press on tile t with tap-mode rules. */
  const press = (t: number, current: number[], currentMode: Mode): number[] => {
    const last = current[current.length - 1];
    if (currentMode === 'tap' && current.length > 0 && last !== undefined) {
      if (t === last) {
        submit(current);
        return [];
      }
      const at = current.indexOf(t);
      if (at >= 0) return current.slice(0, at + 1);
      if (tilesTouch(last, t, size)) return [...current, t];
    }
    return [t];
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button > 0) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = tileAt(e.clientX, e.clientY, rect);
    if (t === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, moved: false, rect };
    const next = press(t, pathRef.current, mode);
    setPath(next);
    if (next.length > 0) {
      setMode(mode === 'tap' && next.length > 1 ? 'tap' : 'drag');
      sfx('click', 40);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || disabled) return;
    const t = tileAt(e.clientX, e.clientY, d.rect);
    if (t === null) return;
    const current = pathRef.current;
    const last = current[current.length - 1];
    if (last === undefined || t === last) return;
    if (current.length >= 2 && t === current[current.length - 2]) {
      setPath(current.slice(0, -1));
      d.moved = true;
      return;
    }
    if (!current.includes(t) && tilesTouch(last, t, size)) {
      setPath([...current, t]);
      d.moved = true;
      sfx('click', 30);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const current = pathRef.current;
    if (d.moved && current.length >= 2) {
      submit(current);
      return;
    }
    // A plain tap: keep building tile by tile.
    if (current.length > 0) setMode('tap');
  };

  const onPointerCancel = () => {
    drag.current = null;
  };

  /** Keyboard / assistive-tech activation of a tile (pointer taps are handled above). */
  const onTileClick = (t: number, detail: number) => {
    if (detail !== 0 || disabled) return;
    const next = press(t, pathRef.current, pathRef.current.length > 0 ? 'tap' : mode);
    setPath(next);
    setMode(next.length > 0 ? 'tap' : null);
  };

  const hl = useMemo(() => new Set(highlight ?? []), [highlight]);
  const flashSet = useMemo(() => new Set(flash?.path ?? []), [flash]);
  const order = useMemo(() => new Map(path.map((t, i) => [t, i])), [path]);
  const line = path.map((t) => `${(t % size) + 0.5},${Math.floor(t / size) + 0.5}`).join(' ');

  return (
    <div className="wd-board-wrap" data-part="board">
      <div className="wd-trace">
        <span className="wd-trace__live" aria-live="polite">
          {letters > 0 ? (
            <>
              <span className="wd-trace__word">{word.toUpperCase()}</span>{' '}
              <span className="wd-trace__pts dc-num" data-short={letters < minLength ? 'true' : undefined}>
                {letters < minLength ? `${minLength - letters} more` : `+${lengthPoints(letters)}`}
              </span>
            </>
          ) : (
            <span className="wd-trace__hint">{disabled ? 'Board locked' : 'Drag or tap touching letters'}</span>
          )}
        </span>
        {mode === 'tap' && path.length > 0 ? (
          <span className="wd-trace__actions">
            <IconButton icon="close" label="Clear letters" size="sm" onClick={() => { setPath([]); setMode(null); }} />
            <Button size="sm" variant="primary" icon="check" disabled={disabled || letters < minLength} onClick={() => submit(path)} aria-label={`Submit ${word.toUpperCase()}`}>
              Submit
            </Button>
          </span>
        ) : null}
      </div>
      <div
        className={cx('wd-board', disabled && 'is-disabled')}
        data-part="board-grid"
        style={{ '--n': size } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        data-testid="words-board"
      >
        <div className="wd-board__grid" ref={gridRef} role="group" aria-label={`Letter grid, ${size} by ${size}`}>
          {tiles.map((tile, i) => {
            const inPath = order.has(i);
            const state = flashSet.has(i) ? flash?.tone : inPath ? 'on' : hl.has(i) ? 'hint' : undefined;
            return (
              <button
                key={i}
                type="button"
                className="wd-cell"
                data-part="tile"
                data-state={state}
                data-long={tile.length > 1 ? 'true' : undefined}
                disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                aria-pressed={inPath}
                aria-label={`${tileLabel(tile)}, row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}`}
                onClick={(e) => onTileClick(i, e.detail)}
              >
                <span className="wd-cell__face">{tileLabel(tile)}</span>
                {inPath ? <span className="wd-cell__order dc-num">{(order.get(i) ?? 0) + 1}</span> : null}
              </button>
            );
          })}
        </div>
        <svg className="wd-board__line" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true">
          {path.length > 1 ? <polyline points={line} /> : null}
        </svg>
      </div>
    </div>
  );
}
