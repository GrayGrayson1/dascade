/**
 * The bottom control bar: betting rail, insurance prompt, decision buttons and
 * status. Only server-legal actions are shown. Keyboard shortcuts on desktop.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatChips, type PlayerView } from '@dascade/shared';
import {
  BLACKJACK_MSG,
  type BlackjackAction,
  type BlackjackPublicState,
  type BlackjackSeatView,
  type BlackjackSettings,
} from '@dascade/shared/games/blackjack';
import { Button, CasinoChip, Kbd, PixelIcon, TimerRing, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { ACTION_KEY, ACTION_LABEL, BET_CHIPS, signed, totalWager } from './util.ts';

type Send = (type: string, payload?: unknown) => void;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || Boolean(el.closest?.('dialog[open]'));
}

/** Global single-key shortcuts (ignored while typing or when a modal is open). */
function useHotkeys(map: Record<string, () => void>, enabled: boolean): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const fn = ref.current[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

// ---------------------------------------------------------------------------
// Betting
// ---------------------------------------------------------------------------

function BettingControls({ seat, rules, state, send }: { seat: BlackjackSeatView; rules: BlackjackSettings; state: BlackjackPublicState; send: Send }) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? seat.bet;
  const available = seat.balance + seat.bet;
  const ceiling = Math.min(available, rules.maxBet);
  const remaining = useCountdown(state.phaseEndsAt || null);

  useEffect(() => {
    if (draft === null) return;
    if (seat.bet === draft) {
      setDraft(null);
      return;
    }
    const t = setTimeout(() => setDraft(null), 1500);
    return () => clearTimeout(t);
  }, [draft, seat.bet]);

  const setBet = useCallback(
    (amount: number) => {
      const next = Math.max(0, Math.min(ceiling, Math.floor(amount)));
      if (next === shown) return;
      setDraft(next);
      send(BLACKJACK_MSG.bet, { amount: next });
      sfx('chip');
    },
    [ceiling, send, shown],
  );
  const chips = BET_CHIPS.filter((v) => v <= rules.maxBet);
  const canDeal = shown >= rules.minBet && shown <= ceiling;
  const rebet = seat.lastBet > 0 && seat.lastBet <= ceiling ? seat.lastBet : 0;
  const doubleRebet = seat.lastBet > 0 && seat.lastBet * 2 <= ceiling ? seat.lastBet * 2 : 0;
  const lock = () => {
    if (!canDeal) return;
    sfx('chip');
    send(BLACKJACK_MSG.lock, { locked: true });
  };
  const rebetAndDeal = () => {
    if (!rebet) return;
    send(BLACKJACK_MSG.bet, { amount: rebet });
    send(BLACKJACK_MSG.lock, { locked: true });
    sfx('chip');
  };

  useHotkeys(
    {
      ...Object.fromEntries(chips.map((v, i) => [String(i + 1), () => setBet(shown + v)])),
      enter: () => (canDeal ? lock() : rebet && shown === 0 ? rebetAndDeal() : undefined),
      backspace: () => setBet(0),
      c: () => setBet(0),
      b: () => rebet && setBet(rebet),
    },
    !seat.locked && !state.betsClosed,
  );

  if (state.betsClosed) {
    // "No more bets" is final on the server: nothing here can change any more.
    const playing = seat.bet >= rules.minBet && seat.bet <= rules.maxBet;
    return (
      <div className="bj-ctl bj-ctl--locked">
        <div className="bj-ctl__prompt">
          <span className="bj-ctl__title">No more bets</span>
          <span className="bj-ctl__hint">{playing ? `Your ${formatChips(seat.bet)} is in — dealing…` : 'Sitting this round out — dealing…'}</span>
        </div>
      </div>
    );
  }

  if (seat.locked) {
    return (
      <div className="bj-ctl bj-ctl--locked">
        <div className="bj-ctl__prompt">
          <span className="bj-ctl__title">{seat.sittingOut ? 'Sitting this round out' : `Bet locked · ${formatChips(seat.bet)}`}</span>
          <span className="bj-ctl__hint">Waiting for the other players…</span>
        </div>
        <Button variant="ghost" icon="pencil" onClick={() => send(BLACKJACK_MSG.lock, { locked: false })}>
          {seat.sittingOut ? 'Play this round' : 'Change bet'}
        </Button>
      </div>
    );
  }

  return (
    <div className="bj-ctl bj-ctl--bet">
      <div className="bj-rail" role="group" aria-label="Chips">
        {chips.map((v, i) => (
          <button
            key={v}
            type="button"
            className="bj-rail__chip"
            disabled={shown + v > ceiling}
            onClick={() => setBet(shown + v)}
            aria-label={`Add ${formatChips(v)} chip`}
            title={`Add ${formatChips(v)} (${i + 1})`}
          >
            <CasinoChip value={v} size={46} />
            <span className="bj-rail__key" aria-hidden>
              {i + 1}
            </span>
          </button>
        ))}
      </div>
      <div className="bj-ctl__actions">
        <Button size="sm" variant="ghost" icon="trash" disabled={shown === 0} onClick={() => setBet(0)}>
          Clear
        </Button>
        <Button size="sm" variant="secondary" icon="refresh" disabled={!rebet || rebet === shown} onClick={() => setBet(rebet)} title="Rebet (B)">
          Rebet{rebet ? ` ${formatChips(rebet)}` : ''}
        </Button>
        <Button size="sm" variant="secondary" disabled={!doubleRebet || doubleRebet === shown} onClick={() => setBet(doubleRebet)}>
          2× {doubleRebet ? formatChips(doubleRebet) : ''}
        </Button>
        {shown === 0 && rebet ? (
          <Button variant="primary" icon="play" onClick={rebetAndDeal}>
            Rebet &amp; deal
          </Button>
        ) : (
          <Button variant="primary" icon="play" disabled={!canDeal} onClick={lock} aria-keyshortcuts="Enter">
            {shown > 0 ? `Deal · ${formatChips(shown)}` : 'Deal'}
          </Button>
        )}
        {shown === 0 ? (
          <Button size="sm" variant="ghost" onClick={() => send(BLACKJACK_MSG.lock, { locked: true })}>
            Sit out
          </Button>
        ) : null}
        {state.phaseEndsAt > 0 ? (
          <TimerRing seconds={Math.ceil(remaining / 1000)} progress={remaining / (rules.bettingSeconds * 1000)} size={44} label="Betting closes" />
        ) : null}
      </div>
      <p className="bj-ctl__fine">
        Table {formatChips(rules.minBet)}–{formatChips(rules.maxBet)} · virtual chips only, no cash value
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

function InsuranceControls({ seat, state, rules, send }: { seat: BlackjackSeatView; state: BlackjackPublicState; rules: BlackjackSettings; send: Send }) {
  const remaining = useCountdown(state.phaseEndsAt || null);
  const natural = seat.hands[0]?.label === 'Blackjack';
  const cost = Math.floor(seat.bet / 2);
  const take = () => send(BLACKJACK_MSG.insurance, { take: true });
  const decline = () => send(BLACKJACK_MSG.insurance, { take: false });
  useHotkeys({ i: take, y: take, n: decline }, true);
  return (
    <div className="bj-ctl bj-ctl--decide">
      <div className="bj-ctl__prompt">
        <span className="bj-ctl__title">{natural ? 'Even money?' : 'Insurance?'}</span>
        <span className="bj-ctl__hint">
          {natural ? `Take a guaranteed +${formatChips(seat.bet)} now, or play your blackjack.` : `Costs ${formatChips(cost)} · pays 2 to 1 if the dealer has blackjack.`}
        </span>
      </div>
      <div className="bj-ctl__actions">
        <Button variant="gold" size="lg" onClick={take} aria-keyshortcuts="I">
          {natural ? 'Even money' : 'Insurance'} <Kbd>I</Kbd>
        </Button>
        <Button variant="secondary" size="lg" onClick={decline} aria-keyshortcuts="N">
          {natural ? 'No thanks' : 'No insurance'} <Kbd>N</Kbd>
        </Button>
        <TimerRing seconds={Math.ceil(remaining / 1000)} progress={remaining / (Math.min(rules.decisionSeconds, 10) * 1000)} size={44} label="Insurance closes" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const ACTION_VARIANT: Record<BlackjackAction, 'primary' | 'gold' | 'secondary' | 'ghost'> = {
  hit: 'primary',
  stand: 'gold',
  double: 'secondary',
  split: 'secondary',
  surrender: 'secondary',
};

function ActionControls({ seat, rules, round, send }: { seat: BlackjackSeatView; rules: BlackjackSettings; round: number; send: Send }) {
  const remaining = useCountdown(seat.deadline || null);
  const hand = seat.activeHand;
  const cur = seat.hands[hand];
  // One decision per state: ignore double clicks until the server answers.
  const stateKey = `${round}:${hand}:${cur?.cards.length ?? 0}:${seat.hands.length}:${cur?.status ?? ''}`;
  const [sentFor, setSentFor] = useState<string | null>(null);
  const busy = sentFor === stateKey;
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setSentFor(null), 1500);
    return () => clearTimeout(t);
  }, [busy]);
  const act = useCallback(
    (action: BlackjackAction) => {
      if (busy || !seat.actions.includes(action)) return;
      setSentFor(stateKey);
      sfx(action === 'hit' || action === 'double' ? 'click' : 'select');
      send(BLACKJACK_MSG.action, { action, hand });
    },
    [busy, hand, seat.actions, send, stateKey],
  );
  useHotkeys(Object.fromEntries(seat.actions.map((a) => [ACTION_KEY[a].toLowerCase(), () => act(a)])), true);
  const extra = (a: BlackjackAction) =>
    a === 'double' || a === 'split' ? ` · ${formatChips(cur?.bet ?? seat.bet)}` : a === 'surrender' ? ` · ½ back` : '';
  const progress = remaining / (rules.decisionSeconds * 1000);
  return (
    <div className="bj-ctl bj-ctl--decide">
      <div className="bj-ctl__clock" data-urgent={remaining < 5000 ? 'true' : undefined} role="timer" aria-label={`Decision time: ${Math.ceil(remaining / 1000)} seconds`}>
        <span style={{ '--p': Math.max(0, Math.min(1, progress)) } as CSSProperties} />
      </div>
      <div className="bj-ctl__prompt">
        <span className="bj-ctl__title">
          {cur?.label ?? ''}
          {seat.hands.length > 1 ? <span className="bj-ctl__sub"> · hand {hand + 1} of {seat.hands.length}</span> : null}
        </span>
        <span className="bj-ctl__hint">Your move</span>
      </div>
      <div className="bj-ctl__actions bj-ctl__actions--decide" role="group" aria-label="Your decision">
        {seat.actions.map((a) => (
          <Button
            key={a}
            variant={ACTION_VARIANT[a]}
            size="lg"
            className={cx('bj-act', `bj-act--${a}`)}
            disabled={busy}
            onClick={() => act(a)}
            aria-keyshortcuts={ACTION_KEY[a]}
          >
            <span className="bj-act__label">{ACTION_LABEL[a]}</span>
            <span className="bj-act__extra">{extra(a)}</span>
            <Kbd>{ACTION_KEY[a]}</Kbd>
          </Button>
        ))}
        <TimerRing seconds={Math.ceil(remaining / 1000)} progress={progress} size={44} label="Decision time" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status / waiting
// ---------------------------------------------------------------------------

function waitingText(state: BlackjackPublicState, seat: BlackjackSeatView | undefined): { title: string; hint: string; tone?: string } {
  const deciding = Object.values(state.seats).filter((s) => s.inRound && !s.done && !s.left).length;
  switch (state.stage) {
    case 'DEALING':
      return { title: 'Dealing', hint: 'Cards are coming out of the shoe.' };
    case 'INSURANCE':
      return { title: 'Insurance', hint: 'Waiting for insurance decisions…' };
    case 'PEEK':
      return { title: 'Dealer peeks', hint: 'Checking the hole card for blackjack…' };
    case 'PLAYING':
      if (seat?.inRound) return { title: 'Hands locked in', hint: deciding ? `Waiting for ${deciding} player${deciding === 1 ? '' : 's'}…` : 'Dealer is up next.' };
      return { title: 'Players decide', hint: 'You will be dealt in next round.' };
    case 'DEALER':
      return { title: state.statusText || 'Dealer plays', hint: 'Dealer draws to 17.' };
    case 'SETTLING': {
      if (seat?.inRound) {
        const net = seat.net;
        const won = seat.hands.some((h) => h.result === 'blackjack');
        return {
          title: net > 0 ? (won ? `Blackjack! ${signed(net)}` : `You win ${signed(net)}`) : net < 0 ? `You lose ${signed(net)}` : 'Push — bet returned',
          hint: state.statusText,
          tone: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
        };
      }
      return { title: state.statusText || 'Settling', hint: 'Next round starts shortly.' };
    }
    case 'SHUFFLING':
      return { title: 'Shuffling', hint: 'The cut card came out — fresh shoe coming up.' };
    default:
      return { title: state.statusText || 'Please wait', hint: '' };
  }
}

function StatusLine({ state, seat }: { state: BlackjackPublicState; seat: BlackjackSeatView | undefined }) {
  const { title, hint, tone } = waitingText(state, seat);
  return (
    <div className="bj-ctl bj-ctl--status" role="status" aria-live="polite">
      <div className="bj-ctl__prompt">
        <span className="bj-ctl__title" data-tone={tone}>
          {title}
        </span>
        {hint ? <span className="bj-ctl__hint">{hint}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export function ControlBar({
  state,
  rules,
  me,
  seat,
  send,
  menu,
}: {
  state: BlackjackPublicState;
  rules: BlackjackSettings;
  me: PlayerView | undefined;
  seat: BlackjackSeatView | undefined;
  send: Send;
  menu: ReactNode;
}) {
  const stage = state.stage;
  const broke = seat ? seat.balance + seat.bet < rules.minBet && !seat.inRound : false;
  // Chips on the felt still belong to the player until the round settles.
  const onFelt = !seat
    ? 0
    : stage === 'BETTING'
      ? seat.bet
      : seat.inRound && stage !== 'SETTLING' && stage !== 'SHUFFLING'
        ? totalWager(seat) + (seat.insuranceState === 'taken' ? seat.insurance : 0)
        : 0;
  const session = seat ? seat.balance + onFelt - seat.bought : 0;
  let main: ReactNode;
  if (!me || me.spectator) {
    const free = Object.keys(state.seats).length < Math.min(7, state.maxPlayers);
    main = (
      <div className="bj-ctl bj-ctl--status">
        <div className="bj-ctl__prompt">
          <span className="bj-ctl__title">
            <PixelIcon name="eye" /> {me?.queued ? 'You’re up next round' : 'Spectating'}
          </span>
          <span className="bj-ctl__hint">{me?.queued ? 'A seat is saved for you — you’ll be dealt in when the next round opens.' : 'Watch the table, or take a seat for the next round.'}</span>
        </div>
        {!me?.queued && free ? (
          <Button variant="primary" icon="plus" onClick={() => send(BLACKJACK_MSG.queue, {})}>
            Deal me in
          </Button>
        ) : null}
      </div>
    );
  } else if (!seat) {
    main = <StatusLine state={state} seat={undefined} />;
  } else if (broke) {
    main = (
      <div className="bj-ctl bj-ctl--status">
        <div className="bj-ctl__prompt">
          <span className="bj-ctl__title">Out of chips</span>
          <span className="bj-ctl__hint">Grab a free refill of {formatChips(rules.startingBalance)} virtual chips to keep playing.</span>
        </div>
        <Button variant="gold" icon="chip" onClick={() => send(BLACKJACK_MSG.refill, {})}>
          Free refill
        </Button>
      </div>
    );
  } else if (stage === 'BETTING') {
    main = <BettingControls seat={seat} rules={rules} state={state} send={send} />;
  } else if (stage === 'INSURANCE' && seat.insuranceState === 'offered') {
    main = <InsuranceControls seat={seat} state={state} rules={rules} send={send} />;
  } else if (stage === 'PLAYING' && seat.actions.length > 0) {
    main = <ActionControls seat={seat} rules={rules} round={state.round} send={send} />;
  } else {
    main = <StatusLine state={state} seat={seat} />;
  }

  return (
    <footer className="bj-bar" data-stage={stage}>
      <div className="bj-bar__inner">
        {seat ? (
          <div className="bj-bar__wallet" aria-label="Your chips">
            <span className="dc-label">Chips</span>
            <span className="bj-bar__balance dc-num">{formatChips(seat.balance)}</span>
            {onFelt > 0 ? <span className="bj-bar__session dc-num">{formatChips(onFelt)} on the felt</span> : null}
            <span className="bj-bar__session dc-num" data-tone={session > 0 ? 'win' : session < 0 ? 'lose' : undefined}>
              {signed(session)} this game
            </span>
          </div>
        ) : null}
        <div className="bj-bar__main" style={{ '--bar-accent': 'var(--accent)' } as CSSProperties}>
          {main}
        </div>
        <div className="bj-bar__menu">{menu}</div>
      </div>
    </footer>
  );
}

