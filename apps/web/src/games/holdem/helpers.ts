/** Small presentation helpers for DAS Hold'em. */
import { formatChips, formatChipsCompact } from '@dascade/shared';
import type { HoldemLastAction, HoldemPublicState, HoldemSeatView } from '@dascade/shared/games/holdem';
import { RANK_NAMES, RANK_PLURALS, parseCard } from '@dascade/game-core/cards';
import { evaluateBest } from '@dascade/game-core/holdem';

export const fmt = formatChips;
export const fmtShort = formatChipsCompact;

/** "Pocket Kings", "Ace-King suited", "Ten-Nine offsuit". */
export function preflopLabel(cards: readonly string[]): string {
  if (cards.length !== 2) return '';
  const [a, b] = cards.map(parseCard).sort((x, y) => y.rank - x.rank) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>];
  if (a.rank === b.rank) return `Pocket ${RANK_PLURALS[a.rank]}`;
  return `${RANK_NAMES[a.rank]}-${RANK_NAMES[b.rank]} ${a.suit === b.suit ? 'suited' : 'offsuit'}`;
}

/** Best current hand for the hero (preflop label before the flop). */
export function heroHandLabel(hole: readonly string[], board: readonly string[]): string {
  if (hole.length !== 2) return '';
  if (board.length < 3) return preflopLabel(hole);
  try {
    return evaluateBest([...hole, ...board]).description;
  } catch {
    return '';
  }
}

/** The best five cards for the hero (to highlight), or [] preflop. */
export function heroBestCards(hole: readonly string[], board: readonly string[]): string[] {
  if (hole.length !== 2 || board.length < 3) return [];
  try {
    return evaluateBest([...hole, ...board]).cards;
  } catch {
    return [];
  }
}

export function actionLabel(seat: HoldemSeatView): { text: string; tone: string } | null {
  const a: HoldemLastAction = seat.lastAction;
  const amt = seat.lastAmount;
  switch (a) {
    case 'sb':
      return { text: 'Small blind', tone: 'muted' };
    case 'bb':
      return { text: 'Big blind', tone: 'muted' };
    case 'fold':
      return { text: 'Fold', tone: 'fold' };
    case 'check':
      return { text: 'Check', tone: 'check' };
    case 'call':
      return { text: `Call ${fmtShort(amt)}`, tone: 'call' };
    case 'bet':
      return { text: `Bet ${fmtShort(amt)}`, tone: 'raise' };
    case 'raise':
      return { text: `Raise ${fmtShort(amt)}`, tone: 'raise' };
    case 'allin':
      return { text: 'All-in', tone: 'allin' };
    default:
      return null;
  }
}

/** Cards are in play (a hand is being dealt / bet / shown down). */
export function handLive(state: HoldemPublicState): boolean {
  return state.street !== 'idle' && state.street !== 'complete' && state.phase === 'PLAYING';
}

export function totalPot(state: HoldemPublicState): number {
  return state.pots.reduce((s, p) => s + p.amount, 0) + state.seats.reduce((s, seat) => s + seat.bet, 0);
}

export function collectedPot(state: HoldemPublicState): number {
  return state.pots.reduce((s, p) => s + p.amount, 0);
}

/** Sum of each winner's shares from the last hand. */
export function winnerTotals(state: HoldemPublicState): Map<number, number> {
  const out = new Map<number, number>();
  for (const w of state.winners) out.set(w.seat, (out.get(w.seat) ?? 0) + w.amount);
  return out;
}

export function streetLabel(street: HoldemPublicState['street']): string {
  switch (street) {
    case 'preflop':
      return 'Pre-flop';
    case 'flop':
      return 'Flop';
    case 'turn':
      return 'Turn';
    case 'river':
      return 'River';
    case 'showdown':
      return 'Showdown';
    case 'complete':
      return 'Hand over';
    default:
      return 'Between hands';
  }
}
