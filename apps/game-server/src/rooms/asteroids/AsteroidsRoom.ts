/**
 * Asteroid Run — authoritative top-down space survival on the DAScade Classics kit.
 *
 * Solo (solo room) and co-op (up to 4 pilots) share one model: the server runs the 60 Hz
 * world simulation (@dascade/game-core/asteroids). Clients send sequenced control frames
 * (`asteroids:input`, 2 per packet) into a per-pilot IntentQueue (credit bank: never faster
 * than real time); the server flies every ship, fires every shot and decides every hit,
 * split, drop, shield hit and lost ship. A binary snapshot goes out every 3 ticks with each
 * ship's last applied input seq so the owner can reconcile its predicted ship.
 *
 * Solo runs are verified by construction and go to the high-score board (per difficulty and
 * lives). Co-op: each pilot scores for their own shots; downed pilots come back with one ship
 * when the team clears a wave (setting); the run ends when every pilot is out at once.
 *
 * Disconnects: a dropped pilot's ship coasts with neutral controls (it can still be hit) and
 * is retired when the grace expires or they leave; solo runs pause while disconnected (out of
 * the run's pause budget — see ClassicsRoom.claimSoloPause).
 */
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS_MSG, type RunEndReason, type RunSummary, type RunVerdict } from '@dascade/shared/games/classics';
import {
  ASTEROIDS_INPUT_MAX,
  ASTEROIDS_INPUT_RATE,
  ASTEROIDS_MSG,
  ASTEROIDS_NET,
  AsteroidsInputSchema,
  AsteroidsPauseSchema,
  AsteroidsSettingsSchema,
  DEFAULT_ASTEROIDS_SETTINGS,
  type AsteroidsEventPayload,
  type AsteroidsSettings,
} from '@dascade/shared/games/asteroids';
import { IntentQueue } from '@dascade/game-core/classics/shared';
import { createWorld, encodeAsteroidsSnapshot, retireShip, stepWorld, type AsteroidsSimEvent, type World } from '@dascade/game-core/asteroids';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { ClassicsRoom } from '../classics/ClassicsRoom.ts';
import { AsteroidsState, PilotView } from './AsteroidsState.ts';

const TICK_HZ = 60;
const SOLO_LEAD_MS = 1_500;
const RESUME_LEAD_MS = 1_000;
/** Pilot meta (shields) is copied into the schema every N ticks. */
const META_EVERY = 6;

export class AsteroidsRoom extends ClassicsRoom<AsteroidsState, AsteroidsSettings> {
  readonly gameId = 'asteroids' as const;
  protected readonly settingsSchema = AsteroidsSettingsSchema;
  protected readonly statLabel = 'Wave';

  protected world: World | null = null;
  private readonly slotOf = new Map<string, number>();
  private idAt: string[] = [];
  private queues: IntentQueue[] = [];
  private startAt = 0;
  private matchCounter = 0;
  private finished = true;
  private readonly verdicts = new Map<string, RunVerdict>();
  /** Diagnostics for tests/load checks. */
  readonly stats = { snapshots: 0, snapshotBytes: 0, ticks: 0, stepMsMax: 0 };

  protected defaultSettings(): AsteroidsSettings {
    return structuredClone(DEFAULT_ASTEROIDS_SETTINGS);
  }

