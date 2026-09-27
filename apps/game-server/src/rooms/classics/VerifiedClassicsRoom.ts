/**
 * VerifiedClassicsRoom — authority model 2 ("locally simulated, server-verified").
 *
 * The client runs the deterministic engine for instant feel and streams its input log
 * (`classics:input`); this room replays every batch through the SAME engine (from
 * @dascade/game-core) with the SAME server-issued seed and owns the result: live standings,
 * game over, the final verdict and high scores. A diverging or tampered client only ever
 * hurts itself — the server's replay stands.
 *
 * Games implement: createSim(), maxInputCode, statLabel, boardKey() (+ optional runOptions(),
 * limitTicks(), soloLeadMs, onRunProgress()).
 */
import { randomId } from '@dascade/shared';
import {
  CLASSICS,
  CLASSICS_INPUT_RATE,
  CLASSICS_MSG,
  RunInputBatchSchema,
  type RunAck,
  type RunEndReason,
  type RunInputBatch,
  type RunVerdict,
} from '@dascade/shared/games/classics';
import type { ClassicsSim } from '@dascade/game-core/classics/shared';
import type { CreateOptions } from '@dascade/shared';
import { log } from '../../lib/log.ts';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { ClassicsRoom } from './ClassicsRoom.ts';
import type { ClassicsState } from './schema.ts';
import { VerifiedRun } from './VerifiedRun.ts';

export abstract class VerifiedClassicsRoom<S extends ClassicsState = ClassicsState, Settings extends object = Record<string, unknown>> extends ClassicsRoom<
  S,
  Settings
