/**
 * DASino Dice High/Low — a shared, quick social round on two six-sided dice.
 *
 * Rules:
 *  1. The table shows a POINT: the total of two server-rolled dice (2–12).
 *     The first round rolls a fresh point; every later round's point is the
 *     previous roll, so the table plays a running "higher or lower" streak.
 *  2. Players bet HIGHER, LOWER or SAME on the total of the next 2d6 roll.
 *     HIGHER and LOWER lose when the roll equals the point.
 *  3. Winning bets return stake × multiplier (rounded down to whole chips).
 *
 * Odds: each multiplier is derived from the true probability with a 3% house
 * edge, rounded DOWN to the cent: multiplier = floor(97 × 36 / ways) / 100,
 * where `ways` is how many of the 36 dice combinations win. A pick is closed
 * for the round when it cannot win (e.g. HIGHER on 12) or when its multiplier
 * would not exceed 1.00× (HIGHER on 2, LOWER on 12). The resulting house edge
 * per pick is between 3.0% and 3.75% before rounding.
 *
 * Whole chips: a win returns floor(stake × multiplier). That rounding
 * ("breakage") adds to the edge on small stakes, so a pick only accepts stakes
 * whose win pays strictly more than the stake (diceMinStake; e.g. 20 chips at
 * 1.05×), and the UI shows the exact whole-chip return (diceStakeRtp).
 */
import type { Rng } from '@dascade/shared';

export const DICE_PICKS = ['higher', 'same', 'lower'] as const;
export type DicePick = (typeof DICE_PICKS)[number];

/** Target return before rounding (97% → 3% edge). */
export const DICE_RETURN_PERCENT = 97;
export const DICE_HOUSE_EDGE = 1 - DICE_RETURN_PERCENT / 100;

export type DicePair = [number, number];

export function isDieValue(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 6;
}

export function isDiceTotal(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 12;
}

/** Two independent, uniform dice. */
export function rollDice(rng: Rng): DicePair {
  return [rng.int(6) + 1, rng.int(6) + 1];
}

/** Ways (out of 36) to roll a total with two dice. */
export function totalWays(total: number): number {
  if (!isDiceTotal(total)) return 0;
  return 6 - Math.abs(total - 7);
}

/** Ways (out of 36) for a pick to win against a point. */
export function pickWays(point: number, pick: DicePick): number {
  if (!isDiceTotal(point)) throw new RangeError(`Invalid point: ${point}`);
  let ways = 0;
  for (let t = 2; t <= 12; t++) {
    if ((pick === 'higher' && t > point) || (pick === 'lower' && t < point) || (pick === 'same' && t === point)) ways += totalWays(t);
  }
  return ways;
}

/** Probability (0–1) that a pick wins. */
export function pickProbability(point: number, pick: DicePick): number {
  return pickWays(point, pick) / 36;
}

/**
 * Return multiplier in hundredths (e.g. 582 = 5.82×) including the stake.
 * 0 means the pick is closed for this point.
 */
export function pickMultiplier100(point: number, pick: DicePick): number {
  const ways = pickWays(point, pick);
  if (ways === 0) return 0;
  const m = Math.floor((DICE_RETURN_PERCENT * 36) / ways);
  return m > 100 ? m : 0;
}

export function isPickOpen(point: number, pick: DicePick): boolean {
  return pickMultiplier100(point, pick) > 0;
}

export function formatMultiplier(m100: number): string {
  return `${(m100 / 100).toFixed(2)}×`;
}

/** How a roll compares with the point. */
export function diceOutcome(point: number, rollTotal: number): DicePick {
  if (rollTotal > point) return 'higher';
  if (rollTotal < point) return 'lower';
  return 'same';
}

/** Chips returned for a bet (0 on a loss). Rounds down to whole chips. */
export function diceReturn(point: number, pick: DicePick, rollTotal: number, amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`Invalid stake: ${amount}`);
  if (!isDiceTotal(rollTotal)) throw new RangeError(`Invalid roll: ${rollTotal}`);
  const m100 = pickMultiplier100(point, pick);
  if (m100 === 0 || diceOutcome(point, rollTotal) !== pick) return 0;
  return Math.floor((amount * m100) / 100);
}

/**
 * Smallest total stake on a pick whose win returns more than the stake after
 * rounding down to whole chips (20 at 1.05×, 7 at 1.16×, 1 from 2.00× up).
 * Smaller stakes could only lose or push, so the table refuses them. 0 = closed.
 */
export function diceMinStake(point: number, pick: DicePick): number {
  const m100 = pickMultiplier100(point, pick);
  if (m100 === 0) return 0;
  return Math.ceil(100 / (m100 - 100));
}

/** Whether a total stake on a pick is playable (pick open and a win would profit). */
export function isDiceStakeOk(point: number, pick: DicePick, amount: number): boolean {
  const min = diceMinStake(point, pick);
  return min > 0 && Number.isInteger(amount) && amount >= min;
}

/** Exact expected return per chip for a given whole-chip stake (includes rounding down). */
export function diceStakeRtp(point: number, pick: DicePick, amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0 || !isPickOpen(point, pick)) return 0;
  return ((pickWays(point, pick) / 36) * Math.floor((amount * pickMultiplier100(point, pick)) / 100)) / amount;
}

/** Exact expected return per chip for a pick (ignoring whole-chip rounding of the payout). */
export function pickRtp(point: number, pick: DicePick): number {
  return (pickWays(point, pick) / 36) * (pickMultiplier100(point, pick) / 100);
}

export interface DicePickInfo {
  pick: DicePick;
  open: boolean;
  ways: number;
  probability: number;
  multiplier100: number;
  houseEdge: number;
}

/** Everything the UI needs to label the three buttons for a point. */
export function diceOdds(point: number): DicePickInfo[] {
  return DICE_PICKS.map((pick) => {
    const ways = pickWays(point, pick);
    const multiplier100 = pickMultiplier100(point, pick);
    return {
      pick,
      open: multiplier100 > 0,
      ways,
      probability: ways / 36,
      multiplier100,
      houseEdge: multiplier100 > 0 ? 1 - pickRtp(point, pick) : 0,
    };
  });
}
