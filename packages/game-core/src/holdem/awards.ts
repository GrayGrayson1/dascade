/**
 * End-of-game awards for DAS Hold'em: "Most hands won" and "Biggest pot".
 * Pure: the room keeps a tally per player as hands finish (recordHandWin) and builds the
 * awards once the game is over (holdemAwards), over the players on the final leaderboard.
 */
import type { HoldemAwardsPayload } from '@dascade/shared/games/holdem';
import type { HandResult } from './hand.ts';

export interface HoldemPlayerTally {
  /** Hands in which the player won at least part of a pot. */
  handsWon: number;
  /** Largest single-hand win. */
  bestPot: number;
  /** The hand that win came in (0 = none yet). */
  bestPotHand: number;
  /** The winning hand's description for it ('' = won uncontested). */
  bestPotLabel: string;
}

export function emptyTally(): HoldemPlayerTally {
  return { handsWon: 0, bestPot: 0, bestPotHand: 0, bestPotLabel: '' };
}

/**
 * What each winning seat took from a finished hand: the sum of its pot shares, described by its
 * first (main-most) winning line. Descriptions are only ever those of tabled hands.
 */
export function handWinsBySeat(result: HandResult | null | undefined): Map<number, { amount: number; description: string }> {
  const out = new Map<number, { amount: number; description: string }>();
  for (const w of result?.winners ?? []) {
    const prev = out.get(w.seat);
    if (prev) prev.amount += w.amount;
    else out.set(w.seat, { amount: w.amount, description: w.description });
  }
  return out;
}

/** Adds one hand's win to a tally (in place). An equal later win doesn't replace the first best. */
export function recordHandWin(tally: HoldemPlayerTally, handNumber: number, amount: number, description: string): HoldemPlayerTally {
  tally.handsWon++;
  if (amount > tally.bestPot) {
    tally.bestPot = amount;
    tally.bestPotHand = handNumber;
    tally.bestPotLabel = description;
  }
  return tally;
}

/**
 * The awards for a finished game. `rows` is the final leaderboard (in its order, which also orders
 * tied winners); players who left before the end aren't on it and can't win an award.
 */
export function holdemAwards(
  hands: number,
  rows: ReadonlyArray<{ playerId: string; name: string }>,
  tallyOf: (playerId: string) => HoldemPlayerTally | undefined,
): HoldemAwardsPayload {
  const scored = rows.map((r) => ({ playerId: r.playerId, name: r.name, tally: tallyOf(r.playerId) ?? emptyTally() }));
  const mostCount = Math.max(0, ...scored.map((s) => s.tally.handsWon));
  const biggest = Math.max(0, ...scored.map((s) => s.tally.bestPot));
  return {
    hands,
    mostHands:
      mostCount > 0
        ? { count: mostCount, players: scored.filter((s) => s.tally.handsWon === mostCount).map(({ playerId, name }) => ({ playerId, name })) }
        : null,
    biggestPot:
      biggest > 0
        ? {
            amount: biggest,
            players: scored
              .filter((s) => s.tally.bestPot === biggest)
              .map(({ playerId, name, tally }) => ({ playerId, name, handNumber: tally.bestPotHand, description: tally.bestPotLabel })),
          }
        : null,
  };
}