> {
  /** Build the deterministic engine for one run (must be the exact factory the client uses). */
  protected abstract createSim(seed: string, options: Record<string, number | string | boolean>): ClassicsSim;
  /** Largest valid input code of this game's engine. */
  protected abstract readonly maxInputCode: number;
  /** Solo: ms between pressing Start and the run clock starting (READY/GO intro). */
  protected soloLeadMs = 0;
  /**
   * Solo: pausing is local (the client simply stops stepping), so a run may fall behind real time —
   * paused, stalled or in slow motion — by this much in total. Beyond it the run still plays and
   * verifies, but no longer counts for the high scores (frame-stepping a ranked run gains nothing).
   * Server-simulated games cap pauses with claimSoloPause() instead.
   */
  protected soloLagBudgetMs = 3 * 60_000;

  /** Engine options for a run (from settings). Sent to the client in the ticket. */
  protected runOptions(): Record<string, number | string | boolean> {
    return {};
  }
  /** Tick limit for runs in the current settings (timed races); 0 = until game over. */
  protected limitTicks(): number {
    return 0;
  }
  /** Called after every accepted batch (e.g. publish a public board preview). */
  protected onRunProgress(_playerId: string, _sim: ClassicsSim): void {}

  /** Live and finished runs of the current match/solo session, by player id. */
  protected readonly runs = new Map<string, VerifiedRun>();
  private watchdog: { clear(): void } | null = null;

  protected override matchDurationMs(): number {
    const ticks = this.limitTicks();
    return ticks > 0 ? Math.ceil((ticks * 1000) / CLASSICS.tickHz) : 0;
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.handle(CLASSICS_MSG.input, RunInputBatchSchema, (p, batch) => this.onBatch(p, batch), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: CLASSICS_INPUT_RATE,
      maxBytes: 16_000,
    });
    this.watchdog = this.clock.setInterval(() => this.watch(), 500);
  }

  protected override onRoomDisposed(): void {
    this.watchdog?.clear();
    this.runs.clear();
  }

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  private newRun(player: PlayerRecord, seed: string, startAt: number): VerifiedRun {
    const options = this.runOptions();
    const run = new VerifiedRun({
      runId: randomId(12, this.rng),
      matchNo: this.state.classics.matchNo,
      playerId: player.id,
      seed,
      startAt,
      limitTicks: this.limitTicks(),
      options,
      board: this.boardKey(),
      sim: this.createSim(seed, options),
      maxCode: this.maxInputCode,
    });
    this.runs.set(player.id, run);
    this.updateStanding(player.id, run.sim.summary(), 0);
    this.sendTo(player, CLASSICS_MSG.run, run.ticket());
    return run;
  }

  protected beginSoloRun(player: PlayerRecord): void {
    this.newRun(player, randomId(16, this.rng), Date.now() + this.soloLeadMs);
  }

  protected prepareMatch(entrants: PlayerRecord[], startAt: number): void {
    this.runs.clear();
    // Everyone races the same content: one seed for the whole match.
    const seed = randomId(16, this.rng);
    for (const p of entrants) this.newRun(p, seed, startAt);
  }

  protected abortRun(playerId: string, reason: RunEndReason): void {
    const run = this.runs.get(playerId);
    if (!run || run.ended) return;
    this.finalize(run, reason);
  }

  protected override onTimeUp(): void {
    // Clients stop at the tick limit and send their final batch; give stragglers a grace period.
    this.schedule('classics:grace', CLASSICS.deadlineGraceMs, () => {
      for (const run of this.runs.values()) if (!run.ended) this.finalize(run, 'time');
    });
  }

  private onBatch(player: PlayerRecord, batch: RunInputBatch): void {
    const run = this.runs.get(player.id);
    if (!run || run.runId !== batch.runId || run.ended) return;
    const res = run.ingest(batch, Date.now());
    switch (res.status) {
      case 'dup':
        return;
      case 'resync':
        this.sendTo(player, CLASSICS_MSG.ack, { runId: run.runId, seq: run.ackSeq, upTo: run.upTo, resync: true } satisfies RunAck);
        return;
      case 'rejected':
        log.warn('classics run rejected', { room: this.roomId, game: this.gameId, player: player.id, why: res.why });
        this.finalize(run, 'rejected');
        return;
      case 'ok':
        this.updateStanding(player.id, run.sim.summary(), run.upTo);
        this.onRunProgress(player.id, run.sim);
        if (res.ended) this.finalize(run, res.reason);
    }
  }

  private finalize(run: VerifiedRun, reason: RunEndReason): void {
    if (run.ended) return;
    run.end(reason);
    const summary = run.sim.summary();
    if (run.clientScore !== null && run.clientScore !== summary.score && reason === 'over') {
      log.warn('classics divergence (server result stands)', { room: this.roomId, game: this.gameId, client: run.clientScore, server: summary.score });
    }
    if (reason === 'quit') return;
    const info = this.playerFinished(run.playerId, summary, reason, run.sim.tick, run.unranked ? '' : run.board);
    const verdict: RunVerdict = {
      ...summary,
      runId: run.runId,
      reason,
      ticks: run.sim.tick,
      best: info.best,
      rank: info.rank,
      entryId: info.entryId,
      board: info.board,
    };
    run.verdict = verdict;
    this.sendTo(run.playerId, CLASSICS_MSG.verdict, verdict);
  }

  /** Lag cap (untimed multiplayer), deadline backstop (timed races) and the solo behind-real-time budget. */
  private watch(): void {
    if (this.phase !== 'PLAYING') return;
    const now = Date.now();
    if (this.isSolo) return this.watchSolo(now);
    const endsAt = this.state.classics.endsAt;
    for (const run of this.runs.values()) {
      if (run.ended) continue;
      if (endsAt > 0) {
        if (now > endsAt + CLASSICS.deadlineGraceMs) this.finalize(run, 'time');
      } else if (run.wallTicks(now) - run.upTo > (CLASSICS.maxLagMs * CLASSICS.tickHz) / 1000) {
        this.finalize(run, 'lag');
      }
    }
  }

  private watchSolo(now: number): void {
    const budget = (this.soloLagBudgetMs * CLASSICS.tickHz) / 1000;
    for (const run of this.runs.values()) {
      if (run.ended || run.unranked || !run.board || run.behindTicks(now) <= budget) continue;
      run.unranked = true;
      const player = this.players.get(run.playerId);
      if (player) this.toast(player, 'info', 'This run was paused or slowed down too long — it no longer counts for the high scores.');
    }
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const run = this.runs.get(player.id);
    if (!run) return;
    this.sendTo(player, CLASSICS_MSG.run, run.ticket());
    if (run.verdict) this.sendTo(player, CLASSICS_MSG.verdict, run.verdict);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.runs.clear();
  }
}
