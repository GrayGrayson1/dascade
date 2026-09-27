/**
 * Per-tick input budget for verified runs (pure; used by VerifiedRunClient).
 *
 * The server rejects a batch with more than CLASSICS.maxEventsPerTick codes on one tick as a
 * flood. After a main-thread stall a game can sample more than that for a single tick, so the
 * client applies at most the cap per tick and carries the rest over to the following ticks.
 */
import { CLASSICS } from '@dascade/shared/games/classics';

/** Safety bound on the carried backlog; the oldest codes go first (the latest say what is held now). */
export const MAX_CARRY = CLASSICS.maxEventsPerTick * 16;

/**
 * Apply up to CLASSICS.maxEventsPerTick accepted codes from `queue` (in order) through `apply`
 * (returns whether the engine accepted the code), and return the codes left for the next tick.
 * In the carried-over part, identical codes queued back to back collapse into one (a stall piles
 * up repeats of the same press).
 */
export function takeTick(queue: readonly number[], apply: (code: number) => boolean): number[] {
  let applied = 0;
  let i = 0;
  for (; i < queue.length && applied < CLASSICS.maxEventsPerTick; i++) if (apply(queue[i]!)) applied++;
  if (i >= queue.length) return [];
  const rest: number[] = [];
  for (let k = i; k < queue.length; k++) {
    const code = queue[k]!;
    if (rest.length > 0 && rest[rest.length - 1] === code) continue;
    rest.push(code);
  }
  return rest.length > MAX_CARRY ? rest.slice(rest.length - MAX_CARRY) : rest;
}
