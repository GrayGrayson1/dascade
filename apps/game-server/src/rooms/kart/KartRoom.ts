/**
 * DASphalt GP — authoritative kart racing room.
 *
 * Flow: LOBBY (looks, host settings; solo rooms too) → COUNTDOWN (grid built, karts locked; inputs are
 * consumed and acknowledged, the sim times the start boost) → PLAYING (race; the finish window opens
 * when the first human crosses the line, and the race ends when every human is home or it closes —
 * computer racers never start it) → RESULTS (single race / time trial / end of a cup).
 * A Grand Prix runs its four races inside one platform match: between races the room sits in
 * INTERMISSION (race result + standings; the host's `kart:next` or an automatic advance starts the
 * next race), so the roster, disconnect handling and the single outcome report span the whole cup.
 *
 * The room runs a fixed 60 Hz `KartSim` (game-core) with the server's crypto RNG. Clients only send
 * sequenced inputs; the server owns positions, laps, item rolls, hits, finish order and race time.
 * Kart motion is broadcast as a binary snapshot every few ticks; low-rate meta lives in the schema.
 */
import {
  DEFAULT_KART_SETTINGS,
  KART_BODY_IDS,
  KART_CUPS,
  KART_GP_POINTS,
  KART_INPUT_RATE,
  KART_MSG,
  KART_RACERS,
  KART_RACER_IDS,
  KART_SIM,
  KART_TRACK_IDS,
  KartInputSchema,
  KartLookSchema,
  KartPauseSchema,
  KartSettingsSchema,
  defaultKartLook,
  packKartInput,
  type KartBodyId,
  type KartEvent,
  type KartLook as KartLookValue,
  type KartMode,
  type KartRacerId,
  type KartSettings,
  type KartTrackId,
} from '@dascade/shared/games/kart';
import { EmptySchema, shuffleInPlace } from '@dascade/shared';
import { z } from 'zod';
import { KART_SIM_LIMITS, KartBot, KartSim, getKartTrack, type KartSimEvent, type SimKart } from '@dascade/game-core/kart';
import { config } from '../../config.ts';
import { log } from '../../lib/log.ts';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted } from '../outcomePlacements.ts';
import { TickStats, ensureLoopMonitor, processDiagnostics } from './diagnostics.ts';
import { placeKartBeforeFinish } from './testPlacement.ts';
import { KartGpEntry, KartLook, KartRacer, KartState } from './KartState.ts';

/** How often (ticks) positions/laps are copied into the schema (5 Hz)… */
const META_EVERY = 12;
/** …and the validated distance (2 Hz: it changes for every moving kart, so it dominates schema patches). */
const DISTANCE_EVERY = 30;
/** Snapshot cadence (ticks): 3 = 20 Hz at every grid size (measured affordable at 30 karts, see LOAD.md). */
const SNAP_EVERY = 3;
/** Grand Prix: time between races before the next one starts on its own. */
const GP_INTERMISSION_MS = 15_000;
/** Solo pause: play on at least this long after resuming before pausing again (no freeze-frame driving). */
const PAUSE_COOLDOWN_MS = 1_000;
/** Test hooks (`kart:test`) and diagnostics (`kart:diag`): relaxed limits on a non-production server only. */
const TEST_HOOKS = config.relaxedLimits && !config.isProduction;

const DiagSchema = z.object({ reset: z.boolean().optional() });
const TestHookSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('autopilot'), on: z.boolean() }),
  z.object({ action: z.literal('finish') }),
]);

let warming = false;
/**
 * Build every track once per process, one per timer turn, so no countdown ever pays for a build.
 * Process timers (unref'd), not a room clock: a room's clock is cleared when it is disposed, which
 * used to drop the remaining builds for good if the first kart room closed within ~330 ms.
 * `getKartTrack` caches each build process-wide.
 */
function warmTracks(): void {
  if (warming) return;
  warming = true;
  const warmNext = (i: number) => {
    const id = KART_TRACK_IDS[i];
    if (!id) return;
    const timer = setTimeout(
      () => {
        try {
          getKartTrack(id);
        } catch (err) {
          log.error('kart track pre-build failed', { track: id, err: err as Error });
        }
        warmNext(i + 1);
      },
      i === 0 ? 50 : 40,
    );
    timer.unref?.();
  };
  warmNext(0);
}

interface Entrant {
  id: string;
  name: string;
  bot: boolean;
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
}

export class KartRoom extends BaseGameRoom<KartState, KartSettings> {
  readonly gameId = 'kart' as const;
  protected readonly settingsSchema = KartSettingsSchema;
  override countdownMs = KART_SIM.countdownMs;
  /** Settings may change in the lobby and on the results screen (before a rematch); never mid-cup. */
  protected override settingsEditablePhases = ['LOBBY', 'RESULTS'] as const;
  /** Cool-down after the race is decided (finish celebration) before results / intermission. */
  protected resultsDelayMs = 3_500;
  protected intermissionMs = GP_INTERMISSION_MS;

