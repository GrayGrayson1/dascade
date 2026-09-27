/**
 * Platform services wired once per server process: DASCADE ratings (and, as they are added,
 * stats and Tournament Center advancement) all listen to reported game outcomes.
 */
import { onOutcome } from './hub.ts';
import { applyRatedOutcome, ratingIdentity } from './ratings.ts';
import { recordOutcomeStats } from './stats.ts';
import { warmRatings, withIdentitiesLoaded } from './statsLoader.ts';
import { installTournamentOutcomeListener } from './tournaments.ts';

let installed = false;

export function installPlatformServices(): void {
  if (installed) return;
  installed = true;

  // Tournament Center: bound match rooms' results advance their kiosk's bracket (synchronous, idempotent).
  installTournamentOutcomeListener();

  // Ratings (rated head-to-head games) and per-player stats (every reported game). Both build on
  // the stored numbers: identities are hydrated from the database first when it is configured.
  warmRatings();
  onOutcome((outcome, ctx) => {
    const identities = [...ctx.players.values()].map(ratingIdentity).filter((id): id is string => id !== null);
    withIdentitiesLoaded(identities, () => {
      applyRatedOutcome(outcome, ctx);
      recordOutcomeStats(outcome, ctx);
    });
  });
}
