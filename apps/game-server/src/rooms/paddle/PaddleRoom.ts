/**
 * Pixel Paddle — authoritative 1v1 paddle duel on the DAScade Classics kit.
 *
 * Modes
 *  - Solo practice (solo room): you (left) vs the house paddle at the lobby's AI level. Each
 *    game is a verified run: the server's final score goes to the high-score board.
 *  - Network match: two seated players; a lone seated player plays the house paddle.
 *  - Tournament games always use PADDLE_TOURNAMENT_RULES; the 'first' side plays left and
 *    serves first. Best-of series are handled by the platform (one game per match here).
 *
 * The room runs the 60 Hz simulation from @dascade/game-core/paddle. Clients only send
 * `paddle:input` (a target y + serve flag); the server moves paddles at the capped speed,
 * decides every hit, point and the winner, and broadcasts a binary snapshot every 2 ticks.
 *
 * Disconnects: a dropped player's paddle is covered by the house AI during the reconnect
 * grace (the rally goes on); when the grace expires or the player leaves, they forfeit. In
 * Tournament Center matches the house never covers (it could win a participant's game for them):
 * the dropped player's paddle just waits.
 */
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS_MSG, type RunEndReason, type RunSummary, type RunVerdict } from '@dascade/shared/games/classics';
import {
  DEFAULT_PADDLE_SETTINGS,
  PADDLE_AI_LEVELS,
  PADDLE_INPUT_RATE,
  PADDLE_MSG,
  PADDLE_TOURNAMENT_RULES,
  PaddleInputSchema,
  PaddlePauseSchema,
  PaddleSettingsSchema,
  type PaddleEventPayload,
  type PaddleInput,
  type PaddleSettings,
} from '@dascade/shared/games/paddle';
import {
  PADDLE,
  createAi,
  createMatch,
  driveAi,
  encodePaddleSnapshot,
  forfeit,
  requestServe,
  setLagTicks,
  setTarget,
  snapshotOf,
  stepMatch,
  type AiBrain,
  type PaddleMatch,
  type PaddleRules,
  type PaddleSimEvent,
  type Side,
} from '@dascade/game-core/paddle';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { ClassicsRoom } from '../classics/ClassicsRoom.ts';
import { PaddleState, type PaddleSide } from './PaddleState.ts';
import { RttProbe } from './rttProbe.ts';

/** Lead-in after resuming a paused solo game or a reconnect. */
const RESUME_LEAD_MS = 900;

/** The house paddle's colour: the first of these that no human on court is wearing. */
const HOUSE_COLORS = ['#ff4fd8', '#ffd23f', '#7cf5ff', '#a78bfa'] as const;

/** RTT a client may claim before the server has measured its own (≈ 2 ticks of lag compensation). */
const DEFAULT_RTT_MS = 34;
/** Headroom over the server's measurement (about a frame of client-side processing). */
const RTT_SLACK_MS = 16;

/** Score multiplier per house level for the solo high-score boards. */
const LEVEL_MULT: Record<PaddleSettings['ai'], number> = { rookie: 1, pro: 2, ace: 3, legend: 5 };

interface SideInput {
  y: number;
  serve: boolean;
  lag: number;
}

export class PaddleRoom extends ClassicsRoom<PaddleState, PaddleSettings> {
  readonly gameId = 'paddle' as const;
  protected readonly settingsSchema = PaddleSettingsSchema;
  protected readonly statLabel = 'Rally';
  /** Solo: READY lead-in before the first serve can happen. */
  protected soloLeadMs = 1_400;

