/**
 * Block Drop — locally simulated, server-verified (classics kit model 2).
 *
 * Every client plays the deterministic engine (@dascade/game-core/blocks) for instant feel and
 * streams its input log; this room replays it with the same server-issued seed and owns score,
 * lines, level and game over. Multiplayer = a synchronized score race: everyone gets the same
 * piece sequence and starts together; Marathon runs until each stack tops out, Blitz until the
 * clock (in engine ticks) runs out. Live stack previews are public (they're on everyone's
 * screen anyway); seeds and logs stay private.
 */
import { t, type SchemaType } from '@colyseus/schema';
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS } from '@dascade/shared/games/classics';
import { BlocksSettingsSchema, DEFAULT_BLOCKS_SETTINGS, blocksBoardKey, type BlocksSettings } from '@dascade/shared/games/blocks';
import { MAX_CODE, createBlocksSim, type BlocksSim } from '@dascade/game-core/blocks';
import type { ClassicsSim } from '@dascade/game-core/classics/shared';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { ClassicsState, VerifiedClassicsRoom } from '../classics/index.ts';

export const BlocksState = ClassicsState.extend(
  {
    boards: t.map('string'),
  },
  'BlocksState',
);
export type BlocksState = SchemaType<typeof BlocksState>;

/** Stack previews are refreshed at most this often per player. */
const PREVIEW_MS = 350;

export class BlocksRoom extends VerifiedClassicsRoom<BlocksState, BlocksSettings> {
  readonly gameId = 'blocks' as const;
  protected readonly settingsSchema = BlocksSettingsSchema;
  protected readonly statLabel = 'Lines';
  protected readonly maxInputCode = MAX_CODE;
  protected override soloLeadMs = 1_400;
  private readonly lastPreview = new Map<string, number>();

  protected defaultSettings(): BlocksSettings {
    return structuredClone(DEFAULT_BLOCKS_SETTINGS);
  }

  protected createState(): BlocksState {
    return new BlocksState();
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    // Solo players pick Marathon/Blitz on the start card (between runs).
    this.settingsEditablePhases = this.isSolo ? ['LOBBY', 'PLAYING'] : ['LOBBY'];
  }

  protected createSim(seed: string, options: Record<string, number | string | boolean>): ClassicsSim {
    return createBlocksSim(seed, options, false);
  }

  protected boardKey(): string {
    return blocksBoardKey(this.getSettings());
  }

  protected override modeLabel(): string {
    return this.getSettings().mode;
  }

  protected override runOptions(): Record<string, number | string | boolean> {
    return { startLevel: this.getSettings().startLevel };
  }

  protected override limitTicks(): number {
    const s = this.getSettings();
    return s.mode === 'blitz' ? s.blitzSeconds * CLASSICS.tickHz : 0;
  }

  protected override onRunProgress(playerId: string, sim: ClassicsSim): void {
    const now = Date.now();
    const blocks = sim as BlocksSim;
    if (!blocks.over && now - (this.lastPreview.get(playerId) ?? 0) < PREVIEW_MS) return;
    this.lastPreview.set(playerId, now);
    this.state.boards.set(playerId, blocks.preview());
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.state.boards.clear();
    this.lastPreview.clear();
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    super.onPlayerRemoved(player, reason);
    if (this.phase === 'LOBBY') this.state.boards.delete(player.id);
  }
}
