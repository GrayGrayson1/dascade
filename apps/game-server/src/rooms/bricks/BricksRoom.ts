/**
 * Brick Blitz — locally simulated, server-verified (classics kit model 2).
 *
 * Clients run the deterministic engine (@dascade/game-core/bricks) for instant paddle feel and
 * stream their input log; this room replays it with the server-issued seed and owns score,
 * level, lives and game over. Multiplayer = a synchronized high-score race on the same seeded
 * levels (same capsule drops too): Arcade runs until everyone is out of lives, Blitz until the
 * clock runs out. Field previews are public (they're on everyone's screen anyway).
 */
import { t, type SchemaType } from '@colyseus/schema';
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS } from '@dascade/shared/games/classics';
import { BricksSettingsSchema, DEFAULT_BRICKS_SETTINGS, bricksBoardKey, type BricksSettings } from '@dascade/shared/games/bricks';
import { COLS, MAX_CODE, createBricksSim, type BricksSim } from '@dascade/game-core/bricks';
import type { ClassicsSim } from '@dascade/game-core/classics/shared';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { ClassicsState, VerifiedClassicsRoom } from '../classics/index.ts';

export const BricksState = ClassicsState.extend(
  {
    fields: t.map('string'),
  },
  'BricksState',
);
export type BricksState = SchemaType<typeof BricksState>;

const PREVIEW_MS = 400;

/** "<level>:<rows>:<cells>" — static bricks only (movers are left out of the preview). */
export function bricksPreview(sim: BricksSim): string {
  let rows = 0;
  for (const b of sim.bricks) if (b.kind !== 'M') rows = Math.max(rows, b.row + 1);
  const cells = new Array<string>(rows * COLS).fill('.');
  for (const b of sim.bricks) if (b.alive && b.kind !== 'M') cells[b.row * COLS + b.col] = b.kind;
  return `${sim.level}:${rows}:${cells.join('')}`;
}

export class BricksRoom extends VerifiedClassicsRoom<BricksState, BricksSettings> {
  readonly gameId = 'bricks' as const;
  protected readonly settingsSchema = BricksSettingsSchema;
  protected readonly statLabel = 'Bricks';
  protected readonly maxInputCode = MAX_CODE;
  private readonly lastPreview = new Map<string, number>();

  protected defaultSettings(): BricksSettings {
    return structuredClone(DEFAULT_BRICKS_SETTINGS);
  }

  protected createState(): BricksState {
    return new BricksState();
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    // Solo players pick Arcade/Blitz on the start card (between runs).
    this.settingsEditablePhases = this.isSolo ? ['LOBBY', 'PLAYING'] : ['LOBBY'];
  }

  protected createSim(seed: string, options: Record<string, number | string | boolean>): ClassicsSim {
    return createBricksSim(seed, options, false);
  }

  protected boardKey(): string {
    return bricksBoardKey(this.getSettings());
  }

  protected override modeLabel(): string {
    return this.getSettings().mode;
  }

  protected override limitTicks(): number {
    const s = this.getSettings();
    return s.mode === 'blitz' ? s.blitzSeconds * CLASSICS.tickHz : 0;
  }

  protected override onRunProgress(playerId: string, sim: ClassicsSim): void {
    const now = Date.now();
    if (!sim.over && now - (this.lastPreview.get(playerId) ?? 0) < PREVIEW_MS) return;
    this.lastPreview.set(playerId, now);
    this.state.fields.set(playerId, bricksPreview(sim as BricksSim));
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.state.fields.clear();
    this.lastPreview.clear();
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    super.onPlayerRemoved(player, reason);
    if (this.phase === 'LOBBY') this.state.fields.delete(player.id);
  }
}
