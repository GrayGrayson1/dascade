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
import { DEFAULT_MEMORY_SETTINGS } from './games/memory.ts';
import { REVERSI_VARIANTS, REVERSI_VARIANT_INFO } from './games/reversi.ts';
import {
  DEFAULT_SHIPS_SETTINGS,
  SHIPS_FIRING_LABELS,
  SHIPS_FIRING_MODES,
  SHIPS_FLEETS,
  SHIPS_FLEET_IDS,
  SHIPS_GRID_SIZES,
} from './games/ships.ts';
import { TTT_VARIANTS, TTT_VARIANT_INFO } from './games/tictactoe.ts';

export interface TournamentGameSettingOption {
  id: string;
  label: string;
  value: unknown;
}

export interface TournamentGameSettingField {
  /** Top-level key of the game's settings object (for a `combined` field, just the field's id). */
  key: string;
  /**
   * Each option's `value` is an object of several top-level settings that only work together (e.g.
   * DAS Ships' fleet + grid: a fleet has a smallest grid). They are merged into `gameSettings` as one.
   */
  combined?: boolean;
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
  memory: [
    {
      key: 'variant',
      label: 'Mode',
      help: 'Both players get the same patterns every round. Mixed alternates sequence and flash rounds.',
      options: [
        { id: 'mixed', label: 'Mixed', value: 'mixed' },
        { id: 'sequence', label: 'Sequence', value: 'sequence' },
        { id: 'flash', label: 'Flash', value: 'flash' },
      ],
      defaultId: DEFAULT_MEMORY_SETTINGS.variant,
    },
    {
      key: 'rule',
      label: 'Lives',
      help: 'A run ends after this many misses. Equal scores draw.',
      options: [
        { id: 'lives', label: 'Three lives', value: 'lives' },
        { id: 'sudden', label: 'Sudden death (one miss)', value: 'sudden' },
      ],
      defaultId: DEFAULT_MEMORY_SETTINGS.rule,
    },
  ],
  ships: [
    {
      key: 'firing',
      label: 'Firing',
      help: SHIPS_FIRING_MODES.map((id) => `${SHIPS_FIRING_LABELS[id].name}: ${SHIPS_FIRING_LABELS[id].blurb}`).join(' '),
      options: SHIPS_FIRING_MODES.map((id) => ({ id, label: SHIPS_FIRING_LABELS[id].name, value: id })),
      defaultId: DEFAULT_SHIPS_SETTINGS.firing,
    },
    {
      key: 'fleetGrid',
      combined: true,
      label: 'Fleet and grid',
      help: 'Bigger fleets and seas make longer games. The Armada needs at least a 10×10 grid.',
      options: SHIPS_FLEET_IDS.flatMap((fleet) =>
        SHIPS_GRID_SIZES.filter((size) => size >= SHIPS_FLEETS[fleet].minGrid).map((gridSize) => ({
          id: `${fleet}-${gridSize}`,
          label: `${SHIPS_FLEETS[fleet].name} · ${gridSize}×${gridSize}`,
          value: { fleet, gridSize },
        })),
      ),
      defaultId: `${DEFAULT_SHIPS_SETTINGS.fleet}-${DEFAULT_SHIPS_SETTINGS.gridSize}`,
    },
  ],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `gameSettings` with `option` of `field` chosen. */
export function applyTournamentGameSetting(
  gameSettings: Record<string, unknown>,
  field: TournamentGameSettingField,
  option: TournamentGameSettingOption,
): Record<string, unknown> {
  if (field.combined) return { ...gameSettings, ...(option.value as Record<string, unknown>) };
  return { ...gameSettings, [field.key]: option.value };
}

/** The option of `field` that `gameSettings` currently holds (undefined when none matches). */
export function selectedTournamentGameSetting(
  field: TournamentGameSettingField,
  gameSettings: Record<string, unknown>,
): TournamentGameSettingOption | undefined {
  if (field.combined) {
    return field.options.find((o) => Object.entries(o.value as Record<string, unknown>).every(([k, v]) => same(gameSettings[k], v)));
  }
  return field.options.find((o) => same(o.value, gameSettings[field.key]));
}

/** `gameSettings` built from each field's default option. */
export function defaultTournamentGameSettings(gameId: GameId): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const field of TOURNAMENT_GAME_SETTINGS[gameId] ?? []) {
    const option = field.options.find((o) => o.id === field.defaultId) ?? field.options[0];
    if (option) out = applyTournamentGameSetting(out, field, option);
  }
  return out;
}
