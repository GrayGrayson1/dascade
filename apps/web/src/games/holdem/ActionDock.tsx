/**
 * Bottom dock: the hero's cards and hand strength, the legal betting actions
 * (with raise slider / amount / pot presets) and seat controls (sit out, rebuy, show).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HOLDEM_MSG, type HoldemLegalView, type HoldemPublicState, type HoldemSettings } from '@dascade/shared/games/holdem';
import { Button, Kbd, PlayingCard, Slider, cx } from '@dascade/ui';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { fmt, handLive, heroBestCards, heroHandLabel, totalPot } from './helpers.ts';

export interface DockProps {
  state: HoldemPublicState;
  settings: HoldemSettings;
  mySeat: number;
  heroCards: string[];
  myTurn: boolean;
  compact: boolean;
  isSpectator: boolean;
  canSit: boolean;
  /** Dock lives in a side column (landscape phones): smaller hero cards. */
  side?: boolean;
  /** Short screens: the raise sizing panel opens only when Raise is pressed. */
  collapseRaise?: boolean;
}

function send(type: string, payload?: unknown) {
  session.send(type, payload);
}

/** Chip amounts inside button labels use the pixel numeral font. */
function Amt({ n }: { n: number }) {
  return <span className="hd-amt">{fmt(n)}</span>;
}

function Key({ k }: { k: string }) {
  return (
    <span aria-hidden className="hd-key">
      <Kbd>{k}</Kbd>
    </span>
  );
}

