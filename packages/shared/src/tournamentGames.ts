/**
 * Organizer-settable game settings per tournament-capable game, for the Tournament Center
 * create wizard. Import it as `@dascade/shared/tournamentGames` (kept out of the package index so
 * the arcade bundle doesn't pull in game contracts).
 *
 * Each option's `value` goes into `TournamentConfig.gameSettings[key]`; the match room merges
 * `gameSettings` over the game's defaults and validates them with the game's own settings schema.
 * Games not listed (or keys not set) use the game's defaults — several games also pin their own
 * tournament rules (e.g. paddle's PADDLE_TOURNAMENT_RULES).
 */
import type { GameId } from './catalog.ts';
import { CLOCK_PRESETS } from './games/boardroom.ts';

export interface TournamentGameSettingOption {
  id: string;
  label: string;
  value: unknown;
}

export interface TournamentGameSettingField {
  /** Top-level key of the game's settings object. */
  key: string;
  label: string;
  help?: string;
  options: TournamentGameSettingOption[];
  defaultId: string;
}

const timeControl = (defaultId: string): TournamentGameSettingField => ({
  key: 'timeControl',
  label: 'Time control',
  help: 'Minutes per player + seconds added per move. Every game of every match uses it.',
  options: CLOCK_PRESETS.map((p) => ({ id: p.id, label: p.label, value: { baseMinutes: p.baseMinutes, incrementSeconds: p.incrementSeconds } })),
  defaultId,
});

export const TOURNAMENT_GAME_SETTINGS: Partial<Record<GameId, TournamentGameSettingField[]>> = {
  chess: [timeControl('5+0')],
  checkers: [timeControl('5+0')],
};

/** `gameSettings` built from each field's default option. */
export function defaultTournamentGameSettings(gameId: GameId): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of TOURNAMENT_GAME_SETTINGS[gameId] ?? []) {
    const option = field.options.find((o) => o.id === field.defaultId) ?? field.options[0];
    if (option) out[field.key] = option.value;
  }
  return out;
}
