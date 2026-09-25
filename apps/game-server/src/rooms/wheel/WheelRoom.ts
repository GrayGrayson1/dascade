/**
 * Wheel of DAStiny: a shared, persistent spinner.
 *
 * Flow: LOBBY (host builds the wheel) → PLAYING (spin as often as you like; the
 * host can keep editing between spins) → host ends the session → RESULTS summary
 * → Play again → LOBBY.
 *
 * Authority: clients send a bare `wheel:spin` intent. The server snapshots the
 * active segments, draws the winner with its crypto RNG, and publishes a
 * deterministic plan {startAt, durationMs, fromRotation, toRotation, snapshot}.
 * Every client evaluates the same easing curve against the synced server clock,
 * so all screens (including late joiners, who pick the spin up mid-flight) land
 * on the same slice. Settings are locked while a spin is in flight.
 */
import type { Phase } from '@dascade/shared';
import { RATE } from '@dascade/shared';
import {
  DEFAULT_WHEEL_SETTINGS,
  WHEEL_LIMITS,
  WHEEL_MSG,
  WHEEL_SPIN_COOLDOWN_MS,
  WHEEL_SPIN_LEAD_MS,
  WheelEmptySchema,
  WheelSettingsSchema,
  WheelSpinSchema,
  type WheelSettings,
  type WheelSpinSnapshot,
} from '@dascade/shared/games/wheel';
import { computeArcs, displayLabel, initialRotation, normalizeRotation, normalizeSegments, planSpin } from '@dascade/game-core/wheel';
import { BaseGameRoom, type PlayerRecord } from '../BaseGameRoom.ts';
import { WheelHistoryEntry, WheelState } from './WheelState.ts';

const EDITABLE: readonly Phase[] = ['LOBBY', 'PLAYING'];
const LOCKED: readonly Phase[] = ['LOBBY'];

export class WheelRoom extends BaseGameRoom<WheelState, WheelSettings> {
  readonly gameId = 'wheel' as const;
  protected readonly settingsSchema = WheelSettingsSchema;
  /** The wheel is a tool: no 3-2-1 before the stage appears. */
  protected override countdownMs = 0;
  protected override settingsEditablePhases: readonly Phase[] = EDITABLE;
  /** Delay between publishing a spin and its first frame (lets every client start together). */
  protected spinLeadMs = WHEEL_SPIN_LEAD_MS;
  /** Pause after a landing before another spin is accepted. */
  protected spinCooldownMs = WHEEL_SPIN_COOLDOWN_MS;

  protected defaultSettings(): WheelSettings {
    return structuredClone(DEFAULT_WHEEL_SETTINGS);
  }

  protected createState(): WheelState {
    return new WheelState();
  }

  protected override onRoomCreated(): void {
    this.handle(WHEEL_MSG.spin, WheelSpinSchema, (player) => this.spin(player), { phases: ['PLAYING'], rate: RATE.heavy });
    this.handle(WHEEL_MSG.resetHistory, WheelEmptySchema, (player) => this.resetHistory(player), { phases: ['PLAYING'], hostOnly: true });
    this.handle(WHEEL_MSG.end, WheelEmptySchema, (player) => this.endSession(player), { phases: ['PLAYING'], hostOnly: true });
  }

  protected override validateStart(): string | null {
    const settings = this.getSettings();
    if (normalizeSegments(settings.segments).length === 0) return 'Add at least one option to the wheel before starting.';
    // Spectators never spin, so a spectating host on a host-only wheel would leave nobody able to spin.
    if (settings.spinPermission === 'host' && this.hostRecord?.state.spectator) {
      return 'You are spectating, so nobody could spin. Join as a player or set “Who can spin” to Anyone.';
    }
    return null;
  }

  protected override onPlayerJoined(_player: PlayerRecord): void {
    if (this.isSolo) this.startMatch();
  }

  protected onGameStart(): void {
    this.resetSpinState();
    this.state.statusText = '';
  }

  protected override onReturnToLobby(): void {
    this.resetSpinState();
    this.state.history.clear();
    this.state.totalSpins = 0;
    this.state.lastWinnerId = '';
    this.state.restRotation = 0;
  }

  // ---------------------------------------------------------------------------
  // Spinning
  // ---------------------------------------------------------------------------

  private get isSpinning(): boolean {
    return this.state.spin.status === 'spinning';
  }

