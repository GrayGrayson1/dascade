/**
 * DASh Circuit — authoritative top-down racing room.
 *
 * Flow: LOBBY (car setup, track/laps) → COUNTDOWN (grid visible, start lights, cars
 * locked; inputs are consumed and acknowledged) → PLAYING (race; after the winner the
 * field gets a finish window, then DNF) → RESULTS → LOBBY (or straight to a rematch).
 *
 * The room runs a fixed 60 Hz simulation (`RaceSim` from game-core). Clients only
 * send sequenced inputs; the server owns positions, checkpoints, laps, finish order
 * and race time. Car motion is broadcast as a compact binary snapshot every 2–3
 * ticks; low-rate race meta is in the schema state.
 */
import {
  CIRCUIT_INPUT_RATE,
  CIRCUIT_MSG,
  CIRCUIT_SIM,
  CarConfigSchema,
  CircuitInputSchema,
  CircuitSettingsSchema,
  DEFAULT_CIRCUIT_SETTINGS,
  NAMEPLATE_MAX,
  defaultCarConfig,
  nameplateFrom,
  type CarConfig,
  type CircuitEvent,
  type CircuitSettings,
} from '@dascade/shared/games/circuit';
import { EmptySchema, cleanText, maskProfanity, shuffleInPlace } from '@dascade/shared';
import { GRID_SLOTS, RaceSim, getTrack, type SimEvent } from '@dascade/game-core/circuit';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted } from '../outcomePlacements.ts';
import { CarLook, CircuitState, Racer } from './CircuitState.ts';

/** How often (ticks) race meta (distance/positions) is copied into the schema. */
const META_EVERY = 15;

export class CircuitRoom extends BaseGameRoom<CircuitState, CircuitSettings> {
  readonly gameId = 'circuit' as const;
  protected readonly settingsSchema = CircuitSettingsSchema;
  override countdownMs = CIRCUIT_SIM.countdownMs;
  /** Cool-down after the race is decided (finish celebration) before RESULTS. */
  protected resultsDelayMs = 3_500;

  /** The live race (kept through RESULTS so the scene can keep rendering the final grid). */
  protected sim: RaceSim | null = null;
  private readonly slotOf = new Map<string, number>();
  private readonly playerAt = new Map<number, string>();
  private raceCounter = 0;
  private snapEvery = 2;
  /** Diagnostics (read by tests and the load script's server-side counterpart). */
  readonly stats = { snapshots: 0, snapshotBytes: 0, inputPackets: 0, inputFrames: 0, ticks: 0, stepMsTotal: 0, stepMsMax: 0 };

  protected defaultSettings(): CircuitSettings {
    return structuredClone(DEFAULT_CIRCUIT_SETTINGS);
  }

  protected createState(): CircuitState {
    return new CircuitState();
  }

