/**
 * One DAS Ships grid: sea + vessels (SVG art layer), real <button> squares (keyboard + screen
 * readers + tests), and a marks layer (splashes, bursts, reticles, deployment ghost).
 */
import {
  memo,
  useCallback,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { SHIPS_COLUMNS, type ShipsDir, type VesselId } from '@dascade/shared/games/ships';
import { cx } from '@dascade/ui';
import { ArtDefs, HitMark, MissMark, SEA, Vessel, type VesselTone } from './art.tsx';

export interface VesselDraw {
  id: VesselId;
  x: number;
  y: number;
  dir: ShipsDir;
  tone?: VesselTone;
  selected?: boolean;
}

export interface CellInfo {
  label: string;
  disabled?: boolean;
  /** Pressing here starts a drag (deployment): no touch scrolling on it. */
  grabbable?: boolean;
  /** Extra state hook for styling ('target', 'aimed', 'vessel'…). */
  kind?: string;
}

export interface BoardProps {
  n: number;
  /** Sea size in px (the coordinate gutters are added around it). */
  px: number;
  label: string;
  variant: 'enemy' | 'own' | 'deploy' | 'reveal';
  /** Public shots string for this sea ('.' 'o' 'x' '#'), or '' for none. */
  shots?: string;
  vessels?: VesselDraw[];
  /** Square indices whose mark just landed (animated). */
  fresh?: ReadonlySet<number>;
  /** Squares of the latest volley on this sea (outlined). */
  latest?: ReadonlySet<number>;
  /** Extra SVG drawn above the marks (reticles, ghosts). */
  overlay?: ReactNode;
  active?: boolean;
  /** Sonar sweep decoration. */
  sweep?: boolean;
  /** 0 = no glow (fx off) … 1 = full. */
  glow: number;
  cell: (x: number, y: number) => CellInfo;
  onCellClick?: (x: number, y: number) => void;
  onCellPointerDown?: (x: number, y: number, e: PointerEvent<HTMLButtonElement>) => void;
  onCellHover?: (cell: { x: number; y: number } | null) => void;
  onKeyAction?: (e: KeyboardEvent<HTMLDivElement>, cursor: { x: number; y: number }) => boolean;
  seaRef?: Ref<HTMLDivElement>;
  className?: string;
  testId?: string;
}

export const Board = memo(function Board(props: BoardProps) {
  const { n, px, label, variant, shots = '', vessels = [], fresh, latest, overlay, active, sweep, glow, cell } = props;
  const glowId = `sh-glow-${useId().replace(/:/g, '')}`;
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const gutter = Math.round(Math.min(22, Math.max(14, px * 0.045)));
  const cellPx = px / n;

  const focusCell = useCallback((x: number, y: number) => {
    setCursor({ x, y });
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-x="${x}"][data-y="${y}"]`);
    el?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (props.onKeyAction?.(e, cursor)) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      focusCell(Math.min(n - 1, Math.max(0, cursor.x + m[0])), Math.min(n - 1, Math.max(0, cursor.y + m[1])));
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusCell(0, cursor.y);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusCell(n - 1, cursor.y);
    }
  };

  const marks: ReactNode[] = [];
  for (let i = 0; i < shots.length && i < n * n; i++) {
    const ch = shots[i];
    if (ch === '.') continue;
    const x = i % n;
    const y = Math.floor(i / n);
    const isFresh = fresh?.has(i);
    if (ch === 'o') marks.push(<MissMark key={i} x={x} y={y} fresh={isFresh} />);
    else marks.push(<HitMark key={i} x={x} y={y} fresh={isFresh} sunk={ch === '#'} />);
  }

  const buttons: ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const info = cell(x, y);
      const focusable = cursor.x === x && cursor.y === y;
      buttons.push(
        <button
          key={`${x}-${y}`}
          type="button"
          className="sh-cell"
          data-x={x}
          data-y={y}
          data-kind={info.kind}
          data-grab={info.grabbable ? 'true' : undefined}
          aria-label={info.label}
          aria-disabled={info.disabled || undefined}
          tabIndex={focusable ? 0 : -1}
          onFocus={(e) => {
            if (cursor.x !== x || cursor.y !== y) setCursor({ x, y });
            // Keyboard users get the same placement preview as mouse hover.
            if (e.currentTarget.matches(':focus-visible')) props.onCellHover?.({ x, y });
          }}
          onClick={() => {
            if (!info.disabled) props.onCellClick?.(x, y);
          }}
          onPointerDown={props.onCellPointerDown ? (e) => props.onCellPointerDown!(x, y, e) : undefined}
          onPointerEnter={props.onCellHover ? (e) => e.pointerType === 'mouse' && props.onCellHover!({ x, y }) : undefined}
        />,
      );
    }
  }

  const latestRects: ReactNode[] = [];
  latest?.forEach((i) => {
    const x = i % n;
    const y = Math.floor(i / n);
    latestRects.push(
      <rect key={i} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} className="sh-latest" fill="none" strokeWidth={0.05} />,
    );
  });

  return (
    <div
      className={cx('sh-board', `sh-board--${variant}`, active && 'is-active', props.className)}
      style={{ '--sh-n': n, '--sh-sea': `${px}px`, '--sh-gutter': `${gutter}px`, '--sh-cell': `${cellPx}px` } as CSSProperties}
      data-testid={props.testId}
    >
      <div className="sh-board__cols" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <span key={i}>{SHIPS_COLUMNS[i]}</span>
        ))}
      </div>
      <div className="sh-board__rows" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <div className="sh-board__sea" ref={props.seaRef} onPointerLeave={props.onCellHover ? () => props.onCellHover!(null) : undefined}>
        <svg className="sh-board__art" viewBox={`0 0 ${n} ${n}`} aria-hidden focusable="false">
          <ArtDefs glowId={glowId} strength={glow} />
          <Sea n={n} />
          {vessels.map((v) => (
            <Vessel key={v.id} {...v} glowId={glow > 0 ? glowId : undefined} />
          ))}
        </svg>
        {sweep && glow > 0 ? <div className="sh-sweep" aria-hidden /> : null}
        <div
          ref={gridRef}
          className="sh-board__cells"
          role="group"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
        >
          {buttons}
        </div>
        <svg className="sh-board__marks" viewBox={`0 0 ${n} ${n}`} aria-hidden focusable="false">
          {latestRects}
          {marks}
          {overlay}
        </svg>
      </div>
    </div>
  );
});

/** Water: gentle bands + grid lines (static, cheap). */
const Sea = memo(function Sea({ n }: { n: number }) {
  const lines: ReactNode[] = [];
  for (let i = 1; i < n; i++) {
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={n} />);
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={n} y2={i} />);
  }
  return (
    <g>
      <rect x={0} y={0} width={n} height={n} className="sh-sea" />
      <g stroke={SEA.line} strokeWidth={0.025}>
        {lines}
      </g>
      <rect x={0.0125} y={0.0125} width={n - 0.025} height={n - 0.025} fill="none" stroke={SEA.lineStrong} strokeWidth={0.025} />
    </g>
  );
});
