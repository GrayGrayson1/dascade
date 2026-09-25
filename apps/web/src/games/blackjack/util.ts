/**
 * DASjack 21 client helpers: rules parsing, seat geometry, chip math and labels.
 */
import { useEffect, useState } from 'react';
import { formatChips } from '@dascade/shared';
import {
  DEFAULT_BLACKJACK_SETTINGS,
  payoutText,
  type BlackjackAction,
  type BlackjackHandResult,
  type BlackjackSeatView,
  type BlackjackSettings,
} from '@dascade/shared/games/blackjack';

export const SEAT_COUNT = 7;
/** Betting chip denominations offered on the rail. */
export const BET_CHIPS = [1, 5, 25, 100, 500, 1000, 5000] as const;

export function parseRules(json: string | undefined): BlackjackSettings {
  try {
    return { ...DEFAULT_BLACKJACK_SETTINGS, ...(JSON.parse(json ?? '{}') as Partial<BlackjackSettings>) };
  } catch {
    return DEFAULT_BLACKJACK_SETTINGS;
  }
}

/**
 * Seat anchor on the half-moon (percent of the felt box). Seat 0 is first base,
 * on the dealer's left — the right-hand end of the arc from the players' view.
 */
export function seatGeometry(seat: number): { x: number; y: number; tilt: number } {
  const t = seat / (SEAT_COUNT - 1);
  const deg = 32 + t * 116;
  const rad = (deg * Math.PI) / 180;
  const x = 50 + 43.5 * Math.cos(rad);
  const y = -20 + 99 * Math.sin(rad);
  return { x, y, tilt: (deg - 90) * 0.2 };
}

export const ACTION_LABEL: Record<BlackjackAction, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

export const ACTION_KEY: Record<BlackjackAction, string> = {
  hit: 'H',
  stand: 'S',
  double: 'D',
  split: 'P',
  surrender: 'R',
};

export function resultText(result: BlackjackHandResult, net: number): string {
  switch (result) {
    case 'blackjack':
      return `Blackjack +${formatChips(net)}`;
    case 'win':
      return `Win +${formatChips(net)}`;
    case 'push':
      return 'Push';
    case 'lose':
      return `Lose −${formatChips(Math.abs(net))}`;
    case 'bust':
      return `Bust −${formatChips(Math.abs(net))}`;
    case 'surrender':
      return `Surrender −${formatChips(Math.abs(net))}`;
    default:
      return '';
  }
}

export function signed(n: number): string {
  if (n > 0) return `+${formatChips(n)}`;
  if (n < 0) return `−${formatChips(Math.abs(n))}`;
  return '±0';
}

export function totalWager(seat: BlackjackSeatView): number {
  if (seat.hands.length === 0) return seat.bet;
  return seat.hands.reduce((sum, h) => sum + h.bet, 0);
}

export function rulesSummary(r: BlackjackSettings): string[] {
  return [
    `Blackjack pays ${payoutText(r.blackjackPayout)}`,
    `Dealer ${r.dealerHitsSoft17 ? 'hits' : 'stands on'} soft 17`,
    `${r.decks} deck${r.decks === 1 ? '' : 's'} · cut card at ${r.penetration}%`,
    `Double on ${r.doubleRule === 'any' ? 'any two cards' : r.doubleRule === '9-11' ? 'hard 9–11' : 'hard 10–11'}${r.doubleAfterSplit ? ', after splits too' : ''}`,
    r.maxHands <= 1 ? 'No splitting' : `Split up to ${r.maxHands} hands${r.resplitAces ? ', re-split aces' : ''}${r.hitSplitAces ? ', hit split aces' : ', split aces get one card'}`,
    r.surrender ? 'Late surrender pays back half' : 'No surrender',
    r.insurance ? 'Insurance pays 2 to 1 · even money (a sure 1 to 1) on your blackjack' : 'No insurance or even money',
    r.dealerPeek
      ? 'Dealer peeks for blackjack under an Ace or 10'
      : `No peek: a dealer blackjack takes doubles and splits${r.surrender ? ', and surrendered hands lose it all' : ''}`,
    `Bets ${formatChips(r.minBet)} – ${formatChips(r.maxBet)} · ${formatChips(r.startingBalance)} starting chips`,
    'Fractional payouts round down',
  ];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Stacked layout for phones and portrait tablets; the half-moon needs a wide screen. */
export function useCompactLayout(): boolean {
  return useMediaQuery('(max-width: 760px), (orientation: portrait) and (max-width: 1100px)');
}
