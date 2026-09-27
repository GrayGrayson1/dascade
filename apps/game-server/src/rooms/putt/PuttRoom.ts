/**
 * DAS Putt — authoritative multiplayer mini golf.
 *
 * Flow: LOBBY → COUNTDOWN (course visible) → PLAYING (hole intro → putting) ⇄ INTERMISSION
 * (hole scores) → … → RESULTS → LOBBY (or straight into a rematch).
 *
 * Clients send stroke intents only ({angle, power, at}). The room simulates the whole roll with
 * the deterministic engine (`@dascade/game-core/putt`), broadcasts the path, and publishes the
 * outcome (lie, strokes, holed, penalties) when the ball comes to rest on everyone's screen.
 *
 * Nothing can stall a room: every turn has a shot clock (shorter while the golfer is
 * disconnected); a timeout costs a stroke and two in a row pick the ball up; every hole has a
 * stroke limit; golfers whose reconnect grace expired are picked up automatically; leavers
 * retire. Solo practice has no shot clock (nobody is waiting).
 */
import {
  DEFAULT_PUTT_SETTINGS,
  PUTT_AIM_RATE,
  PUTT_LAUNCH_DELAY_MS,
  PUTT_MSG,
  PUTT_PLAYOFF_HOLES,
  PUTT_RELEASE_WINDOW_MS,
  PUTT_STROKE_RATE,
  PUTT_TOURNAMENT_SETTINGS,
  PuttAimSchema,
  PuttSettingsSchema,
  PuttStrokeSchema,
  puttRoute,
  puttScoreLabel,
  type PuttAimRelay,
  type PuttEvent,
  type PuttSettings,
  type PuttShotView,
} from '@dascade/shared/games/putt';
import { EmptySchema } from '@dascade/shared';
import { COURSE_NAME, PuttMatch, encodeEvents, encodePath, getHole, ticksToMs, type PickupReason, type StrokeOutcome } from '@dascade/game-core/putt';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { Golfer, PuttState } from './PuttState.ts';

const BLOCK_TEXT: Record<string, string> = {
  unknown: 'You are not playing this match.',
  retired: 'You left this match.',
  done: 'Your ball is already holed or picked up.',
  not_your_turn: 'Wait for your turn.',
  match_over: 'The round is over.',
};

export class PuttRoom extends BaseGameRoom<PuttState, PuttSettings> {
  readonly gameId = 'putt' as const;
  protected readonly settingsSchema = PuttSettingsSchema;

  // Tunables (tests shorten them).
  protected introMs = 2_200;
  protected intermissionMs = 5_500;
  protected resultsDelayMs = 2_200;
  /** Pause after a roll ends before the next turn (cup drop / splash animations). */
  protected restPadMs = 450;
  /** Shot clock while the golfer on the clock is disconnected (inside their reconnect grace). */
  protected disconnectedClockMs = 10_000;
  /** Scale applied to animation-driven waits (tests use a tiny value). */
  protected playbackScale = 1;

  protected match: PuttMatch | null = null;
  private config: PuttSettings = DEFAULT_PUTT_SETTINGS;
  /** Shots still rolling on screen (replayed to clients that (re)join mid-roll). */
  private readonly inFlight = new Map<string, PuttShotView>();
  private readonly lastAimAt = new Map<string, number>();
  private playoffCount = 0;

  protected defaultSettings(): PuttSettings {
    return structuredClone(DEFAULT_PUTT_SETTINGS);
  }

  protected createState(): PuttState {
    return new PuttState();
  }

