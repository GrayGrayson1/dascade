/**
 * DAS Tic-Tac-Toe boards. One <Grid> draws any board (hand-drawn lines, marks, the winning strike,
 * hover ghosts); the layouts compose it: a single grid, Ultimate's nine boards in one, Notakto's
 * three boards and the cube's four layers.
 *
 * Every square is a `button[data-cell]` with a spoken name ("b2, X"). The board keeps one roving
 * tab stop: arrow keys move it (across boards too), Enter or Space plays. Clicks always reach the
 * screen (`onCell`), which decides what they mean (Nesting: select a piece, then a square).
 */
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { TTT_VARIANT_INFO, type TttMark, type TttVariant } from '@dascade/shared/games/tictactoe';
import { cellName } from '@dascade/game-core/tictactoe';
import { cx } from '@dascade/ui';
import { CellContent, Glyph, describeToken } from './Mark.tsx';
import { boardLines, linesWithin, navStep } from './position.ts';

export interface BoardPreview {
  cell: number;
  token: string;
}

export interface TttBoardProps {
  variant: TttVariant;
  cells: readonly string[];
  boards: string;
  active: number;
  /** Squares the move lands on (styling). */
  targets: Set<number>;
  /** Squares a click plays on (Gravity: every square of a column with room). */
  clickable: Set<number>;
  /** Nesting: your pieces that can be picked up. */
  selectable: Set<number>;
  /** Nesting: the picked-up piece's square (-1 = none). */
  selected: number;
  /** Cells of the deciding line (Ultimate: its small boards). */
  winLine: readonly number[];
  last: { cell: number; from: number; removed: number };
  /** Vanishing: the mark that fades on the next move of the side to move / of the other side. */
  fadeNext: number;
  fadeLater: number;
  /** Token the last move erased (Vanishing), for its fade-out. */
  removedToken: string;
  /** Ghost of the move under the pointer. */
  preview: (cell: number) => BoardPreview | null;
  /** The viewer may play now. */
  interactive: boolean;
  /** The game is running (highlights Ultimate's board to play). */
  live: boolean;
  over: boolean;
  onCell: (cell: number) => void;
  label: string;
  className?: string;
}

interface GridProps {
  variant: TttVariant;
  base: number;
  cols: number;
  rows: number;
  board: TttBoardProps;
  strikes: number[][];
  win: Set<number>;
  hover: BoardPreview | null;
  focus: number;
  onFocus: (cell: number) => void;
  onHover: (cell: number | null) => void;
  label: string;
  className?: string;
  style?: CSSProperties;
}

