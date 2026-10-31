/**
 * DAS Reversi game screen (every variant): player cards with disc counts and clocks around the
 * board, a side panel with the turn status, the score bar, the variant's hints (skipped turns,
 * Original's centre opening and discs left), the move list, the rules and the kit actions, and the
 * kit's result card over the board at the end.
 *
 * Moves show optimistically (the engine previews them, flips included) until the server's state
 * catches up, and roll back if the server refuses. The board is never flipped: both players read
 * the same coordinates, as on a printed Reversi diagram.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { otherSide, timeControlLabel, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  REVERSI_MSG,
  REVERSI_SIDE_LABEL,
  REVERSI_SIDE_LABELS,
  REVERSI_VARIANT_INFO,
  isRatedReversiVariant,
  type ReversiMoveEvent,
  type ReversiPublicState,
  type ReversiSettings,
} from '@dascade/shared/games/reversi';
import { applyPlacement, discCounts, inOpening, legalMoves } from '@dascade/game-core/reversi';
import { Badge, PixelIcon, cx } from '@dascade/ui';
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
import { DiscSwatch } from './Disc.tsx';
import { ReversiBoard } from './ReversiBoard.tsx';
import { positionOf, variantOf } from './position.ts';
import { reversiSounds } from './sounds.ts';

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
  board: string;
  flips: number[];
}

const NO_MOVES: readonly number[] = [];
const sideLabel = (side: BoardSide) => REVERSI_SIDE_LABEL[side];
const swatch = (side: BoardSide) => <DiscSwatch side={side} />;

/** Black's and White's discs as a bar (Anti: the shorter bar is winning). */
function ScoreBar({ score, fewest }: { score: [number, number]; fewest: boolean }) {
  const total = Math.max(1, score[0] + score[1]);
  return (
    <div className="rv-score" role="img" aria-label={`Discs: Black ${score[0]}, White ${score[1]}${fewest ? ' — fewest wins' : ''}`}>
      <span className="rv-score__n br-num" data-side="first">
        <DiscSwatch side="first" /> {score[0]}
      </span>
      <span className="rv-score__bar" aria-hidden>
        <span className="rv-score__fill" style={{ '--rv-share': score[0] / total } as CSSProperties} />
      </span>
      <span className="rv-score__n br-num" data-side="second">
        {score[1]} <DiscSwatch side="second" />
      </span>
    </div>
  );
}

