/**
 * Games whose main screens hide the way back to the arcade, for now: no Leave in the top bar, the
 * lobby's action bar, the results or the game's own corners, and no Arcade button on the invite
 * (its Join button is centred instead). Error and reconnect screens keep their way out, so nobody is
 * stuck on a dead room; the browser's Back still leaves.
 *
 * Survey Showdown (Brian, 2026-10-27): hidden for the DAS-O-Ween show. To revisit: how guests,
 * crew and big screens should leave a show (docs/SHOWDOWN.md, "To revisit"). Removing the id here
 * brings every button back.
 */
import type { GameId } from '@dascade/shared';

const NO_ARCADE_EXIT: ReadonlySet<string> = new Set<GameId>(['showdown']);

export function hidesArcadeExit(gameId: string | null | undefined): boolean {
  return gameId ? NO_ARCADE_EXIT.has(gameId) : false;
}