function Grid({ variant, base, cols, rows, board, strikes, win, hover, focus, onFocus, onHover, label, className, style }: GridProps) {
  const n = cols * rows;
  const local = (cell: number) => ({ x: ((cell - base) % cols) + 0.5, y: Math.floor((cell - base) / cols) + 0.5 });
  const mine = (cell: number) => cell >= base && cell < base + n;
  return (
    <div
      className={cx('tt-grid', className)}
      style={{ '--cols': cols, '--rows': rows, ...style } as CSSProperties}
      role="group"
      aria-label={label}
      data-size={cols * rows > 50 ? 'dense' : cols > 3 ? 'medium' : 'roomy'}
    >
      <svg className="tt-grid__lines" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden focusable="false">
        {Array.from({ length: cols - 1 }, (_, i) => (
          <line
            key={`v${i}`}
            className="tt-rule"
            x1={i + 1}
            y1={0.04}
            x2={i + 1}
            y2={rows - 0.04}
            pathLength={1}
            style={{ '--i': i } as CSSProperties}
          />
        ))}
        {Array.from({ length: rows - 1 }, (_, i) => (
          <line
            key={`h${i}`}
            className="tt-rule"
            x1={0.04}
            y1={i + 1}
            x2={cols - 0.04}
            y2={i + 1}
            pathLength={1}
            style={{ '--i': i + cols - 1 } as CSSProperties}
          />
        ))}
      </svg>
      {Array.from({ length: n }, (_, i) => {
        const cell = base + i;
        const token = board.cells[cell] ?? '';
        const ghost = hover && hover.cell === cell && (!token || variant === 'nesting') ? hover.token : '';
        const fade = cell === board.fadeNext ? 'next' : cell === board.fadeLater ? 'later' : undefined;
        const removed = cell === board.last.removed && !token;
        const name = cellName(variant, cell);
        const spoken = `${name}, ${describeToken(variant, token)}${fade === 'next' ? ', fades on the next move' : fade === 'later' ? ', fades soon' : ''}${win.has(cell) ? ', winning line' : ''}`;
        return (
          <button
            key={cell}
            type="button"
            className="tt-cell"
            data-cell={cell}
            data-target={board.targets.has(cell) || undefined}
            data-clickable={board.clickable.has(cell) || undefined}
            data-selectable={board.selectable.has(cell) || undefined}
            data-selected={board.selected === cell || undefined}
            data-last={board.last.cell === cell || board.last.from === cell || undefined}
            data-win={win.has(cell) || undefined}
            data-fade={fade}
            aria-label={spoken}
            aria-disabled={!board.interactive || (!board.clickable.has(cell) && !board.selectable.has(cell)) || undefined}
            aria-pressed={board.selected === cell ? true : undefined}
            tabIndex={focus === cell ? 0 : -1}
            onFocus={() => onFocus(cell)}
            onPointerEnter={() => onHover(cell)}
            onPointerLeave={() => onHover(null)}
            onClick={() => board.onCell(cell)}
          >
            {token ? (
              <span className="tt-cell__mark" key={token}>
                <CellContent variant={variant} token={token} />
              </span>
            ) : null}
            {removed && board.removedToken ? (
              <span className="tt-cell__mark tt-cell__mark--gone" aria-hidden>
                <CellContent variant={variant} token={board.removedToken} />
              </span>
            ) : null}
            {ghost ? (
              <span className="tt-cell__mark tt-cell__mark--ghost" aria-hidden>
                <CellContent variant={variant} token={ghost} />
              </span>
            ) : null}
          </button>
        );
      })}
      {strikes.length ? (
        <svg className="tt-grid__strike" viewBox={`0 0 ${cols} ${rows}`} aria-hidden focusable="false">
          {strikes
            .filter((line) => line.every(mine))
            .map((line) => {
              const a = local(line[0]!);
              const b = local(line[line.length - 1]!);
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ext = 0.32;
              return (
                <line
                  key={line.join('-')}
                  className="tt-strike"
                  x1={a.x - (dx / len) * ext}
                  y1={a.y - (dy / len) * ext}
                  x2={b.x + (dx / len) * ext}
                  y2={b.y + (dy / len) * ext}
                  pathLength={1}
                />
              );
            })}
        </svg>
      ) : null}
    </div>
  );
}

function UltimateMeta({ winLine }: { winLine: readonly number[] }) {
  if (winLine.length < 3) return null;
  const pos = (b: number) => ({ x: (b % 3) + 0.5, y: Math.floor(b / 3) + 0.5 });
  const a = pos(winLine[0]!);
  const b = pos(winLine[winLine.length - 1]!);
  return (
    <svg className="tt-ultimate__strike" viewBox="0 0 3 3" aria-hidden focusable="false">
      <line
        className="tt-strike tt-strike--meta"
        x1={a.x - (b.x - a.x) * 0.12}
        y1={a.y - (b.y - a.y) * 0.12}
        x2={b.x + (b.x - a.x) * 0.12}
        y2={b.y + (b.y - a.y) * 0.12}
        pathLength={1}
      />
    </svg>
  );
}

