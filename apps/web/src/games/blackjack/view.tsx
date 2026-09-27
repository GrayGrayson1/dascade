/**
 * DASjack 21 game view: a neon-lit half-moon table on desktop and tablets, a
 * stacked portrait layout on phones, plus the RESULTS leaderboard.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { PlayerView } from '@dascade/shared';
import {
  BLACKJACK_MSG,
  type BlackjackPublicState,
  type BlackjackSeatView,
  type BlackjackSettings,
  type BlackjackStage,
} from '@dascade/shared/games/blackjack';
import { cx } from '@dascade/ui';
import { useCountdown, useGame } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { GameStage } from '../../shell/common.tsx';
import { TableAnimProvider } from './anim.tsx';
import { ControlBar } from './controls.tsx';
import { TableMenu } from './menu.tsx';
import { BetSpot, ChipRack, DealerHand, DiscardTray, FeltLogo, FeltPrint, HandView, SeatPlate, Shoe } from './parts.tsx';
import { ResultsView } from './results.tsx';
import { SEAT_COUNT, parseRules, seatGeometry, useCompactLayout, useShortLandscape } from './util.ts';

type Send = (type: string, payload?: unknown) => void;

export function BlackjackView() {
  const game = useGame<BlackjackPublicState, BlackjackSettings>();
  if (!game) return null;
  if (game.phase === 'RESULTS') return <ResultsView state={game.state} playerId={game.playerId} />;
  return (
    <GameStage gameId="blackjack" className="bj-stage">
      <TableAnimProvider>
        <TableView
          state={game.state}
          settings={game.settings}
          playerId={game.playerId}
          me={game.me}
          isHost={game.isHost}
          send={game.send}
        />
      </TableAnimProvider>
    </GameStage>
  );
}

interface TableProps {
  state: BlackjackPublicState;
  settings: BlackjackSettings;
  playerId: string | null;
  me: PlayerView | undefined;
  isHost: boolean;
  send: Send;
}

function TableView({ state, settings, playerId, me, isHost, send }: TableProps) {
  const rules = useMemo(() => parseRules(state.rulesJson), [state.rulesJson]);
  const compact = useCompactLayout();
  const short = useShortLandscape();
  const mySeat = playerId ? state.seats[playerId] : undefined;
  const stage = (state.stage ?? 'IDLE') as BlackjackStage;
  useTableSounds(state, mySeat);

  const bySeat = useMemo(() => {
    const out: Array<BlackjackSeatView | null> = Array.from({ length: SEAT_COUNT }, () => null);
    for (const s of Object.values(state.seats ?? {})) out[s.seat] = s;
    return out;
  }, [state.seats]);

  const canMove = stage === 'BETTING' && !state.betsClosed && Boolean(mySeat) && !mySeat?.locked;
  const moveTo = (seat: number) => {
    sfx('select');
    send(BLACKJACK_MSG.sit, { seat });
  };

  const arenaRef = useRef<HTMLDivElement>(null);
  const feltWidth = useFeltWidth(arenaRef, !compact);
  const menu = <TableMenu rules={rules} settings={settings} isHost={isHost} endRequested={state.endRequested} compact={compact} />;
  const furniture = (
    <>
      <div className="bj-dealer-zone">
        <DiscardTray count={state.discards} size={state.shoeSize} />
        <div className="bj-dealer-zone__center">
          <ChipRack />
          <DealerHand dealer={state.dealer} round={state.round} stage={stage} />
          <StageBanner state={state} rules={rules} mySeat={mySeat} />
        </div>
        <Shoe remaining={state.shoeRemaining} size={state.shoeSize} cutRemaining={state.cutRemaining} cutReached={state.cutReached} shuffling={stage === 'SHUFFLING'} />
      </div>
    </>
  );

  return (
    <div className={cx('bj-room', compact && 'bj-room--compact', compact && short && 'bj-room--short')} data-stage={stage}>
      {compact ? (
        <CompactTable state={state} rules={rules} playerId={playerId} bySeat={bySeat} furniture={furniture} />
      ) : (
        <div
          className="bj-arena"
          ref={arenaRef}
          data-size={!feltWidth ? 'l' : feltWidth < 760 ? 's' : feltWidth < 1100 ? 'm' : feltWidth < 1500 ? 'l' : 'xl'}
          style={feltWidth ? ({ '--felt-w': `${feltWidth}px` } as CSSProperties) : undefined}
        >
          <div className="bj-table" data-part="table">
            <div className="bj-felt" data-part="felt">
              <FeltPrint rules={rules} />
              {furniture}
              {bySeat.map((seat, i) => (
                <SeatSlot
                  key={i}
                  index={i}
                  seat={seat}
                  player={seat ? state.players[seat.playerId] : undefined}
                  isMe={Boolean(seat && seat.playerId === playerId)}
                  stage={stage}
                  round={state.round}
                  rules={rules}
                  canMoveHere={canMove && !seat}
                  onMove={() => moveTo(i)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <ControlBar state={state} rules={rules} me={me} seat={mySeat} send={send} menu={menu} />
    </div>
  );
}

/** Largest half-moon (1000:495 plus rail) that fits the arena; measured, so it works in every browser. */
function useFeltWidth(ref: RefObject<HTMLDivElement | null>, enabled: boolean): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const next = Math.max(300, Math.floor(Math.min(r.width - 32, (r.height - 20) * 1.96)));
      setWidth((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return width;
}

// ---------------------------------------------------------------------------
// Wide layout: seats along the arc
// ---------------------------------------------------------------------------

function SeatSlot({
  index,
  seat,
  player,
  isMe,
  stage,
  round,
  rules,
  canMoveHere,
  onMove,
}: {
  index: number;
  seat: BlackjackSeatView | null;
  player: PlayerView | undefined;
  isMe: boolean;
  stage: BlackjackStage;
  round: number;
  rules: BlackjackSettings;
  canMoveHere: boolean;
  onMove: () => void;
}) {
  const geo = seatGeometry(index);
  const showResult = stage === 'SETTLING';
  const multi = (seat?.hands.length ?? 0) > 1;
  const deciding = Boolean(seat && stage === 'PLAYING' && seat.inRound && !seat.done);
  return (
    <div
      className="bj-seat"
      data-me={isMe ? 'true' : undefined}
      data-empty={seat ? undefined : 'true'}
      data-deciding={deciding ? 'true' : undefined}
      data-multi={multi ? 'true' : undefined}
      style={{ '--x': `${geo.x}%`, '--y': `${geo.y}%`, '--tilt': `${geo.tilt}deg` } as CSSProperties}
      aria-label={seat ? `Seat ${index + 1}: ${player?.name ?? seat.name}` : `Seat ${index + 1}: empty`}
    >
      {seat && seat.hands.length > 0 ? (
        <div className="bj-seat__hands" data-count={seat.hands.length}>
          {seat.hands.map((h, i) => (
            <HandView key={i} hand={h} index={i} seatId={seat.playerId} round={round} active={stage === 'PLAYING' && seat.activeHand === i && !seat.done} showResult={showResult} />
          ))}
        </div>
      ) : null}
      <BetSpot seat={seat} stage={stage} round={round} seatNumber={index + 1} isMe={isMe} chipSize={30} onSit={canMoveHere ? onMove : undefined} />
      {seat ? <SeatPlate seat={seat} player={player} isMe={isMe} stage={stage} decisionSeconds={rules.decisionSeconds} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact (phone portrait) layout
// ---------------------------------------------------------------------------

function CompactTable({
  state,
  rules,
  playerId,
  bySeat,
  furniture,
}: {
  state: BlackjackPublicState;
  rules: BlackjackSettings;
  playerId: string | null;
  bySeat: Array<BlackjackSeatView | null>;
  furniture: ReactNode;
}) {
  const stage = state.stage as BlackjackStage;
  const mine = playerId ? state.seats[playerId] : undefined;
  // Others in table order from the players' left (third base) to right (first base).
  const others = bySeat.filter((s): s is BlackjackSeatView => Boolean(s) && s!.playerId !== playerId).reverse();
  const showResult = stage === 'SETTLING';
  return (
    <div className="bj-compact" data-part="table">
      <div className="bj-felt bj-felt--compact" data-part="felt">
        {furniture}
        <div className="bj-compact-print" aria-hidden>
          <div className="bj-compact-print__art">
            <FeltPrint rules={rules} />
            <FeltLogo />
          </div>
        </div>
        {others.length > 0 ? (
          <div className="bj-others" aria-label="Other players">
            {others.map((s) => (
              <div key={s.playerId} className="bj-mini" data-deciding={stage === 'PLAYING' && s.inRound && !s.done ? 'true' : undefined}>
                <SeatPlate seat={s} player={state.players[s.playerId]} isMe={false} stage={stage} decisionSeconds={rules.decisionSeconds} compact />
                <div className="bj-mini__hands">
                  {s.hands.map((h, i) => (
                    <HandView key={i} hand={h} index={i} seatId={s.playerId} round={state.round} active={stage === 'PLAYING' && s.activeHand === i && !s.done} showResult={showResult} />
                  ))}
                  {s.hands.length === 0 ? <BetSpot seat={s} stage={stage} round={state.round} seatNumber={s.seat + 1} isMe={false} chipSize={20} /> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {mine ? (
          <div className="bj-mine" data-multi={mine.hands.length > 1 ? 'true' : undefined}>
            <div className="bj-mine__hands">
              {mine.hands.map((h, i) => (
                <HandView key={i} hand={h} index={i} seatId={mine.playerId} round={state.round} active={stage === 'PLAYING' && mine.activeHand === i && !mine.done} showResult={showResult} />
              ))}
            </div>
            <BetSpot seat={mine} stage={stage} round={state.round} seatNumber={mine.seat + 1} isMe chipSize={30} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage banner (centre of the felt)
// ---------------------------------------------------------------------------

function StageBanner({ state, rules, mySeat }: { state: BlackjackPublicState; rules: BlackjackSettings; mySeat: BlackjackSeatView | undefined }) {
  const remaining = useCountdown(state.stage === 'BETTING' || state.stage === 'INSURANCE' ? state.phaseEndsAt || null : null);
  const stage = state.stage as BlackjackStage;
  let title = '';
  let sub = '';
  let tone: string | undefined;
  switch (stage) {
    case 'BETTING':
      title = state.betsClosed ? 'No more bets' : 'Place your bets';
      sub = state.phaseEndsAt > 0 && !state.betsClosed ? `Closing in ${Math.ceil(remaining / 1000)}s` : `Table ${rules.minBet.toLocaleString('en-US')} – ${rules.maxBet.toLocaleString('en-US')}`;
      break;
    case 'DEALING':
      title = state.endRequested ? 'Final round' : `Round ${state.round}`;
      break;
    case 'INSURANCE':
      title = 'Insurance?';
      sub = 'Dealer shows an Ace';
      break;
    case 'PEEK':
      title = 'Dealer peeks';
      sub = 'Checking for blackjack…';
      break;
    case 'DEALER':
      title = state.dealer.blackjack ? 'Dealer blackjack' : state.statusText;
      tone = state.dealer.blackjack ? 'lose' : state.dealer.bust ? 'win' : undefined;
      break;
    case 'SETTLING': {
      const d = state.dealer;
      title = d.blackjack ? 'Dealer blackjack' : d.bust ? 'Dealer busts!' : `Dealer ${d.total}`;
      tone = d.bust ? 'win' : d.blackjack ? 'lose' : undefined;
      if (mySeat?.inRound) {
        const natural = mySeat.hands.some((h) => h.result === 'blackjack');
        sub = natural ? 'Blackjack pays!' : mySeat.net > 0 ? 'You win' : mySeat.net < 0 ? 'House wins' : 'Push';
      }
      break;
    }
    case 'SHUFFLING':
      title = 'Shuffling';
      sub = 'Fresh shoe';
      break;
    default:
      break;
  }
  if (!title && !sub) return null;
  return (
    <div className="bj-banner" data-stage={stage} data-tone={tone} key={`${stage}:${title}`} role="status" aria-live="polite">
      {title ? <span className="bj-banner__title">{title}</span> : null}
      {sub ? <span className="bj-banner__sub">{sub}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sound design hooks
// ---------------------------------------------------------------------------

function useTableSounds(state: BlackjackPublicState, mySeat: BlackjackSeatView | undefined): void {
  const prevStage = useRef(state.stage);
  const myTurnKey = useRef('');
  useEffect(() => {
    const prev = prevStage.current;
    prevStage.current = state.stage;
    if (prev === state.stage) return;
    if (state.stage === 'SETTLING' && mySeat?.inRound) {
      if (mySeat.hands.some((h) => h.result === 'blackjack')) sfx('bigwin');
      else if (mySeat.net > 0) sfx('win');
      else if (mySeat.net < 0) sfx('lose');
      else sfx('ding');
    }
    if (state.stage === 'SHUFFLING') sfx('whoosh');
    if (state.stage === 'BETTING' && prev !== 'IDLE') sfx('pop');
    if (state.stage === 'INSURANCE' && mySeat?.insuranceState === 'offered') sfx('ding');
  }, [state.stage, mySeat]);

  // A gentle cue when a decision becomes yours (including each split hand).
  useEffect(() => {
    if (state.stage !== 'PLAYING' || !mySeat || mySeat.actions.length === 0) return;
    const key = `${state.round}:${mySeat.activeHand}`;
    if (myTurnKey.current === key) return;
    myTurnKey.current = key;
    sfx('select');
  }, [state.stage, state.round, mySeat]);

  // Bust / natural stingers for your own hands.
  const statuses = mySeat?.hands.map((h) => h.status).join(',') ?? '';
  const prevStatuses = useRef(statuses);
  useEffect(() => {
    const before = prevStatuses.current.split(',');
    prevStatuses.current = statuses;
    statuses.split(',').forEach((s, i) => {
      if (s === before[i]) return;
      if (s === 'bust') sfx('wrong');
      if (s === 'blackjack') sfx('coin');
    });
  }, [statuses]);
}