  protected match: PaddleMatch | null = null;
  /** Room player id per side (null = house paddle). */
  private sideIds: [string | null, string | null] = [null, null];
  private brains: [AiBrain | null, AiBrain | null] = [null, null];
  /** House AI is covering a disconnected human on this side. */
  private covering: [boolean, boolean] = [false, false];
  private readonly sideInputs = new Map<string, SideInput>();
  private startAt = 0;
  private matchCounter = 0;
  private finished = true;
  private forfeitSide: Side | -1 = -1;
  private readonly verdicts = new Map<string, RunVerdict>();
  /** Server-measured round trips (ping frames) — caps the RTT clients claim for hit forgiveness. */
  private readonly rttProbe = new RttProbe();
  private probeTimer: { clear(): void } | null = null;
  private probeRounds = 0;

  protected defaultSettings(): PaddleSettings {
    return structuredClone(DEFAULT_PADDLE_SETTINGS);
  }

  protected createState(): PaddleState {
    return new PaddleState();
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    // Solo players tune the house paddle between games from the instructions card.
    if (this.isSolo) this.settingsEditablePhases = ['LOBBY', 'PLAYING', 'RESULTS'];
    this.handle(PADDLE_MSG.input, PaddleInputSchema, (p, input) => this.onInput(p, input), {
      phases: ['COUNTDOWN', 'PLAYING'],
      playersOnly: true,
      silent: true,
      rate: PADDLE_INPUT_RATE,
    });
    this.handle(PADDLE_MSG.pause, PaddlePauseSchema, (p, { paused }) => this.setPaused(p, paused), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 6, perSecond: 2 },
    });
    this.syncMeta();
    this.setFixedTimestep(() => this.tick(), PADDLE.tickRate);
    this.probeTimer = this.clock.setInterval(() => this.probeRtt(), 250);
  }

  /** Ping the humans on court: every 250 ms until measured, then once a second. */
  private probeRtt(): void {
    if (this.phase !== 'COUNTDOWN' && this.phase !== 'PLAYING') return;
    this.probeRounds++;
    for (const id of this.sideIds) {
      const rec = id ? this.players.get(id) : undefined;
      if (!id || !rec?.client) continue;
      if (this.rttProbe.rtt(id) === null || this.probeRounds % 4 === 0) this.rttProbe.probe(id, rec.client);
    }
  }

  /**
   * One-way latency in ticks (+1 for the input interval) for hit forgiveness near the paddle edge.
   * The client's RTT is only a hint: it is capped by the server's own measurement (plus a frame), and
   * by a small default until that exists — a modified client can't buy a longer paddle history.
   */
  private lagTicks(playerId: string, clientRtt: number | undefined): number {
    const measured = this.rttProbe.rtt(playerId);
    const ceiling = measured === null ? DEFAULT_RTT_MS : measured + RTT_SLACK_MS;
    const rtt = Math.min(clientRtt ?? ceiling, ceiling);
    return Math.round(rtt / 2 / (1000 / PADDLE.tickRate)) + 1;
  }

  /** Solo only: freeze the game; resuming gives a short lead-in before play continues. */
  private setPaused(player: PlayerRecord, paused: boolean): void {
    if (!this.isSolo) return this.reject(player, PADDLE_MSG.pause, 'not_allowed', 'Network games can’t be paused.');
    if (!this.match || this.finished || this.state.match.paused === paused) return;
    if (paused) {
      const refusal = this.claimSoloPause();
      if (refusal) return this.reject(player, PADDLE_MSG.pause, 'not_allowed', refusal);
    }
    this.state.match.paused = paused;
    if (!paused) {
      this.startAt = Date.now() + RESUME_LEAD_MS;
      this.state.match.startAt = this.startAt;
      this.noteSoloResume(this.startAt);
    }
  }

  // ---------------------------------------------------------------------------
  // Rules + boards
  // ---------------------------------------------------------------------------

  private rules(): PaddleRules {
    if (this.tournamentMatch) return { ...PADDLE_TOURNAMENT_RULES };
    const s = this.getSettings();
    return { target: s.target, winBy2: s.winBy2, speed: s.speed };
  }

  protected boardKey(): string {
    if (!this.isSolo) return '';
    const s = this.getSettings();
    return `${s.ai}-${s.speed}-to${s.target}`;
  }

  protected override modeLabel(): string {
    return this.isSolo ? 'solo' : 'duel';
  }

  protected override onSettingsChanged(): void {
    super.onSettingsChanged();
    if (!this.match || this.finished) this.syncMeta();
  }

  // ---------------------------------------------------------------------------
  // Runs (kit hooks)
  // ---------------------------------------------------------------------------

  protected beginSoloRun(player: PlayerRecord): void {
    this.verdicts.delete(player.id);
    this.setupMatch([player], Date.now() + this.soloLeadMs);
  }

  protected prepareMatch(entrants: PlayerRecord[], startAt: number): void {
    this.verdicts.clear();
    this.setupMatch(entrants, startAt);
  }

  private setupMatch(entrants: PlayerRecord[], startAt: number): void {
    let left = entrants[0] ?? null;
    let right = entrants[1] ?? null;
    let firstServer: Side = this.rng.int(2) as Side;
    const t = this.tournamentMatch;
    if (t && left && right) {
      const firstId = t.participants.find((p) => p.side === 'first')?.playerId;
      if (firstId === right.id) [left, right] = [right, left];
      firstServer = 0;
    }
    this.match = createMatch(this.rules(), firstServer);
    this.matchCounter = (this.matchCounter + 1) & 0xffff;
    this.sideIds = [left?.id ?? null, right?.id ?? null];
    const level = this.getSettings().ai;
    this.brains = [left ? null : createAi(level), right ? null : createAi(level)];
    this.covering = [false, false];
    this.sideInputs.clear();
    this.startAt = startAt;
    this.finished = false;
    this.forfeitSide = -1;
    this.state.match.paused = false;
    for (const side of [0, 1] as const) {
      const id = this.sideIds[side];
      const rec = id ? this.players.get(id) : undefined;
      if (rec && !rec.client && !this.tournamentMatch) this.cover(side, true);
    }
    this.syncSides();
    this.syncMeta();
    for (const id of this.sideIds) if (id) this.updateStanding(id, this.summaryFor(id), 0);
    this.broadcastSnapshot();
  }

  protected abortRun(playerId: string, reason: RunEndReason): void {
    const m = this.match;
    if (!m || this.finished) return;
    const side = this.sideIds.indexOf(playerId);
    if (side < 0) return;
    if (reason === 'quit') {
      // Solo "quit to menu": drop the game without a result.
      this.finished = true;
      this.match = null;
      this.state.match.status = 'idle';
      return;
    }
    this.forfeitSide = side as Side;
    this.handleEvents(forfeit(m, side as Side));
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  private onInput(player: PlayerRecord, input: PaddleInput): void {
    if (this.sideIds.indexOf(player.id) < 0) return;
    const prev = this.sideInputs.get(player.id);
    const lag = this.lagTicks(player.id, input.rtt);
    this.sideInputs.set(player.id, { y: input.y, serve: Boolean(input.serve) || Boolean(prev?.serve), lag });
  }

  private cover(side: Side, on: boolean): void {
    this.covering[side] = on;
    if (on && !this.brains[side]) this.brains[side] = createAi(this.getSettings().ai);
    if (!on && this.sideIds[side]) this.brains[side] = null;
    this.sideState(side).ai = on || !this.sideIds[side];
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    super.onPlayerDisconnected(player);
    const side = this.sideIds.indexOf(player.id);
    if (side < 0 || !this.match || this.finished) return;
    if (this.isSolo) {
      // Solo: freeze the game until the player is back (the house never plays for you) — out of
      // the run's pause budget, so dropping the connection isn't an unlimited pause button.
      if (!this.state.match.paused && this.claimSoloPause('disconnect') === null) this.state.match.paused = true;
      return;
    }
    if (this.tournamentMatch) {
      // Tournament games are decided by the two participants alone: the house paddle never plays
      // for a dropped player (it could win their game for them). Their paddle waits where it is —
      // the rally goes on, so dropping out never helps — until they're back or forfeit.
      this.sideInputs.delete(player.id);
      this.systemChat(`${player.state.name} lost connection — their paddle waits for them.`);
      return;
    }
    this.cover(side as Side, true);
    this.systemChat(`${player.state.name} lost connection — the house paddle is covering.`);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    super.onPlayerReconnected(player);
    // A new connection: measure its round trip afresh.
    this.rttProbe.forget(player.id);
    const side = this.sideIds.indexOf(player.id);
    if (side < 0 || !this.match || this.finished) return;
    this.sideInputs.delete(player.id);
    if (this.isSolo) return; // stays paused; the player resumes from the pause card
    this.cover(side as Side, false);
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    super.onPlayerAway(player);
    // Grace expired mid-game: that's a forfeit.
    if (this.sideIds.includes(player.id)) this.abortRun(player.id, 'left');
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    super.onPlayerRemoved(player, reason);
    this.sideInputs.delete(player.id);
    this.rttProbe.forget(player.id);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const verdict = this.verdicts.get(player.id);
    if (verdict) this.sendTo(player, CLASSICS_MSG.verdict, verdict);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  private tick(): void {
    const m = this.match;
    if (!m || this.finished || this.phase !== 'PLAYING') return;
    if (this.state.match.paused || Date.now() < this.startAt) return;
    for (const side of [0, 1] as const) {
      const id = this.sideIds[side];
      const brain = this.brains[side];
      if (!id || this.covering[side]) {
        if (brain) driveAi(m, side, brain, this.rng);
        continue;
      }
      const input = this.sideInputs.get(id);
      if (!input) continue;
      setTarget(m, side, input.y);
      setLagTicks(m, side, input.lag);
      if (input.serve) {
        requestServe(m, side);
        input.serve = false;
      }
    }
    const before = m.status;
    const events = stepMatch(m, this.rng);
    this.handleEvents(events);
    if (m.status !== before && !this.finished) this.syncMeta();
    if (m.tick % 2 === 0) this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    if (!this.match) return;
    this.broadcastBytes(PADDLE_MSG.snap, encodePaddleSnapshot(snapshotOf(this.match, this.matchCounter)), {});
  }

  private handleEvents(events: PaddleSimEvent[]): void {
    const m = this.match;
    if (!m) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'hit':
          this.sideState(ev.side).hits = m.sides[ev.side].hits;
          this.state.match.rally = m.rally;
          this.state.match.longestRally = m.longestRally;
          this.emit({ kind: 'hit', side: ev.side, rally: ev.rally, speed: round2(ev.speed), offset: round2(ev.offset), x: round2(ev.x), y: round2(ev.y) });
          break;
        case 'wall':
          this.emit({ kind: 'wall', x: round2(ev.x), y: ev.y });
          break;
        case 'serve':
          this.state.match.status = 'play';
          this.state.match.rally = 0;
          this.emit({ kind: 'serve', side: ev.side });
          break;
        case 'point':
          this.syncSides();
          this.syncMeta();
          for (const id of this.sideIds) if (id) this.updateStanding(id, this.summaryFor(id), m.tick);
          this.emit({ kind: 'point', scorer: ev.scorer, scores: [m.sides[0].score, m.sides[1].score], rally: ev.rally, gamePoint: ev.gamePoint });
          break;
        case 'over':
          this.syncSides();
          this.syncMeta();
          this.emit({ kind: 'over', winner: ev.winner, scores: [m.sides[0].score, m.sides[1].score], reason: ev.reason });
          this.broadcastSnapshot();
          this.finish();
          break;
      }
    }
  }

  private emit(payload: PaddleEventPayload): void {
    this.broadcast(PADDLE_MSG.event, payload);
  }

  /** Solo: a run's verified score. Multiplayer: points (the standings rank by them). */
  private summaryFor(playerId: string): RunSummary {
    const m = this.match;
    const side = this.sideIds.indexOf(playerId);
    if (!m || side < 0) return { score: 0, level: 0, lives: 0, stat: 0 };
    const mine = m.sides[side as Side];
    if (!this.isSolo) return { score: mine.score, level: 0, lives: 0, stat: m.longestRally };
    const ai = this.getSettings().ai;
    const won = m.winner === side;
    const score = mine.score * 100 + (won ? 500 * LEVEL_MULT[ai] : 0) + m.longestRally * 10;
    return { score, level: PADDLE_AI_LEVELS.indexOf(ai) + 1, lives: 0, stat: m.longestRally };
  }

  private finish(): void {
    const m = this.match;
    if (!m || this.finished) return;
    this.finished = true;
    const order: Side[] = this.forfeitSide === 0 ? [0, 1] : [1, 0];
    for (const side of order) {
      const id = this.sideIds[side];
      if (!id) continue;
      const reason: RunEndReason = this.forfeitSide === side ? 'left' : 'over';
      const summary = this.summaryFor(id);
      if (this.statusOf(id) !== 'playing') continue;
      const info = this.playerFinished(id, summary, reason, m.tick);
      const verdict: RunVerdict = {
        ...summary,
        runId: `paddle-${this.matchCounter}`,
        reason,
        ticks: m.tick,
        best: info.best,
        rank: info.rank,
        entryId: info.entryId,
        board: info.board,
      };
      this.verdicts.set(id, verdict);
      this.sendTo(id, CLASSICS_MSG.verdict, verdict);
    }
  }

  // ---------------------------------------------------------------------------
  // Schema sync
  // ---------------------------------------------------------------------------

  private sideState(side: Side): PaddleSide {
    return side === 0 ? this.state.left : this.state.right;
  }

  private syncSides(): void {
    const m = this.match;
    const humanColors = this.sideIds.map((id) => (id ? this.players.get(id)?.state.color : undefined)).filter(Boolean);
    const houseColor = HOUSE_COLORS.find((c) => !humanColors.includes(c)) ?? HOUSE_COLORS[0]!;
    for (const side of [0, 1] as const) {
      const s = this.sideState(side);
      const id = this.sideIds[side];
      const rec = id ? this.players.get(id) : undefined;
      s.playerId = id ?? '';
      s.name = rec?.state.name ?? (id ? (this.standingOf(id)?.name ?? 'Player') : `House · ${cap(this.getSettings().ai)}`);
      s.color = rec?.state.color ?? (id ? '#22d3ee' : houseColor);
      s.ai = !id || this.covering[side];
      s.score = m ? m.sides[side].score : 0;
      s.hits = m ? m.sides[side].hits : 0;
    }
  }

  private syncMeta(): void {
    const meta = this.state.match;
    const rules = this.rules();
    const m = this.match;
    meta.target = rules.target;
    meta.winBy2 = rules.winBy2;
    meta.speed = rules.speed;
    meta.aiLevel = this.getSettings().ai;
    meta.matchId = this.matchCounter;
    if (m && !this.finished) meta.startAt = this.startAt;
    if (!m) {
      meta.status = 'idle';
      meta.winner = -1;
      meta.reason = '';
      meta.rally = 0;
      meta.longestRally = 0;
      meta.pointsPlayed = 0;
      meta.server = 0;
      return;
    }
    meta.status = m.status;
    meta.server = m.server;
    meta.winner = m.winner;
    meta.reason = m.reason;
    meta.rally = m.rally;
    meta.longestRally = m.longestRally;
    meta.pointsPlayed = m.sides[0].score + m.sides[1].score;
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.match = null;
    this.finished = true;
    this.sideIds = [null, null];
    this.brains = [null, null];
    this.covering = [false, false];
    this.sideInputs.clear();
    this.verdicts.clear();
    this.state.match.paused = false;
    this.syncSides();
    this.syncMeta();
  }

  protected override onRoomDisposed(): void {
    this.match = null;
    this.probeTimer?.clear();
    this.rttProbe.clear();
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