  protected override onRoomCreated(): void {
    this.state.solo = this.isSolo;
    if (this.isSolo) this.countdownMs = 0;
    this.syncPreview();

    this.handle(PUTT_MSG.stroke, PuttStrokeSchema, (p, s) => this.onStroke(p, s.angle, s.power, s.at), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: PUTT_STROKE_RATE,
    });
    this.handle(PUTT_MSG.aim, PuttAimSchema, (p, a) => this.onAim(p, a.angle, a.power), {
      phases: ['PLAYING'],
      playersOnly: true,
      silent: true,
      rate: PUTT_AIM_RATE,
    });
    this.handle(PUTT_MSG.pickup, EmptySchema, (p) => this.onConcede(p), { phases: ['PLAYING'], playersOnly: true });
    this.handle(
      PUTT_MSG.rematch,
      EmptySchema,
      (p) => {
        // Tournament series run themselves (the next game starts after the intermission).
        if (this.tournamentMatch) return this.reject(p, PUTT_MSG.rematch, 'not_allowed', 'The Tournament Center schedules the next game.');
        this.returnToLobby();
        this.startMatch();
      },
      { phases: ['RESULTS'], hostOnly: true, rate: { burst: 2, perSecond: 0.5 } },
    );
  }

  // ---------------------------------------------------------------------------
  // Lobby
  // ---------------------------------------------------------------------------

  protected override onPlayerJoined(): void {
    if (this.isSolo) this.startMatch();
  }

  protected override onSettingsChanged(): void {
    if (this.phase === 'LOBBY') this.syncPreview();
  }

  /** Mirror the chosen format into the state so the lobby can preview it. */
  private syncPreview(): void {
    const s = this.effectiveSettings();
    this.state.mode = s.mode;
    this.state.route.clear();
    for (const n of puttRoute(s)) this.state.route.push(n);
    this.state.regulation = this.state.route.length;
    this.state.maxOverPar = s.maxOverPar;
    this.state.shotClock = s.shotClock;
  }

  private effectiveSettings(): PuttSettings {
    return this.tournamentMatch ? PUTT_TOURNAMENT_SETTINGS : this.getSettings();
  }

  // ---------------------------------------------------------------------------
  // Match setup
  // ---------------------------------------------------------------------------

  protected override onCountdownStart(): void {
    this.setupMatch();
  }

  protected onGameStart(): void {
    if (!this.match) this.setupMatch();
    this.startHole();
  }

  private setupMatch(): void {
    const s = (this.config = this.effectiveSettings());
    this.syncPreview();
    this.state.tournament = this.tournamentMatch !== null;
    let seated = this.seatedPlayers().filter((p) => !p.away);
    const info = this.tournamentMatch;
    if (info) {
      // Tournament: the 'first' side tees off first on hole 1.
      const side = (p: PlayerRecord) => info.participants.find((x) => x.playerId === p.id)?.side;
      seated = [...seated].sort((a, b) => Number(side(a) === 'second') - Number(side(b) === 'second'));
    }
    this.match = new PuttMatch({ route: puttRoute(s), mode: s.mode, maxOverPar: s.maxOverPar }, seated.map((p) => p.id));
    this.playoffCount = 0;
    this.inFlight.clear();
    this.state.golfers.clear();
    this.state.playoffIds.clear();
    this.state.winners.clear();
    this.state.shotSeq = 0;
    for (const p of seated) {
      const g = new Golfer();
      g.name = p.state.name;
      g.color = p.state.color;
      this.state.golfers.set(p.id, g);
    }
    this.state.holeIndex = 0;
    this.state.holeStatus = 'intro';
    this.state.holeStartedAt = Date.now();
    this.publishAll();
  }

  private startHole(): void {
    const match = this.match;
    if (!match) return;
    if (this.phase !== 'PLAYING') this.setPhase('PLAYING');
    const now = Date.now();
    const intro = Math.round((this.isSolo ? this.introMs * 0.65 : this.introMs) * this.playbackScale);
    this.state.holeIndex = match.holeIndex;
    this.state.round = match.holeIndex + 1;
    this.state.holeStatus = 'intro';
    this.state.holeStartedAt = now;
    this.state.introEndsAt = now + intro;
    this.state.turnId = '';
    this.state.playoffIds.clear();
    for (const id of match.playoffIds) if (match.isPlayoff) this.state.playoffIds.push(id);
    this.inFlight.clear();
    const hole = match.hole;
    this.state.statusText = `Hole ${hole.number} · ${hole.name} · Par ${hole.par}`;
    this.publishAll();
    this.broadcast(PUTT_MSG.event, { kind: 'hole-start', holeIndex: match.holeIndex, hole: hole.number, playoff: match.isPlayoff } satisfies PuttEvent);
    this.schedule('intro', intro, () => this.openHole());
  }

  private openHole(): void {
    const match = this.match;
    if (!match || this.phase !== 'PLAYING') return;
    this.state.holeStatus = 'play';
    // Golfers whose reconnect grace already expired sit this hole out (picked up).
    for (const g of match.playing()) {
      const p = this.players.get(g.id);
      if (!p || p.away) this.pickUp(g.id, 'away');
    }
    if (match.holeComplete()) return this.endHole();
    if (match.mode === 'turns') this.startTurn(match.nextTurn(null));
    else for (const g of match.playing()) this.startClock(g.id);
  }

  // ---------------------------------------------------------------------------
  // Turns & shot clocks
  // ---------------------------------------------------------------------------

  private startTurn(id: string | null): void {
    const match = this.match;
    if (!match) return;
    // Skip anyone whose grace expired; loop is bounded by the number of golfers.
    for (let guard = 0; id && guard <= match.golfers.size; guard++) {
      const p = this.players.get(id);
      if (p && !p.away) break;
      this.pickUp(id, 'away');
      id = match.nextTurn(id);
    }
    if (!id) {
      this.state.turnId = '';
      if (match.holeComplete()) this.endHole();
      return;
    }
    this.state.turnId = id;
    this.broadcast(PUTT_MSG.event, { kind: 'turn', playerId: id } satisfies PuttEvent);
    this.startClock(id);
  }

  /** Put a golfer on the shot clock (no clock in solo practice). */
  private startClock(id: string): void {
    const g = this.state.golfers.get(id);
    if (!g) return;
    this.cancel(`clock:${id}`);
    if (this.isSolo) {
      g.deadline = 0;
      return;
    }
    const p = this.players.get(id);
    const full = this.config.shotClock * 1000;
    const ms = p?.client ? full : Math.min(full, this.disconnectedClockMs);
    g.deadline = Date.now() + ms;
    this.schedule(`clock:${id}`, ms, () => this.onClock(id));
  }

  private onClock(id: string): void {
    const match = this.match;
    const g = this.state.golfers.get(id);
    if (!match || !g || this.phase !== 'PLAYING' || this.state.holeStatus !== 'play' || g.moving) return;
    if (match.canShoot(id)) return;
    const r = match.timeout(id);
    g.deadline = 0;
    this.publishGolfer(id);
    this.broadcast(PUTT_MSG.event, { kind: 'timeout', playerId: id, strokes: r.strokes } satisfies PuttEvent);
    if (r.pickedUp) this.broadcast(PUTT_MSG.event, { kind: 'pickup', playerId: id, strokes: r.strokes, reason: r.reason ?? 'limit' } satisfies PuttEvent);
    this.progress(id);
  }

  /** After a golfer's action resolved: next turn / restart their clock / end the hole. */
  private progress(afterId: string): void {
    const match = this.match;
    if (!match || this.phase !== 'PLAYING' || this.state.holeStatus !== 'play') return;
    if (match.holeComplete() && ![...this.state.golfers.values()].some((g) => g.moving)) return this.endHole();
    if (match.mode === 'turns') {
      if ([...this.state.golfers.values()].some((g) => g.moving)) return;
      this.startTurn(match.nextTurn(afterId));
    } else {
      const g = match.golfers.get(afterId);
      if (g && !match.isDone(g)) this.startClock(afterId);
    }
  }

  private pickUp(id: string, reason: PickupReason): void {
    const match = this.match;
    if (!match || !match.pickUp(id)) return;
    this.cancel(`clock:${id}`);
    const g = this.state.golfers.get(id);
    if (g) g.deadline = 0;
    this.publishGolfer(id);
    const strokes = match.golfers.get(id)?.strokes ?? 0;
    this.broadcast(PUTT_MSG.event, { kind: 'pickup', playerId: id, strokes, reason } satisfies PuttEvent);
  }

  // ---------------------------------------------------------------------------
  // Strokes
  // ---------------------------------------------------------------------------

  private onStroke(player: PlayerRecord, angle: number, power: number, at: number | undefined): void {
    const match = this.match;
    if (!match || this.state.holeStatus !== 'play') {
      return this.reject(player, PUTT_MSG.stroke, 'wrong_phase', 'Hold on — the hole is not open yet.');
    }
    const g = this.state.golfers.get(player.id);
    if (g?.moving) return this.reject(player, PUTT_MSG.stroke, 'not_allowed', 'Your ball is still rolling.');
    if (match.mode === 'turns' && [...this.state.golfers.values()].some((x) => x.moving)) {
      return this.reject(player, PUTT_MSG.stroke, 'not_your_turn', 'Wait for the ball to stop.');
    }
    const block = match.canShoot(player.id);
    if (block || !g) {
      return this.reject(player, PUTT_MSG.stroke, block === 'not_your_turn' ? 'not_your_turn' : 'not_allowed', BLOCK_TEXT[block ?? 'unknown']!);
    }
    const now = Date.now();
    // Lag compensation: launch a fixed delay after the release moment the client reports, if that
    // moment is recent; clamped so it can never be in the past or far in the future.
    let startedAt = now + PUTT_LAUNCH_DELAY_MS;
    if (at !== undefined && at >= now - PUTT_RELEASE_WINDOW_MS && at <= now + 100) {
      startedAt = Math.min(now + 300, Math.max(now + 20, at + PUTT_LAUNCH_DELAY_MS));
    }
    const obstacleMs = startedAt - this.state.holeStartedAt;
    const out = match.stroke(player.id, angle, power, obstacleMs);
    this.cancel(`clock:${player.id}`);
    const seq = (this.state.shotSeq = this.state.shotSeq + 1);
    const view = this.shotView(seq, player.id, angle, power, startedAt, obstacleMs, out);
    g.moving = true;
    g.deadline = 0;
    g.lastSeq = seq;
    this.inFlight.set(player.id, view);
    this.broadcast(PUTT_MSG.shot, view);
    const wait = Math.max(0, startedAt - now) + (view.durationMs + this.restPadMs) * this.playbackScale;
    this.schedule(`rest:${player.id}`, wait, () => this.onRest(player.id, view));
  }

  private shotView(seq: number, playerId: string, angle: number, power: number, startedAt: number, obstacleMs: number, out: StrokeOutcome): PuttShotView {
    const match = this.match!;
    return {
      seq,
      playerId,
      holeIndex: match.holeIndex,
      hole: match.hole.number,
      angle,
      power,
      from: [out.from.x, out.from.y],
      startedAt,
      obstacleMs,
      path: encodePath(out.sim.samples),
      events: encodeEvents(out.sim.events),
      ticks: out.sim.ticks,
      durationMs: ticksToMs(out.sim.ticks),
      result: out.result,
      lie: [out.lie.x, out.lie.y],
      strokes: out.strokes,
      penalty: out.penalty,
      holed: out.holed,
      pickedUp: out.pickedUp,
    };
  }

  private onRest(id: string, view: PuttShotView): void {
    const match = this.match;
    if (!match || this.inFlight.get(id)?.seq !== view.seq) return;
    this.inFlight.delete(id);
    const g = this.state.golfers.get(id);
    if (g) g.moving = false;
    this.publishGolfer(id);
    const hole = getHole(view.hole);
    if (view.penalty) {
      this.broadcast(PUTT_MSG.event, { kind: 'penalty', playerId: id, reason: view.result === 'water' ? 'water' : 'oob', strokes: view.strokes } satisfies PuttEvent);
    }
    if (view.holed) {
      const label = puttScoreLabel(view.strokes, hole.par);
      this.broadcast(PUTT_MSG.event, { kind: 'holed', playerId: id, hole: hole.number, strokes: view.strokes, par: hole.par, label } satisfies PuttEvent);
      if (view.strokes === 1 && !this.isSolo) this.systemChat(`${this.nameOf(id)} aced hole ${hole.number}! Hole in one!`);
    } else if (view.pickedUp) {
      this.broadcast(PUTT_MSG.event, { kind: 'pickup', playerId: id, strokes: view.strokes, reason: 'limit' } satisfies PuttEvent);
    }
    this.progress(id);
  }

  private onAim(player: PlayerRecord, angle: number, power: number): void {
    const match = this.match;
    if (!match || this.state.holeStatus !== 'play' || match.mode !== 'turns' || match.turnId !== player.id) return;
    if (this.state.golfers.get(player.id)?.moving) return;
    const now = Date.now();
    if (now - (this.lastAimAt.get(player.id) ?? 0) < 66) return;
    this.lastAimAt.set(player.id, now);
    const relay: PuttAimRelay = { playerId: player.id, angle, power };
    this.sendWhere((p) => p.id !== player.id, PUTT_MSG.aim, relay);
  }

  private onConcede(player: PlayerRecord): void {
    const match = this.match;
    const g = this.state.golfers.get(player.id);
    if (!match || !g || this.state.holeStatus !== 'play') return;
    if (g.moving) return this.reject(player, PUTT_MSG.pickup, 'not_allowed', 'Wait for your ball to stop.');
    const gm = match.golfers.get(player.id);
    if (!gm || match.isDone(gm)) return;
    this.pickUp(player.id, 'conceded');
    this.progress(player.id);
  }

  // ---------------------------------------------------------------------------
  // Hole / match end
  // ---------------------------------------------------------------------------

  private endHole(): void {
    const match = this.match;
    if (!match || this.state.holeStatus === 'done' || this.phase !== 'PLAYING') return;
    for (const id of match.golfers.keys()) this.cancel(`clock:${id}`);
    this.state.holeStatus = 'done';
    this.state.turnId = '';
    this.broadcast(PUTT_MSG.event, { kind: 'hole-end', holeIndex: match.holeIndex, hole: match.hole.number } satisfies PuttEvent);
    const more = match.advance();
    this.publishAll(false);
    if (more) return this.intermission();
    if (this.state.tournament && !match.playoffResult) {
      const leaders = match.isPlayoff ? match.playoffIds : match.leaders();
      if (leaders.length >= 2) {
        const hole = PUTT_PLAYOFF_HOLES[this.playoffCount];
        if (hole !== undefined) {
          this.playoffCount++;
          match.startPlayoff(leaders, hole);
          this.syncRoute();
          this.broadcast(PUTT_MSG.event, { kind: 'playoff', hole, playerIds: [...leaders] } satisfies PuttEvent);
          this.systemChat(`All square — sudden-death playoff on hole ${hole}!`);
          return this.intermission();
        }
        match.endPlayoffTied();
      }
    }
    this.schedule('results', Math.round(this.resultsDelayMs * this.playbackScale), () => this.finishMatch('completed'));
  }

  private intermission(): void {
    const ms = Math.round((this.isSolo ? this.intermissionMs * 0.55 : this.intermissionMs) * this.playbackScale);
    this.setPhase('INTERMISSION', ms);
    this.schedule('next', ms, () => {
      if (this.phase === 'INTERMISSION') this.startHole();
    });
  }

  private finishMatch(reason: 'completed' | 'forfeit'): void {
    const match = this.match;
    if (!match || this.phase === 'RESULTS' || this.phase === 'LOBBY' || this.phase === 'ENDED') return;
    this.clearAllTimers();
    match.finished = true;
    this.inFlight.clear();
    for (const g of this.state.golfers.values()) {
      g.moving = false;
      g.deadline = 0;
    }
    this.state.holeStatus = 'done';
    this.state.turnId = '';
    this.publishAll(false);
    const placements = match.placements();
    const scores = match.scores();
    this.state.winners.clear();
    for (const id of placements[0] ?? []) this.state.winners.push(id);
    const placeOf = new Map<string, number>();
    let place = 1;
    for (const group of placements) {
      for (const id of group) placeOf.set(id, place);
      place += group.length;
    }
    const full = match.regulation === 9;
    const playerStats: Record<string, Record<string, number>> = {};
    for (const g of match.golfers.values()) {
      let birdies = 0;
      for (let i = 0; i < match.regulation; i++) {
        const s = g.card[i] ?? 0;
        if (s > 0 && s < getHole(match.route[i]!).par) birdies++;
      }
      const stats: Record<string, number> = { holesInOne: g.holesInOne, birdies };
      if (full && !g.retired && g.card.slice(0, 9).every((s) => s > 0)) stats.minCourseStrokes = scores[g.id] ?? 0;
      playerStats[g.id] = stats;
    }
    const players = [...match.golfers.values()].map((g) => {
      const record = this.players.get(g.id);
      const score = scores[g.id] ?? 0;
      if (record) record.state.score = score;
      return {
        playerId: g.id,
        name: record?.state.name ?? this.state.golfers.get(g.id)?.name ?? 'Golfer',
        guestId: record?.guestId,
        userId: record?.userId,
        score,
        placement: placeOf.get(g.id) ?? placements.length,
      };
    });
    const details = {
      course: COURSE_NAME,
      route: [...match.route.slice(0, match.regulation)],
      par: match.route.slice(0, match.regulation).reduce((s, n) => s + getHole(n).par, 0),
      mode: match.mode,
      playoffHoles: match.route.length - match.regulation,
      playerStats,
    };
    this.endMatch({ players, details });
    this.reportOutcome({
      placements,
      scores,
      lowerIsBetter: true,
      reason: reason === 'forfeit' ? 'forfeit' : match.playoffResult && match.playoffResult.length > 1 ? 'playoff' : 'completed',
      details,
    });
  }

  // ---------------------------------------------------------------------------
  // Connection changes
  // ---------------------------------------------------------------------------

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const g = this.state.golfers.get(player.id);
    if (!g || !this.isScheduled(`clock:${player.id}`) || this.isSolo) return;
    const left = g.deadline - Date.now();
    if (left > this.disconnectedClockMs) {
      g.deadline = Date.now() + this.disconnectedClockMs;
      this.schedule(`clock:${player.id}`, this.disconnectedClockMs, () => this.onClock(player.id));
    }
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    const match = this.match;
    if (!match || this.phase !== 'PLAYING' || this.state.holeStatus !== 'play') return;
    const g = this.state.golfers.get(player.id);
    if (!g || g.moving) return;
    const gm = match.golfers.get(player.id);
    if (!gm || match.isDone(gm)) return;
    this.pickUp(player.id, 'away');
    this.progress(player.id);
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    const match = this.match;
    const g = this.state.golfers.get(player.id);
    this.lastAimAt.delete(player.id);
    if (!match || !g || !match.golfers.has(player.id)) return;
    if (this.phase === 'LOBBY' || this.phase === 'RESULTS' || this.phase === 'ENDED') return;
    const wasTurn = match.turnId === player.id;
    match.retire(player.id);
    this.cancel(`clock:${player.id}`);
    g.retired = true;
    g.deadline = 0;
    this.publishGolfer(player.id);
    const active = [...match.golfers.values()].filter((x) => !x.retired);
    if (this.state.tournament && active.length <= 1) {
      // Head-to-head forfeit: the remaining golfer wins now instead of playing on alone.
      this.finishMatch('forfeit');
      return;
    }
    if (this.phase !== 'PLAYING' || this.state.holeStatus !== 'play' || g.moving) return;
    if (match.holeComplete()) {
      if (![...this.state.golfers.values()].some((x) => x.moving)) this.endHole();
    } else if (wasTurn || match.mode === 'turns') {
      if (!this.state.turnId || wasTurn) this.startTurn(match.nextTurn(player.id));
    }
  }

  protected override syncPrivate(player: PlayerRecord): void {
    // Nothing in golf is private; this is the (re)join hook: replay rolls still on screen.
    const now = Date.now();
    const rolling = [...this.inFlight.values()].filter((v) => v.startedAt + v.durationMs > now);
    if (rolling.length) this.sendTo(player, PUTT_MSG.replay, rolling);
  }

  // ---------------------------------------------------------------------------
  // State publishing
  // ---------------------------------------------------------------------------

  private nameOf(id: string): string {
    return this.players.get(id)?.state.name ?? this.state.golfers.get(id)?.name ?? 'Someone';
  }

  private syncRoute(): void {
    const match = this.match;
    if (!match) return;
    this.state.route.clear();
    for (const n of match.route) this.state.route.push(n);
    this.state.regulation = match.regulation;
  }

  /** Copy one golfer from the engine into the schema (skipped while their roll is on screen, unless forced). */
  private publishGolfer(id: string, force = false): void {
    const match = this.match;
    const gm = match?.golfers.get(id);
    const g = this.state.golfers.get(id);
    if (!match || !gm || !g) return;
    if (g.moving && !force) return;
    g.order = gm.order;
    g.x = gm.lie.x;
    g.y = gm.lie.y;
    g.strokes = Math.min(255, gm.strokes);
    g.holed = gm.holed;
    g.pickedUp = gm.pickedUp;
    g.retired = gm.retired;
    g.holesInOne = gm.holesInOne;
    const t = match.totals(gm);
    g.total = t.total;
    g.parPlayed = t.parPlayed;
    for (let i = 0; i < gm.card.length; i++) {
      const v = Math.min(255, gm.card[i] ?? 0);
      if (i < g.card.length) {
        if (g.card[i] !== v) g.card[i] = v;
      } else g.card.push(v);
    }
  }

  private publishAll(forceMoving = true): void {
    const match = this.match;
    if (!match) return;
    this.syncRoute();
    this.state.holeIndex = match.holeIndex;
    for (const id of match.golfers.keys()) this.publishGolfer(id, forceMoving);
  }

  protected override onReturnToLobby(): void {
    this.match = null;
    this.inFlight.clear();
    this.lastAimAt.clear();
    this.playoffCount = 0;
    this.state.golfers.clear();
    this.state.playoffIds.clear();
    this.state.winners.clear();
    this.state.holeStatus = 'idle';
    this.state.holeIndex = 0;
    this.state.turnId = '';
    this.state.shotSeq = 0;
    this.syncPreview();
  }

  protected override onRoomDisposed(): void {
    this.match = null;
    this.inFlight.clear();
  }
}
