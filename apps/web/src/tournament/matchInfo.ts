/** Pure helpers for a match room's `tournamentJson` (TournamentMatchInfo). */
import type { TournamentMatchInfo } from '@dascade/shared';

export function parseMatchInfo(json: string | null | undefined): TournamentMatchInfo | null {
  if (!json) return null;
  try {
    const info = JSON.parse(json) as TournamentMatchInfo;
    return info && typeof info.tournamentCode === 'string' && Array.isArray(info.participants) ? info : null;
  } catch {
    return null;
  }
}

/** "Game 2 of 3", "Decider", "Armageddon decider". */
export function gameLabel(info: Pick<TournamentMatchInfo, 'gameNumber' | 'bestOf' | 'decider'>): string {
  if (info.decider === 'armageddon') return 'Armageddon decider';
  if (info.decider === 'sudden_death' || info.gameNumber > info.bestOf) return 'Decider game';
  if (info.bestOf <= 1) return 'Single game';
  return `Game ${Math.max(1, info.gameNumber)} of ${info.bestOf}`;
}