  /** The live race (kept through INTERMISSION/RESULTS so the scene can keep showing the final grid). */
  protected sim: KartSim | null = null;
  private readonly slotOf = new Map<string, number>();
  private readonly idAt = new Map<number, string>();
  private raceCounter = 0;
  private snapEvery = 3;
  /** Grand Prix bookkeeping (round 0 = not in a cup). */
  private gpRound = 0;
  private gpTracks: readonly KartTrackId[] = [];
  private gpBots: Entrant[] = [];
  /** Per racer id, over the whole match: best lap, fastest laps, item hits landed. */
  private readonly matchStats = new Map<string, { bestLapMs: number; fastestLaps: number; itemHits: number }>();
  /** Settings frozen when the match starts (a cup never changes mid-way). */
  private matchSettings: KartSettings = structuredClone(DEFAULT_KART_SETTINGS);
  /** Test hook: human karts driven by the bot AI (slot → driver). */
  private readonly autopilots = new Map<number, KartBot>();
  /** Diagnostics (read by tests and, on relaxed-limit servers, the load script via `kart:diag`). */
  readonly stats = new TickStats();
  /** Solo pause: when it began (server epoch ms; 0 = running) and when play last resumed. */
  private pausedAt = 0;
  private resumedAt = 0;

  protected defaultSettings(): KartSettings {
    return structuredClone(DEFAULT_KART_SETTINGS);
  }

  protected createState(): KartState {
    return new KartState();
  }

