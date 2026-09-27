/**
 * Neon Snake — authoritative grid arena on the DAScade Classics kit.
 *
 * Modes
 *  - Solo score attack (solo room): one life, the pace rises every few pickups, verified score
 *    on the high-score board (per speed / edge rule).
 *  - Multiplayer (2–12): Survival (one life, last snake alive wins, same-step crashes share a
 *    place, the living rank by length at the time cap) or Frenzy (timed, respawn after 2 s,
 *    highest score wins). Tournament games are always Survival on a small arena.
 *
 * The server steps the grid simulation (@dascade/game-core/snake) at the configured pace from
 * a 60 Hz loop, buffers each player's turn intents (up to three, no 180° reversals) and
 * broadcasts a binary grid snapshot every step. Clients never report positions, food or
 * crashes.
 *
 * Disconnects: a dropped snake keeps sliding in its last direction (it can crash — the game
 * never waits); when the reconnect grace expires or the player leaves, the snake is retired
 * (a crash in survival). Solo games pause while the player is disconnected (out of the run's
 * pause budget — see ClassicsRoom.claimSoloPause).
 */
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS_MSG, type RunEndReason, type RunSummary, type RunVerdict } from '@dascade/shared/games/classics';
import {
  DEFAULT_SNAKE_SETTINGS,
  SNAKE_MSG,
  SNAKE_STEP_MS,
  SNAKE_TOURNAMENT_SETTINGS,
  SNAKE_TURN_RATE,
  SnakePauseSchema,
  SnakeSettingsSchema,
  SnakeTurnSchema,
  type SnakeEventPayload,
  type SnakeSettings,
} from '@dascade/shared/games/snake';
import {
  arenaSize,
  cellX,
  cellY,
  createGame,
  encodeSnakeSnapshot,
  queueTurn,
  rank,
  retireSnake,
  stepGame,
  type SnakeGame,
  type SnakeSimEvent,
} from '@dascade/game-core/snake';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { ClassicsRoom } from '../classics/ClassicsRoom.ts';
import { SnakeState, SnakeView } from './SnakeState.ts';

const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;
/** Solo: READY lead-in after Start, and after resuming from a pause. */
const SOLO_LEAD_MS = 1_300;
const RESUME_LEAD_MS = 900;
/** Solo pace: each level shortens the step by this much, down to the floor. */
const SOLO_STEP_DROP = 5;
const MIN_STEP_MS = 58;

export class SnakeRoom extends ClassicsRoom<SnakeState, SnakeSettings> {
  readonly gameId = 'snake' as const;
  protected readonly settingsSchema = SnakeSettingsSchema;
  protected readonly statLabel = 'Length';

  protected game: SnakeGame | null = null;
  private readonly slotOf = new Map<string, number>();
  private idAt: string[] = [];
  private stepMs = SNAKE_STEP_MS.normal;
  private baseStepMs = SNAKE_STEP_MS.normal;
  private acc = 0;
  private startAt = 0;
  private matchCounter = 0;
  private finished = true;
  private readonly verdicts = new Map<string, RunVerdict>();
  /** Engine placements of the finished round (used by matchPlacements). */
  private enginePlacements: string[][] | null = null;

  protected defaultSettings(): SnakeSettings {
    return structuredClone(DEFAULT_SNAKE_SETTINGS);
  }

