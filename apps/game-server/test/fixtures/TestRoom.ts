import { z } from 'zod';
import { t, type SchemaType } from '@colyseus/schema';
import { BaseRoomState } from '../../src/schema/base.ts';
import { BaseGameRoom, type PlayerRecord } from '../../src/rooms/BaseGameRoom.ts';

export const TestState = BaseRoomState.extend({ counter: t.number().default(0) }, 'TestState');
export type TestState = SchemaType<typeof TestState>;

const SettingsSchema = z.object({
  target: z.number().int().min(1).max(100),
  label: z.string().max(20),
  /** Optional big field (settings byte-budget tests). */
  notes: z.string().max(60_000).optional(),
});
type Settings = z.infer<typeof SettingsSchema>;

/** Minimal game used by the platform integration tests (registered as "test", uses the 'wheel' catalog entry). */
export class TestRoom extends BaseGameRoom<TestState, Settings> {
  readonly gameId = 'wheel' as const;
  protected readonly settingsSchema = SettingsSchema;
  override countdownMs = 50;
  override reconnectGraceSeconds = 1;
  override hostMigrationDelayMs = 300;
  events: string[] = [];

  protected defaultSettings(): Settings {
    return { target: 10, label: 'hello' };
  }
  protected createState(): TestState {
    return new TestState();
  }
  protected override onRoomCreated(): void {
    this.handle('test:inc', z.object({ by: z.number().int().min(1).max(5) }), (p, { by }) => {
      this.state.counter += by;
      p.state.score += by;
    }, { phases: ['PLAYING'], playersOnly: true });
    this.handle('test:ping', z.object({}).optional(), (p) => this.sendTo(p, 'test:pong', { secret: `for-${p.id}` }), { rate: { burst: 3, perSecond: 0.1 } });
    this.handle('test:finish', z.object({}).optional(), () => this.endMatch({ players: [] }), { hostOnly: true, phases: ['PLAYING'] });
    // Simulates a game resetting its own timers (e.g. from onReturnToLobby / a round reset).
    this.handle('test:clearTimers', z.object({}).optional(), () => this.clearAllTimers());
    this.handle('test:blob', z.object({ data: z.string().max(10_000) }), (p) => this.sendTo(p, 'test:blobOk', {}), { maxBytes: 200 });
    this.handle('test:act', z.object({ n: z.number() }), (p) => this.sendTo(p, 'test:acted', {}), { playersOnly: true });
  }
  protected override onSettingsChanged(_prev: Settings, next: Settings): void {
    this.events.push(`settings:${next.target}`);
  }
  protected override onReturnToLobby(): void {
    this.events.push(`lobby:${this.phase}:${this.players.size}`);
  }
  protected override onCountdownStart(): void {
    this.events.push(`countdown:${this.phase}`);
  }
  protected onGameStart(): void {
    this.events.push('start');
  }
  protected override syncPrivate(player: PlayerRecord): void {
    // A buggy game hook must not be able to break joining or reconnecting.
    if (player.state.name === 'Boom') throw new Error('boom');
    this.sendTo(player, 'test:private', { mine: player.id });
  }
  protected override onPlayerAway(player: PlayerRecord): void {
    this.events.push(`away:${player.id}`);
  }
  protected override onPlayerRemoved(player: PlayerRecord, reason: string): void {
    this.events.push(`removed:${player.id}:${reason}`);
    this.events.push(`removed-in:${this.phase}`);
  }
}