  protected override onRoomCreated(): void {
    if (TEST_HOOKS) ensureLoopMonitor();
    warmTracks();
    this.normalizeSettings();
    this.syncRacePreview();
    this.state.race.solo = this.isSolo;

    // A racer (and their kart) is chosen for the whole Grand Prix: not between rounds.
    this.handle(KART_MSG.look, KartLookSchema, (p, look) => this.setLook(p, look), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 8, perSecond: 3 },
    });

    this.handle(KART_MSG.input, KartInputSchema, (p, packet) => this.onInput(p, packet.seq, packet.inputs), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: KART_INPUT_RATE,
      // Schema maximum: the object, seq, the array and its frames (3 + maxInputsPerPacket).
      maxNodes: KART_SIM.maxInputsPerPacket + 8,
    });

    this.handle(KART_MSG.next, EmptySchema, () => this.onNext(), {
      phases: ['RESULTS', 'INTERMISSION'],
      hostOnly: true,
      rate: { burst: 2, perSecond: 0.5 },
    });

    this.handle(KART_MSG.pause, KartPauseSchema, (p, { paused }) => this.onPause(p, paused), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      rate: { burst: 4, perSecond: 1 },
      maxNodes: 4,
    });

    if (TEST_HOOKS) {
      // Read-only room + process diagnostics for the load simulation (players only; never in production).
      this.handle(
        'kart:diag',
        DiagSchema,
        (p, { reset }) => {
          this.sendTo(p, 'kart:diag', {
            room: this.stats.view(),
            process: processDiagnostics(reset),
            karts: this.sim?.karts.length ?? 0,
            snapEvery: this.snapEvery,
          });
          if (reset) this.stats.reset();
        },
        { rate: { burst: 5, perSecond: 2 }, playersOnly: true, silent: true, maxNodes: 4 },
      );
      this.handle('kart:test', TestHookSchema, (p, cmd) => this.testHook(p, cmd), {
        phases: ['COUNTDOWN', 'PLAYING'],
        playersOnly: true,
        rate: { burst: 5, perSecond: 2 },
      });
    }

    this.setFixedTimestep(() => this.tick(), KART_SIM.tickRate);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  /** Time trial is solo only; a tournament match (not offered today) would always be a plain race. */
  private normalizeSettings(): void {
    const s = this.getSettings();
    if (s.mode === 'timetrial' && (!this.isSolo || this.tournamentMatch)) this.updateSettings({ ...s, mode: 'race' });
    else if (this.tournamentMatch && s.mode !== 'race') this.updateSettings({ ...s, mode: 'race' });
  }

  protected override onSettingsChanged(prev: KartSettings, next: KartSettings): void {
    if (!this.isSolo && next.mode === 'timetrial') {
      const host = this.hostRecord;
      if (host) this.toast(host, 'info', 'Time trial is a solo mode — start a solo game from the title screen.');
      this.updateSettings({ ...next, mode: prev.mode === 'timetrial' ? 'race' : prev.mode });
      return;
    }
    if (this.phase === 'LOBBY') this.syncRacePreview();
  }

  /** Effective rules for a race (forced toggles for time trial / tournament matches). */
  private rules(s: KartSettings): { mode: KartMode; items: boolean; bots: number } {
    let mode: KartMode = s.mode;
    if (this.tournamentMatch || (mode === 'timetrial' && !this.isSolo)) mode = 'race';
    const noBots = mode === 'timetrial' || this.tournamentMatch !== null;
    return {
      mode,
      items: mode === 'timetrial' ? false : s.items,
      bots: noBots ? 0 : Math.min(s.bots, KART_SIM.maxBots),
    };
  }

  private syncRacePreview(): void {
    const s = this.getSettings();
    const r = this.rules(s);
    const race = this.state.race;
    race.mode = r.mode;
    race.cup = s.cup;
    race.trackId = r.mode === 'gp' ? KART_CUPS[s.cup].tracks[0]! : s.track;
    race.laps = s.laps;
    race.items = r.items;
    race.round = 0;
    race.rounds = r.mode === 'gp' ? KART_CUPS[s.cup].tracks.length : 0;
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  protected override onPlayerJoined(player: PlayerRecord): void {
    const look = new KartLook();
    const def = defaultKartLook(player.state.joinOrder);
    look.racer = def.racer;
    look.body = def.body;
    look.paint = def.paint;
    this.state.looks.set(player.id, look);
    // Solo rooms open in the lobby too: the player picks a racer and (as host) the mode, track or
    // cup, laps and bots, then starts. The defaults are a race against 5 normal bots.
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const slot = this.slotOf.get(player.id);
    if (slot !== undefined && this.racing) this.sim?.setConnected(slot, false);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    const slot = this.slotOf.get(player.id);
    if (slot !== undefined && this.racing) this.sim?.setConnected(slot, true);
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    this.retirePlayer(player.id, 'disconnected');
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    const racing = this.slotOf.has(player.id);
    if (racing) this.retirePlayer(player.id, reason === 'left' ? 'left' : 'disconnected');
    // Keep a departed racer's look until the lobby so results can still show their kart.
    if (!racing || !this.sim) this.state.looks.delete(player.id);
  }

  private setLook(player: PlayerRecord, look: KartLookValue): void {
    const row = this.state.looks.get(player.id) ?? new KartLook();
    row.racer = look.racer;
    row.body = look.body;
    row.paint = look.paint.toLowerCase();
    if (!this.state.looks.has(player.id)) this.state.looks.set(player.id, row);
  }

  private onInput(player: PlayerRecord, seq: number, inputs: number[]): void {
    const slot = this.slotOf.get(player.id);
    if (!this.sim || slot === undefined || this.state.race.paused) {
      this.stats.inputPacketsIgnored++;
      return;
    }
    this.stats.inputPackets++;
    const kart = this.sim.kart(slot);
    if (kart && seq + inputs.length - 1 <= kart.lastSeq - KART_SIM_LIMITS.maxSeqJump) {
      // The client restarted its frame numbering (a fresh predictor for a new race, or a reload)
      // while this race had already anchored on its old, higher numbers. Websocket frames arrive in
      // order, so a packet this far behind is never a late duplicate: re-anchor instead of
      // ignoring the kart for the rest of the race. It buys nothing: every frame still costs credit.
      kart.queue.length = 0;
      kart.lastSeq = seq - 1;
      this.stats.seqRestarts++;
    }
    const accepted = this.sim.pushInputs(slot, seq, inputs);
    this.stats.inputFrames += accepted;
    this.stats.inputFramesDropped += inputs.length - accepted;
  }

  private get racing(): boolean {
    return this.phase === 'COUNTDOWN' || this.phase === 'PLAYING';
  }

  // ---------------------------------------------------------------------------
  // Match / cup lifecycle
  // ---------------------------------------------------------------------------

  protected override validateStart(): string | null {
    if (this.seatedPlayers().filter((p) => !p.away).length > KART_SIM.gridSlots) return `The grid holds ${KART_SIM.gridSlots} karts.`;
    return null;
  }

  /** A new match starts (the base's countdown): freeze the settings and set up the cup. */
  protected override onCountdownStart(): void {
    this.matchSettings = structuredClone(this.getSettings());
    this.matchStats.clear();
    this.state.gp.clear();
    const r = this.rules(this.matchSettings);
    if (r.mode === 'gp') {
      this.gpTracks = KART_CUPS[this.matchSettings.cup].tracks;
      this.gpRound = 1;
      this.gpBots = this.makeBots(r.bots, this.humanEntrants());
    } else {
      this.gpTracks = [];
      this.gpRound = 0;
      this.gpBots = [];
    }
    this.setupRace();
  }

  protected onGameStart(): void {
    if (!this.sim) this.setupRace();
    this.goRace();
  }

  private goRace(): void {
    const sim = this.sim;
    if (!sim) return;
    // The room's clock and the sim's scheduled GO agree to within a tick; whichever comes first wins.
    if (sim.status === 'grid') sim.go();
    this.state.race.status = 'racing';
    this.broadcast(KART_MSG.event, { kind: 'go' } satisfies KartEvent);
    // Already decided: an empty grid, or the sim's GO came a tick before the room's and the race was
    // settled in that window (e.g. the last racer retired) while finishRace() still waited for PLAYING.
    if (sim.karts.length === 0 || sim.status === 'done') this.finishRace();
    else this.endIfNoHumanRacing(sim);
  }

  /** Host: the next Grand Prix race now (INTERMISSION), or a rematch with the same settings (RESULTS). */
  private onNext(): void {
    if (this.phase === 'INTERMISSION') {
      this.nextGpRace();
    } else if (this.phase === 'RESULTS') {
      this.returnToLobby();
      this.startMatch();
    }
  }

  private nextGpRace(): void {
    if (this.phase !== 'INTERMISSION' || this.gpRound === 0 || this.gpRound >= this.gpTracks.length) return;
    this.cancel('gp-next');
    // Spectators who arrived mid-cup take a seat for the next race (earlier rounds score 0).
    this.promoteQueued();
    this.gpRound++;
    this.setPhase('COUNTDOWN', this.countdownMs);
    this.setupRace();
    if (this.state.phase !== 'COUNTDOWN') return; // the cup ended early (nobody left to race)
    this.schedule('gp-go', this.countdownMs, () => {
      if (this.phase !== 'COUNTDOWN') return;
      this.setPhase('PLAYING');
      this.goRace();
    });
  }

  /** Seated humans who can take a grid slot: connected, or inside their reconnect grace. */
  private humanEntrants(): Entrant[] {
    return this.seatedPlayers()
      .filter((p) => !p.away)
      .slice(0, KART_SIM.gridSlots)
      .map((p) => {
        const look = this.state.looks.get(p.id);
        const fallback = defaultKartLook(p.state.joinOrder);
        return {
          id: p.id,
          name: p.state.name,
          bot: false,
          racer: (look?.racer as KartRacerId | undefined) ?? fallback.racer,
          body: (look?.body as KartBodyId | undefined) ?? fallback.body,
          paint: look?.paint ?? fallback.paint,
        };
      });
  }

  /** Computer racers: racers nobody picked first (shuffled), then repeats with numbered names. */
  private makeBots(count: number, humans: readonly Entrant[]): Entrant[] {
    const n = Math.max(0, Math.min(count, KART_SIM.maxBots, KART_SIM.gridSlots - humans.length));
    const taken = new Set(humans.map((h) => h.racer));
    const free = shuffleInPlace(
      KART_RACER_IDS.filter((r) => !taken.has(r)),
      this.rng,
    );
    const rest = shuffleInPlace([...KART_RACER_IDS], this.rng);
    const order = [...free, ...rest];
    const used = new Map<string, number>();
    const bots: Entrant[] = [];
    for (let i = 0; i < n; i++) {
      const racer = order[i % order.length]!;
      const info = KART_RACERS[racer];
      const k = (used.get(racer) ?? 0) + 1;
      used.set(racer, k);
      bots.push({
        id: `bot:${i + 1}`,
        name: k === 1 ? info.name : `${info.name} ${k}`,
        bot: true,
        racer,
        body: KART_BODY_IDS[this.rng.int(KART_BODY_IDS.length)] ?? 'buggy',
        paint: info.colors.main,
      });
    }
    return bots;
  }

  /** Build the grid for the current race (at the start of its countdown: karts visible, locked). */
  private setupRace(): void {
    const settings = this.matchSettings;
    const r = this.rules(settings);
    const gp = r.mode === 'gp' && this.gpRound > 0;
    const trackId: KartTrackId = gp ? this.gpTracks[this.gpRound - 1]! : settings.track;
    const humans = this.humanEntrants();
    if (gp && this.gpRound > 1 && humans.length === 0) {
      // Everyone seated is away: close the cup with the standings so far instead of racing bots alone.
      this.gpRound--;
      this.endCup();
      return;
    }
    const botPool = gp ? this.gpBots : this.makeBots(r.bots, humans);
    const bots = botPool.slice(0, Math.max(0, KART_SIM.gridSlots - humans.length));
    let field: Entrant[] = shuffleInPlace([...humans, ...bots], this.rng);
    if (gp && this.gpRound > 1) {
      // Reverse Grand Prix order: the points leader starts at the back (stable sort keeps ties shuffled).
      const pts = (id: string) => this.state.gp.get(id)?.points ?? 0;
      field = field.sort((a, b) => pts(a.id) - pts(b.id));
    }

    this.raceCounter = (this.raceCounter + 1) & 0xffff;
    const maxRaceMs = settings.laps * 120_000 + 60_000;
    const sim = new KartSim(
      getKartTrack(trackId),
      {
        laps: settings.laps,
        items: r.items,
        // The room runs the finish window (see openFinishWindow): the sim's own one, which any
        // finisher starts (bots included), can then never close before its max race time.
        finishWindowMs: maxRaceMs,
        maxRaceMs,
        startItem: r.mode === 'timetrial' ? 'turbo3' : null,
      },
      this.rng,
      this.raceCounter,
    );
    this.slotOf.clear();
    this.idAt.clear();
    this.autopilots.clear();
    this.state.racers.clear();
    field.forEach((e, slot) => {
      sim.addRacer(slot, e.id, e.racer, e.bot ? settings.botSkill : undefined);
      if (!e.bot && !this.players.get(e.id)?.client) sim.setConnected(slot, false);
      this.slotOf.set(e.id, slot);
      this.idAt.set(slot, e.id);
      const racer = new KartRacer();
      racer.slot = slot;
      racer.name = e.name;
      racer.bot = e.bot;
      racer.racer = e.racer;
      racer.body = e.body;
      racer.paint = e.paint;
      racer.position = slot + 1;
      this.state.racers.set(e.id, racer);
      if (gp) this.ensureGpRow(e);
    });

    const race = this.state.race;
    race.status = 'grid';
    race.mode = r.mode;
    race.cup = settings.cup;
    race.trackId = trackId;
    race.round = gp ? this.gpRound : 0;
    race.rounds = gp ? this.gpTracks.length : 0;
    race.laps = settings.laps;
    race.items = r.items;
    race.goAt = this.state.phaseEndsAt || Date.now() + this.countdownMs;
    race.finishDeadline = 0;
    race.fastestLapMs = 0;
    race.fastestLapBy = '';
    race.entrants = field.length;
    race.solo = this.isSolo;
    race.raceId = this.raceCounter;
    this.snapEvery = SNAP_EVERY;
    // The sim times the lights itself (bots and the start boost key off its goTick).
    sim.startCountdown(Math.max(1, Math.round((Math.max(0, race.goAt - Date.now()) / 1000) * KART_SIM.tickRate)));
    this.sim = sim;
    this.syncMeta();
    // Ordering guarantee for clients: the state patch with this race's raceId, track and racers
    // lands before the first snapshot / own state of the race.
    this.broadcastPatch();
    this.broadcastSnapshot();
  }

  private ensureGpRow(e: Entrant): void {
    let row = this.state.gp.get(e.id);
    if (!row) {
      row = new KartGpEntry();
      row.name = e.name;
      row.bot = e.bot;
      // Rounds run before this racer arrived score nothing.
      for (let i = 1; i < this.gpRound; i++) row.places.push(0);
      this.state.gp.set(e.id, row);
    }
    row.racer = e.racer;
    row.paint = e.paint;
  }

  // ---------------------------------------------------------------------------
  // Simulation loop
  // ---------------------------------------------------------------------------

  private tick(): void {
    const sim = this.sim;
    if (!sim || !this.racing || this.state.race.paused) return;
    const t0 = performance.now();
    this.driveAutopilots(sim);
    const events = sim.step();
    if (sim.status === 'racing' && this.state.race.status === 'grid') this.state.race.status = 'racing';
    this.handleEvents(events);
    if (this.sim === sim && this.racing) {
      if (sim.tick % this.snapEvery === 0) this.broadcastSnapshot();
      if (sim.tick % META_EVERY === 0) this.syncMeta(sim.tick % DISTANCE_EVERY === 0);
    }
    this.stats.recordStep(performance.now() - t0);
  }

  /**
   * Display snapshot to everyone (spectators included) + each racer's exact own state and ack
   * (for their predictor) on the same tick. Bots and absent players get no own message.
   */
  private broadcastSnapshot(): void {
    const sim = this.sim;
    if (!sim) return;
    const bytes = sim.encodeSnapshot();
    this.stats.recordSnapshot(bytes.byteLength);
    this.broadcastBytes(KART_MSG.snap, bytes, {});
    for (const [slot, id] of this.idAt) {
      const client = this.players.get(id)?.client;
      if (!client) continue;
      const own = sim.encodeOwn(slot);
      if (!own) continue;
      this.stats.ownBytes += own.byteLength;
      this.stats.owns++;
      client.sendBytes(KART_MSG.own, own);
    }
  }

  private racerFor(slot: number): { id: string; racer: KartRacer } | null {
    const id = this.idAt.get(slot);
    const racer = id ? this.state.racers.get(id) : undefined;
    return id && racer ? { id, racer } : null;
  }

  private statsFor(id: string): { bestLapMs: number; fastestLaps: number; itemHits: number } {
    let s = this.matchStats.get(id);
    if (!s) {
      s = { bestLapMs: 0, fastestLaps: 0, itemHits: 0 };
      this.matchStats.set(id, s);
    }
    return s;
  }

  private handleEvents(events: readonly KartSimEvent[]): void {
    const sim = this.sim;
    if (!sim) return;
    let standingsDirty = false;
    for (const ev of events) {
      switch (ev.type) {
        case 'done':
          if (standingsDirty) this.syncMeta();
          this.finishRace();
          return;
        case 'lap-start': {
          const who = this.racerFor(ev.slot);
          if (!who) break;
          who.racer.lap = ev.lap;
          who.racer.lapStartMs = Math.round(ev.atMs);
          standingsDirty = true;
          break;
        }
        case 'final-lap': {
          const id = this.idAt.get(ev.slot);
          if (id && !id.startsWith('bot:')) this.sendTo(id, KART_MSG.event, { kind: 'final-lap', playerId: id } satisfies KartEvent);
          break;
        }
        case 'lap': {
          const who = this.racerFor(ev.slot);
          if (!who) break;
          who.racer.lastLapMs = ev.lapMs;
          who.racer.bestLapMs = sim.kart(ev.slot)?.progress.bestLapMs ?? ev.lapMs;
          const st = this.statsFor(who.id);
          if (st.bestLapMs === 0 || ev.lapMs < st.bestLapMs) st.bestLapMs = ev.lapMs;
          const race = this.state.race;
          const fastest = race.fastestLapMs === 0 || ev.lapMs < race.fastestLapMs;
          if (fastest) {
            race.fastestLapMs = ev.lapMs;
            race.fastestLapBy = who.id;
          }
          this.broadcast(KART_MSG.event, {
            kind: 'lap',
            playerId: who.id,
            lap: ev.lap,
            lapMs: ev.lapMs,
            best: ev.best,
            fastest,
          } satisfies KartEvent);
          break;
        }
        case 'finish': {
          const who = this.racerFor(ev.slot);
          if (!who) break;
          const r = who.racer;
          r.finished = true;
          r.finishMs = ev.timeMs;
          r.finishOrder = ev.place;
          r.lap = this.matchSettings.laps + 1;
          standingsDirty = true;
          if (ev.place === 1 && !this.isSolo) this.systemChat(`${r.name} takes the chequered flag!`);
          if (!r.bot) this.openFinishWindow(sim);
          this.broadcast(KART_MSG.event, { kind: 'finish', playerId: who.id, place: ev.place, timeMs: ev.timeMs } satisfies KartEvent);
          break;
        }
        case 'dnf': {
          const who = this.racerFor(ev.slot);
          if (!who) break;
          who.racer.dnf = true;
          standingsDirty = true;
          this.broadcast(KART_MSG.event, { kind: 'dnf', playerId: who.id, reason: ev.reason } satisfies KartEvent);
          break;
        }
        case 'hit': {
          const victim = this.idAt.get(ev.victim);
          if (!victim) break;
          const by = ev.by === null ? null : (this.idAt.get(ev.by) ?? null);
          if (by && by !== victim && !ev.blocked) this.statsFor(by).itemHits++;
          this.broadcast(KART_MSG.event, { kind: 'hit', victim, by, cause: ev.cause, blocked: ev.blocked } satisfies KartEvent);
          break;
        }
        case 'item': {
          const id = this.idAt.get(ev.slot);
          if (!id || id.startsWith('bot:')) break;
          this.sendTo(id, KART_MSG.event, { kind: 'item', playerId: id, item: ev.item } satisfies KartEvent);
          break;
        }
        default:
          break;
      }
    }
    if (standingsDirty) this.syncMeta();
    this.endIfNoHumanRacing(sim);
  }

  /**
   * The first human across the line opens the finish window (computer racers never do): the race
   * ends when it closes, or sooner once every human is home. The window is the sim's time limit
   * pulled in to `now + finishWindowSec`; the max race time still caps everything.
   */
  private openFinishWindow(sim: KartSim): void {
    const race = this.state.race;
    if (race.finishDeadline > 0 || sim.status !== 'racing') return;
    const windowMs = this.matchSettings.finishWindowSec * 1000;
    race.finishDeadline = Date.now() + windowMs;
    sim.opts.maxRaceMs = Math.min(sim.opts.maxRaceMs, sim.raceMs + windowMs);
  }

  /**
   * Every human racer is home (finished, retired or out): end the race on the sim's next step.
   * Computer racers still out there are classified by distance (the sim marks them DNF and keeps
   * their standing), so nobody waits for bots once the people are done.
   */
  private endIfNoHumanRacing(sim: KartSim): void {
    if (sim.status !== 'racing') return;
    const humanRacing = sim.karts.some((k) => k.bot === null && !k.retired && !k.dnf && !k.progress.finished);
    if (!humanRacing) sim.opts.maxRaceMs = Math.min(sim.opts.maxRaceMs, sim.raceMs);
  }

  /** Copy positions + laps (and, unless skipped, the validated distance) into the schema. */
  private syncMeta(distance = true): void {
    const sim = this.sim;
    if (!sim) return;
    sim.standings().forEach((kart, i) => {
      const who = this.racerFor(kart.slot);
      if (!who) return;
      const r = who.racer;
      r.position = i + 1;
      if (distance) r.distance = Math.round(kart.distance);
      if (!kart.progress.finished) r.lap = kart.progress.lap;
    });
  }

  private retirePlayer(playerId: string, reason: 'left' | 'disconnected'): void {
    const slot = this.slotOf.get(playerId);
    const racer = this.state.racers.get(playerId);
    if (racer) racer.active = false;
    if (!this.sim || slot === undefined || !this.racing) return;
    // A paused solo racer who is gone for good (left, or their reconnect grace ran out): the race
    // runs on so it can be decided and the room can close.
    this.applyPause(false);
    this.handleEvents(this.sim.retire(slot, reason));
  }

  // ---------------------------------------------------------------------------
  // Solo pause
  // ---------------------------------------------------------------------------

  /**
   * `kart:pause` (solo rooms, the player, COUNTDOWN/PLAYING until the race is decided). While paused
   * the sim does not step, no snapshots are sent, inputs are dropped, and every race clock stands
   * still: the countdown (room timer + the sim's GO tick), the finish window and the max race time
   * (sim time), the results delay (room timers). A disconnect keeps the pause (the player resumes
   * after reconnecting); a racer gone for good lifts it (see retirePlayer).
   */
  private onPause(player: PlayerRecord, paused: boolean): void {
    if (!this.isSolo) return this.reject(player, KART_MSG.pause, 'not_allowed', 'Only solo races can be paused.');
    if (this.state.race.paused === paused) return;
    if (paused) {
      const sim = this.sim;
      if (!sim || sim.status === 'done' || this.isScheduled('results')) {
        return this.reject(player, KART_MSG.pause, 'not_allowed', 'The race is over.');
      }
      if (Date.now() < this.resumedAt + PAUSE_COOLDOWN_MS) {
        return this.reject(player, KART_MSG.pause, 'rate_limited', 'Play on for a moment before pausing again.');
      }
    }
    this.applyPause(paused);
  }

  private applyPause(paused: boolean): void {
    const race = this.state.race;
    if (race.paused === paused) return;
    const now = Date.now();
    if (paused) {
      this.pausedAt = now;
    } else {
      // Wall-clock values move on by the pause (the sim's own clocks never ran), so
      // `serverNow - goAt` stays the race time and the countdown/finish window resume where they were.
      const held = Math.max(0, now - this.pausedAt);
      if (race.goAt > 0) race.goAt += held;
      if (race.finishDeadline > 0) race.finishDeadline += held;
      if (this.state.phaseEndsAt > 0) this.state.phaseEndsAt += held;
      this.pausedAt = 0;
      this.resumedAt = now;
    }
    race.paused = paused;
    this.freezeTimers(paused);
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  /** The race is decided: freeze the standings now, show results after a short cool-down. */
  private finishRace(): void {
    if (!this.sim || this.phase !== 'PLAYING' || this.isScheduled('results')) return;
    this.state.race.status = 'done';
    this.syncMeta();
    this.broadcastSnapshot();
    this.schedule('results', this.resultsDelayMs, () => this.raceOver());
  }

  private raceOver(): void {
    const sim = this.sim;
    if (!sim || this.phase !== 'PLAYING') return;
    const standings = sim.standings();
    for (const kart of standings) {
      const id = this.idAt.get(kart.slot);
      if (id) this.statsFor(id); // everyone who raced gets a stats row
    }
    const fastestBy = this.state.race.fastestLapBy;
    if (fastestBy && standings.length >= 2) this.statsFor(fastestBy).fastestLaps++;

    if (this.gpRound > 0) {
      this.scoreGpRace(standings);
      if (this.gpRound < this.gpTracks.length) {
        this.setPhase('INTERMISSION', this.intermissionMs);
        this.schedule('gp-next', this.intermissionMs, () => this.nextGpRace());
        return;
      }
      this.endCup();
      return;
    }
    this.endSingleRace(standings);
  }

  /** Grand Prix points for one race: every kart still in the race at the end scores by position. */
  private scoreGpRace(standings: readonly SimKart[]): void {
    const raced = new Set<string>();
    standings.forEach((kart, i) => {
      const id = this.idAt.get(kart.slot);
      if (!id) return;
      raced.add(id);
      const row = this.state.gp.get(id);
      if (!row) return;
      const place = kart.retired && !kart.progress.finished ? 0 : i + 1;
      row.places.push(place);
      row.points += place > 0 ? (KART_GP_POINTS[place - 1] ?? 0) : 0;
    });
    // Rows that sat this race out (away, or a bot bumped off a full grid) record a 0.
    for (const [id, row] of this.state.gp) if (!raced.has(id)) row.places.push(0);
    for (const [id, row] of this.state.gp) {
      const record = this.players.get(id);
      if (record) record.state.score = row.points;
    }
  }

  /** Grand Prix standings, best first: points, then the better place in the most recent race. */
  private gpOrder(): Array<{ id: string; row: KartGpEntry }> {
    const lastPlace = (row: KartGpEntry) => {
      const p = row.places.at(-1) ?? 0;
      return p > 0 ? p : 999;
    };
    return [...this.state.gp.entries()]
      .map(([id, row]) => ({ id, row }))
      .sort((a, b) => b.row.points - a.row.points || lastPlace(a.row) - lastPlace(b.row));
  }

  private endCup(): void {
    const order = this.gpOrder();
    const bots = order.filter((e) => e.row.bot).map((e) => e.id);
    const present = order.filter((e) => e.row.bot || this.players.has(e.id));
    const placements = groupSorted(
      present,
      (e) => e.id,
      (a, b) => a.row.points === b.row.points,
    );
    // Players who left the cup keep their row on the board but are placed last in the outcome.
    const leavers = order.filter((e) => !e.row.bot && !this.players.has(e.id)).map((e) => e.id);
    if (leavers.length) placements.push(leavers);
    if (order.some((e) => e.row.points > 0)) {
      this.reportOutcome({
        placements,
        ...(bots.length ? { nonPlayerIds: bots } : {}),
        reason: 'cup_finished',
        details: {
          mode: 'gp',
          cup: this.matchSettings.cup,
          laps: this.matchSettings.laps,
          rounds: this.gpRound,
          points: Object.fromEntries(order.filter((e) => !e.row.bot).map((e) => [e.id, e.row.points])),
          playerStats: this.playerStats(
            order.map((e) => e.id),
            true,
          ),
        },
      });
    }
    this.endMatch({
      players: order
        .filter((e) => !e.row.bot)
        .map((e) => {
          const record = this.players.get(e.id);
          const placement = order.findIndex((o) => o.row.points === e.row.points) + 1;
          return {
            playerId: e.id,
            name: record?.state.name ?? e.row.name,
            guestId: record?.guestId,
            userId: record?.userId,
            score: e.row.points,
            placement,
          };
        }),
      details: { mode: 'gp', cup: this.matchSettings.cup, winner: order[0]?.id ?? null, rounds: this.gpRound },
    });
  }

  private endSingleRace(standings: readonly SimKart[]): void {
    const entrants = standings.length;
    const idOf = (k: SimKart) => this.idAt.get(k.slot) ?? k.id;
    const players = standings
      .map((kart, i) => ({ kart, id: idOf(kart), place: i + 1 }))
      .filter((e) => !e.id.startsWith('bot:'))
      .map(({ kart, id, place }) => {
        const record = this.players.get(id);
        const score = kart.progress.finished ? entrants - place + 1 : 0;
        if (record) record.state.score = score;
        return {
          playerId: id,
          name: record?.state.name ?? this.state.racers.get(id)?.name ?? 'Racer',
          guestId: record?.guestId,
          userId: record?.userId,
          score,
          placement: place,
        };
      });
    const winner = standings.find((k) => k.progress.finished);
    this.reportRaceOutcome(standings);
    this.endMatch({
      players,
      details: {
        mode: this.state.race.mode,
        track: this.state.race.trackId,
        laps: this.matchSettings.laps,
        winner: winner ? idOf(winner) : null,
        winnerMs: winner?.progress.finishMs ?? null,
        fastestLapMs: this.state.race.fastestLapMs || null,
      },
    });
  }

  /**
   * DASCADE stats for one race: finishing order (identical times share a place; bots are placed
   * as non-players), then every kart that did not finish as one last group. `scores` are race times
   * in ms for finishers (lower is better). A race nobody finished is no contest.
   */
  private reportRaceOutcome(standings: readonly SimKart[]): void {
    const idOf = (k: SimKart) => this.idAt.get(k.slot) ?? k.id;
    const finishers = standings.filter((k) => k.progress.finished);
    if (finishers.length === 0) return;
    const dnf = standings.filter((k) => !k.progress.finished).map(idOf);
    const placements = groupSorted(finishers, idOf, (a, b) => a.progress.finishMs === b.progress.finishMs);
    if (dnf.length > 0) placements.push(dnf);
    const bots = standings.map(idOf).filter((id) => id.startsWith('bot:'));
    const scores: Record<string, number> = {};
    for (const k of finishers) if (!idOf(k).startsWith('bot:')) scores[idOf(k)] = k.progress.finishMs;
    this.reportOutcome({
      placements,
      ...(bots.length ? { nonPlayerIds: bots } : {}),
      scores,
      lowerIsBetter: true,
      reason: 'finished',
      details: {
        mode: this.state.race.mode,
        track: this.state.race.trackId,
        laps: this.matchSettings.laps,
        playerStats: this.playerStats(standings.map(idOf), false),
      },
    });
  }

  private playerStats(ids: readonly string[], cup: boolean): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    const multi = ids.length >= 2;
    const items = this.rules(this.matchSettings).items;
    for (const id of ids) {
      if (id.startsWith('bot:')) continue;
      const s = this.matchStats.get(id);
      out[id] = {
        ...(s && s.bestLapMs > 0 ? { minLapMs: s.bestLapMs } : {}),
        ...(multi ? { fastestLaps: s?.fastestLaps ?? 0 } : {}),
        ...(items ? { itemHits: s?.itemHits ?? 0 } : {}),
        ...(cup ? { maxCupPoints: this.state.gp.get(id)?.points ?? 0 } : {}),
      };
    }
    return out;
  }

  protected override onReturnToLobby(): void {
    this.sim = null;
    this.slotOf.clear();
    this.idAt.clear();
    this.state.racers.clear();
    this.state.gp.clear();
    this.gpRound = 0;
    this.gpTracks = [];
    this.gpBots = [];
    this.matchStats.clear();
    const race = this.state.race;
    race.status = 'idle';
    race.paused = false;
    this.pausedAt = 0;
    race.goAt = 0;
    race.finishDeadline = 0;
    race.fastestLapMs = 0;
    race.fastestLapBy = '';
    race.entrants = 0;
    this.syncRacePreview();
    for (const id of [...this.state.looks.keys()]) if (!this.players.has(id)) this.state.looks.delete(id);
  }

  protected override onRoomDisposed(): void {
    this.sim = null;
  }

  // ---------------------------------------------------------------------------
  // Test hook (relaxed limits on a non-production server only; see SERVER_NOTES.md)
  // ---------------------------------------------------------------------------

  private testHook(player: PlayerRecord, cmd: z.infer<typeof TestHookSchema>): void {
    const slot = this.slotOf.get(player.id);
    const sim = this.sim;
    if (!sim || slot === undefined) return;
    if (cmd.action === 'autopilot') {
      if (cmd.on) this.autopilots.set(slot, new KartBot('normal', slot + 1));
      else this.autopilots.delete(slot);
    } else {
      placeKartBeforeFinish(sim, slot, 60);
    }
  }

  /** Autopilot karts feed bot inputs through the normal input path (credit bank and all). */
  private driveAutopilots(sim: KartSim): void {
    for (const [slot, bot] of this.autopilots) {
      const kart = sim.kart(slot);
      if (!kart || kart.retired) continue;
      sim.pushInputs(slot, kart.lastSeq + 1, [packKartInput(bot.think(sim, kart))]);
    }
  }
}