  protected override onRoomCreated(): void {
    this.syncRacePreview();
    this.state.race.solo = this.isSolo;

    this.handle(CIRCUIT_MSG.car, CarConfigSchema, (p, cfg) => this.setCar(p, cfg), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 8, perSecond: 3 },
    });

    this.handle(CIRCUIT_MSG.input, CircuitInputSchema, (p, packet) => this.onInput(p, packet.seq, packet.inputs), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: CIRCUIT_INPUT_RATE,
    });

    this.handle(
      CIRCUIT_MSG.rematch,
      EmptySchema,
      () => {
        this.returnToLobby();
        this.startMatch();
      },
      { phases: ['RESULTS'], hostOnly: true, rate: { burst: 2, perSecond: 0.5 } },
    );

    this.setFixedTimestep(() => this.tick(), CIRCUIT_SIM.tickRate);
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  protected override onPlayerJoined(player: PlayerRecord): void {
    const look = new CarLook();
    Object.assign(look, defaultCarConfig(player.state.color, player.state.name, player.state.joinOrder));
    look.nameplate = this.cleanPlate(look.nameplate, player);
    this.state.cars.set(player.id, look);
    if (this.isSolo) this.startMatch();
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const slot = this.slotOf.get(player.id);
    if (slot !== undefined) this.sim?.setConnected(slot, false);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    const slot = this.slotOf.get(player.id);
    if (slot !== undefined) this.sim?.setConnected(slot, true);
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    this.retirePlayer(player.id, 'disconnected');
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    const racing = this.slotOf.has(player.id);
    if (racing) this.retirePlayer(player.id, reason === 'left' ? 'left' : 'disconnected');
    // Keep a departed racer's look until the lobby so results can still show their car.
    if (!racing || !this.sim) this.state.cars.delete(player.id);
  }

  private cleanPlate(raw: string, player: PlayerRecord): string {
    const plate = nameplateFrom(maskProfanity(cleanText(raw, NAMEPLATE_MAX * 2)));
    return plate === 'RACER' && !raw.trim() ? nameplateFrom(player.state.name) : plate;
  }

  private setCar(player: PlayerRecord, cfg: CarConfig): void {
    const look = this.state.cars.get(player.id) ?? new CarLook();
    look.chassis = cfg.chassis;
    look.primary = cfg.primary.toLowerCase();
    look.secondary = cfg.secondary.toLowerCase();
    look.decal = cfg.decal;
    look.wheels = cfg.wheels;
    look.number = cfg.number;
    look.nameplate = this.cleanPlate(cfg.nameplate, player);
    if (!this.state.cars.has(player.id)) this.state.cars.set(player.id, look);
  }

  private onInput(player: PlayerRecord, seq: number, inputs: number[]): void {
    const slot = this.slotOf.get(player.id);
    if (!this.sim || slot === undefined) return;
    this.stats.inputPackets++;
    this.stats.inputFrames += this.sim.pushInputs(slot, seq, inputs);
  }

  // ---------------------------------------------------------------------------
  // Race lifecycle
  // ---------------------------------------------------------------------------

  protected override validateStart(): string | null {
    if (this.seatedPlayers().filter((p) => !p.away).length > GRID_SLOTS) return `The grid holds ${GRID_SLOTS} cars.`;
    return null;
  }

  protected override onSettingsChanged(): void {
    if (this.phase === 'LOBBY') this.syncRacePreview();
  }

  private syncRacePreview(): void {
    const s = this.getSettings();
    this.state.race.trackId = s.track;
    this.state.race.laps = s.laps;
  }

  /** Build the grid as soon as the countdown begins (cars visible, locked). */
  private setupRace(): void {
    const settings = this.getSettings();
    const track = getTrack(settings.track);
    this.raceCounter = (this.raceCounter + 1) & 0xffff;
    const sim = new RaceSim(
      track,
      {
        laps: settings.laps,
        collisions: settings.collisions,
        boost: settings.boost,
        tickRate: CIRCUIT_SIM.tickRate,
        finishWindowMs: settings.finishWindowSec * 1000,
        maxRaceMs: settings.laps * 150_000 + 60_000,
      },
      this.raceCounter,
    );
    this.slotOf.clear();
    this.playerAt.clear();
    this.state.racers.clear();
    // Seated players who are connected or inside their reconnect grace (a blip as the countdown
    // starts must not cost a grid slot). Absent cars coast, turn into ghosts and never stall the race.
    const entrants = shuffleInPlace(
      this.seatedPlayers().filter((p) => !p.away),
      this.rng,
    ).slice(0, GRID_SLOTS);
    entrants.forEach((p, slot) => {
      const look = this.state.cars.get(p.id);
      sim.addCar(slot, p.id, (look?.chassis as CarConfig['chassis']) ?? 'volt');
      if (!p.client) sim.setConnected(slot, false);
      this.slotOf.set(p.id, slot);
      this.playerAt.set(slot, p.id);
      const racer = new Racer();
      racer.slot = slot;
      racer.name = p.state.name;
      racer.position = slot + 1;
      this.state.racers.set(p.id, racer);
    });
    const race = this.state.race;
    race.status = 'grid';
    race.trackId = settings.track;
    race.laps = settings.laps;
    race.goAt = this.state.phaseEndsAt || Date.now() + this.countdownMs;
    race.finishDeadline = 0;
    race.fastestLapMs = 0;
    race.fastestLapBy = '';
    race.entrants = entrants.length;
    race.solo = this.isSolo;
    race.raceId = this.raceCounter;
    this.snapEvery = entrants.length > 10 ? 3 : 2;
    this.sim = sim;
    this.syncMeta();
    this.broadcastSnapshot();
  }

  protected onGameStart(): void {
    if (!this.sim) this.setupRace();
    const sim = this.sim!;
    sim.go();
    this.state.race.status = 'racing';
    this.broadcast(CIRCUIT_MSG.event, { kind: 'go' } satisfies CircuitEvent);
    if (sim.cars.length === 0) this.finishRace();
  }

  private tick(): void {
    const phase = this.phase;
    if (!this.sim) {
      if (phase === 'COUNTDOWN') this.setupRace();
      return;
    }
    if (phase !== 'COUNTDOWN' && phase !== 'PLAYING') return;
    const sim = this.sim;
    const t0 = performance.now();
    const events = sim.step();
    this.handleEvents(events);
    if (sim.tick % this.snapEvery === 0) this.broadcastSnapshot();
    if (sim.tick % META_EVERY === 0) this.syncMeta();
    const took = performance.now() - t0;
    this.stats.ticks++;
    this.stats.stepMsTotal += took;
    this.stats.stepMsMax = Math.max(this.stats.stepMsMax, took);
  }

  private broadcastSnapshot(): void {
    if (!this.sim) return;
    const bytes = this.sim.encodeSnapshot();
    this.stats.snapshots++;
    this.stats.snapshotBytes += bytes.byteLength;
    this.broadcastBytes(CIRCUIT_MSG.snap, bytes, {});
  }

  private racerFor(slot: number): { id: string; racer: Racer } | null {
    const id = this.playerAt.get(slot);
    const racer = id ? this.state.racers.get(id) : undefined;
    return id && racer ? { id, racer } : null;
  }

  private handleEvents(events: SimEvent[]): void {
    const sim = this.sim;
    if (!sim) return;
    let standingsDirty = false;
    for (const ev of events) {
      if (ev.type === 'done') {
        this.finishRace();
        return;
      }
      if (ev.type === 'collision') continue;
      const who = this.racerFor(ev.slot);
      if (!who) continue;
      const { id, racer } = who;
      const car = sim.car(ev.slot)!;
      if (ev.type === 'finish') {
        racer.finishOrder = ev.place;
        standingsDirty = true;
        if (ev.place === 1) {
          this.state.race.finishDeadline = Date.now() + this.getSettings().finishWindowSec * 1000;
          const name = this.players.get(id)?.state.name ?? racer.name;
          if (!this.isSolo) this.systemChat(`${name} takes the chequered flag!`);
        }
        this.broadcast(CIRCUIT_MSG.event, { kind: 'finish', playerId: id, place: ev.place, timeMs: ev.timeMs } satisfies CircuitEvent);
        continue;
      }
      if (ev.type === 'dnf') {
        racer.dnf = true;
        standingsDirty = true;
        this.broadcast(CIRCUIT_MSG.event, { kind: 'dnf', playerId: id, reason: ev.reason } satisfies CircuitEvent);
        continue;
      }
      const p = ev.event;
      switch (p.type) {
        case 'lap-start':
          racer.lap = p.lap;
          racer.lapStartMs = Math.round(p.atMs);
          racer.gate = car.progress.nextGate;
          standingsDirty = true;
          if (p.lap === sim.opts.laps && sim.opts.laps > 1) this.sendTo(id, CIRCUIT_MSG.event, { kind: 'final-lap', playerId: id } satisfies CircuitEvent);
          break;
        case 'gate':
          racer.gate = car.progress.nextGate;
          this.sendTo(id, CIRCUIT_MSG.event, { kind: 'split', playerId: id, lap: p.lap, gate: p.gate, splitMs: p.splitMs } satisfies CircuitEvent);
          break;
        case 'gate-undo':
          racer.gate = car.progress.nextGate;
          break;
        case 'lap': {
          racer.lastLapMs = p.lapMs;
          racer.bestLapMs = car.progress.bestLapMs;
          const race = this.state.race;
          const fastest = race.fastestLapMs === 0 || p.lapMs < race.fastestLapMs;
          if (fastest) {
            race.fastestLapMs = p.lapMs;
            race.fastestLapBy = id;
          }
          this.broadcast(CIRCUIT_MSG.event, { kind: 'lap', playerId: id, lap: p.lap, lapMs: p.lapMs, best: p.best, fastest } satisfies CircuitEvent);
          break;
        }
        case 'lap-undo':
          racer.lap = car.progress.lap;
          racer.bestLapMs = car.progress.bestLapMs;
          racer.lastLapMs = car.progress.lapTimes.at(-1) ?? 0;
          racer.lapStartMs = Math.round(car.progress.lapStarts.at(-1) ?? 0);
          racer.gate = car.progress.nextGate;
          standingsDirty = true;
          break;
        case 'finish':
          racer.finished = true;
          racer.finishMs = p.timeMs;
          racer.lap = car.progress.lap;
          racer.wrongWay = false;
          break;
        case 'wrong-way':
          racer.wrongWay = p.on;
          break;
      }
    }
    if (standingsDirty) this.syncMeta();
  }

  /** Copy validated distance + positions into the schema. */
  private syncMeta(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.standings().forEach((car, i) => {
      const who = this.racerFor(car.slot);
      if (!who) return;
      const r = who.racer;
      r.position = i + 1;
      r.distance = Math.round(car.distance);
      r.gate = car.progress.nextGate;
      if (!car.progress.finished) r.lap = car.progress.lap;
    });
  }

  private retirePlayer(playerId: string, reason: 'left' | 'disconnected'): void {
    const slot = this.slotOf.get(playerId);
    const racer = this.state.racers.get(playerId);
    if (racer) racer.active = false;
    if (!this.sim || slot === undefined) return;
    if (this.phase !== 'COUNTDOWN' && this.phase !== 'PLAYING') return;
    const events = this.sim.retire(slot, reason);
    this.handleEvents(events);
  }

  /** The race is decided: freeze the standings now, show results after a short cool-down. */
  private finishRace(): void {
    const sim = this.sim;
    if (!sim || this.phase === 'RESULTS' || this.phase === 'LOBBY' || this.isScheduled('results')) return;
    this.state.race.status = 'done';
    this.syncMeta();
    this.broadcastSnapshot();
    this.schedule('results', this.resultsDelayMs, () => this.showResults());
  }

  private showResults(): void {
    const sim = this.sim;
    if (!sim || this.phase !== 'PLAYING') return;
    const standings = sim.standings();
    const entrants = standings.length;
    const players = standings.map((car, i) => {
      const record = this.players.get(car.id);
      const racer = this.state.racers.get(car.id);
      const finished = car.progress.finished;
      const score = finished ? entrants - i : 0;
      if (record) record.state.score = score;
      return {
        playerId: car.id,
        name: record?.state.name ?? racer?.name ?? 'Racer',
        guestId: record?.guestId,
        userId: record?.userId,
        score,
        placement: i + 1,
      };
    });
    const winner = standings.find((c) => c.progress.finished);
    this.reportRaceOutcome(standings);
    this.endMatch({
      players,
      details: {
        track: sim.track.def.id,
        laps: sim.opts.laps,
        winner: winner?.id ?? null,
        winnerMs: winner?.progress.finishMs ?? null,
        fastestLapMs: this.state.race.fastestLapMs || null,
      },
    });
  }

  /**
   * DASCADE stats: finishing order (identical race times share a place), then every car that did
   * not finish (retired, left, timed out) as one last group. `scores` are race times in ms for
   * finishers only (lower is better). A race nobody finished is no contest.
   */
  private reportRaceOutcome(standings: ReturnType<RaceSim['standings']>): void {
    const sim = this.sim!;
    const finishers = standings.filter((c) => c.progress.finished);
    if (finishers.length === 0) return;
    const dnf = standings.filter((c) => !c.progress.finished).map((c) => c.id);
    const placements = groupSorted(finishers, (c) => c.id, (a, b) => a.progress.finishMs === b.progress.finishMs);
    if (dnf.length > 0) placements.push(dnf);
    const scores: Record<string, number> = {};
    for (const c of finishers) scores[c.id] = c.progress.finishMs;
    const multi = standings.length >= 2;
    const playerStats: Record<string, Record<string, number>> = {};
    for (const c of standings) {
      playerStats[c.id] = {
        ...(c.progress.bestLapMs > 0 ? { minLapMs: c.progress.bestLapMs } : {}),
        ...(multi ? { fastestLaps: this.state.race.fastestLapBy === c.id ? 1 : 0 } : {}),
      };
    }
    this.reportOutcome({
      placements,
      scores,
      lowerIsBetter: true,
      reason: 'finished',
      details: { track: sim.track.def.id, laps: sim.opts.laps, playerStats },
    });
  }

  protected override onReturnToLobby(): void {
    this.sim = null;
    this.slotOf.clear();
    this.playerAt.clear();
    this.state.racers.clear();
    const race = this.state.race;
    race.status = 'idle';
    race.goAt = 0;
    race.finishDeadline = 0;
    race.fastestLapMs = 0;
    race.fastestLapBy = '';
    race.entrants = 0;
    this.syncRacePreview();
    for (const id of [...this.state.cars.keys()]) if (!this.players.has(id)) this.state.cars.delete(id);
  }

  protected override onRoomDisposed(): void {
    this.sim = null;
  }
}