export function ReversiView() {
  const room = useBoardroom<ReversiPublicState, ReversiSettings>(false);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const narrow = useMedia('(max-width: 899px)');
  // Phones (portrait and landscape): the compact result card keeps Rematch/Leave on screen.
  const phone = useMedia('(max-width: 599px), (orientation: landscape) and (max-height: 560px)');
  const [pending, setPending] = useState<Pending | null>(null);

  const state = room?.state;
  const variant = variantOf(state);
  const info = REVERSI_VARIANT_INFO[variant];
  const ply = state?.ply ?? 0;
  const mySide = room?.mySide ?? null;
  const position = useMemo(() => (state ? positionOf(state) : null), [state]);

  // The server's position is authoritative: drop the optimistic move once it has moved on.
  const livePending = pending && pending.ply === ply ? pending : null;
  useEffect(() => {
    if (pending && pending.ply !== ply) setPending(null);
  }, [pending, ply]);
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e?.type === REVERSI_MSG.move) setPending(null);
  });
  // A move lost in a network drop is never confirmed: fall back to the server position.
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setPending((p) => (p === pending ? null : p)), 5000);
    return () => window.clearTimeout(id);
  }, [pending]);

  const playing = state?.phase === 'PLAYING';
  const over = Boolean(state?.result.over);
  const myTurn = Boolean(room?.myTurn) && playing && !over;
  const moves = useMemo(() => (myTurn && !livePending && position ? legalMoves(position) : NO_MOVES), [myTurn, livePending, position]);

  const onMove = useCallback(
    (cell: number) => {
      if (!state || !position) return;
      const placed = applyPlacement(position, cell);
      if (!placed) return;
      setPending({ ply: state.ply, cell, board: placed.position.board, flips: placed.flips });
      session.send(REVERSI_MSG.move, { cell, ply: state.ply });
    },
    [state, position],
  );

  // Sounds: the landing, one tick per flipped disc, the skip; game end and low time.
  useRoomMessage<ReversiMoveEvent>(REVERSI_MSG.moved, (m) => {
    reversiSounds.move({ flips: m.flips.length, mine: m.side === mySide, passed: Boolean(m.passed) });
  });
  useBoardEventSounds('reversi', mySide);
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

  const board = livePending ? livePending.board : state.board;
  const lastCell = livePending ? livePending.cell : state.lastCell;
  const lastFlips = livePending ? livePending.flips : state.lastFlips;
  const score = discCounts(board);
  const turn = (state.turn as BoardSide) ?? 'first';
  const counting = state.phase === 'COUNTDOWN';
  const rated = isRatedReversiVariant(variant);
  const fewest = info.goal === 'fewest';
  const bottom = room.bottomSide;
  const top = otherSide(bottom);
  const supply = state.supply ?? [];

  const discs = (side: BoardSide) => {
    const i = side === 'first' ? 0 : 1;
    const left = supply.length === 2 ? supply[i]! : -1;
    return (
      <span className="rv-count" aria-label={`${score[i]} discs on the board${left >= 0 ? `, ${left} left to place` : ''}`}>
        <span className="rv-count__n br-num">{score[i]}</span>
        {left >= 0 ? <span className="rv-count__left br-num">{`${left} left`}</span> : null}
      </span>
    );
  };

  const card = (side: BoardSide, cardPosition: 'top' | 'bottom') => {
    const seat = room.seat(side);
    const player = seat?.playerId ? state.players[seat.playerId] : undefined;
    return (
      <PlayerCard
        seat={seat}
        sideLabel={sideLabel(side)}
        swatch={swatch(side)}
        active={playing && !over && turn === side}
        isYou={mySide === side}
        connected={seat?.playerId ? Boolean(player?.connected) : true}
        showRating={rated}
        showDelta={over}
        captured={discs(side)}
        clock={<BoardClock clock={state.clock} side={side} owner={sideLabel(side)} size={narrow ? 'md' : 'lg'} />}
        position={cardPosition}
        compact={narrow}
        className="rv-card"
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
  if (playing && !over && !livePending) {
    const passed = state.lastPassed as BoardSide | '';
    if (passed)
      hints.push(
        `${sideLabel(passed)} had no move — ${passed === mySide ? 'your turn is skipped' : `${sideLabel(otherSide(passed))} plays again`}.`,
      );
    if (position && inOpening(position)) hints.push('Opening: the first four discs go on the four centre squares.');
    if (fewest) hints.push('Anti: the fewest discs wins.');
    if (info.wrap) hints.push('Lines wrap around the edges.');
    if (supply.length === 2) {
      const left = supply[turn === 'first' ? 0 : 1]!;
      if (left <= 6) hints.push(`${toMove} has ${left} ${left === 1 ? 'disc' : 'discs'} left.`);
    }
  }

  return (
    <GameStage
      gameId="reversi"
      className={cx('rv', narrow && 'rv--narrow', reducedMotion && 'rv--still')}
      style={{ '--rv-glow': fx === 'off' ? 0 : fx === 'low' ? 0.5 : 1 } as CSSProperties}
    >
      <div
        className="rv-layout"
        data-variant={variant}
        data-size={info.size}
        data-holes={info.holes}
        data-wrap={info.wrap || undefined}
        data-turn={playing && !over ? turn : undefined}
      >
        <div className="rv-slot rv-slot--top">{card(top, 'top')}</div>
        <div className="rv-board-wrap">
          <ReversiBoard
            key={`${variant}-${state.gameNumber}`}
            variant={variant}
            board={board}
            position={position}
            moves={moves}
            mover={turn}
            lastCell={lastCell}
            lastFlips={lastFlips}
            onMove={onMove}
            onIllegal={boardSounds.illegal}
            reducedMotion={reducedMotion}
            label={`Reversi board, ${info.title}${info.size !== 8 ? ` ${info.size}×${info.size}` : ''}`}
            className={cx(over && 'is-over')}
          />
        </div>
        {over ? (
          <div className="rv-result">
            <ResultBanner
              room={room}
              sideLabel={sideLabel}
              swatch={swatch}
              compact={phone}
              ratings={rated}
              extra={<ScoreBar score={score} fewest={fewest} />}
            />
          </div>
        ) : null}
        <div className="rv-slot rv-slot--bottom">{card(bottom, 'bottom')}</div>

        <aside className="rv-side" data-part="hud" aria-label="Game panel">
          <section className={cx('rv-status', myTurn && 'is-my-turn', over && 'is-over')} data-part="status" aria-live="polite">
            <div className="rv-status__line">
              {!over ? <DiscSwatch side={turn} className="rv-status__swatch" /> : <PixelIcon name="trophy" />}
              <span className="rv-status__text" data-testid="reversi-status">
                {status}
              </span>
            </div>
            <ScoreBar score={score} fewest={fewest} />
            {hints.map((h) => (
              <p key={h} className="rv-status__hint">
                {h}
              </p>
            ))}
            {counting ? <p className="rv-status__hint">{info.tip}</p> : null}
            <div className="rv-status__meta">
              <Badge color="var(--accent)">
                {info.title}
                {info.size !== 8 && !info.title.includes('×') ? ` · ${info.size}×${info.size}` : ''}
              </Badge>
              <Badge color="var(--text-2)">
                {timeControlLabel({
                  baseMinutes: state.clock.enabled ? Math.round(state.clock.baseMs / 60_000) : 0,
                  incrementSeconds: Math.round(state.clock.incrementMs / 1000),
                })}
              </Badge>
              {rated || state.rated ? (
                <Badge color={state.rated ? 'var(--accent-2)' : 'var(--text-2)'}>{state.rated ? 'Rated' : 'Casual'}</Badge>
              ) : null}
              {room.tournament ? (
                <Badge color="var(--accent-2)">
                  {room.tournament.roundLabel} · Game {room.tournament.gameNumber}/{room.tournament.bestOf}
                </Badge>
              ) : state.gameNumber > 1 ? (
                <Badge color="var(--text-2)">Game {state.gameNumber}</Badge>
              ) : null}
            </div>
          </section>

          <BoardActionBar room={room} sideLabel={sideLabel} compact={narrow} className="rv-actions" />

          <section className="rv-moves" aria-label="Move history">
            <h2 className="rv-side__title">Moves</h2>
            <MoveList
              moves={state.history.map((h) => h.notation)}
              sideLabels={REVERSI_SIDE_LABELS}
              layout={narrow ? 'strip' : 'table'}
              emptyText="Black moves first."
              label="Move history"
            />
          </section>

          <details className="rv-rules" open={counting || undefined}>
            <summary className="rv-rules__summary">
              <PixelIcon name="info" /> How to play {info.title}
            </summary>
            <ul className="rv-rules__list">
              {info.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="rv-rules__tip">
              <PixelIcon name="star" /> {info.tip}
            </p>
          </details>
        </aside>
      </div>
    </GameStage>
  );
}