export function TttBoard(props: TttBoardProps) {
  const { variant, cells, boards, active, winLine, live, interactive, over, label, className } = props;
  const info = TTT_VARIANT_INFO[variant];
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  // The first tab stop: the centre (Gravity: the bottom of the middle column).
  const [focus, setFocus] = useState(() =>
    variant === 'ultimate'
      ? 40
      : variant === 'gravity'
        ? (info.rows - 1) * info.cols + Math.floor(info.cols / 2)
        : Math.floor((info.cols * info.rows) / 2),
  );
  const root = useRef<HTMLDivElement>(null);

  const hover = hoverCell !== null && interactive ? props.preview(hoverCell) : null;
  const meta = variant === 'ultimate';
  const win = new Set(meta ? [] : winLine);
  const strikes = [...boardLines(variant, cells, boards), ...(meta ? [] : linesWithin(variant, winLine))];

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const from = Number(target.dataset.cell);
      if (!Number.isInteger(from)) return;
      const next = navStep(variant, from, e.key);
      if (next === from) return;
      e.preventDefault();
      setFocus(next);
      root.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
    },
    [variant],
  );

  const grid = (base: number, gridLabel: string, extra?: { className?: string; style?: CSSProperties }) => (
    <Grid
      key={base}
      variant={variant}
      base={base}
      cols={info.cols}
      rows={info.rows}
      board={props}
      strikes={strikes}
      win={win}
      hover={hover}
      focus={focus}
      onFocus={setFocus}
      onHover={setHoverCell}
      label={gridLabel}
      className={extra?.className}
      style={extra?.style}
    />
  );

  let body;
  if (info.layout === 'grid') {
    body = grid(0, label);
  } else if (variant === 'ultimate') {
    const metaWin = new Set(winLine);
    body = (
      <div className="tt-ultimate">
        {Array.from({ length: 9 }, (_, b) => {
          const status = boards[b] ?? '.';
          const open = status === '.';
          const playable = live && !over && open && (active === -1 || active === b);
          return (
            <div
              key={b}
              className="tt-ultimate__board"
              data-status={open ? 'open' : status === '=' ? 'full' : 'won'}
              data-play={playable || undefined}
              data-win={metaWin.has(b) || undefined}
            >
              {grid(
                b * 9,
                `Board ${b + 1}${open ? '' : status === '=' ? ', full' : `, won by ${status.toUpperCase()}`}${playable && active === b ? ', play here' : ''}`,
              )}
              {status === 'x' || status === 'o' ? (
                <span className="tt-bigmark" aria-hidden>
                  <Glyph mark={status as TttMark} />
                </span>
              ) : null}
            </div>
          );
        })}
        <UltimateMeta winLine={winLine} />
      </div>
    );
  } else if (variant === 'notakto') {
    body = (
      <div className="tt-notakto">
        {Array.from({ length: info.count }, (_, b) => {
          const dead = boards[b] === '#';
          return (
            <div key={b} className="tt-notakto__board" data-dead={dead || undefined} style={{ '--b': b } as CSSProperties}>
              <span className="tt-board-tag">
                Board {b + 1}
                {dead ? ' · dead' : ''}
              </span>
              {grid(b * 9, `Board ${b + 1}${dead ? ', dead' : ''}`)}
            </div>
          );
        })}
      </div>
    );
  } else {
    // The cube: four layers, top to bottom.
    const per = info.cols * info.rows;
    body = (
      <div className="tt-cube">
        {Array.from({ length: info.count }, (_, z) => (
          <div key={z} className="tt-cube__layer" style={{ '--z': z } as CSSProperties}>
            <span className="tt-board-tag">
              Layer {z + 1}
              {z === 0 ? ' · top' : z === info.count - 1 ? ' · bottom' : ''}
            </span>
            {grid(z * per, `Layer ${z + 1} of ${info.count}`)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={root}
      className={cx(
        'tt-board',
        `tt-board--${variant}`,
        `tt-board--${info.layout}`,
        interactive && 'is-interactive',
        over && 'is-over',
        className,
      )}
      data-variant={variant}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ '--cols': info.cols, '--rows': info.rows } as CSSProperties}
    >
      {body}
    </div>
  );
}