  protected createState(): SnakeState {
    return new SnakeState();
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    if (this.isSolo) this.settingsEditablePhases = ['LOBBY', 'PLAYING', 'RESULTS'];
    this.handle(SNAKE_MSG.turn, SnakeTurnSchema, (p, { dir }) => this.onTurn(p, dir), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: SNAKE_TURN_RATE,
    });
    this.handle(SNAKE_MSG.pause, SnakePauseSchema, (p, { paused }) => this.setPaused(p, paused), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 6, perSecond: 2 },
    });
    this.syncMeta();
    this.setFixedTimestep(() => this.tick(), TICK_HZ);
  }

  // ---------------------------------------------------------------------------
  // Rules + boards
  // ---------------------------------------------------------------------------

  private rules(): SnakeSettings {
    return this.tournamentMatch ? { ...SNAKE_TOURNAMENT_SETTINGS } : this.getSettings();
  }

  protected boardKey(): string {
    if (!this.isSolo) return '';
    const s = this.getSettings();
    return `solo-${s.speed}${s.wrap ? '-wrap' : ''}${s.powerUps ? '' : '-pure'}`;
  }

  protected override modeLabel(): string {
    return this.isSolo ? 'solo' : this.rules().mode;
  }

  protected override onSettingsChanged(): void {
    super.onSettingsChanged();
    if (!this.game || this.finished) this.syncMeta();
  }

  // ---------------------------------------------------------------------------
  // Runs (kit hooks)
  // ---------------------------------------------------------------------------

  protected beginSoloRun(player: PlayerRecord): void {
    this.verdicts.delete(player.id);
    this.setup([player], Date.now() + SOLO_LEAD_MS);
  }

  protected prepareMatch(entrants: PlayerRecord[], startAt: number): void {
    this.verdicts.clear();
    this.setup(entrants, startAt);
  }

  private setup(entrants: PlayerRecord[], startAt: number): void {
    const s = this.rules();
    const solo = this.isSolo;
    const { cols, rows } = arenaSize(s.arena, entrants.length, solo);
    this.baseStepMs = SNAKE_STEP_MS[s.speed];
    this.stepMs = this.baseStepMs;
    const sps = 1000 / this.baseStepMs;
    const ids = entrants.map((p) => p.id);
    this.game = createGame(
      {
        mode: solo ? 'solo' : s.mode,
        cols,
        rows,
        wrap: s.wrap,
        powerUps: s.powerUps,
        maxTicks: solo ? 0 : Math.round((s.roundSeconds * 1000) / this.baseStepMs),
        stepsPerSecond: sps,
      },
      ids,
      this.rng,
    );
    this.matchCounter = (this.matchCounter + 1) & 0xffff;
    this.slotOf.clear();
    this.idAt = ids;
    ids.forEach((id, slot) => this.slotOf.set(id, slot));
    this.acc = 0;
    this.startAt = startAt;
    this.finished = false;
    this.enginePlacements = null;
    this.state.snakes.clear();
    for (const p of entrants) {
      const v = new SnakeView();
      v.slot = this.slotOf.get(p.id)!;
      v.name = p.state.name;
      v.color = p.state.color;
      this.state.snakes.set(p.id, v);
    }
    const meta = this.state.match;
    meta.paused = false;
    meta.winnersJson = '[]';
    meta.draw = false;
    meta.startAt = startAt;
    meta.endsAt = solo ? 0 : startAt + s.roundSeconds * 1000;
    this.syncMeta();
    this.syncSnakes();
    this.broadcastSnapshot();
  }

  protected abortRun(playerId: string, reason: RunEndReason): void {
    const g = this.game;
    if (!g || this.finished) return;
    const slot = this.slotOf.get(playerId);
    if (slot === undefined) return;
    if (reason === 'quit') {
      this.finished = true;
      this.game = null;
      this.state.match.status = 'idle';
      return;
    }
    const events = retireSnake(g, slot);
    this.handleEvents(events);
    if (!this.finished && this.statusOf(playerId) === 'playing') this.finishPlayer(playerId, 'left');
    this.syncSnakes();
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  private onTurn(player: PlayerRecord, dir: number): void {
    const g = this.game;
    const slot = this.slotOf.get(player.id);
    if (!g || this.finished || slot === undefined) return;
    // A paused solo game takes no input: planning turns while frozen would make pause a free step.
    if (this.state.match.paused) return;
    queueTurn(g, slot, dir);
  }

  private setPaused(player: PlayerRecord, paused: boolean): void {
    if (!this.isSolo) return this.reject(player, SNAKE_MSG.pause, 'not_allowed', 'Arena games can’t be paused.');
    if (!this.game || this.finished || this.state.match.paused === paused) return;
    if (paused) {
      const refusal = this.claimSoloPause();
      if (refusal) return this.reject(player, SNAKE_MSG.pause, 'not_allowed', refusal);
    }
    this.state.match.paused = paused;
    if (!paused) {
      this.startAt = Date.now() + RESUME_LEAD_MS;
      this.state.match.startAt = this.startAt;
      this.acc = 0;
      this.noteSoloResume(this.startAt);
    }
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    super.onPlayerDisconnected(player);
    // Solo: freeze until the player is back, out of the run's pause budget (see claimSoloPause).
    if (this.isSolo && this.game && !this.finished && !this.state.match.paused && this.claimSoloPause('disconnect') === null) this.state.match.paused = true;
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    super.onPlayerAway(player);
    if (this.slotOf.has(player.id) && this.statusOf(player.id) === 'playing') this.abortRun(player.id, 'left');
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const verdict = this.verdicts.get(player.id);
    if (verdict) this.sendTo(player, CLASSICS_MSG.verdict, verdict);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private tick(): void {
    const g = this.game;
    if (!g || this.finished || this.phase !== 'PLAYING') return;
    if (this.state.match.paused || Date.now() < this.startAt) return;
    if (this.state.match.status !== 'running') this.state.match.status = 'running';
    this.acc += TICK_MS;
    let steps = 0;
    while (this.acc >= this.stepMs && steps < 3 && !this.finished) {
      this.acc -= this.stepMs;
      steps++;
      const events = stepGame(g, this.rng);
      this.handleEvents(events);
      this.syncSnakes();
      this.broadcastSnapshot();
    }
  }

  private broadcastSnapshot(): void {
    if (!this.game) return;
    this.broadcastBytes(SNAKE_MSG.snap, encodeSnakeSnapshot(this.game, this.matchCounter, this.stepMs), {});
  }

  private handleEvents(events: SnakeSimEvent[]): void {
    const g = this.game;
    if (!g) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'eat':
          this.emit({ kind: 'eat', playerId: this.idAt[ev.slot] ?? '', item: ev.kind, x: cellX(g, ev.cell), y: cellY(g, ev.cell), points: ev.points });
          break;
        case 'death':
          this.emit({ kind: 'death', playerId: this.idAt[ev.slot] ?? '', cause: ev.cause, by: ev.by >= 0 ? (this.idAt[ev.by] ?? '') : '', x: cellX(g, ev.cell), y: cellY(g, ev.cell) });
          break;
        case 'respawn':
          this.emit({ kind: 'respawn', playerId: this.idAt[ev.slot] ?? '' });
          break;
        case 'level':
          this.stepMs = Math.max(MIN_STEP_MS, this.baseStepMs - (ev.level - 1) * SOLO_STEP_DROP);
          this.state.match.level = ev.level;
          this.state.match.stepMs = this.stepMs;
          this.emit({ kind: 'level', level: ev.level });
          break;
        case 'over':
          this.finish();
          break;
      }
    }
  }

  private emit(payload: SnakeEventPayload): void {
    this.broadcast(SNAKE_MSG.event, payload);
  }

  private summaryFor(playerId: string): RunSummary {
    const g = this.game;
    const slot = this.slotOf.get(playerId);
    const s = g && slot !== undefined ? g.snakes[slot] : undefined;
    if (!g || !s) return { score: 0, level: 0, lives: 0, stat: 0 };
    return { score: s.score, level: this.isSolo ? g.level : 0, lives: s.alive ? 1 : 0, stat: Math.max(s.best, s.body.length) };
  }

  private finishPlayer(playerId: string, reason: RunEndReason): void {
    const g = this.game;
    const summary = this.summaryFor(playerId);
    const info = this.playerFinished(playerId, summary, reason, g?.tick ?? 0);
    const verdict: RunVerdict = {
      ...summary,
      runId: `snake-${this.matchCounter}`,
      reason,
      ticks: g?.tick ?? 0,
      best: info.best,
      rank: info.rank,
      entryId: info.entryId,
      board: info.board,
    };
    this.verdicts.set(playerId, verdict);
    this.sendTo(playerId, CLASSICS_MSG.verdict, verdict);
  }

  /** The round is decided: publish places, then finish every entrant (the kit ends the match). */
  private finish(): void {
    const g = this.game;
    if (!g || this.finished) return;
    this.finished = true;
    const groups = rank(g).map((group) => group.map((slot) => this.idAt[slot]!).filter(Boolean));
    // Leavers go last whatever the engine thinks (a forfeit is never a good result).
    const leavers = g.snakes.filter((s) => s.retired).map((s) => s.id);
    const placements = groups.map((grp) => grp.filter((id) => !leavers.includes(id))).filter((grp) => grp.length > 0);
    if (leavers.length) placements.push(leavers);
    let place = 1;
    for (const group of placements) {
      for (const id of group) {
        const v = this.state.snakes.get(id);
        if (v) v.place = place;
      }
      place += group.length;
    }
    const winners = placements[0] ?? [];
    this.state.match.status = 'over';
    this.state.match.winnersJson = JSON.stringify(winners);
    this.state.match.draw = winners.length > 1;
    this.syncSnakes();
    this.broadcastSnapshot();
    this.emit({ kind: 'over', winners, draw: winners.length > 1 });
    this.enginePlacements = placements;
    for (const id of this.idAt) {
      if (this.statusOf(id) !== 'playing') continue;
      const s = g.snakes[this.slotOf.get(id)!];
      this.finishPlayer(id, s?.retired ? 'left' : 'over');
    }
  }

  /**
   * Final placements come from the engine: survival ranks by who lasted longest (same-step
   * crashes share a place, the living rank by length at the time cap); frenzy by score. The kit
   * appends leavers last.
   */
  protected override matchPlacements(finishers: string[], scores: Record<string, number>): string[][] {
    const placements = this.enginePlacements;
    if (!placements) return super.matchPlacements(finishers, scores);
    const keep = new Set(finishers);
    const out = placements.map((group) => group.filter((id) => keep.has(id))).filter((group) => group.length > 0);
    // Anyone the engine didn't rank (shouldn't happen) goes after, by score.
    const ranked = new Set(out.flat());
    const rest = finishers.filter((id) => !ranked.has(id));
    return rest.length ? [...out, ...super.matchPlacements(rest, scores)] : out;
  }

  protected override finishMatch(reason: string): void {
    super.finishMatch(this.game ? this.game.rules.mode : reason);
  }

  // ---------------------------------------------------------------------------
  // Schema sync
  // ---------------------------------------------------------------------------

  private syncSnakes(): void {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    for (const s of g.snakes) {
      const v = this.state.snakes.get(s.id);
      if (!v) continue;
      const len = s.body.length;
      if (v.alive !== s.alive) v.alive = s.alive;
      if (v.score !== s.score) v.score = s.score;
      if (v.length !== len) v.length = len;
      if (v.kills !== s.kills) v.kills = s.kills;
      if (v.deaths !== s.deaths) v.deaths = s.deaths;
      const best = Math.max(s.best, len);
      if (v.best !== best) v.best = best;
      const respawnAt = !s.alive && s.respawnIn > 0 ? now + s.respawnIn * this.stepMs : 0;
      if ((respawnAt === 0) !== (v.respawnAt === 0)) v.respawnAt = respawnAt;
      if (v.active === s.retired) v.active = !s.retired;
      if (this.statusOf(s.id) === 'playing') this.updateStanding(s.id, this.summaryFor(s.id), g.tick);
    }
  }

  private syncMeta(): void {
    const meta = this.state.match;
    const s = this.rules();
    const g = this.game;
    meta.mode = this.isSolo ? 'survival' : s.mode;
    meta.solo = this.isSolo;
    meta.wrap = s.wrap;
    meta.matchId = this.matchCounter;
    meta.stepMs = this.stepMs;
    if (g) {
      meta.cols = g.rules.cols;
      meta.rows = g.rules.rows;
      meta.level = g.level;
      if (!this.finished) meta.status = Date.now() < this.startAt ? 'ready' : 'running';
    } else {
      const size = arenaSize(s.arena, Math.max(1, this.seatedPlayers().length), this.isSolo);
      meta.cols = size.cols;
      meta.rows = size.rows;
      meta.level = 1;
      meta.status = 'idle';
    }
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.game = null;
    this.finished = true;
    this.slotOf.clear();
    this.idAt = [];
    this.verdicts.clear();
    this.enginePlacements = null;
    this.state.snakes.clear();
    this.state.match.paused = false;
    this.state.match.endsAt = 0;
    this.state.match.startAt = 0;
    this.stepMs = this.baseStepMs;
    this.syncMeta();
  }

  protected override onRoomDisposed(): void {
    this.game = null;
  }
}
