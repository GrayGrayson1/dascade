/**
 * DAS Boardroom kit — generic square board (chess, checkers…).
 *
 * Controlled: the game owns selection and targets. The board turns pointer/keyboard gestures into
 * intents — `onSelect(square | null)` and `onMove(from, to, via)` — and never changes selection by
 * itself, so games can chain multi-step inputs (checkers multi-jumps) or premoves.
 *
 * Gestures
 *  - tap a pickable piece → onSelect(it); tap it again → onSelect(null);
 *  - tap a target square while a piece is selected → onMove(selected, target, 'click');
 *  - press a pickable piece and drag (≥ 4 px) → a ghost follows the pointer; release over a square →
 *    onMove(from, square, 'drag') (the game validates; nothing happens on an illegal drop);
 *  - tap anything else → onSquareClick(square) then onSelect(null).
 *  - keyboard: every square is a button (roving tabindex, arrows move focus, Enter/Space = tap).
 * Touch: pickable squares use `touch-action: none` so dragging a piece never scrolls the page, while
 * swiping over empty squares still scrolls on phones.
 *
 * Coordinates: file 0 is the left file and rank 0 the bottom rank from the FIRST side's view
 * (a1 in chess). `flipped` puts the second side at the bottom.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cx } from '@dascade/ui';

export type TargetKind = 'move' | 'capture';

export interface BoardAnimation {
  /** Changes once per move (e.g. the ply); the same key never animates twice. */
  key: string | number;
  /** Each path is [from, …hops, to]; the piece now standing on `to` slides along it. */
  paths: string[][];
}

export interface SquareBoardProps {
  files?: number;
  ranks?: number;
  /** Square id for board coordinates (see header). */
  squareId: (file: number, rank: number) => string;
  flipped?: boolean;
  /** Dark squares (default: (file + rank) even → dark, i.e. a1 is dark). */
  isDark?: (file: number, rank: number) => boolean;
  /**
   * Squares that can ever take part in play (default: all). Unplayable squares (e.g. checkers' light
   * squares) are rendered as plain decoration: not buttons, out of the tab order, skipped by arrow keys.
   */
  playable?: (file: number, rank: number) => boolean;
  pieces: Record<string, ReactNode>;
  selected?: string | null;
  targets?: Record<string, TargetKind>;
  /** Last move squares (a path for multi-hop moves). */
  lastMove?: readonly string[];
  /** Squares where pieces were just captured (faint marker). */
  captured?: readonly string[];
  check?: string | null;
  /** Queued premove squares [from, to]. */
  premove?: readonly string[];
  /** Arbitrary per-square tokens, exposed as data-mark for game CSS (e.g. 'must-capture'). */
  marks?: Record<string, string>;
  /** 'edge' = file letters on the bottom row, rank numbers on the left column; 'none' = hidden. */
  coordinates?: 'edge' | 'none';
  fileLabels?: readonly string[];
  rankLabels?: readonly string[];
  /** Small per-square corner label (e.g. checkers square numbers). */
  squareLabel?: (id: string) => ReactNode;
  /** Accessible name of a square ("e4, white knight"). Defaults to the id. */
  squareName?: (id: string) => string;
  interactive?: boolean;
  /** May the user pick up / select the piece on this square? */
  canPick?: (id: string) => boolean;
  onSelect?: (id: string | null) => void;
  onMove?: (from: string, to: string, via: 'click' | 'drag') => void;
  /** Raw tap on a square that is neither pickable nor a target. */
  onSquareClick?: (id: string) => void;
  animation?: BoardAnimation | null;
  reducedMotion?: boolean;
  /** Accessible label of the board. */
  label?: string;
  className?: string;
}

interface Cell {
  id: string;
  file: number;
  rank: number;
  vx: number;
  vy: number;
  dark: boolean;
  playable: boolean;
}

type Gesture =
  | { mode: 'target'; from: string; sq: string; pointerId: number }
  | { mode: 'other'; sq: string; pointerId: number }
  | { mode: 'pick'; from: string; wasSelected: boolean; pointerId: number; x: number; y: number; started: boolean };

