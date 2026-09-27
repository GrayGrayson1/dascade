/**
 * Role dealing: turns a planned setup (role counts) into a secret seat → role map.
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import { DECEPTION_ROLES, roleTeam, type DeceptionRole, type DeceptionSetup, type DeceptionTeam } from '@dascade/shared/games/deception';

/** Expand role counts into a flat list in canonical role order (before shuffling). */
export function roleDeck(setup: DeceptionSetup): DeceptionRole[] {
  const deck: DeceptionRole[] = [];
  for (const role of DECEPTION_ROLES) for (let i = 0; i < setup.counts[role]; i++) deck.push(role);
  return deck;
}

/**
 * Deal one role per player. `playerIds` must be in a stable order (join order) so a seeded RNG
 * reproduces the same deal; the server uses its crypto RNG.
 */
export function dealRoles(playerIds: readonly string[], setup: DeceptionSetup, rng: Rng): Map<string, DeceptionRole> {
  if (playerIds.length !== setup.players) {
    throw new RangeError(`dealRoles: ${playerIds.length} players for a ${setup.players}-player setup`);
  }
  if (new Set(playerIds).size !== playerIds.length) throw new RangeError('dealRoles: duplicate player id');
  const deck = shuffleInPlace(roleDeck(setup), rng);
  return new Map(playerIds.map((id, i) => [id, deck[i] as DeceptionRole]));
}

/** Players on a team, in the given order. */
export function teamMembers(roles: ReadonlyMap<string, DeceptionRole>, team: DeceptionTeam): string[] {
  return [...roles].filter(([, role]) => roleTeam(role) === team).map(([id]) => id);
}