  protected createState(): AsteroidsState {
    return new AsteroidsState();
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    if (this.isSolo) this.settingsEditablePhases = ['LOBBY', 'PLAYING', 'RESULTS'];
    this.handle(ASTEROIDS_MSG.input, AsteroidsInputSchema, (p, packet) => this.onInput(p, packet.seq, packet.inputs), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: ASTEROIDS_INPUT_RATE,
      // Schema maximum: the object, seq, the array and its frames (3 + maxInputsPerPacket).
      maxNodes: ASTEROIDS_NET.maxInputsPerPacket + 8,
    });
    this.handle(ASTEROIDS_MSG.pause, AsteroidsPauseSchema, (p, { paused }) => this.setPaused(p, paused), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 6, perSecond: 2 },
    });
    this.syncRun();
    this.setFixedTimestep(() => this.tick(), TICK_HZ);
  }

  // ---------------------------------------------------------------------------
  // Boards
  // ---------------------------------------------------------------------------

  protected boardKey(): string {
    if (!this.isSolo) return '';
    const s = this.getSettings();
    return s.lives === DEFAULT_ASTEROIDS_SETTINGS.lives ? s.difficulty : `${s.difficulty}-${s.lives}l`;
  }

  protected override modeLabel(): string {
    return this.isSolo ? 'solo' : 'coop';
  }

  protected override onSettingsChanged(): void {
    super.onSettingsChanged();
    if (!this.world || this.finished) this.syncRun();
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
    const s = this.getSettings();
    const ids = entrants.slice(0, 4).map((p) => p.id);
    this.world = createWorld({ difficulty: s.difficulty, lives: s.lives, revive: s.revive }, ids, this.rng);
    this.matchCounter = (this.matchCounter + 1) & 0xffff;
    this.slotOf.clear();
    this.idAt = ids;
    ids.forEach((id, slot) => this.slotOf.set(id, slot));
    this.queues = ids.map(() => new IntentQueue());
    this.startAt = startAt;
    this.finished = false;
    this.state.pilots.clear();
    for (const p of entrants.slice(0, 4)) {
      const v = new PilotView();
      v.slot = this.slotOf.get(p.id)!;
      v.name = p.state.name;
      v.color = p.state.color;
      this.state.pilots.set(p.id, v);
    }
    this.state.run.paused = false;
    this.state.run.startAt = startAt;
    this.syncRun();
    this.syncPilots(true);
    this.broadcastSnapshot();
  }

  protected abortRun(playerId: string, reason: RunEndReason): void {
    const w = this.world;
    if (!w || this.finished) return;
    const slot = this.slotOf.get(playerId);
    if (slot === undefined) return;
    if (reason === 'quit') {
      this.finished = true;
      this.world = null;
      this.state.run.status = 'idle';
      return;
    }
    this.handleEvents(retireShip(w, slot));
    if (!this.finished && this.statusOf(playerId) === 'playing') this.finishPlayer(playerId, 'left');
    this.syncPilots(true);
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  private onInput(player: PlayerRecord, seq: number, inputs: number[]): void {
    const slot = this.slotOf.get(player.id);
    if (slot === undefined || !this.world || this.finished) return;
    this.queues[slot]?.push(seq, inputs, ASTEROIDS_INPUT_MAX);
  }

  private setPaused(player: PlayerRecord, paused: boolean): void {
    if (!this.isSolo) return this.reject(player, ASTEROIDS_MSG.pause, 'not_allowed', 'Co-op runs can’t be paused.');
    if (!this.world || this.finished || this.state.run.paused === paused) return;
    if (paused) {
      const refusal = this.claimSoloPause();
      if (refusal) return this.reject(player, ASTEROIDS_MSG.pause, 'not_allowed', refusal);
    }
    this.state.run.paused = paused;
    if (!paused) {
      this.startAt = Date.now() + RESUME_LEAD_MS;
      this.state.run.startAt = this.startAt;
      this.noteSoloResume(this.startAt);
    }
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    super.onPlayerDisconnected(player);
    // Solo: freeze until the player is back, out of the run's pause budget (see claimSoloPause).
    if (this.isSolo && this.world && !this.finished && !this.state.run.paused && this.claimSoloPause('disconnect') === null) this.state.run.paused = true;
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
    const w = this.world;
    if (!w || this.finished || this.phase !== 'PLAYING') return;
    if (this.state.run.paused || Date.now() < this.startAt) return;
    const t0 = performance.now();
    const frames = w.ships.map((s, slot) => {
      const q = this.queues[slot];
      if (!q) return 0;
      const frame = q.next();
      const record = this.players.get(s.id);
      // Starved (lag, hidden tab) or disconnected pilots coast with neutral controls.
      return q.starved || !record?.client ? 0 : frame;
    });
    const { events } = stepWorld(w, frames, this.rng);
    this.handleEvents(events);
    if (w.tick % ASTEROIDS_NET.snapEvery === 0) this.broadcastSnapshot();
    if (w.tick % META_EVERY === 0) this.syncPilots(false);
    this.stats.ticks++;
    this.stats.stepMsMax = Math.max(this.stats.stepMsMax, performance.now() - t0);
  }

  private broadcastSnapshot(): void {
    if (!this.world) return;
    const bytes = encodeAsteroidsSnapshot(
      this.world,
      this.matchCounter,
      this.queues.map((q) => q.ackSeq),
    );
    this.stats.snapshots++;
    this.stats.snapshotBytes += bytes.byteLength;
    this.broadcastBytes(ASTEROIDS_MSG.snap, bytes, {});
  }

  private handleEvents(events: AsteroidsSimEvent[]): void {
    const w = this.world;
    if (!w) return;
    let scoreDirty = false;
    for (const ev of events) {
      switch (ev.type) {
        case 'rock':
          if (ev.points > 0) scoreDirty = true;
          this.emit({ kind: 'rock', x: r1(ev.x), y: r1(ev.y), size: ev.size, rock: ev.kind, by: ev.by >= 0 ? (this.idAt[ev.by] ?? '') : '', points: ev.points, destroyed: ev.destroyed });
          break;
        case 'ship-hit':
          this.emit({ kind: 'ship-hit', playerId: this.idAt[ev.slot] ?? '', x: r1(ev.x), y: r1(ev.y), shield: Math.round(ev.shield) });
          break;
        case 'ship-down':
          scoreDirty = true;
          this.emit({ kind: 'ship-down', playerId: this.idAt[ev.slot] ?? '', x: r1(ev.x), y: r1(ev.y), lives: ev.lives });
          break;
        case 'respawn':
          this.emit({ kind: 'respawn', playerId: this.idAt[ev.slot] ?? '' });
          break;
        case 'pickup':
          scoreDirty = true;
          this.emit({ kind: 'pickup', playerId: this.idAt[ev.slot] ?? '', power: ev.kind, x: r1(ev.x), y: r1(ev.y) });
          break;
        case 'nova':
          this.emit({ kind: 'nova', playerId: this.idAt[ev.slot] ?? '', x: r1(ev.x), y: r1(ev.y) });
          break;
        case 'wave':
          scoreDirty = true;
          this.emit({ kind: 'wave', wave: ev.wave, bonus: ev.bonus });
          break;
        case 'revive':
          scoreDirty = true;
          this.emit({ kind: 'revive', playerId: this.idAt[ev.slot] ?? '' });
          break;
        case 'over':
          this.syncRun();
          this.syncPilots(true);
          this.broadcastSnapshot();
          this.emit({ kind: 'over', wave: w.wave, score: w.teamScore });
          this.finish();
          return;
      }
    }
    if (scoreDirty) this.syncPilots(true);
    if (scoreDirty || this.state.run.status !== w.status || this.state.run.wave !== w.wave) this.syncRun();
  }

  private emit(payload: AsteroidsEventPayload): void {
    this.broadcast(ASTEROIDS_MSG.event, payload);
  }

  private summaryFor(playerId: string): RunSummary {
    const w = this.world;
    const slot = this.slotOf.get(playerId);
    const s = w && slot !== undefined ? w.ships[slot] : undefined;
    if (!w || !s) return { score: 0, level: 0, lives: 0, stat: 0 };
    return { score: s.score, level: w.wave, lives: s.lives, stat: w.wave };
  }

  private finishPlayer(playerId: string, reason: RunEndReason): void {
    const w = this.world;
    const summary = this.summaryFor(playerId);
    const info = this.playerFinished(playerId, summary, reason, w?.tick ?? 0);
    const verdict: RunVerdict = {
      ...summary,
      runId: `asteroids-${this.matchCounter}`,
      reason,
      ticks: w?.tick ?? 0,
      best: info.best,
      rank: info.rank,
      entryId: info.entryId,
      board: info.board,
    };
    this.verdicts.set(playerId, verdict);
    this.sendTo(playerId, CLASSICS_MSG.verdict, verdict);
  }

  private finish(): void {
    const w = this.world;
    if (!w || this.finished) return;
    this.finished = true;
    this.state.run.status = 'over';
    for (const id of this.idAt) {
      if (this.statusOf(id) !== 'playing') continue;
      const s = w.ships[this.slotOf.get(id)!];
      this.finishPlayer(id, s?.retired ? 'left' : 'over');
    }
  }

  // ---------------------------------------------------------------------------
  // Schema sync
  // ---------------------------------------------------------------------------

  private syncPilots(standings: boolean): void {
    const w = this.world;
    if (!w) return;
    for (const s of w.ships) {
      const v = this.state.pilots.get(s.id);
      if (!v) continue;
      const shield = Math.round(s.shield);
      if (v.score !== s.score) v.score = s.score;
      if (v.lives !== s.lives) v.lives = s.lives;
      if (v.shield !== shield) v.shield = shield;
      if (v.kills !== s.kills) v.kills = s.kills;
      if (v.out !== s.out) v.out = s.out;
      if (v.active === s.retired) v.active = !s.retired;
      if (standings && this.statusOf(s.id) === 'playing') this.updateStanding(s.id, this.summaryFor(s.id), w.tick);
    }
  }

  private syncRun(): void {
    const run = this.state.run;
    const s = this.getSettings();
    const w = this.world;
    run.difficulty = s.difficulty;
    run.coop = !this.isSolo;
    run.matchId = this.matchCounter;
    if (w) {
      run.status = this.finished && w.status !== 'over' ? 'idle' : w.status;
      run.wave = w.wave;
      run.teamScore = w.teamScore;
    } else {
      run.status = 'idle';
      run.wave = 0;
      run.teamScore = 0;
    }
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.world = null;
    this.finished = true;
    this.slotOf.clear();
    this.idAt = [];
    this.queues = [];
    this.verdicts.clear();
    this.state.pilots.clear();
    this.state.run.paused = false;
    this.state.run.startAt = 0;
    this.syncRun();
  }

  protected override onRoomDisposed(): void {
    this.world = null;
  }
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
