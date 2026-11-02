/**
 * What joining a room would do, from its public lookup (GET /api/rooms/:code), for the join prompt's
 * status line and warning (pure, unit-tested).
 */
import type { Phase, RoomLookup } from '@dascade/shared';

export type { RoomLookup };

/** Where the room is, in the join prompt's words. */
function stage(phase: Phase | undefined): string {
  if (!phase || phase === 'LOBBY') return 'Lobby';
  if (phase === 'COUNTDOWN') return 'Starting';
  if (phase === 'RESULTS') return 'Results';
  return 'In progress';
}

export interface JoinOutlook {
  /** e.g. "In progress · 4/8 players", "Full · 8/8 players", "Locked". */
  status: string;
  /** What "Join game" does: take a seat, end up watching (the server seats them as a spectator), or get refused. */
  joinsAs: 'player' | 'spectator' | 'refused';
  /** Said before joining whenever the player wouldn't simply get a seat. */
  warning: string | null;
  /** Offer "Watch instead" (just watch a game in progress, rather than play or wait to be dealt in). */
  offerWatch: boolean;
}

/**
 * What joining would do, from the room's public lookup. Mirrors BaseGameRoom.onJoin's seating rules:
 * a locked room refuses everyone; a full room seats newcomers as spectators (if it takes them); a game
 * in progress that doesn't take late players seats them as spectators who are dealt in next game.
 */
export function joinOutlook(lookup: RoomLookup, lateJoinAsPlayer: boolean): JoinOutlook | null {
  if (!lookup.exists) return null;
  const players = lookup.players ?? 0;
  const max = lookup.maxPlayers ?? 0;
  const count = max > 0 ? ` · ${players}/${max} players` : '';
  const spectators = lookup.allowSpectators !== false;
  const inMatch = Boolean(lookup.phase && lookup.phase !== 'LOBBY');

  if (lookup.locked) {
    return { status: 'Locked', joinsAs: 'refused', warning: 'The host has locked this room to new players.', offerWatch: false };
  }
  if (lookup.phase === 'ENDED') return { status: 'Closed', joinsAs: 'refused', warning: 'This room is closing.', offerWatch: false };
  if (lookup.full || (max > 0 && players >= max)) {
    return spectators
      ? { status: `Full${count}`, joinsAs: 'spectator', warning: 'Every seat is taken: you’ll join as a spectator.', offerWatch: false }
      : { status: `Full${count}`, joinsAs: 'refused', warning: 'Every seat is taken, and this room doesn’t take spectators.', offerWatch: false };
  }
  const status = `${stage(lookup.phase)}${count}`;
  if (inMatch && !lateJoinAsPlayer) {
    return spectators
      ? {
          status,
          joinsAs: 'spectator',
          warning: 'A game is in progress: you’ll watch it, and you’re dealt in when the next one starts.',
          offerWatch: true,
        }
      : { status, joinsAs: 'refused', warning: 'A game is in progress, and this room doesn’t take spectators.', offerWatch: false };
  }
  return { status, joinsAs: 'player', warning: null, offerWatch: inMatch && spectators };
}
