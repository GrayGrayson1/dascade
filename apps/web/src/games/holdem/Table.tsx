/** The oval table: rail, felt, board, pots, bets, dealer button, seats and chip flights. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import type { HoldemPublicState } from '@dascade/shared/games/holdem';
import { ChipStack, PlayingCard, cx } from '@dascade/ui';
import { betPoint, buttonPoint, seatPoints, type Point, type TableGeometry } from './geometry.ts';
import { collectedPot, fmt, fmtShort, handLive, totalPot, winnerTotals } from './helpers.ts';
import { FeltLogo } from './FeltLogo.tsx';
import { Seat } from './Seat.tsx';

interface Flight {
  id: number;
  from: Point;
  to: Point;
  amount: number;
  delay: number;
}

export interface TableProps {
  state: HoldemPublicState;
  geo: TableGeometry;
  mySeat: number;
  heroCards: string[];
  players: Record<string, PlayerView>;
  reducedMotion: boolean;
  fxOff: boolean;
  canSit: boolean;
  onSit: (index: number) => void;
}

function BoardCard({ code, width, delay, highlight, dim, animate }: { code: string; width: number; delay: number; highlight: boolean; dim: boolean; animate: boolean }) {
  const [up, setUp] = useState(!animate);
  useEffect(() => {
    if (up) return;
    const t = window.setTimeout(() => setUp(true), delay);
    return () => window.clearTimeout(t);
  }, [delay, up]);
  return <PlayingCard code={code} faceDown={!up} width={width} highlight={highlight && up} dim={dim && up} deal={animate} className="hd-board__card" style={{ animationDelay: `${Math.max(0, delay - 220)}ms` }} />;
}

let flightSeq = 1;

export function Table({ state, geo, mySeat, heroCards, players, reducedMotion, fxOff, canSit, onSit }: TableProps) {
  const size = state.tableSize;
  const anchor = mySeat >= 0 ? mySeat : 0;
  const points = useMemo(() => seatPoints(geo, size), [geo, size]);
  const posOf = (seat: number): Point => points[(seat - anchor + size) % size]!;
  const heroAtTable = !geo.compact && heroCards.length === 2;
  const betAt = (seat: number): Point => betPoint(geo, posOf(seat), seat === mySeat && heroAtTable);
  const boardW = geo.boardCardW;
  const boardH = Math.round(boardW * 1.4);
  const potPoint: Point = { x: geo.cx, y: geo.boardCy - boardH / 2 - 6 - geo.potH / 2 };

  const showdown = state.street === 'showdown' || (state.street === 'complete' && state.winners.some((w) => w.description));
  const totals = winnerTotals(state);
  const primary = state.winners[0];
  const highlight = showdown && primary ? primary.bestCards : [];

  // --- Board: new cards flip in one after another ---------------------------------
  const seenBoard = useRef<{ hand: number; count: number } | null>(null);
  const firstRender = seenBoard.current === null;
  const prevCount = seenBoard.current && seenBoard.current.hand === state.handNumber ? seenBoard.current.count : 0;
  useEffect(() => {
    seenBoard.current = { hand: state.handNumber, count: state.board.length };
  }, [state.handNumber, state.board.length]);

  // --- Chip flights: bets → pot at the end of a street, pot → winners at the end of a hand
  const [flights, setFlights] = useState<Flight[]>([]);
  const prevBets = useRef<Map<number, number>>(new Map());
  const prevWinHand = useRef(0);
  const flightTimers = useRef(new Set<number>());
  useEffect(
    () => () => {
      for (const t of flightTimers.current) window.clearTimeout(t);
      flightTimers.current.clear();
    },
    [],
  );
  useLayoutEffect(() => {
    const motion = !reducedMotion && !fxOff;
    const bets = new Map<number, number>();
    for (const s of state.seats) if (s.bet > 0) bets.set(s.index, s.bet);
    const next: Flight[] = [];
    if (motion && bets.size === 0 && prevBets.current.size > 0) {
      for (const [seat, amount] of prevBets.current) {
        if (seat >= size) continue;
        next.push({ id: flightSeq++, from: betAt(seat), to: potPoint, amount, delay: 0 });
      }
    }
    prevBets.current = bets;
    if (state.winners.length > 0 && prevWinHand.current !== state.handNumber) {
      prevWinHand.current = state.handNumber;
      if (motion) {
        let i = 0;
        for (const [seat, amount] of totals) {
          if (seat >= size) continue;
          next.push({ id: flightSeq++, from: potPoint, to: posOf(seat), amount, delay: 250 + i * 120 });
          i++;
        }
      }
    }
    if (next.length) {
      setFlights((f) => [...f, ...next]);
      const ids = new Set(next.map((n) => n.id));
      const timer = window.setTimeout(() => {
        flightTimers.current.delete(timer);
        setFlights((f) => f.filter((x) => !ids.has(x.id)));
      }, 1300);
      flightTimers.current.add(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.seats, state.winners, state.handNumber]);

  const pot = totalPot(state);
  const live = handLive(state);
  const collected = collectedPot(state);
  const idle = state.street === 'idle';
  const winnerLines = [...totals.entries()].map(([seat, amount]) => {
    const w = state.winners.find((x) => x.seat === seat)!;
    return { seat, amount, name: w.name, description: w.description };
  });
  const showWinners = winnerLines.length > 0 && (state.street === 'complete' || state.street === 'showdown');
  const btn = state.button >= 0 && state.button < size ? buttonPoint(geo, posOf(state.button), state.button === mySeat && heroAtTable) : null;


  return (
    <div className="hd-table" style={{ width: geo.width, height: geo.height } as CSSProperties} data-portrait={geo.portrait ? 'true' : undefined} data-compact={geo.compact ? 'true' : undefined}>
      <div
        className="hd-rail"
        style={{ left: geo.cx - geo.seatRx - 10, top: geo.cy - geo.seatRy - 10, width: (geo.seatRx + 10) * 2, height: (geo.seatRy + 10) * 2 }}
        aria-hidden
      />
      <div className="hd-felt" style={{ left: geo.cx - geo.feltRx, top: geo.cy - geo.feltRy, width: geo.feltRx * 2, height: geo.feltRy * 2 }} aria-hidden>
        <div className="hd-felt__line" />
        <div className="hd-felt__glow" />
      </div>

      <div className="hd-center" style={{ left: geo.cx, top: geo.boardCy, '--board-h': `${boardH}px` } as CSSProperties}>
        {geo.roomy && !showWinners && !(state.runout && state.street !== 'complete') ? (
          <div className="hd-logo-slot">
            <FeltLogo width={Math.min(geo.feltRx * (geo.portrait ? 1.05 : 0.6), 280)} />
          </div>
        ) : null}

        <div className="hd-pot" aria-live="polite">
          {pot > 0 ? (
            <>
              <div className="hd-pot__main">
                {collected > 0 ? <ChipStack amount={collected} size={geo.compact ? 16 : 20} maxChips={geo.compact ? 3 : 4} className="hd-pot__chips" /> : null}
                <span className="hd-pot__label">Pot</span>
                <span className="hd-pot__amount" data-testid="holdem-pot">
                  {fmt(pot)}
                </span>
              </div>
              {state.pots.length > 1 ? (
                <div className="hd-pot__sides">
                  {state.pots.map((p, i) => (
                    <span key={i} className="hd-pot__side">
                      {i === 0 ? 'Main' : `Side ${i}`} <b>{fmtShort(p.amount)}</b>
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="hd-board" style={{ '--board-w': `${boardW}px` } as CSSProperties} aria-label={state.board.length ? `Board: ${state.board.join(' ')}` : 'No community cards yet'}>
          {[0, 1, 2, 3, 4].map((i) => {
            const code = state.board[i];
            if (!code) return <span key={`slot-${i}`} className="hd-board__slot" style={{ width: boardW }} />;
            const isNew = !firstRender && i >= prevCount;
            const delay = isNew ? 120 + (i - prevCount) * 170 : 0;
            return (
              <BoardCard
                key={`${state.handNumber}-${code}`}
                code={code}
                width={boardW}
                delay={reducedMotion ? 0 : delay}
                animate={isNew && !reducedMotion}
                highlight={highlight.includes(code)}
                dim={showdown && highlight.length > 0 && !highlight.includes(code)}
              />
            );
          })}
        </div>

        {geo.roomy && state.runout && state.street !== 'complete' ? <div className="hd-runout">All-in · running it out</div> : null}

        {showWinners ? (
          <div className="hd-winner" role="status" aria-live="polite">
            {winnerLines.slice(0, 3).map((w) => (
              <div key={w.seat} className="hd-winner__line">
                <span className="hd-winner__name">{w.name}</span>
                <span className="hd-winner__amount">wins {fmt(w.amount)}</span>
                {w.description ? <span className="hd-winner__hand">{w.description}</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {idle && state.tableMessage ? <div className="hd-table-msg">{state.tableMessage}</div> : null}
      </div>

      {state.seats.map((s) =>
        s.index < size && s.bet > 0 ? (
          <Bet key={`bet-${s.index}`} amount={s.bet} at={betAt(s.index)} from={posOf(s.index)} compact={geo.compact} />
        ) : null,
      )}

      {btn ? (
        <span className="hd-dealer" style={{ left: btn.x, top: btn.y }} aria-label="Dealer button">
          D
        </span>
      ) : null}

      {state.seats.map((s) => {
        if (s.index >= size) return null;
        const order = state.button >= 0 ? (s.index - state.button - 1 + size) % size : s.index;
        return (
          <Seat
            key={s.index}
            seat={s}
            player={s.playerId ? players[s.playerId] : undefined}
            pos={posOf(s.index)}
            geo={geo}
            isMe={s.index === mySeat}
            heroCards={s.index === mySeat ? heroCards : []}
            heroCardsAtTable={!geo.compact}
            acting={state.toActSeat === s.index && state.actionDeadline > 0}
            deadline={state.actionDeadline}
            actionMs={state.actionMs}
            handNumber={state.handNumber}
            dealOrder={order}
            wonAmount={totals.get(s.index) ?? 0}
            highlightCards={highlight}
            showdown={showdown}
            live={live}
            isHost={Boolean(s.playerId && s.playerId === state.hostId)}
            canSit={canSit}
            onSit={onSit}
          />
        );
      })}

      {flights.map((f) => (
        <span
          key={f.id}
          className="hd-flight"
          style={{ left: f.from.x, top: f.from.y, '--dx': `${f.to.x - f.from.x}px`, '--dy': `${f.to.y - f.from.y}px`, animationDelay: `${f.delay}ms` } as CSSProperties}
          aria-hidden
        >
          <ChipStack amount={f.amount} size={geo.compact ? 16 : 20} maxChips={3} />
        </span>
      ))}
    </div>
  );
}

function Bet({ amount, at, from, compact }: { amount: number; at: Point; from: Point; compact: boolean }) {
  return (
    <span
      className={cx('hd-bet')}
      style={{ left: at.x, top: at.y, '--fx': `${from.x - at.x}px`, '--fy': `${from.y - at.y}px` } as CSSProperties}
      aria-label={`Bet ${fmt(amount)}`}
    >
      <ChipStack amount={amount} size={compact ? 15 : 20} maxChips={compact ? 4 : 5} />
      <span className="hd-bet__amount">{fmtShort(amount)}</span>
    </span>
  );
}
