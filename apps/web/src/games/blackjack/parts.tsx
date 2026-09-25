/**
 * Table furniture and seat/hand presentation for DASjack 21.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { formatChips, formatChipsCompact, type PlayerView } from '@dascade/shared';
import type {
  BlackjackDealerView,
  BlackjackHandView,
  BlackjackSeatView,
  BlackjackSettings,
  BlackjackStage,
} from '@dascade/shared/games/blackjack';
import { Avatar, CardBack, CasinoChip, PixelIcon, TimerRing, chipBreakdown, cx } from '@dascade/ui';
import { useCountdown } from '../../net/hooks.ts';
import { sfx } from '../../audio/audio.ts';
import { ChipFlight, TableCard, useTableAnim } from './anim.tsx';
import { resultText, signed, totalWager } from './util.ts';

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function BetStack({ amount, size = 34, max = 7, showAmount = true, className }: { amount: number; size?: number; max?: number; showAmount?: boolean; className?: string }) {
  if (amount <= 0) return null;
  const chips = chipBreakdown(amount, max);
  return (
    <span className={cx('bj-stack', className)} role="img" aria-label={`${formatChips(amount)} in chips`} style={{ '--chip': `${size}px` } as CSSProperties}>
      <span className="bj-stack__chips">
        {chips.map((v, i) => (
          <CasinoChip key={i} value={v} size={size} label={i === chips.length - 1} className="bj-stack__chip" style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
      {showAmount ? <span className="bj-stack__amount dc-num">{formatChipsCompact(amount)}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

const RESULT_TONE: Record<string, string> = {
  blackjack: 'gold',
  win: 'win',
  push: 'push',
  lose: 'lose',
  bust: 'lose',
  surrender: 'push',
};

export function HandView({
  hand,
  index,
  seatId,
  round,
  active,
  showResult,
}: {
  hand: BlackjackHandView;
  index: number;
  seatId: string;
  round: number;
  active: boolean;
  showResult: boolean;
}) {
  const busted = hand.status === 'bust';
  const natural = hand.status === 'blackjack';
  const label = hand.label || (hand.cards.length ? String(hand.total) : '');
  return (
    <div
      className="bj-hand"
      data-active={active ? 'true' : undefined}
      data-status={hand.status}
      data-result={showResult && hand.result ? RESULT_TONE[hand.result] : undefined}
      aria-label={`Hand ${index + 1}: ${hand.cards.length} cards, ${label || 'no cards yet'}${hand.doubled ? ', doubled' : ''}${showResult && hand.result ? `, ${resultText(hand.result, hand.net)}` : ''}`}
    >
      {active ? <span className="bj-hand__pointer" aria-hidden /> : null}
      <div className="bj-hand__cards" style={{ '--n': hand.cards.length } as CSSProperties}>
        {hand.cards.map((c, i) => (
          <TableCard
            key={i}
            animKey={`r${round}:${seatId}:h${index}:c${i}:${c}`}
            code={c}
            entry={hand.split && index > 0 && i === 0 ? 'slide' : 'deal'}
            dim={showResult && (hand.result === 'lose' || hand.result === 'bust' || hand.result === 'surrender')}
            style={{ '--i': i } as CSSProperties}
          />
        ))}
      </div>
      {label ? (
        <span className="bj-hand__value" data-soft={hand.soft ? 'true' : undefined}>
          {hand.doubled ? <span className="bj-hand__x2">2×</span> : null}
          {label}
        </span>
      ) : null}
      {busted && !showResult ? <span className="bj-badge bj-badge--bust">Bust</span> : null}
      {natural && !showResult ? <span className="bj-badge bj-badge--bj">Blackjack!</span> : null}
      {hand.status === 'surrendered' && !showResult ? <span className="bj-badge bj-badge--muted">Surrendered</span> : null}
      {showResult && hand.result ? (
        <span className="bj-badge" data-tone={RESULT_TONE[hand.result]}>
          {resultText(hand.result, hand.net)}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seat nameplate
// ---------------------------------------------------------------------------

export function SeatPlate({
  seat,
  player,
  isMe,
  stage,
  decisionSeconds,
  compact = false,
}: {
  seat: BlackjackSeatView;
  player: PlayerView | undefined;
  isMe: boolean;
  stage: BlackjackStage;
  decisionSeconds: number;
  compact?: boolean;
}) {
  const remaining = useCountdown(seat.deadline || null);
  const deciding = stage === 'PLAYING' && seat.inRound && !seat.done && seat.deadline > 0;
  const offline = player ? !player.connected : true;
  let status: string;
  if (seat.left || !player) status = 'Left the table';
  else if (offline) status = 'Reconnecting…';
  else if (stage === 'BETTING') status = seat.sittingOut ? 'Sitting out' : seat.locked ? `Bet ${formatChips(seat.bet)} ✓` : seat.bet > 0 ? 'Betting…' : 'Choosing a bet';
  else if (stage === 'INSURANCE' && seat.insuranceState === 'offered') status = 'Insurance?';
  else if (deciding) status = 'Deciding';
  else if (seat.inRound && stage === 'PLAYING') status = 'Done';
  else if (!seat.inRound && stage !== 'SETTLING' && stage !== 'SHUFFLING') status = 'Next round';
  else status = '';
  return (
    <div className={cx('bj-plate', compact && 'bj-plate--compact')} data-me={isMe ? 'true' : undefined} data-offline={offline ? 'true' : undefined}>
      {isMe ? <span className="bj-plate__you">You</span> : null}
      <Avatar avatar={player?.avatar ?? 'rocket'} color={player?.color ?? '#9d95c4'} size={compact ? 22 : 28} offline={offline} />
      <div className="bj-plate__text">
        <span className="bj-plate__name">
          <span className="bj-plate__nick">{player?.name ?? seat.name}</span>
        </span>
        <span className="bj-plate__chips dc-num" aria-label={`${formatChips(seat.balance)} chips`}>
          <PixelIcon name="chip" /> {formatChips(seat.balance)}
        </span>
        {status && !compact ? <span className="bj-plate__status">{status}</span> : null}
      </div>
      {deciding ? (
        <span className="bj-plate__timer">
          <TimerRing seconds={Math.ceil(remaining / 1000)} progress={remaining / (decisionSeconds * 1000)} size={compact ? 26 : 32} label={`${player?.name ?? 'Player'} decision time`} />
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Betting circle (+ payout animation)
// ---------------------------------------------------------------------------

export function BetSpot({
  seat,
  stage,
  round,
  seatNumber,
  isMe,
  chipSize,
  onSit,
}: {
  seat: BlackjackSeatView | null;
  stage: BlackjackStage;
  round: number;
  seatNumber: number;
  isMe: boolean;
  chipSize: number;
  /** Empty seat the viewer may move to. */
  onSit?: () => void;
}) {
  const settling = stage === 'SETTLING' && Boolean(seat?.inRound);
  const wager = seat ? (seat.inRound ? totalWager(seat) : seat.bet) : 0;
  const net = seat?.net ?? 0;
  const winnings = settling && net > 0 ? net : 0;
  const lost = settling && net < 0;
  const staked = settling ? Math.max(0, wager + Math.min(0, net)) : wager;
  if (!seat && onSit) {
    return (
      <button type="button" className="bj-spot bj-spot--sit" data-empty="true" onClick={onSit} aria-label={`Move to seat ${seatNumber}`} title={`Move to seat ${seatNumber}`}>
        <span className="bj-spot__ring" aria-hidden />
        <span className="bj-spot__num" aria-hidden>
          {seatNumber}
        </span>
        <span className="bj-spot__sit" aria-hidden>
          Sit
        </span>
      </button>
    );
  }
  return (
    <div className="bj-spot" data-me={isMe ? 'true' : undefined} data-empty={seat ? undefined : 'true'} data-locked={seat?.locked ? 'true' : undefined}>
      <span className="bj-spot__ring" aria-hidden />
      {!seat || wager === 0 ? <span className="bj-spot__num" aria-hidden>{seatNumber}</span> : null}
      {staked > 0 ? <BetStack amount={staked} size={chipSize} max={5} /> : null}
      {winnings > 0 ? (
        <ChipFlight direction="in" playKey={`win:${round}:${seat?.playerId}`}>
          <BetStack amount={winnings} size={chipSize} max={5} showAmount={false} />
        </ChipFlight>
      ) : null}
      {lost ? (
        <ChipFlight direction="out" playKey={`lose:${round}:${seat?.playerId}`}>
          <BetStack amount={Math.min(wager, -net)} size={chipSize} max={5} showAmount={false} />
        </ChipFlight>
      ) : null}
      {seat && seat.insurance > 0 && seat.inRound ? (
        <span className="bj-spot__ins" title="Insurance">
          <BetStack amount={seat.insurance} size={Math.round(chipSize * 0.7)} max={3} showAmount={false} />
          <span>INS</span>
        </span>
      ) : null}
      {settling ? (
        <span className="bj-spot__net dc-num" data-tone={net > 0 ? 'win' : net < 0 ? 'lose' : 'push'} key={`net-${round}`}>
          {signed(net)}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dealer, shoe, discard tray, chip rack
// ---------------------------------------------------------------------------

export function DealerHand({ dealer, round, stage }: { dealer: BlackjackDealerView; round: number; stage: BlackjackStage }) {
  const cards: Array<string | null> = [...dealer.cards];
  if (dealer.hasHole && !dealer.revealed) cards.splice(1, 0, null);
  const prevRevealed = useRef(dealer.revealed);
  useEffect(() => {
    if (dealer.revealed && !prevRevealed.current && dealer.cards.length >= 2) sfx('flip');
    prevRevealed.current = dealer.revealed;
  }, [dealer.revealed, dealer.cards.length]);
  const showValue = dealer.cards.length > 0;
  return (
    <div className="bj-dealer" data-peek={stage === 'PEEK' ? 'true' : undefined} data-revealed={dealer.revealed ? 'true' : undefined}>
      <div className="bj-dealer__cards" style={{ '--n': cards.length } as CSSProperties} aria-label="Dealer cards">
        {cards.map((c, i) => (
          <TableCard key={i} animKey={`r${round}:dealer:${i}`} code={c} faceDown={c === null} style={{ '--i': i } as CSSProperties} className={c === null ? 'bj-card--hole' : undefined} />
        ))}
        {cards.length === 0 ? (
          <span className="bj-dealer__spot" aria-hidden>
            <FeltLogo className="bj-logo--spot" />
          </span>
        ) : null}
      </div>
      {showValue ? (
        <span className="bj-dealer__value" data-tone={dealer.bust ? 'lose' : dealer.blackjack ? 'gold' : undefined}>
          {dealer.revealed ? (dealer.bust ? `Bust · ${dealer.total}` : dealer.label) : dealer.label}
        </span>
      ) : null}
      {dealer.peeked && !dealer.revealed ? <span className="bj-dealer__peeked">No blackjack</span> : null}
    </div>
  );
}

export function Shoe({ remaining, size, cutRemaining, cutReached, shuffling }: { remaining: number; size: number; cutRemaining: number; cutReached: boolean; shuffling: boolean }) {
  const { shoeRef } = useTableAnim();
  const fill = size > 0 ? remaining / size : 0;
  const cut = size > 0 ? cutRemaining / size : 0;
  return (
    <div className="bj-shoe" data-shuffling={shuffling ? 'true' : undefined} data-cut={cutReached ? 'true' : undefined} aria-label={`Shoe: ${remaining} of ${size} cards left${cutReached ? ', cut card is out' : ''}`} role="img">
      <div className="bj-shoe__body" ref={shoeRef}>
        <span className="bj-shoe__card" aria-hidden>
          <CardBack />
        </span>
        <span className="bj-shoe__mouth" aria-hidden />
      </div>
      <div className="bj-shoe__meter" aria-hidden>
        <span className="bj-shoe__fill" style={{ '--fill': fill } as CSSProperties} />
        <span className="bj-shoe__cut" style={{ '--cut': cut } as CSSProperties} />
      </div>
      <span className="bj-shoe__label dc-num">{shuffling ? 'Shuffling' : `${remaining} cards`}</span>
    </div>
  );
}

export function DiscardTray({ count, size }: { count: number; size: number }) {
  const layers = size > 0 ? Math.min(10, Math.ceil((count / size) * 10)) : 0;
  return (
    <div className="bj-discard" role="img" aria-label={`Discard tray: ${count} cards`}>
      <div className="bj-discard__tray">
        {Array.from({ length: layers }, (_, i) => (
          <span key={i} className="bj-discard__card" style={{ '--i': i } as CSSProperties}>
            <CardBack />
          </span>
        ))}
      </div>
      <span className="bj-discard__label dc-num">{count} used</span>
    </div>
  );
}

const RACK = [5000, 1000, 500, 100, 25, 5, 1];

export function ChipRack() {
  const { rackRef } = useTableAnim();
  return (
    <div className="bj-rack" ref={rackRef} aria-hidden>
      {RACK.map((v) => (
        <span key={v} className="bj-rack__col">
          {[0, 1, 2, 3].map((i) => (
            <CasinoChip key={i} value={v} size={30} label={false} className="bj-rack__chip" style={{ '--i': i } as CSSProperties} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** The curved rules printed on the felt, reflecting the live table rules. */
export function FeltPrint({ rules }: { rules: BlackjackSettings }) {
  const main = `BLACKJACK PAYS ${rules.blackjackPayout.replace(':', ' TO ')}  ·  DEALER ${rules.dealerHitsSoft17 ? 'HITS' : 'STANDS ON'} SOFT 17`;
  const sub = rules.insurance ? 'INSURANCE PAYS 2 TO 1' : 'NO INSURANCE';
  return (
    <svg className="bj-print" viewBox="0 0 1000 480" aria-hidden>
      <defs>
        <path id="bj-arc-main" d="M 150 99 A 350 202 0 0 0 850 99" />
        <path id="bj-arc-sub" d="M 205 128 A 322 190 0 0 0 795 128" />
      </defs>
      <path d="M 128 88 A 372 218 0 0 0 872 88" className="bj-print__line" />
      <path d="M 186 140 A 314 204 0 0 0 814 140" className="bj-print__line bj-print__line--thin" />
      <text className="bj-print__main">
        <textPath href="#bj-arc-main" startOffset="50%" textAnchor="middle">
          {main}
        </textPath>
      </text>
      <text className="bj-print__sub">
        <textPath href="#bj-arc-sub" startOffset="50%" textAnchor="middle">
          {sub}
        </textPath>
      </text>
    </svg>
  );
}

export function FeltLogo({ className }: { className?: string }) {
  return (
    <div className={cx('bj-logo', className)} aria-hidden>
      <span className="bj-logo__das">DAS</span>
      <span className="bj-logo__jack">JACK</span>
      <span className="bj-logo__21">21</span>
    </div>
  );
}
