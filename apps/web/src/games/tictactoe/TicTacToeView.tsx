/**
 * DAS Tic-Tac-Toe game screen: player cards with clocks around the board, a side panel with the
 * turn status, the variant's hints, the picker for what you place (Wild / Order & Chaos: X or O,
 * Numbers: your number, Nesting: a piece from your hand or one on the board), the rules, the move
 * list and the kit actions, and the kit's result card over the board at the end.
 *
 * Moves show optimistically (the engine previews them) until the server's state catches up, and
 * roll back if the server refuses. Keys: arrows + Enter on the board; 1–9 play the squares of a
 * 3×3 board; X / O pick the mark, S / M / L the Nesting piece, a digit the Numbers number.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { otherSide, timeControlLabel, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  TTT_MOVE_LIMIT,
  TTT_MSG,
  TTT_NUMBERS,
  TTT_SIZE_LABEL,
  TTT_VARIANT_INFO,
  type TicTacToePublicState,
  type TicTacToeSettings,
  type TttMark,
  type TttMoveEvent,
  type TttSize,
  type TttVariant,
} from '@dascade/shared/games/tictactoe';
import { cellName, legalMoves, markOf, numbersLeft, topOf, type TttMove, type TttPosition } from '@dascade/game-core/tictactoe';
import { Badge, PixelIcon, cx, handleRovingKeys, rovingTabIndex } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { GameStage } from '../../shell/common.tsx';
import {
  BoardActionBar,
  BoardClock,
  MoveList,
  PlayerCard,
  ResultBanner,
  boardSounds,
  lowTimeMs,
  useBoardEventSounds,
  useBoardroom,
  useClockMs,
} from '../_boardroom/index.ts';
import { TttBoard, type BoardPreview } from './Board.tsx';
import { Glyph, Piece, SideSwatch } from './Mark.tsx';
import {
  choiceOf,
  clickableCells,
  defaultSize,
  moveAt,
  ownsTop,
  positionOf,
  previewCells,
  targetCells,
  variantOf,
  type Selection,
} from './position.ts';
import { tttSounds } from './sounds.ts';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

interface Pending {
  ply: number;
  cell: number;
  cells: string[];
}

const EMPTY = new Set<number>();
/** 3×3 single boards: keys 1–9 play the squares (reading order). */
const KEYPAD: ReadonlySet<TttVariant> = new Set(['classic', 'misere', 'vanishing', 'wild', 'nesting']);

/** The selection the click will use: fills in the defaults and drops choices that no longer apply. */
function effectiveSelection(variant: TttVariant, position: TttPosition | null, side: BoardSide | null, sel: Selection): Selection {
  if (!position || !side) return {};
  switch (choiceOf(variant)) {
    case 'mark':
      return { mark: sel.mark ?? 'x' };
    case 'num': {
      const left = numbersLeft(position, side);
      return { num: sel.num !== undefined && left.includes(sel.num) ? sel.num : left[0] };
    }
    case 'piece': {
      if (sel.from !== undefined && ownsTop(position, side, sel.from)) return { from: sel.from };
      const base = side === 'first' ? 0 : 3;
      const size = sel.size !== undefined && (position.hands[base + sel.size - 1] ?? 0) > 0 ? sel.size : defaultSize(position, side);
      return { size, explicit: sel.explicit && size === sel.size };
    }
    default:
      return {};
  }
}

/** What the move would put on the board (hover ghost). */
function ghostToken(variant: TttVariant, side: BoardSide, move: TttMove): string {
  if (variant === 'numbers') return String(move.num ?? '');
  if (variant === 'wild' || variant === 'orderchaos') return move.mark ?? 'x';
  if (variant === 'nesting') return `${markOf(variant, side)}${move.size ?? 1}`;
  return markOf(variant, side);
}

