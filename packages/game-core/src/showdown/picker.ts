/**
 * The Presenter Showcase audience picker (PCK-01…05): who may be drawn, and the draw itself. Pure:
 * the room builds a seat list from its own connection state (never from a client claim) and draws
 * with its crypto RNG; tests use a seeded one.
 */
import type { Rng } from '@dascade/shared';

/** One seat as the room sees it at draw time. */
export interface PickSeat {
  id: string;
  /** A participant: not the presenter, crew, a big screen or a spectator. */
  participant: boolean;
  /** Has a live connection (an away or disconnected seat sits the draw out). */
  connected: boolean;
  /** A moderator hid them from the stage and the pool. */
  hidden: boolean;
  /** Their private "Skip me" switch. */
  skip: boolean;
  /** Their turn already counted this round. */
  done: boolean;
  /** In the hot seat right now. */
  hot: boolean;
  /** Left out of this one draw (the person a reroll just put back). */
  excluded?: boolean;
}

/** Whether a seat may be drawn right now. */
export function inPool(seat: PickSeat): boolean {
  return seat.participant && seat.connected && !seat.hidden && !seat.skip && !seat.done && !seat.hot && !seat.excluded;
}

/** The ids that may be drawn, in seat order. */
export function pickPool(seats: readonly PickSeat[]): string[] {
  return seats.filter(inPool).map((s) => s.id);
}

/** One uniform draw from the pool (null when it's empty). */
export function drawPick(pool: readonly string[], rng: Rng): string | null {
  if (pool.length === 0) return null;
  return pool[rng.int(pool.length)] ?? null;
}