export function ActionDock({ state, settings, mySeat, heroCards, myTurn, compact, isSpectator, canSit, side = false, collapseRaise = false }: DockProps) {
  const seat = mySeat >= 0 ? state.seats[mySeat] : undefined;
  const inHand = Boolean(seat?.inHand && !seat.folded && heroCards.length === 2);
  const live = handLive(state);
  const label = inHand || (seat?.inHand && heroCards.length === 2) ? heroHandLabel(heroCards, state.board) : '';
  const best = inHand ? heroBestCards(heroCards, state.board) : [];
  const handOver = !live;
  const showCardsInDock = compact && heroCards.length === 2 && Boolean(seat?.inHand);

  return (
    <div className="hd-dock" data-compact={compact ? 'true' : undefined} data-turn={myTurn ? 'true' : undefined}>
      <div className="hd-dock__inner">
        <div className="hd-hero">
          {showCardsInDock ? (
            <div className="hd-hero__cards" key={state.handNumber}>
              {heroCards.map((c, i) => (
                <PlayingCard
                  key={c}
                  code={c}
                  width={side ? 44 : 58}
                  deal
                  dim={Boolean(seat?.folded)}
                  highlight={best.includes(c) && (seat?.won ?? 0) > 0}
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          ) : null}
          <div className="hd-hero__text">
            <HeroStatus state={state} seatIndex={mySeat} label={label} isSpectator={isSpectator} canSit={canSit} myTurn={myTurn} />
          </div>
        </div>

        <div className="hd-dock__actions">
          {myTurn && seat && state.legal.seat === mySeat ? (
            <BetControls key={state.actionSeq} state={state} legal={state.legal} compact={compact} collapsible={collapseRaise} />
          ) : (
            <>
              {!compact || side ? <RecentLog state={state} /> : null}
              <SeatControls state={state} settings={settings} seatIndex={mySeat} heroCards={heroCards} handOver={handOver} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The last few lines of this hand's history, filling the dock while you wait. */
function RecentLog({ state }: { state: HoldemPublicState }) {
  const lines = state.log.filter((l) => l.hand === state.handNumber && l.kind !== 'hand').slice(-3);
  if (lines.length === 0) return <div className="hd-feed" aria-hidden />;
  return (
    <ul className="hd-feed" aria-label="Latest actions">
      {lines.map((l, i) => (
        <li key={`${state.handNumber}-${state.log.length}-${i}`} className="hd-feed__line" data-kind={l.kind}>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

function HeroStatus({
  state,
  seatIndex,
  label,
  isSpectator,
  canSit,
  myTurn,
}: {
  state: HoldemPublicState;
  seatIndex: number;
  label: string;
  isSpectator: boolean;
  canSit: boolean;
  myTurn: boolean;
}) {
  const seat = seatIndex >= 0 ? state.seats[seatIndex] : undefined;
  const live = handLive(state);
  const playing = Boolean(seat?.inHand && live);
  if (!seat) {
    return (
      <>
        <span className="hd-hero__kicker">{isSpectator ? 'Spectating' : 'Not seated'}</span>
        <span className="hd-hero__line">{canSit ? 'Tap an open seat to join the next hand.' : 'Enjoy the show — every seat is taken.'}</span>
      </>
    );
  }
  const acting = state.toActSeat >= 0 ? state.seats[state.toActSeat] : undefined;
  let line: string;
  if (myTurn) line = 'Your turn';
  else if (seat.busted && !playing) line = 'Out of chips';
  else if (seat.sittingOut && !playing) line = seat.sitOutReason === 'timeout' ? 'Sat out (timed out)' : seat.sitOutReason === 'away' ? 'Sat out while away' : 'Sitting out';
  else if (seat.waiting) line = 'You’re in from the next hand';
  else if (seat.folded && playing) line = 'Folded';
  else if (state.runout && playing) line = 'All-in · running out the board';
  else if (seat.allIn && playing) line = 'All-in';
  else if (acting && playing) line = `Waiting for ${acting.name}…`;
  else if (seat.sittingOut && playing) line = 'Sitting out from the next hand';
  else line = live ? 'Watching this hand' : state.street === 'idle' ? 'Waiting for the next hand' : 'Hand over';
  return (
    <>
      <span className="hd-hero__kicker">
        <span className="hd-hero__stack">{fmt(seat.stack)}</span> virtual chips
      </span>
      {label ? <span className="hd-hero__hand">{label}</span> : null}
      <span className={cx('hd-hero__line', myTurn && 'hd-hero__line--turn')}>{line}</span>
    </>
  );
}

function SeatControls({
  state,
  settings,
  seatIndex,
  heroCards,
  handOver,
}: {
  state: HoldemPublicState;
  settings: HoldemSettings;
  seatIndex: number;
  heroCards: string[];
  handOver: boolean;
}) {
  const seat = seatIndex >= 0 ? state.seats[seatIndex] : undefined;
  if (!seat) return null;
  const canShow = handOver && state.street === 'complete' && heroCards.length === 2 && seat.inHand && seat.shownCards.length === 0;
  return (
    <div className="hd-seat-controls">
      {canShow ? (
        <Button size="sm" variant="secondary" icon="eye" onClick={() => send(HOLDEM_MSG.show, {})}>
          Show cards
        </Button>
      ) : null}
      {seat.busted && seat.stack === 0 && settings.allowRebuys ? (
        <Button variant="gold" icon="chip" onClick={() => (sfx('coin'), send(HOLDEM_MSG.rebuy, {}))}>
          Rebuy <Amt n={settings.startingStack} />
        </Button>
      ) : null}
      {seat.sittingOut ? (
        <Button variant="primary" icon="play" onClick={() => send(HOLDEM_MSG.sitOut, { sittingOut: false })}>
          I’m back
        </Button>
      ) : !seat.busted ? (
        <Button size="sm" variant="ghost" icon="pause" onClick={() => send(HOLDEM_MSG.sitOut, { sittingOut: true })}>
          Sit out
        </Button>
      ) : null}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function BetControls({ state, legal, compact, collapsible }: { state: HoldemPublicState; legal: HoldemLegalView; compact: boolean; collapsible: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const [draft, setDraft] = useState(String(legal.minRaiseTo));
  const [sent, setSent] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const min = legal.minRaiseTo;
  const max = legal.maxRaiseTo;
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));

  const pot = totalPot(state);
  const presets = useMemo(() => {
    if (!legal.canRaise || max <= min) return [] as Array<{ label: string; value: number }>;
    const potRaise = (f: number) => (legal.isBet ? Math.round(pot * f) : state.currentBet + Math.round((pot + legal.callAmount) * f));
    const list: Array<{ label: string; value: number }> = [{ label: 'Min', value: min }];
    for (const [label, f] of [
      ['½ Pot', 0.5],
      ['¾ Pot', 0.75],
      ['Pot', 1],
    ] as const) {
      const v = potRaise(f);
      if (v > min && v < max) list.push({ label, value: v });
    }
    return list;
  }, [legal.canRaise, legal.isBet, legal.callAmount, max, min, pot, state.currentBet]);

  // A rejected action (e.g. a stale click) re-enables the buttons.
  useRoomMessage<{ type?: string }>('sys:error', (e) => {
    if (e.type === HOLDEM_MSG.act) setSent(false);
  });

  const act = (action: string, amount?: number) => {
    if (sent) return;
    setSent(true);
    send(HOLDEM_MSG.act, { action, amount, seq: state.actionSeq });
  };
  const choose = (v: number) => {
    const c = clamp(v);
    setRaiseTo(c);
    setDraft(String(c));
  };
  const commitDraft = () => {
    const n = Number(draft.replace(/[^\d]/g, ''));
    choose(Number.isFinite(n) && n > 0 ? n : min);
  };
  const raiseIsAllIn = raiseTo >= max;
  const raise = () => {
    if (!legal.canRaise) return;
    if (!open) {
      setOpen(true);
      return;
    }
    if (raiseIsAllIn) act('allin');
    else act(legal.isBet ? 'bet' : 'raise', raiseTo);
  };
  const callAllIn = legal.canCall && !legal.canRaise && legal.callAmount >= (state.seats[legal.seat]?.stack ?? Infinity);

  // Keyboard shortcuts: F fold · C check/call · R raise/bet · A all-in.
  const handlers = useRef({ act, raise, choose });
  handlers.current = { act, raise, choose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      const h = handlers.current;
      if (k === 'f') h.act('fold');
      else if (k === 'c' || k === 'k') h.act(legal.canCheck ? 'check' : 'call');
      else if (k === 'r' || k === 'b') {
        if (legal.canRaise) h.raise();
      } else if (k === 'a') {
        if (legal.canRaise) {
          setOpen(true);
          h.choose(max);
        }
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [legal.canCheck, legal.canRaise, max]);

  const fillPct = max > min ? ((raiseTo - min) / (max - min)) * 100 : 100;

  return (
    <div className={cx('hd-bet-controls', compact && 'hd-bet-controls--compact')} role="group" aria-label="Your action">
      {legal.canRaise && open ? (
        <div className="hd-raise">
          <div className="hd-raise__presets" role="group" aria-label="Bet size presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="hd-preset"
                aria-pressed={raiseTo === p.value}
                aria-label={`${p.label} size: ${fmt(p.value)}`}
                onClick={() => choose(p.value)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="hd-preset hd-preset--allin"
              aria-pressed={raiseIsAllIn}
              aria-label={`All-in size: ${fmt(max)}`}
              onClick={() => choose(max)}
            >
              All-in
            </button>
            {collapsible ? (
              <button type="button" className="hd-preset hd-preset--close" aria-label="Hide bet sizing" onClick={() => setOpen(false)}>
                ✕
              </button>
            ) : null}
          </div>
          <div className="hd-raise__row">
            <Slider
              className="hd-raise__slider"
              value={raiseTo}
              min={min}
              max={max}
              step={1}
              onChange={(v) => choose(v)}
              aria-label={legal.isBet ? 'Bet amount' : 'Raise to amount'}
              disabled={max <= min}
              style={{ '--fill': `${fillPct}%` } as CSSProperties}
            />
            <input
              ref={amountRef}
              className="dc-input hd-raise__input"
              inputMode="numeric"
              aria-label={legal.isBet ? 'Bet amount in chips' : 'Raise to, in chips'}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value.replace(/[^\d]/g, '').slice(0, 10))}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const n = Number(draft.replace(/[^\d]/g, ''));
                  const c = clamp(Number.isFinite(n) && n > 0 ? n : min);
                  setRaiseTo(c);
                  setDraft(String(c));
                  if (c >= max) act('allin');
                  else act(legal.isBet ? 'bet' : 'raise', c);
                }
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="hd-actions">
        <Button variant="danger" className="hd-action hd-action--fold" onClick={() => act('fold')} disabled={sent}>
          Fold
          {!compact ? <Key k="F" /> : null}
        </Button>
        {legal.canCheck ? (
          <Button variant="secondary" className="hd-action hd-action--check" onClick={() => act('check')} disabled={sent}>
            Check
            {!compact ? <Key k="C" /> : null}
          </Button>
        ) : (
          <Button variant="success" className="hd-action hd-action--call" onClick={() => act('call')} disabled={sent}>
            <span className="hd-action__verb">{callAllIn ? 'All-in' : 'Call'}</span> <Amt n={legal.callAmount} />
            {!compact ? <Key k="C" /> : null}
          </Button>
        )}
        {legal.canRaise ? (
          <Button variant="gold" className="hd-action hd-action--raise" onClick={raise} disabled={sent}>
            {open ? (
              <>
                <span className="hd-action__verb">{raiseIsAllIn ? 'All-in' : legal.isBet ? 'Bet' : 'Raise to'}</span> <Amt n={raiseIsAllIn ? max : raiseTo} />
              </>
            ) : (
              <>
                <span className="hd-action__verb">{legal.isBet ? 'Bet' : 'Raise'}</span> <Amt n={min} />
                <span className="hd-action__more">+</span>
              </>
            )}
            {!compact ? <Key k="R" /> : null}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