export function TicTacToeView() {
  const room = useBoardroom<TicTacToePublicState, TicTacToeSettings>(false);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const narrow = useMedia('(max-width: 899px)');
  const phone = useMedia('(max-width: 599px), (orientation: landscape) and (max-height: 560px)');
  const [pending, setPending] = useState<Pending | null>(null);
  const [sel, setSel] = useState<Selection>({});

  const state = room?.state;
  const variant = variantOf(state);
  const info = TTT_VARIANT_INFO[variant];
  const ply = state?.ply ?? 0;
  const mySide = room?.mySide ?? null;
  const position = useMemo(() => (state ? positionOf(state) : null), [state]);

  // The server's position is authoritative: drop the optimistic move once it has moved on.
  const livePending = pending && pending.ply === ply ? pending : null;
  useEffect(() => {
    if (pending && pending.ply !== ply) setPending(null);
  }, [pending, ply]);
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e?.type === TTT_MSG.move) setPending(null);
  });
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setPending((p) => (p === pending ? null : p)), 5000);
    return () => window.clearTimeout(id);
  }, [pending]);
  // A new turn: a picked-up Nesting piece goes back down.
  useEffect(() => {
    setSel((s) => (s.from !== undefined ? { ...s, from: undefined } : s));
  }, [ply]);

  const playing = state?.phase === 'PLAYING';
  const over = Boolean(state?.result.over);
  const myTurn = Boolean(room?.myTurn) && playing && !over;
  const interactive = myTurn && !livePending && position !== null;
  const eff = useMemo(() => effectiveSelection(variant, position, mySide, sel), [variant, position, mySide, sel]);
  const targets = useMemo(() => (interactive && position ? targetCells(position, eff) : EMPTY), [interactive, position, eff]);
  const clickable = useMemo(() => (interactive && position ? clickableCells(position, eff) : EMPTY), [interactive, position, eff]);
  const selectable = useMemo(() => {
    if (!interactive || !position || !mySide || variant !== 'nesting') return EMPTY;
    const from = new Set(legalMoves(position).flatMap((m) => (m.from !== undefined ? [m.from] : [])));
    return from;
  }, [interactive, position, mySide, variant]);

  const play = useCallback(
    (move: TttMove) => {
      if (!state || !position) return;
      const cells = previewCells(position, state.fading ?? [], move);
      if (!cells) return;
      setPending({ ply: state.ply, cell: move.cell, cells });
      session.send(TTT_MSG.move, { ...move, ply: state.ply });
      setSel((s) => ({ ...s, from: undefined, explicit: false }));
    },
    [state, position],
  );

  const onCell = useCallback(
    (cell: number) => {
      if (!position || !mySide) return;
      if (!interactive) {
        if (playing && !over) boardSounds.illegal();
        return;
      }
      if (variant === 'nesting' && ownsTop(position, mySide, cell) && !(eff.explicit && targets.has(cell))) {
        if (eff.from === cell) {
          setSel((s) => ({ ...s, from: undefined }));
          return;
        }
        if (selectable.has(cell)) {
          setSel((s) => ({ ...s, from: cell }));
          return;
        }
      }
      const move = clickable.has(cell) ? moveAt(position, eff, cell) : null;
      if (!move) {
        boardSounds.illegal();
        return;
      }
      play(move);
    },
    [position, mySide, interactive, playing, over, variant, eff, targets, selectable, clickable, play],
  );

  const preview = useCallback(
    (cell: number): BoardPreview | null => {
      if (!position || !mySide || !clickable.has(cell)) return null;
      const move = moveAt(position, eff, cell);
      return move ? { cell: move.cell, token: ghostToken(variant, mySide, move) } : null;
    },
    [position, mySide, clickable, eff, variant],
  );

  // Keyboard shortcuts (never while typing in the chat or a field).
  useEffect(() => {
    if (!mySide || !playing || over) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const key = e.key.toLowerCase();
      const choice = choiceOf(variant);
      if (choice === 'mark' && (key === 'x' || key === 'o')) setSel({ mark: key });
      else if (choice === 'piece' && (key === 's' || key === 'm' || key === 'l'))
        setSel({ size: (key === 's' ? 1 : key === 'm' ? 2 : 3) as TttSize, explicit: true });
      else if (choice === 'num' && /^[1-9]$/.test(key)) setSel({ num: Number(key) });
      else if (KEYPAD.has(variant) && /^[1-9]$/.test(key)) onCell(Number(key) - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mySide, playing, over, variant, onCell]);

  // Sounds.
  useRoomMessage<TttMoveEvent>(TTT_MSG.moved, (m) => {
    const placed: TttMark | 'num' =
      variant === 'numbers'
        ? 'num'
        : variant === 'wild' || variant === 'orderchaos'
          ? m.notation.startsWith('O')
            ? 'o'
            : 'x'
          : markOf(variant, m.side);
    tttSounds.place({ mark: placed, mine: m.side === mySide, drop: variant === 'gravity', cover: variant === 'nesting' });
    if (m.removed >= 0) tttSounds.vanish();
    if (m.board >= 0) tttSounds.board();
  });
  useBoardEventSounds('tictactoe', mySide);
  const myClockMs = useClockMs(state?.clock, mySide ?? 'first');
  const lowWarned = useRef(false);
  useEffect(() => {
    if (!state?.clock.enabled || !mySide || state.clock.running !== mySide) return;
    const low = myClockMs <= lowTimeMs(state.clock);
    if (low && !lowWarned.current) {
      lowWarned.current = true;
      boardSounds.lowTime();
    }
    if (!low) lowWarned.current = false;
  }, [myClockMs, mySide, state?.clock]);

  if (!room || !state) return null;

  const sideLabel = (side: BoardSide) => info.sides[side === 'first' ? 0 : 1];
  const swatch = (side: BoardSide) => <SideSwatch variant={variant} side={side} />;
  const cells = livePending ? livePending.cells : state.cells;
  const turn = (state.turn as BoardSide) ?? 'first';
  const fading = state.fading ?? [];
  const fadeNext = variant === 'vanishing' && playing && !over ? (fading[turn === 'first' ? 0 : 1] ?? -1) : -1;
  const fadeLater = variant === 'vanishing' && playing && !over ? (fading[turn === 'first' ? 1 : 0] ?? -1) : -1;
  const counting = state.phase === 'COUNTDOWN';
  const bottom = room.bottomSide;
  const top = otherSide(bottom);

  const extraFor = (side: BoardSide) => {
    if (variant === 'nesting') {
      const base = side === 'first' ? 0 : 3;
      const owner = markOf(variant, side);
      return (
        <span
          className="tt-hand"
          aria-label={`In hand: ${[1, 2, 3].map((s) => `${state.hands[base + s - 1] ?? 0} ${TTT_SIZE_LABEL[s as TttSize].toLowerCase()}`).join(', ')}`}
        >
          {([3, 2, 1] as const).map((size) => (
            <span key={size} className="tt-hand__slot" data-empty={(state.hands[base + size - 1] ?? 0) === 0 || undefined}>
              <Piece owner={owner} size={size} />
              <span className="tt-hand__n br-num">×{state.hands[base + size - 1] ?? 0}</span>
            </span>
          ))}
        </span>
      );
    }
    if (variant === 'numbers' && position) {
      const left = new Set(numbersLeft(position, side));
      return (
        <span className="tt-numbers" aria-label={`Numbers left: ${[...left].join(', ') || 'none'}`}>
          {TTT_NUMBERS[side].map((n) => (
            <span
              key={n}
              className={cx('tt-numbers__n br-num', n % 2 ? 'tt-number--odd' : 'tt-number--even')}
              data-used={!left.has(n) || undefined}
            >
              {n}
            </span>
          ))}
        </span>
      );
    }
    if (variant === 'ultimate') {
      const won = [...state.boards].filter((b) => b === markOf(variant, side)).length;
      return won ? <span className="tt-won br-num">{`${won} ${won === 1 ? 'board' : 'boards'}`}</span> : null;
    }
    return null;
  };

  const card = (side: BoardSide, cardPosition: 'top' | 'bottom') => {
    const seat = room.seat(side);
    const player = seat?.playerId ? state.players[seat.playerId] : undefined;
    return (
      <PlayerCard
        seat={seat}
        sideLabel={sideLabel(side)}
        swatch={swatch(side)}
        active={playing && !over && state.turn === side}
        isYou={mySide === side}
        connected={seat?.playerId ? Boolean(player?.connected) : true}
        showRating={false}
        captured={extraFor(side)}
        clock={<BoardClock clock={state.clock} side={side} owner={sideLabel(side)} size={narrow ? 'md' : 'lg'} />}
        position={cardPosition}
        compact={narrow}
        className="tt-card"
      />
    );
  };

  const toMove = sideLabel(turn);
  const status = over
    ? state.result.text
    : counting
      ? 'Get ready…'
      : myTurn
        ? 'Your move'
        : mySide
          ? `Waiting for ${room.seat(otherSide(mySide))?.name || sideLabel(otherSide(mySide))}`
          : `${toMove} to move`;

  const hints: string[] = [];
  if (playing && !over) {
    if (variant === 'ultimate')
      hints.push(
        state.active >= 0
          ? `${myTurn ? 'Play' : `${toMove} plays`} in board ${state.active + 1} — it’s highlighted.`
          : `${myTurn ? 'Play' : `${toMove} plays`} on any open board.`,
      );
    if (variant === 'vanishing') {
      const mine = mySide ? (fading[mySide === 'first' ? 0 : 1] ?? -1) : -1;
      if (mine >= 0) hints.push(`Your mark on ${cellName(variant, mine)} fades when you place your next one.`);
    }
    if (variant === 'numbers') hints.push('Any full line adding up to 15 wins — whoever’s numbers are in it.');
    if (variant === 'notakto') {
      const live = [...state.boards].filter((b) => b === '.').length;
      hints.push(`${live} of 3 boards still live — don’t finish the last one.`);
    }
    if (variant === 'orderchaos') hints.push('Order needs five of one mark in a row. Chaos needs a full board without one.');
    if (variant === 'misere') hints.push('Avoid three in a row — making one loses.');
    if ((variant === 'vanishing' || variant === 'nesting') && state.repetitions >= 2)
      hints.push('Position repeated — a third time is a draw.');
    if ((variant === 'vanishing' || variant === 'nesting') && TTT_MOVE_LIMIT - ply <= 20)
      hints.push(`Draw in ${TTT_MOVE_LIMIT - ply} moves (move limit).`);
  }

  const choice = choiceOf(variant);
  const tray =
    mySide && choice && !over && position ? (
      <section className="tt-tray" aria-label="What you place">
        {choice === 'mark' ? (
          <div className="tt-tray__row" role="radiogroup" aria-label="Mark to place" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
            {(['x', 'o'] as const).map((m, i) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={eff.mark === m}
                tabIndex={rovingTabIndex(eff.mark === m, i, true)}
                className="tt-tray__opt"
                onClick={() => setSel({ mark: m })}
              >
                <Glyph mark={m} />
                <span className="tt-tray__label">Place {m.toUpperCase()}</span>
              </button>
            ))}
          </div>
        ) : null}
        {choice === 'num' ? (
          <div className="tt-tray__row" role="radiogroup" aria-label="Number to place" onKeyDown={(e) => handleRovingKeys(e, 'radio')}>
            {TTT_NUMBERS[mySide].map((n, i) => {
              const left = numbersLeft(position, mySide).includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={eff.num === n}
                  tabIndex={rovingTabIndex(eff.num === n, i, eff.num !== undefined)}
                  disabled={!left}
                  className={cx('tt-tray__opt tt-tray__opt--num', n % 2 ? 'tt-number--odd' : 'tt-number--even')}
                  onClick={() => setSel({ num: n })}
                >
                  <span className="br-num">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {choice === 'piece' ? (
          <>
            <div
              className="tt-tray__row"
              role="radiogroup"
              aria-label="Piece from your hand"
              onKeyDown={(e) => handleRovingKeys(e, 'radio')}
            >
              {([3, 2, 1] as const).map((size, i) => {
                const n = state.hands[(mySide === 'first' ? 0 : 3) + size - 1] ?? 0;
                const on = eff.from === undefined && eff.size === size;
                return (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={rovingTabIndex(on, i, eff.from === undefined && eff.size !== undefined)}
                    disabled={n === 0}
                    className="tt-tray__opt tt-tray__opt--piece"
                    onClick={() => setSel({ size, explicit: true })}
                  >
                    <Piece owner={markOf(variant, mySide)} size={size} />
                    <span className="tt-tray__label">
                      {TTT_SIZE_LABEL[size]} <span className="br-num">×{n}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="tt-tray__hint">
              {eff.from !== undefined
                ? `Moving your ${TTT_SIZE_LABEL[(topOf(position.cells[eff.from] ?? '')?.size ?? 1) as TttSize].toLowerCase()} piece from ${cellName(variant, eff.from)} — pick a square, or tap it again to keep it there.`
                : 'Place a piece from your hand, or tap one of yours on the board to move it.'}
            </p>
          </>
        ) : null}
      </section>
    ) : null;

  const removedToken = variant === 'vanishing' && state.lastRemoved >= 0 ? markOf(variant, otherSide(turn)) : '';

  return (
    <GameStage
      gameId="tictactoe"
      className={cx('tt', narrow && 'tt--narrow', reducedMotion && 'tt--still')}
      style={{ '--tt-glow': fx === 'off' ? 0 : fx === 'low' ? 0.5 : 1 } as CSSProperties}
    >
      <div className="tt-layout" data-variant={variant}>
        <div className="tt-slot tt-slot--top">{card(top, 'top')}</div>
        <div className="tt-board-wrap">
          <TttBoard
            key={`${variant}-${state.gameNumber}`}
            variant={variant}
            cells={cells}
            boards={state.boards}
            active={state.active}
            targets={targets}
            clickable={clickable}
            selectable={selectable}
            selected={eff.from ?? -1}
            winLine={state.winLine}
            last={{
              cell: livePending ? livePending.cell : state.lastCell,
              from: livePending ? -1 : state.lastFrom,
              removed: livePending ? -1 : state.lastRemoved,
            }}
            fadeNext={fadeNext}
            fadeLater={fadeLater}
            removedToken={removedToken}
            preview={preview}
            interactive={interactive}
            live={playing && !over}
            over={over}
            onCell={onCell}
            label={`${info.title} board`}
          />
        </div>
        {over ? (
          <div className="tt-result">
            <ResultBanner room={room} sideLabel={sideLabel} swatch={swatch} compact={phone} ratings={false} />
          </div>
        ) : null}
        <div className="tt-slot tt-slot--bottom">{card(bottom, 'bottom')}</div>

        <aside className="tt-side" data-part="hud" aria-label="Game panel">
          <section className={cx('tt-status', myTurn && 'is-my-turn', over && 'is-over')} data-part="status" aria-live="polite">
            <div className="tt-status__line">
              {!over ? swatch(turn) : <PixelIcon name="trophy" />}
              <span className="tt-status__text" data-testid="tictactoe-status">
                {status}
              </span>
            </div>
            {hints.map((h) => (
              <p key={h} className="tt-status__hint">
                {h}
              </p>
            ))}
            {counting ? (
              <ul className="tt-status__rules">
                {info.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <div className="tt-status__meta">
              <Badge color="var(--accent)">{info.title}</Badge>
              <Badge color="var(--text-2)">
                {timeControlLabel({
                  baseMinutes: state.clock.enabled ? Math.round(state.clock.baseMs / 60_000) : 0,
                  incrementSeconds: Math.round(state.clock.incrementMs / 1000),
                })}
              </Badge>
              {room.tournament ? (
                <Badge color="var(--accent-2)">
                  {room.tournament.roundLabel} · Game {room.tournament.gameNumber}/{room.tournament.bestOf}
                </Badge>
              ) : state.gameNumber > 1 ? (
                <Badge color="var(--text-2)">Game {state.gameNumber}</Badge>
              ) : null}
            </div>
          </section>

          {tray}

          <BoardActionBar room={room} sideLabel={sideLabel} compact={narrow} className="tt-actions" />

          <section className="tt-moves" aria-label="Move history">
            <h2 className="tt-side__title">Moves</h2>
            <MoveList
              moves={state.history.map((h) => h.notation)}
              sideLabels={info.sides}
              layout={narrow ? 'strip' : 'table'}
              emptyText={`${info.sides[0]} moves first.`}
              label="Move history"
            />
          </section>

          {counting ? null : (
            <details className="tt-rules">
              <summary className="tt-rules__summary">
                <PixelIcon name="info" /> How to play {info.title}
              </summary>
              <ul className="tt-rules__list">
                {info.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </GameStage>
  );
}
