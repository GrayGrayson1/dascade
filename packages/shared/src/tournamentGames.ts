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
import { CHECKERS_VARIANTS, CHECKERS_VARIANT_INFO } from './games/checkers.ts';
import { CHESS_VARIANTS, CHESS_VARIANT_INFO } from './games/chess.ts';
import { REVERSI_VARIANTS, REVERSI_VARIANT_INFO } from './games/reversi.ts';
import { TTT_VARIANTS, TTT_VARIANT_INFO } from './games/tictactoe.ts';

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
  chess: [
    {
      key: 'variant',
      label: 'Variant',
      help: 'Every game of every match is played in this variant (Chess960 draws a new start position each game). Only standard chess is rated.',
      options: CHESS_VARIANTS.map((id) => ({ id, label: CHESS_VARIANT_INFO[id].title, value: id })),
      defaultId: 'standard',
    },
    timeControl('5+0'),
  ],
  checkers: [
    {
      key: 'variant',
      label: 'Variant',
      help: 'Every game of every match is played in this variant. Only American checkers is rated.',
      options: CHECKERS_VARIANTS.map((id) => ({ id, label: CHECKERS_VARIANT_INFO[id].title, value: id })),
      defaultId: 'american',
    },
    timeControl('5+0'),
  ],
  tictactoe: [
    {
      key: 'variant',
      label: 'Variant',
      help: 'Every game of every match is played in this variant.',
      options: TTT_VARIANTS.map((id) => ({ id, label: TTT_VARIANT_INFO[id].title, value: id })),
      defaultId: 'classic',
    },
    timeControl('3+0'),
  ],
  reversi: [
    {
      key: 'variant',
      label: 'Variant',
      help: 'Every game of every match is played in this variant (Blockers and Random Start draw a new setup each game). Only Classic is rated.',
      options: REVERSI_VARIANTS.map((id) => ({ id, label: REVERSI_VARIANT_INFO[id].title, value: id })),
      defaultId: 'classic',
    },
    timeControl('5+0'),
  ],
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
