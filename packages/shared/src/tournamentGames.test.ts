import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import type { GameId } from './catalog.ts';
import { GAME_CATALOG } from './catalog.ts';
import { CheckersSettingsSchema, DEFAULT_CHECKERS_SETTINGS } from './games/checkers.ts';
import { ChessSettingsSchema, DEFAULT_CHESS_SETTINGS } from './games/chess.ts';
import { DEFAULT_MEMORY_SETTINGS, MemorySettingsSchema } from './games/memory.ts';
import { DEFAULT_PUTT_SETTINGS, PuttSettingsSchema } from './games/putt.ts';
import { DEFAULT_REVERSI_SETTINGS, ReversiSettingsSchema } from './games/reversi.ts';
import { DEFAULT_SHIPS_SETTINGS, SHIPS_FLEETS, ShipsSettingsSchema } from './games/ships.ts';
import { DEFAULT_TICTACTOE_SETTINGS, TicTacToeSettingsSchema } from './games/tictactoe.ts';
import {
  TOURNAMENT_GAME_SETTINGS,
  applyTournamentGameSetting,
  defaultTournamentGameSettings,
  selectedTournamentGameSetting,
} from './tournamentGames.ts';

/**
 * Lobby defaults and settings schema of the tournament games with lobby settings: the match room
 * merges gameSettings over the first and validates the result with the second.
 */
const ROOM_SETTINGS: Partial<Record<GameId, { defaults: Record<string, unknown>; schema: ZodType }>> = {
  chess: { defaults: DEFAULT_CHESS_SETTINGS, schema: ChessSettingsSchema },
  checkers: { defaults: DEFAULT_CHECKERS_SETTINGS, schema: CheckersSettingsSchema },
  tictactoe: { defaults: DEFAULT_TICTACTOE_SETTINGS, schema: TicTacToeSettingsSchema },
  reversi: { defaults: DEFAULT_REVERSI_SETTINGS, schema: ReversiSettingsSchema },
  memory: { defaults: DEFAULT_MEMORY_SETTINGS, schema: MemorySettingsSchema },
  ships: { defaults: DEFAULT_SHIPS_SETTINGS, schema: ShipsSettingsSchema },
  putt: { defaults: DEFAULT_PUTT_SETTINGS, schema: PuttSettingsSchema },
};

const games = Object.keys(TOURNAMENT_GAME_SETTINGS) as GameId[];

describe('TOURNAMENT_GAME_SETTINGS', () => {
  it('only lists tournament-capable games, each with a known settings schema', () => {
    for (const id of games) {
      expect(GAME_CATALOG[id].tournament, id).toBeTruthy();
      expect(ROOM_SETTINGS[id], id).toBeTruthy();
    }
  });

  it('fields have unique keys and option ids, and a default that exists', () => {
    for (const id of games) {
      const fields = TOURNAMENT_GAME_SETTINGS[id]!;
      expect(new Set(fields.map((f) => f.key)).size, id).toBe(fields.length);
      for (const f of fields) {
        expect(f.options.length, `${id}.${f.key}`).toBeGreaterThan(1);
        expect(new Set(f.options.map((o) => o.id)).size, `${id}.${f.key}`).toBe(f.options.length);
        expect(
          f.options.some((o) => o.id === f.defaultId),
          `${id}.${f.key} default`,
        ).toBe(true);
      }
    }
  });

  // A merged setting that fails the room's schema is silently dropped (BaseGameRoom), so every
  // choice the wizard offers must survive it — combined with every other field's every choice.
  it('every option, with every other field at any option, is accepted by the room and kept as chosen', () => {
    for (const id of games) {
      const { defaults, schema } = ROOM_SETTINGS[id]!;
      const fields = TOURNAMENT_GAME_SETTINGS[id]!;
      let combos: Array<Record<string, unknown>> = [{}];
      for (const f of fields) combos = combos.flatMap((gs) => f.options.map((o) => applyTournamentGameSetting(gs, f, o)));
      for (const gs of combos) {
        const parsed = schema.safeParse({ ...defaults, ...gs });
        expect(parsed.success, `${id} ${JSON.stringify(gs)}`).toBe(true);
        expect(parsed.data, `${id} ${JSON.stringify(gs)}`).toMatchObject(gs);
        for (const f of fields) expect(selectedTournamentGameSetting(f, gs), `${id}.${f.key}`).toBeDefined();
      }
    }
  });

  it('apart from the board games’ tournament clock, the defaults are the lobby defaults', () => {
    for (const id of games) {
      const { timeControl: _clock, ...rest } = defaultTournamentGameSettings(id);
      expect(ROOM_SETTINGS[id]!.defaults, id).toMatchObject(rest);
    }
  });
});

describe('Memory Matrix options', () => {
  it('offer every mode and the lives / sudden-death rule', () => {
    const [variant, rule] = TOURNAMENT_GAME_SETTINGS.memory!;
    expect(variant!.options.map((o) => o.value)).toEqual(['mixed', 'sequence', 'flash']);
    expect(rule!.options.map((o) => o.value)).toEqual(['lives', 'sudden']);
  });
});

describe('DAS Ships options', () => {
  const [firing, fleetGrid] = TOURNAMENT_GAME_SETTINGS.ships!;

  it('offer every firing mode', () => {
    expect(firing!.options.map((o) => o.value)).toEqual(['classic', 'streak', 'salvo']);
  });

  it('fleet and grid are one field: every fleet on every grid it fits, never the Armada on 8×8', () => {
    expect(fleetGrid!.combined).toBe(true);
    const values = fleetGrid!.options.map((o) => o.value as { fleet: keyof typeof SHIPS_FLEETS; gridSize: number });
    expect(values).toHaveLength(8);
    expect(values).not.toContainEqual({ fleet: 'armada', gridSize: 8 });
    for (const v of values) expect(v.gridSize).toBeGreaterThanOrEqual(SHIPS_FLEETS[v.fleet].minGrid);
  });

  it('choosing a preset sets both keys and is read back from them', () => {
    const armada = fleetGrid!.options.find((o) => o.id === 'armada-12')!;
    const gs = applyTournamentGameSetting({ firing: 'salvo', fleet: 'skirmish', gridSize: 8 }, fleetGrid!, armada);
    expect(gs).toEqual({ firing: 'salvo', fleet: 'armada', gridSize: 12 });
    expect(selectedTournamentGameSetting(fleetGrid!, gs)?.id).toBe('armada-12');
    expect(selectedTournamentGameSetting(fleetGrid!, { fleet: 'armada', gridSize: 8 })).toBeUndefined();
    expect(defaultTournamentGameSettings('ships')).toEqual({ firing: 'classic', fleet: 'standard', gridSize: 10 });
  });
});
