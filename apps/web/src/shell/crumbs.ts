import { GAME_CATALOG, cabinetForGame, isMultiGameCabinet, type CabinetDef, type GameId } from '@dascade/shared';

/**
 * The cabinet to show before a game's title in breadcrumbs ("DASino › DAS Hold'em"): its multi-game
 * cabinet, or null for single-game cabinets and when the crumb would only repeat the game's own name
 * (the DASino floor game lives in the DASino cabinet — "DASino › DASino" says nothing).
 */
export function crumbCabinet(gameId: GameId): CabinetDef | null {
  const cabinet = cabinetForGame(gameId);
  if (!cabinet || !isMultiGameCabinet(cabinet)) return null;
  const game = GAME_CATALOG[gameId];
  if (cabinet.title === game.title || cabinet.marquee === game.marquee) return null;
  return cabinet;
}