const DRAG_THRESHOLD = 4;
const FILES = 'abcdefghijklmnopqrstuvwxyz';

const defaultDark = (file: number, rank: number) => (file + rank) % 2 === 0;
const allPlayable = () => true;

export function SquareBoard(props: SquareBoardProps) {
  const {
    files = 8,
    ranks = 8,
    squareId,
    flipped = false,
    isDark = defaultDark,
    playable = allPlayable,
    pieces,
    selected = null,
    targets,
    lastMove,
    captured,
    check = null,
    premove,
    marks,
    coordinates = 'edge',
    fileLabels,
    rankLabels,
    squareLabel,
    squareName,
    interactive = true,
    canPick,
    onSelect,
    onMove,
    onSquareClick,
    animation,
    reducedMotion = false,
    label = 'Board',
    className,
  } = props;

  const gridRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const hoverEl = useRef<HTMLElement | null>(null);
  const lastDrop = useRef<{ to: string; at: number } | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [focusSq, setFocusSq] = useState<string | null>(null);

  const cells = useMemo(() => {
    const out: Cell[] = [];
    for (let vy = 0; vy < ranks; vy++) {
      for (let vx = 0; vx < files; vx++) {
        const file = flipped ? files - 1 - vx : vx;
        const rank = flipped ? vy : ranks - 1 - vy;
        out.push({ id: squareId(file, rank), file, rank, vx, vy, dark: isDark(file, rank), playable: playable(file, rank) });
      }
    }
    return out;
  }, [files, ranks, flipped, squareId, isDark, playable]);

  const byId = useMemo(() => new Map(cells.map((c) => [c.id, c])), [cells]);
  const lastSet = useMemo(() => new Set(lastMove ?? []), [lastMove]);
  const capturedSet = useMemo(() => new Set(captured ?? []), [captured]);
  const premoveSet = useMemo(() => new Set(premove ?? []), [premove]);
  const pickable = useCallback((id: string) => interactive && Boolean(canPick?.(id)), [interactive, canPick]);

  const squareAtPoint = useCallback(
    (x: number, y: number): string | null => {
      const el = gridRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const vx = Math.floor(((x - r.left) / r.width) * files);
      const vy = Math.floor(((y - r.top) / r.height) * ranks);
      if (vx < 0 || vy < 0 || vx >= files || vy >= ranks) return null;
      return cells[vy * files + vx]?.id ?? null;
    },
    [cells, files, ranks],
  );

  const setHover = (id: string | null) => {
    const next = id ? (gridRef.current?.querySelector<HTMLElement>(`[data-sq="${CSS.escape(id)}"]`) ?? null) : null;
    if (hoverEl.current === next) return;
    hoverEl.current?.removeAttribute('data-hover');
    next?.setAttribute('data-hover', 'true');
    hoverEl.current = next;
  };

  const moveGhost = (x: number, y: number) => {
    const grid = gridRef.current;
    const ghost = ghostRef.current;
    if (!grid || !ghost) return;
    const r = grid.getBoundingClientRect();
    const w = r.width / files;
    const h = r.height / ranks;
    ghost.style.transform = `translate(${x - r.left - w / 2}px, ${y - r.top - h / 2}px)`;
  };

  const endDrag = () => {
    setDragFrom(null);
    setHover(null);
  };

  /** A tap (pointer without drag, or Enter/Space). */
  const tap = (sq: string) => {
    if (selected && sq !== selected && targets?.[sq]) {
      onMove?.(selected, sq, 'click');
      return;
    }
    if (pickable(sq)) {
      onSelect?.(sq === selected ? null : sq);
      return;
    }
    onSquareClick?.(sq);
    if (selected) onSelect?.(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    // One finger at a time: a second touch (or a resting palm) never hijacks a drag in progress.
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (dragFrom) endDrag();
    const sq = (e.target as HTMLElement).closest<HTMLElement>('[data-sq]')?.dataset.sq;
    if (!sq) return;
    if (selected && sq !== selected && targets?.[sq]) {
      gesture.current = { mode: 'target', from: selected, sq, pointerId: e.pointerId };
      return;
    }
    if (pickable(sq)) {
      e.preventDefault();
      const wasSelected = sq === selected;
      if (!wasSelected) onSelect?.(sq);
      gesture.current = { mode: 'pick', from: sq, wasSelected, pointerId: e.pointerId, x: e.clientX, y: e.clientY, started: false };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      return;
    }
    gesture.current = { mode: 'other', sq, pointerId: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.mode !== 'pick' || g.pointerId !== e.pointerId) return;
    if (!g.started) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD) return;
      g.started = true;
      setDragFrom(g.from);
    }
    moveGhost(e.clientX, e.clientY);
    setHover(squareAtPoint(e.clientX, e.clientY));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    const under = squareAtPoint(e.clientX, e.clientY);
    if (g.mode === 'target') {
      if (under === g.sq) onMove?.(g.from, g.sq, 'click');
      return;
    }
    if (g.mode === 'other') {
      if (under === g.sq) {
        onSquareClick?.(g.sq);
        if (selected) onSelect?.(null);
      }
      return;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!g.started) {
      if (g.wasSelected) onSelect?.(null);
      return;
    }
    endDrag();
    if (under && under !== g.from) {
      lastDrop.current = { to: under, at: performance.now() };
      onMove?.(g.from, under, 'drag');
    }
  };

  const onPointerCancel = () => {
    gesture.current = null;
    endDrag();
  };

  // Roving focus + keyboard play.
  const firstPlayable = useMemo(() => {
    // Bottom-left first, row by row upwards.
    for (let vy = ranks - 1; vy >= 0; vy--)
      for (let vx = 0; vx < files; vx++) if (cells[vy * files + vx]?.playable) return cells[vy * files + vx]!.id;
    return null;
  }, [cells, files, ranks]);
  const tabSq = focusSq && byId.get(focusSq)?.playable ? focusSq : selected && byId.get(selected)?.playable ? selected : firstPlayable;
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, cell: Cell) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = moves[e.key];
    if (step) {
      e.preventDefault();
      // Walk in that direction to the next playable square (stay put at the edge).
      let vx = cell.vx;
      let vy = cell.vy;
      let next: Cell | undefined;
      for (;;) {
        vx += step[0];
        vy += step[1];
        if (vx < 0 || vy < 0 || vx >= files || vy >= ranks) break;
        const c = cells[vy * files + vx];
        if (c?.playable) {
          next = c;
          break;
        }
      }
      if (next) {
        setFocusSq(next.id);
        gridRef.current?.querySelector<HTMLElement>(`[data-sq="${CSS.escape(next.id)}"]`)?.focus();
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (interactive) tap(cell.id);
      return;
    }
    if (e.key === 'Escape' && selected) {
      e.preventDefault();
      onSelect?.(null);
    }
  };

  // Slide the last move's piece(s) from where they came from.
  const animatedKey = useRef<string | number | null>(animation?.key ?? null);
  useLayoutEffect(() => {
    if (!animation || animation.key === animatedKey.current) return;
    animatedKey.current = animation.key;
    const grid = gridRef.current;
    if (!grid || reducedMotion || typeof Element.prototype.animate !== 'function') return;
    const r = grid.getBoundingClientRect();
    const w = r.width / files;
    const h = r.height / ranks;
    for (const path of animation.paths) {
      if (path.length < 2) continue;
      const to = path[path.length - 1]!;
      const drop = lastDrop.current;
      if (drop && drop.to === to && performance.now() - drop.at < 1500) continue; // the user dragged it there
      const end = byId.get(to);
      const el = grid.querySelector<HTMLElement>(`[data-piece-sq="${CSS.escape(to)}"]`);
      if (!end || !el) continue;
      const frames = path.map((sq) => {
        const c = byId.get(sq) ?? end;
        return { transform: `translate(${(c.vx - end.vx) * w}px, ${(c.vy - end.vy) * h}px)` };
      });
      el.style.zIndex = '3';
      const anim = el.animate(frames, { duration: 150 + 110 * (path.length - 1), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      anim.onfinish = anim.oncancel = () => {
        el.style.zIndex = '';
      };
    }
  }, [animation, byId, files, ranks, reducedMotion]);

  const showFile = (cell: Cell) => coordinates === 'edge' && cell.vy === ranks - 1;
  const showRank = (cell: Cell) => coordinates === 'edge' && cell.vx === 0;

  return (
    <div
      className={cx('br-board', dragFrom && 'br-board--dragging', className)}
      style={{ '--br-files': files, '--br-ranks': ranks } as CSSProperties}
      data-flipped={flipped || undefined}
      data-interactive={interactive || undefined}
    >
      <div
        ref={gridRef}
        className="br-board__grid"
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={() => {
          if (gesture.current?.mode === 'pick' && gesture.current.started) onPointerCancel();
        }}
        onContextMenu={(e) => {
          if (dragFrom) e.preventDefault();
        }}
      >
        {cells.map((cell) => {
          if (!cell.playable) {
            return (
              <div key={cell.id} className="br-sq" data-sq={cell.id} data-dark={cell.dark || undefined} data-unplayable aria-hidden="true">
                {pieces[cell.id] ? (
                  <span className="br-piece" data-piece-sq={cell.id}>
                    {pieces[cell.id]}
                  </span>
                ) : null}
                {squareLabel ? <span className="br-sq__label">{squareLabel(cell.id)}</span> : null}
                {showRank(cell) ? <span className="br-coord br-coord--rank">{rankLabels?.[cell.rank] ?? cell.rank + 1}</span> : null}
                {showFile(cell) ? <span className="br-coord br-coord--file">{fileLabels?.[cell.file] ?? FILES[cell.file]}</span> : null}
              </div>
            );
          }
          const piece = pieces[cell.id];
          const target = targets?.[cell.id];
          const canPickHere = pickable(cell.id);
          return (
            <button
              key={cell.id}
              type="button"
              className="br-sq"
              data-sq={cell.id}
              data-dark={cell.dark || undefined}
              data-selected={cell.id === selected || undefined}
              data-target={target}
              data-occupied={piece ? true : undefined}
              data-last={lastSet.has(cell.id) || undefined}
              data-captured={capturedSet.has(cell.id) || undefined}
              data-check={cell.id === check || undefined}
              data-premove={premoveSet.has(cell.id) || undefined}
              data-pickable={canPickHere || undefined}
              data-mark={marks?.[cell.id]}
              tabIndex={cell.id === tabSq ? 0 : -1}
              aria-label={squareName ? squareName(cell.id) : cell.id}
              aria-pressed={cell.id === selected ? true : undefined}
              onFocus={() => setFocusSq(cell.id)}
              onKeyDown={(e) => onKeyDown(e, cell)}
            >
              {piece ? (
                <span className="br-piece" data-piece-sq={cell.id} data-dragging={dragFrom === cell.id || undefined}>
                  {piece}
                </span>
              ) : null}
              {target ? <span className="br-sq__target" aria-hidden /> : null}
              {squareLabel ? <span className="br-sq__label">{squareLabel(cell.id)}</span> : null}
              {showRank(cell) ? (
                <span className="br-coord br-coord--rank" aria-hidden>
                  {rankLabels?.[cell.rank] ?? cell.rank + 1}
                </span>
              ) : null}
              {showFile(cell) ? (
                <span className="br-coord br-coord--file" aria-hidden>
                  {fileLabels?.[cell.file] ?? FILES[cell.file]}
                </span>
              ) : null}
            </button>
          );
        })}
        <div ref={ghostRef} className="br-ghost" aria-hidden data-active={dragFrom ? true : undefined}>
          {dragFrom ? pieces[dragFrom] : null}
        </div>
      </div>
    </div>
  );
}