  private spin(player: PlayerRecord): void {
    const settings = this.getSettings();
    if (player.state.spectator) {
      return this.reject(player, WHEEL_MSG.spin, 'not_allowed', 'Spectators can watch, but not spin.');
    }
    if (!this.isHost(player) && settings.spinPermission !== 'anyone') {
      return this.reject(player, WHEEL_MSG.spin, 'not_host', 'Only the host can spin this wheel.');
    }
    if (this.isSpinning) {
      return this.reject(player, WHEEL_MSG.spin, 'not_allowed', 'The wheel is already spinning!');
    }
    const now = Date.now();
    if (now < this.state.nextSpinAt) {
      return this.reject(player, WHEEL_MSG.spin, 'not_allowed', 'Let the last result sink in for a second…');
    }
    const segments = normalizeSegments(settings.segments);
    if (segments.length === 0) {
      return this.reject(player, WHEEL_MSG.spin, 'not_allowed', 'There is nothing on the wheel. Add or re-enable some options first.');
    }

    const from = this.state.spin.spinId === 0 ? initialRotation(computeArcs(segments, settings.sliceMode)) : this.state.restRotation;
    const plan = planSpin({
      segments,
      sliceMode: settings.sliceMode,
      rng: this.rng,
      fromRotation: from,
      durationMs: settings.spinDurationMs,
      previousWinnerId: this.state.lastWinnerId || null,
      preventRepeat: settings.repeats === 'prevent',
    });
    const snapshot: WheelSpinSnapshot = { sliceMode: settings.sliceMode, segments };

    const spin = this.state.spin;
    spin.spinId = spin.spinId + 1;
    spin.status = 'spinning';
    spin.startAt = now + this.spinLeadMs;
    spin.durationMs = settings.spinDurationMs;
    spin.fromRotation = plan.fromRotation;
    spin.toRotation = plan.toRotation;
    spin.winnerId = plan.winnerId;
    spin.winnerIndex = plan.winnerIndex;
    spin.spunById = player.id;
    spin.spunByName = player.state.name;
    spin.snapshotJson = JSON.stringify(snapshot);

    // No edits while the wheel is in flight: the snapshot is what everyone is watching.
    this.settingsEditablePhases = LOCKED;
    const spinId = spin.spinId;
    this.schedule('land', this.spinLeadMs + settings.spinDurationMs, () => this.land(spinId));
  }

  private land(spinId: number): void {
    const spin = this.state.spin;
    if (spin.spinId !== spinId || spin.status !== 'spinning') return;
    const snapshot = this.parseSnapshot(spin.snapshotJson);
    const winner = snapshot?.segments[spin.winnerIndex];
    spin.status = 'landed';
    this.state.restRotation = normalizeRotation(spin.toRotation);
    this.state.nextSpinAt = Date.now() + this.spinCooldownMs;
    this.settingsEditablePhases = EDITABLE;
    if (!winner) return;

    const entry = new WheelHistoryEntry();
    entry.spinId = spinId;
    entry.segmentId = winner.id;
    entry.label = winner.label;
    entry.emoji = winner.emoji;
    entry.color = winner.color;
    entry.spunById = spin.spunById;
    entry.spunByName = spin.spunByName;
    entry.at = Date.now();
    this.state.history.push(entry);
    const overflow = this.state.history.length - WHEEL_LIMITS.history;
    if (overflow > 0) this.state.history.splice(0, overflow);
    this.state.totalSpins += 1;
    this.state.lastWinnerId = winner.id;
    const spinner = this.getPlayer(spin.spunById);
    if (spinner) spinner.state.score += 1;

    const name = displayLabel(winner);
    this.systemChat(`The wheel landed on ${winner.label && winner.emoji ? `${winner.emoji} ` : ''}${name} (spun by ${spin.spunByName}).`);

    const settings = this.getSettings();
    if (settings.afterSpin === 'remove') {
      const segments = settings.segments.map((s) => (s.id === winner.id ? { ...s, enabled: false } : s));
      this.updateSettings({ ...settings, segments });
      if (normalizeSegments(segments).length === 0) {
        this.toast('all', 'info', 'Every option has been picked. The host can re-enable options to keep spinning.');
      }
    }
  }

  private resetSpinState(): void {
    this.cancel('land');
    const spin = this.state.spin;
    spin.status = 'idle';
    spin.startAt = 0;
    spin.durationMs = 0;
    spin.fromRotation = 0;
    spin.toRotation = 0;
    spin.winnerId = '';
    spin.winnerIndex = -1;
    spin.spunById = '';
    spin.spunByName = '';
    spin.snapshotJson = '';
    spin.spinId = 0;
    this.state.nextSpinAt = 0;
    this.settingsEditablePhases = EDITABLE;
  }

  private resetHistory(player: PlayerRecord): void {
    if (this.isSpinning) return this.reject(player, WHEEL_MSG.resetHistory, 'not_allowed', 'Wait for the wheel to stop first.');
    this.state.history.clear();
    this.state.lastWinnerId = '';
    this.systemChat(`${player.state.name} cleared the result history.`);
  }

  private endSession(player: PlayerRecord): void {
    if (this.isSpinning) return this.reject(player, WHEEL_MSG.end, 'not_allowed', 'Wait for the wheel to stop first.');
    const counts = new Map<string, number>();
    for (const h of this.state.history) {
      const key = h.label || h.emoji;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const ranked = this.seatedPlayers().sort((a, b) => b.state.score - a.state.score);
    this.endMatch({
      players: ranked.map((p, i) => ({
        playerId: p.id,
        name: p.state.name,
        guestId: p.guestId,
        userId: p.userId,
        score: p.state.score,
        placement: i + 1,
      })),
      details: { spins: this.state.totalSpins, topResult: top?.[0] ?? null },
    });
  }

  private parseSnapshot(json: string): WheelSpinSnapshot | null {
    try {
      return JSON.parse(json) as WheelSpinSnapshot;
    } catch {
      return null;
    }
  }
}
