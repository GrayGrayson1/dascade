/**
 * Presentation helpers shared by the lineup plaque, the cabinet picker and the
 * title screen: player ranges, feature badges and category labels.
 */
import { GAME_CATALOG, type CabinetDef, type CabinetGame, type GameCatalogEntry, type GameId } from '@dascade/shared';
import type { IconName } from '@dascade/ui';

export const CATEGORY_LABEL: Record<GameCatalogEntry['category'], string> = {
  party: 'Party game',
  casino: 'Casino table',
  racing: 'Racing',
  adventure: 'Co-op adventure',
  strategy: 'Strategy',
  sports: 'Sports',
  action: 'Action',
  puzzle: 'Puzzle',
  meta: 'Tournaments',
};

/** Games whose rules include a team mode (the catalog has no flag for it yet). */
const TEAM_GAMES: ReadonlySet<GameId> = new Set<GameId>(['trivia', 'words', 'tanks']);

export function playerRange(game: GameCatalogEntry): string {
  const { minPlayers, maxPlayersLimit } = game.capacity;
  return minPlayers === maxPlayersLimit ? `${minPlayers}` : `${minPlayers}–${maxPlayersLimit}`;
}

export function playersText(game: GameCatalogEntry): string {
  const r = playerRange(game);
  return `${r} player${r === '1' ? '' : 's'}`;
}

export interface FeatureBadge {
  key: string;
  label: string;
  icon: IconName;
  color?: string;
}

/** Feature badges for one game (order matters: most useful first). */
export function gameBadges(game: GameCatalogEntry): FeatureBadge[] {
  const out: FeatureBadge[] = [];
  if (game.capacity.maxPlayersLimit === 2 && game.capacity.minPlayers === 2)
    out.push({ key: 'duel', label: 'Head-to-head', icon: 'users', color: 'var(--orange)' });
  if (game.capacity.supportsSolo) out.push({ key: 'solo', label: 'Solo', icon: 'user', color: 'var(--cyan)' });
  if (TEAM_GAMES.has(game.id)) out.push({ key: 'teams', label: 'Teams', icon: 'flag', color: 'var(--green)' });
  if (game.tournament) out.push({ key: 'tournament', label: 'Tournament', icon: 'trophy', color: 'var(--yellow)' });
  if (game.rated) out.push({ key: 'rated', label: 'Rated', icon: 'star', color: 'var(--yellow)' });
  if (game.capacity.supportsSpectators) out.push({ key: 'spectators', label: 'Spectators', icon: 'eye', color: 'var(--purple)' });
  if (game.virtualChips) out.push({ key: 'chips', label: 'Virtual chips', icon: 'chip', color: 'var(--yellow)' });
  return out;
}

/** Union of the badges of every game in a cabinet (no duplicates, no "Head-to-head" unless all are). */
export function cabinetBadges(cabinet: CabinetDef): FeatureBadge[] {
  const games = uniqueGames(cabinet).map((g) => GAME_CATALOG[g]);
  const seen = new Map<string, FeatureBadge>();
  for (const g of games) for (const b of gameBadges(g)) if (!seen.has(b.key)) seen.set(b.key, b);
  if (!games.every((g) => g.capacity.maxPlayersLimit === 2)) seen.delete('duel');
  return [...seen.values()];
}

export function uniqueGames(cabinet: CabinetDef): GameId[] {
  return [...new Set(cabinet.games.map((g) => g.gameId))];
}

export function cabinetHasTournament(cabinet: CabinetDef): boolean {
  return uniqueGames(cabinet).some((id) => !!GAME_CATALOG[id].tournament);
}

/** Tournament-capable games inside a cabinet (in lineup order). */
export function tournamentGames(cabinet: CabinetDef): CabinetGame[] {
  return cabinet.games.filter((g) => !!GAME_CATALOG[g.gameId].tournament);
}

/** Players label for a single cabinet entry (a DASino table uses the DASino room capacity). */
export function entryPlayers(entry: CabinetGame): string {
  return playersText(GAME_CATALOG[entry.gameId]);
}
