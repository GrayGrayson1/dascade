import { z } from 'zod';
import { t, type SchemaType } from '@colyseus/schema';
import type { GameId } from '@dascade/shared';
import { BaseRoomState } from '../../src/schema/base.ts';
import { BaseGameRoom } from '../../src/rooms/BaseGameRoom.ts';

export const DuelState = BaseRoomState.extend(
  {
    /** JSON [[playerId, side]] captured at each game start (sides come from the tournament binding). */
    sidesJson: t.string().default('[]'),
    games: t.uint16().default(0),
  },
  'DuelState',
);
export type DuelState = SchemaType<typeof DuelState>;

const SettingsSchema = z.object({ mode: z.enum(['classic', 'blitz']) });
type Settings = z.infer<typeof SettingsSchema>;

/**
 * Minimal two-player game for Tournament Center integration tests. Registered only by the tournament
 * tests' own server under a tournament-capable game id ('checkers' = sides + draws; 'snake' = no sides).
 * `duel:win` / `duel:draw` end the game and report the outcome exactly like a real game room.
 */
export class TournamentDuelRoom extends BaseGameRoom<DuelState, Settings> {
  readonly gameId: GameId = 'checkers';
  protected readonly settingsSchema = SettingsSchema;
  override countdownMs = 40;

  protected defaultSettings(): Settings {
    return { mode: 'classic' };
  }
  protected createState(): DuelState {
    return new DuelState();
  }
  protected override onRoomCreated(): void {
    this.handle(
      'duel:win',
      z.object({}).optional(),
      (p) => {
        const other = this.seatedPlayers().find((x) => x !== p);
        this.reportOutcome({ placements: other ? [[p.id], [other.id]] : [[p.id]], reason: 'test_win' });
        this.endMatch({ players: [] });
      },
      { phases: ['PLAYING'], playersOnly: true },
    );
    this.handle(
      'duel:draw',
      z.object({}).optional(),
      () => {
        this.reportOutcome({ placements: [this.seatedPlayers().map((x) => x.id)], reason: 'test_draw' });
        this.endMatch({ players: [] });
      },
      { phases: ['PLAYING'], playersOnly: true },
    );
    // A buggy game that reports twice: the platform must ignore the duplicate.
    this.handle(
      'duel:reportAgain',
      z.object({}).optional(),
      (p) => {
        const other = this.seatedPlayers().find((x) => x !== p);
        this.reportOutcome({ placements: other ? [[p.id], [other.id]] : [[p.id]], reason: 'dup' });
      },
      { playersOnly: true },
    );
  }
  protected onGameStart(): void {
    this.state.games += 1;
    const info = this.tournamentMatch;
    this.state.sidesJson = JSON.stringify(info ? info.participants.map((p) => [p.playerId, p.side ?? null]) : []);
  }
}

export class SidelessDuelRoom extends TournamentDuelRoom {
  override readonly gameId: GameId = 'snake';
}
