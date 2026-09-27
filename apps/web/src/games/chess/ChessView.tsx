/**
 * DAS Chess — game screen. Layouts:
 *  - wide (desktop, tablet landscape): cards above/below the board, side panel with moves + actions;
 *  - stack (phones/tablets in portrait): card · board (full width) · card · move strip · actions;
 *  - short (phones in landscape): board fills the height on the left, everything else on the right.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { otherSide, timeControlLabel, clockCategory, type BoardSide } from '@dascade/shared/games/boardroom';
import type { ChessPublicState, ChessSettings } from '@dascade/shared/games/chess';
import { materialBalance, sideColor, squareAt, type PieceType } from '@dascade/game-core/chess';
import { Badge, Button, IconButton, PixelIcon, cx } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { useSettings } from '../../net/hooks.ts';
import { GameStage } from '../../shell/common.tsx';
import {
  BoardActionBar,
  BoardClock,
  MoveList,
  PlayerCard,
  ResultBanner,
  SquareBoard,
  useBoardEventSounds,
  useBoardroom,
  useClockMs,
  boardSounds,
  type Boardroom,
} from '../_boardroom/index.ts';
import { ChessPiece, pieceName, type PieceColor, type PieceKind } from './pieces.tsx';
import { PromotionPicker } from './Promotion.tsx';
import { RulesModal } from './Rules.tsx';
import { copyText, currentPgn, downloadText } from './pgn.ts';
import { useChessBoard, type ChessBoardController } from './useChessBoard.ts';

type Layout = 'wide' | 'stack' | 'short';

function useLayoutMode(): Layout {
  const get = (): Layout => {
    if (typeof window === 'undefined') return 'wide';
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w > h && h <= 560) return 'short';
    if (w < 900 || h > w * 1.15) return 'stack';
    return 'wide';
  };
  const [mode, setMode] = useState<Layout>(get);
  useEffect(() => {
    const on = () => setMode(get());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return mode;
}

const SIDE_LABEL = (side: BoardSide) => (side === 'first' ? 'White' : 'Black');
const FILES = 'abcdefgh';
const squareIdOf = (file: number, rank: number) => squareAt(file, rank) ?? `${FILES[file]}${rank + 1}`;

export function ChessView() {
  const [flipped, setFlipped] = useState(false);
  const room = useBoardroom<ChessPublicState, ChessSettings>(flipped);
  if (!room) return null;
  return <ChessGameView room={room} onFlip={() => setFlipped((f) => !f)} />;
}

function Captured({ fen, color }: { fen: string; color: PieceColor }) {
  const bal = materialBalance(fen);
  const up = bal[color];
  const score = color === 'w' ? bal.score : -bal.score;
  const theirs: PieceColor = color === 'w' ? 'b' : 'w';
  const items: PieceType[] = [];
  for (const t of ['q', 'r', 'b', 'n', 'p'] as const) for (let i = 0; i < (up[t] ?? 0); i++) items.push(t);
  if (items.length === 0 && score <= 0) return <span className="ch-captured ch-captured--empty" aria-hidden />;
  return (
    <span className="ch-captured" aria-label={`Material: ${score > 0 ? `+${score}` : 'even'}`}>
      {items.map((t, i) => (
        <ChessPiece key={`${t}${i}`} kind={t as PieceKind} color={theirs} className="ch-captured__piece" />
      ))}
      {score > 0 ? <span className="ch-captured__score br-num">+{score}</span> : null}
    </span>
  );
}

function StatusLine({
  state,
  ctl,
  room,
}: {
  state: ChessPublicState;
  ctl: ChessBoardController;
  room: Boardroom<ChessPublicState, ChessSettings>;
}) {
  const { live, mySide } = room;
  let text: string;
  let tone: 'accent' | 'warn' | 'muted' = 'muted';
  if (state.phase === 'COUNTDOWN') text = 'Get ready…';
  else if (state.result.over) text = state.result.text;
  else if (ctl.review !== null)
    text = `Reviewing move ${Math.floor(ctl.review / 2) + 1}${ctl.review % 2 ? '…' : '.'} ${ctl.sans[ctl.review] ?? ''}`;
  else if (live) {
    const turnName = SIDE_LABEL(state.turn);
    const mine = mySide === state.turn;
    text = state.inCheck
      ? mine
        ? 'Check! Your king is attacked'
        : `${turnName} is in check`
      : mine
        ? 'Your move'
        : mySide
          ? `Waiting for ${turnName}`
          : `${turnName} to move`;
    tone = state.inCheck ? 'warn' : mine ? 'accent' : 'muted';
  } else text = '';
  const hints: string[] = [];
  if (room.tournament?.decider === 'armageddon' && !state.result.over) hints.push('Armageddon decider: a draw counts as a win for Black.');
  if (live && ctl.review === null) {
    if (state.repetition === 2) hints.push('This position has occurred twice — a third time is an automatic draw.');
    if (state.halfmoveClock >= 80)
      hints.push(`Fifty-move rule: ${Math.max(0, Math.ceil((100 - state.halfmoveClock) / 2))} moves left without a capture or pawn move.`);
    if (ctl.premove) hints.push(`Premove queued: ${ctl.premove.from}→${ctl.premove.to} (Esc cancels)`);
  }
  return (
    <div className="ch-status" data-part="status" data-tone={tone} role="status" aria-live="polite">
      <span className="ch-status__text">{text}</span>
      {hints.map((h) => (
        <span key={h} className="ch-status__hint">
          {h}
        </span>
      ))}
    </div>
  );
}

function ChessGameView({ room, onFlip }: { room: Boardroom<ChessPublicState, ChessSettings>; onFlip: () => void }) {
  const { state, mySide, bottomSide, live, game } = room;
  const settings = useSettings<ChessSettings>() ?? (game.settings as ChessSettings);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const layout = useLayoutMode();
  const ctl = useChessBoard(state, mySide, live);
  const [rules, setRules] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  useBoardEventSounds('chess', mySide);

  // Board size = the largest square that fits. Wide layout: the width budget is the layout minus the side
  // panel (so the board + panel group can be centred); other layouts: the board area itself.
  const areaRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      let w = area.clientWidth;
      const h = area.clientHeight;
      const lay = layoutRef.current;
      const side = sideRef.current;
      if (layout === 'wide' && lay && side) {
        const cs = getComputedStyle(lay);
        w = lay.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.columnGap || '0') - side.offsetWidth;
      }
      setSize(Math.max(160, Math.floor(Math.min(w, h))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    if (layoutRef.current) ro.observe(layoutRef.current);
    return () => ro.disconnect();
  }, [layout]);

  // Keyboard: ←/→ review, F flip, Esc cancels a premove.
  const reviewRef = useRef(ctl);
  reviewRef.current = ctl;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const c = reviewRef.current;
      const n = c.sans.length;
      if (e.key === 'ArrowLeft' && !(t && t.closest('.br-board'))) {
        if (n === 0) return;
        e.preventDefault();
        const cur = c.review ?? n - 1;
        c.setReview(Math.max(0, cur - 1));
      } else if (e.key === 'ArrowRight' && !(t && t.closest('.br-board'))) {
        if (c.review === null) return;
        e.preventDefault();
        const next = c.review + 1;
        c.setReview(next >= n - 1 ? null : next);
      } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
        onFlip();
      } else if (e.key === 'Escape' && c.premove) {
        c.cancelPremove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFlip]);

  // Low-time tick on my own clock.
  const myMs = useClockMs(state.clock, mySide ?? 'first');
  const lowSecond =
    mySide && state.clock.enabled && state.clock.running === mySide && myMs > 0 && myMs <= 10_000 ? Math.ceil(myMs / 1000) : 0;
  useEffect(() => {
    if (lowSecond) boardSounds.lowTime();
  }, [lowSecond]);

  const pieces = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    const g = ctl.game;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = squareIdOf(f, r);
        const p = g.piece(sq);
        if (p) out[sq] = <ChessPiece kind={p.type} color={p.color} />;
      }
    }
    return out;
  }, [ctl.game]);

  const squareName = useCallback(
    (sq: string) => {
      const p = ctl.game.piece(sq);
      return p ? `${sq}, ${pieceName(p.type, p.color)}` : sq;
    },
    [ctl.game],
  );

  const topSide = otherSide(bottomSide);
  const players = state.players;
  const card = (side: BoardSide, position: 'top' | 'bottom', compact: boolean) => {
    const seat = room.seat(side);
    const player = seat?.playerId ? players[seat.playerId] : undefined;
    return (
      <PlayerCard
        key={side}
        seat={seat}
        sideLabel={SIDE_LABEL(side)}
        swatch={<ChessPiece kind="k" color={sideColor(side)} />}
        active={live && state.turn === side}
        isYou={mySide === side}
        connected={seat?.playerId ? Boolean(player?.connected) : true}
        showDelta={state.result.over && state.rated}
        captured={<Captured fen={ctl.fen} color={sideColor(side)} />}
        clock={<BoardClock clock={state.clock} side={side} owner={SIDE_LABEL(side)} size={compact ? 'md' : 'lg'} />}
        position={position}
        compact={compact}
        className="ch-card"
      />
    );
  };

  const copyPgn = async () => {
    const ok = await copyText(currentPgn(state, settings, state.startedAt || Date.now()));
    setCopied(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopied('idle'), 1800);
  };
  const downloadPgn = () =>
    downloadText(`dascade-chess-${state.code}-game${state.gameNumber}.pgn`, currentPgn(state, settings, state.startedAt || Date.now()));
  const pgnButtons = (
    <Button
      size="sm"
      variant="ghost"
      icon={copied === 'ok' ? 'check' : 'copy'}
      onClick={copyPgn}
      disabled={state.moves.length === 0 && !state.result.over}
    >
      {copied === 'ok' ? 'PGN copied' : copied === 'fail' ? 'Copy failed' : 'Copy PGN'}
    </Button>
  );

  const actionBar = (
    <BoardActionBar
      room={room}
      sideLabel={SIDE_LABEL}
      onFlip={onFlip}
      compact={layout === 'short'}
      iconTools={layout === 'stack'}
      extra={
        <>
          {layout === 'wide' ? (
            <Button size="sm" variant="ghost" icon="help" onClick={() => setRules(true)}>
              Rules
            </Button>
          ) : (
            <IconButton icon="help" label="Chess rules" size="sm" onClick={() => setRules(true)} />
          )}
          {layout === 'wide' ? (
            pgnButtons
          ) : (
            <IconButton
              icon={copied === 'ok' ? 'check' : 'copy'}
              label={copied === 'ok' ? 'PGN copied' : 'Copy PGN'}
              size="sm"
              onClick={copyPgn}
            />
          )}
        </>
      }
    />
  );

  const board = (
    <div className="ch-board-area" ref={areaRef}>
      <div className="ch-board-wrap" style={{ '--ch-board': `${size}px` } as CSSProperties}>
        {size > 0 ? (
          <SquareBoard
            squareId={squareIdOf}
            flipped={bottomSide === 'second'}
            pieces={pieces}
            selected={ctl.selected}
            targets={ctl.targets}
            lastMove={ctl.lastMove}
            check={ctl.check}
            premove={ctl.premove ? [ctl.premove.from, ctl.premove.to] : undefined}
            squareName={squareName}
            interactive={ctl.interactive}
            canPick={ctl.canPick}
            onSelect={ctl.onSelect}
            onMove={ctl.onMove}
            animation={ctl.animation}
            reducedMotion={reducedMotion}
            label="Chess board"
          />
        ) : null}
        {ctl.promotion && mySide ? <PromotionPicker color={sideColor(mySide)} onChoose={ctl.choosePromotion} /> : null}
        {state.result.over ? (
          <div className="ch-result-layer">
            <ResultBanner
              room={room}
              sideLabel={SIDE_LABEL}
              swatch={(side) => <ChessPiece kind="k" color={sideColor(side)} />}
              compact={size < 520}
              extra={
                size < 520 ? (
                  <>
                    <IconButton
                      icon={copied === 'ok' ? 'check' : 'copy'}
                      label={copied === 'ok' ? 'PGN copied' : 'Copy PGN'}
                      size="sm"
                      onClick={copyPgn}
                    />
                    <IconButton icon="arrow-right" label="Download PGN" size="sm" onClick={downloadPgn} />
                  </>
                ) : (
                  <>
                    {pgnButtons}
                    <Button size="sm" variant="ghost" icon="arrow-right" onClick={downloadPgn}>
                      Download PGN
                    </Button>
                  </>
                )
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  const reviewBar =
    ctl.review !== null ? (
      <div className="ch-review">
        <span>
          <PixelIcon name="eye" /> Reviewing — the game continues live
        </span>
        <Button size="sm" variant="primary" icon="play" onClick={() => ctl.setReview(null)}>
          Back to live
        </Button>
      </div>
    ) : null;

  const moveList = (layoutKind: 'table' | 'strip') => (
    <MoveList
      moves={ctl.sans}
      sideLabels={['White', 'Black']}
      current={ctl.review}
      onSelect={ctl.setReview}
      layout={layoutKind}
      emptyText={live ? 'White to make the first move.' : 'No moves yet'}
    />
  );

  const header = (
    <header className="ch-head">
      <span className="ch-head__brand">
        <ChessPiece kind="n" color="w" className="ch-head__icon" /> DAS Chess
      </span>
      <span className="ch-head__tags">
        <Badge color="var(--accent)" icon="clock">
          {timeControlLabel(settings.timeControl ?? { baseMinutes: 0, incrementSeconds: 0 })}
          {state.clock.enabled ? ` · ${clockCategory(settings.timeControl)}` : ''}
        </Badge>
        <Badge color={state.rated ? 'var(--yellow)' : 'var(--text-2)'} icon={state.rated ? 'trophy' : undefined}>
          {state.rated ? 'Rated' : 'Casual'}
        </Badge>
        {!mySide ? (
          <Badge color="var(--purple)" icon="eye">
            Spectating
          </Badge>
        ) : null}
      </span>
    </header>
  );

  return (
    <GameStage gameId="chess" className={cx('ch', `ch--${layout}`)} style={{ '--ch-board': `${size}px` } as CSSProperties}>
      {layout === 'wide' ? (
        <div className="ch-layout" ref={layoutRef}>
          <div className="ch-main">
            {card(topSide, 'top', false)}
            {board}
            {card(bottomSide, 'bottom', false)}
          </div>
          <aside className="ch-side" data-part="hud" aria-label="Game panel" ref={sideRef}>
            {header}
            <StatusLine state={state} ctl={ctl} room={room} />
            <div className="ch-side__moves">{moveList('table')}</div>
            {reviewBar}
            {actionBar}
          </aside>
        </div>
      ) : layout === 'stack' ? (
        <div className="ch-layout">
          {card(topSide, 'top', true)}
          {board}
          {card(bottomSide, 'bottom', true)}
          <StatusLine state={state} ctl={ctl} room={room} />
          {moveList('strip')}
          {reviewBar}
          {actionBar}
        </div>
      ) : (
        <div className="ch-layout">
          {board}
          <aside className="ch-side" data-part="hud" aria-label="Game panel">
            {card(topSide, 'top', true)}
            <StatusLine state={state} ctl={ctl} room={room} />
            {moveList('strip')}
            {reviewBar}
            {actionBar}
            {card(bottomSide, 'bottom', true)}
          </aside>
        </div>
      )}
      <RulesModal open={rules} onClose={() => setRules(false)} />
    </GameStage>
  );
}
