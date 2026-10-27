/**
 * The Presenter Showcase audience picker (PCK-01…05): who may be drawn, and the draw itself. Pure:
 * the room builds a seat list from its own connection state (never from a client claim) and draws
 * with its crypto RNG; tests use a seeded one.
 *
 * Two modes (the `pickMode` setting):
 *   - fair:   only the people in the draw with the fewest turns this show. When everyone is level
 *             the next lap opens by itself, so the pool never runs dry while anyone is in the draw.
 *   - random: everyone in the draw, every time, except the person the last draw picked (unless
 *             they're the only one left — the rail never dead-ends on one person).
 */
import type { Rng } from '@dascade/shared';
import type { ShowdownPickMode } from '@dascade/shared/games/showdown';

/** One seat as the room sees it at draw time. */
export interface PickSeat {
  id: string;
  /** A guest: not the presenter, crew, a big screen or a spectator. */
  participant: boolean;
  /** Crew who aren't presenting: in the random draw only when the rules say so. */
  crew?: boolean;
  /** Has a live connection (an away or disconnected seat sits the draw out). */
  connected: boolean;
  /** A moderator hid them from the stage and the pool. */
  hidden: boolean;
  /** Their private "Skip me" switch (random draws only: by name they can still be chosen). */
  skip: boolean;
  /** The presenter or crew took them out of random draws (until included again). */
  excluded?: boolean;
  /** Turns this show (Mark done counts one). */
  turns?: number;
  /** In the hot seat right now. */
  hot: boolean;
  /** Left out of this one draw (the person a reroll just put back). */
  rerolled?: boolean;
}

export interface PickRules {
  mode: ShowdownPickMode;
  /** Crew are in the random draw too. */
  crewDraw: boolean;
  /** Whom the last draw picked ('' = nobody yet): True random never draws them twice in a row. */
  lastPicked: string;
}

export const DEFAULT_PICK_RULES: PickRules = { mode: 'fair', crewDraw: false, lastPicked: '' };

/** Whether a seat is in the random draw at all (before the mode narrows it down). */
export function inDraw(seat: PickSeat, rules: Pick<PickRules, 'crewDraw'> = DEFAULT_PICK_RULES): boolean {
  return (
    (seat.participant || (rules.crewDraw && seat.crew === true)) &&
    seat.connected &&
    !seat.hidden &&
    !seat.skip &&
    !seat.excluded &&
    !seat.hot &&
    !seat.rerolled
  );
}

/** The ids the next draw may pick, in seat order. */
export function pickPool(seats: readonly PickSeat[], rules: PickRules = DEFAULT_PICK_RULES): string[] {
  const open = seats.filter((s) => inDraw(s, rules));
  if (rules.mode === 'fair') {
    let fewest = Infinity;
    for (const s of open) fewest = Math.min(fewest, s.turns ?? 0);
    return open.filter((s) => (s.turns ?? 0) === fewest).map((s) => s.id);
  }
  const fresh = open.filter((s) => s.id !== rules.lastPicked);
  return (fresh.length > 0 ? fresh : open).map((s) => s.id);
}

/** One uniform draw from the pool (null when it's empty). */
export function drawPick(pool: readonly string[], rng: Rng): string | null {
  if (pool.length === 0) return null;
  return pool[rng.int(pool.length)] ?? null;
}
