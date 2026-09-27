/**
 * DAS Checkers game screen: player cards with clocks around the board, a side panel with the turn
 * status (incl. "Capture required"), draw-rule hints, move list and actions, and the kit's result
 * card over the board when the game ends.
 *
 * Moves are sent as paths; the board shows them optimistically until the server's state (which is
 * authoritative) catches up, and rolls back if the server refuses.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { otherSide, timeControlLabel, type BoardSide } from '@dascade/shared/games/boardroom';
import {
  CHECKERS_COLOR_LABEL,
  CHECKERS_MSG,
  checkersColorOf,
  type CheckersMoveEvent,
  type CheckersPublicState,
  type CheckersSettings,
} from '@dascade/shared/games/checkers';
import { applyMove, FORTY_MOVE_PLIES, hasCapture, legalMoves, material, type CheckersMove, type Color } from '@dascade/game-core/checkers';
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
import { CheckersBoard } from './CheckersBoard.tsx';
import { PieceSwatch } from './Piece.tsx';
import { checkersSounds } from './sounds.ts';

const sideLabel = (side: BoardSide) => CHECKERS_COLOR_LABEL[checkersColorOf(side)];
const swatch = (side: BoardSide) => <PieceSwatch tone={checkersColorOf(side)} />;
const SIDE_LABELS = ['Dark', 'Light'] as const;

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
  move: CheckersMove;
  board: string;
}

export function CheckersView() {
  const [flipped, setFlipped] = useState(false);
  const room = useBoardroom<CheckersPublicState, CheckersSettings>(flipped);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const narrow = useMedia('(max-width: 899px)');
  // Phones (portrait and landscape): the result card over the board is the compact variant, so
  // Rematch/Leave stay on screen and it covers as little of the final position as possible.
  const phone = useMedia('(max-width: 599px), (orientation: landscape) and (max-height: 560px)');
  const [pending, setPending] = useState<Pending | null>(null);

  const state = room?.state;
  const board = state?.board ?? '';
  const turnColor: Color = checkersColorOf((state?.turn as BoardSide | undefined) ?? 'first');
  const ply = state?.ply ?? 0;

  // The server's position is authoritative: drop the optimistic move once it has moved on.
  const livePending = pending && pending.ply === ply ? pending : null;
  useEffect(() => {
    if (pending && pending.ply !== ply) setPending(null);
  }, [pending, ply]);
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e?.type === CHECKERS_MSG.move) setPending(null);
  });
  // A move lost in a network drop is never confirmed: fall back to the server position.
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setPending((p) => (p === pending ? null : p)), 5000);
    return () => window.clearTimeout(id);
  }, [pending]);

  const legal = useMemo(() => (board.length === 32 ? legalMoves({ board, turn: turnColor }) : []), [board, turnColor]);
  const mustCapture = useMemo(() => board.length === 32 && hasCapture({ board, turn: turnColor }), [board, turnColor]);

  const myTurn = Boolean(room?.myTurn) && state?.phase === 'PLAYING';
  const moves = myTurn && !livePending ? legal : [];

  const onMove = useCallback(
    (move: CheckersMove) => {
      if (!state || board.length !== 32) return;
      setPending({ ply: state.ply, move, board: applyMove({ board, turn: turnColor }, move).board });
      session.send(CHECKERS_MSG.move, { path: move.path, ply: state.ply });
    },
    [state, board, turnColor],
  );

  // Sounds: moves (with capture clacks + crown arpeggio), game end, low time.
  const mySide = room?.mySide ?? null;
  useRoomMessage<CheckersMoveEvent>(CHECKERS_MSG.moved, (m) => {
    checkersSounds.move({ hops: m.path.length - 1, captures: m.captures.length, crowned: m.crowned, mine: m.side === mySide, hopMs: 110 });
  });
  useBoardEventSounds('checkers', mySide);
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

  const shownBoard = livePending ? livePending.board : board;
  const shownPly = livePending ? ply + 1 : ply;
  const lastPath = livePending ? livePending.move.path : state.lastPath;
  const lastCaptures = livePending ? livePending.move.captures : state.lastCaptures;
  const lastEntry = state.history[state.history.length - 1];
  const lastCrowned = livePending ? livePending.move.crowned : Boolean(lastEntry?.crowned);
  const bottom = room.bottomSide;
  const top = otherSide(bottom);
  const history = state.history.map((h) => h.notation);
  const over = state.result.over;
  const playing = state.phase === 'PLAYING';
  const counting = state.phase === 'COUNTDOWN';

  const captured = (side: BoardSide) => {
    const opponent = checkersColorOf(otherSide(side));
    const n = Math.max(0, 12 - material(shownBoard, opponent).total);
    return n > 0 ? (
      <span className="ck-captured" aria-label={`${n} captured`}>
        <PieceSwatch tone={opponent} className="ck-captured__swatch" />
        <span className="ck-captured__n">×{n}</span>
      </span>
    ) : null;
  };
  const kings = (side: BoardSide) => material(shownBoard, checkersColorOf(side)).kings;

  const card = (side: BoardSide, position: 'top' | 'bottom') => {
    const seat = room.seat(side);
    const player = seat?.playerId ? state.players[seat.playerId] : undefined;
    return (
      <PlayerCard
        seat={seat}
        sideLabel={`${sideLabel(side)}${kings(side) ? ` · ${kings(side)} ${kings(side) === 1 ? 'king' : 'kings'}` : ''}`}
        swatch={swatch(side)}
        active={playing && !over && state.turn === side}
        isYou={mySide === side}
        connected={player?.connected ?? true}
        showDelta={over}
        captured={captured(side)}
        clock={<BoardClock clock={state.clock} side={side} owner={sideLabel(side)} size={narrow ? 'md' : 'lg'} />}
        position={position}
        compact={narrow}
        className="ck-card"
      />
    );
  };

  const toMove = sideLabel(state.turn as BoardSide);
  const status = over
    ? state.result.text
    : counting
      ? 'Get ready…'
      : myTurn
        ? 'Your move'
        : mySide
          ? `Waiting for ${room.seat(otherSide(mySide))?.name || sideLabel(otherSide(mySide))}`
          : `${toMove} to move`;
  const movesToDraw = Math.ceil((FORTY_MOVE_PLIES - state.quietPlies) / 2);

  return (
    <GameStage
      gameId="checkers"
      className={cx('ck', narrow && 'ck--narrow')}
      style={{ '--ck-glow': fx === 'off' ? 0 : fx === 'low' ? 0.5 : 1 } as CSSProperties}
    >
      <div className="ck-layout">
        <div className="ck-slot ck-slot--top">{card(top, 'top')}</div>
        <div className="ck-board-wrap">
          <CheckersBoard
            board={shownBoard}
            ply={shownPly}
            lastPath={lastPath}
            lastCaptures={lastCaptures}
            lastCrowned={lastCrowned}
            flipped={bottom === 'second'}
            moves={moves}
            mustCapture={mustCapture && playing && !over}
            onMove={onMove}
            onIllegal={boardSounds.illegal}
            reducedMotion={reducedMotion}
            showNumbers
            label={`Checkers board, ${sideLabel(bottom)} at the bottom`}
            className={cx(over && 'is-over')}
          />
        </div>
        {over ? (
          <div className="ck-result">
            <ResultBanner room={room} sideLabel={sideLabel} swatch={swatch} compact={phone} />
          </div>
        ) : null}
        <div className="ck-slot ck-slot--bottom">{card(bottom, 'bottom')}</div>

        <aside className="ck-side" data-part="hud" aria-label="Game panel">
          <section className={cx('ck-status', myTurn && 'is-my-turn', over && 'is-over')} data-part="status" aria-live="polite">
            <div className="ck-status__line">
              {!over ? <PieceSwatch tone={turnColor} className="ck-status__swatch" /> : <PixelIcon name="trophy" />}
              <span className="ck-status__text" data-testid="checkers-status">
                {status}
              </span>
            </div>
            {!over && playing && mustCapture ? (
              <p className="ck-status__must" role="status">
                <PixelIcon name="warning" /> Capture required{myTurn ? ' — jumps are mandatory' : ` for ${toMove}`}
              </p>
            ) : null}
            {!over && playing && state.quietPlies >= 40 ? (
              <p className="ck-status__hint">
                Draw in <b className="br-num">{movesToDraw}</b> {movesToDraw === 1 ? 'move' : 'moves'} unless a man moves or a piece is captured
              </p>
            ) : null}
            {!over && playing && state.repetitions >= 2 ? <p className="ck-status__hint">Position repeated — a third time is a draw</p> : null}
            <div className="ck-status__meta">
              <Badge color="var(--accent)">{timeControlLabel({ baseMinutes: state.clock.enabled ? Math.round(state.clock.baseMs / 60_000) : 0, incrementSeconds: Math.round(state.clock.incrementMs / 1000) })}</Badge>
              <Badge color={state.rated ? 'var(--accent-2)' : 'var(--text-2)'}>{state.rated ? 'Rated' : 'Casual'}</Badge>
              {room.tournament ? (
                <Badge color="var(--accent-2)">
                  {room.tournament.roundLabel} · Game {room.tournament.gameNumber}/{room.tournament.bestOf}
                </Badge>
              ) : state.gameNumber > 1 ? (
                <Badge color="var(--text-2)">Game {state.gameNumber}</Badge>
              ) : null}
            </div>
          </section>

          <section className="ck-moves" aria-label="Move history">
            <h2 className="ck-side__title">Moves</h2>
            <MoveList moves={history} sideLabels={SIDE_LABELS} layout={narrow ? 'strip' : 'table'} emptyText="Dark moves first." label="Move history" />
          </section>

          <BoardActionBar room={room} sideLabel={sideLabel} onFlip={() => setFlipped((f) => !f)} compact={narrow} className="ck-actions" />
        </aside>
      </div>
    </GameStage>
  );
}

