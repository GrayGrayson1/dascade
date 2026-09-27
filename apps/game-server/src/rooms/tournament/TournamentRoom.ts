/**
 * Tournament Center kiosk room (`tournament`). One room = one tournament.
 *
 * - The tournament lives here, in a pure `TournamentEngine` (@dascade/game-core/tournament);
 *   this room validates messages, owns secrets (participant/organizer tokens, match tickets),
 *   launches a game room per READY match and mirrors the engine into synchronized state.
 * - Viewers are ordinary room players (chat, reconnect…). Participants are NOT room players:
 *   a viewer registers (gets a secret participant token privately) or claims with that token.
 * - The creator is the organizer (bound to a secret organizer token); only the organizer is ever
 *   host. `lobby:start` / `lobby:ready` / `lobby:settings` don't apply and are refused.
 * - Match rooms are created server-side with an in-process binding (see platform/tournaments.ts);
 *   participants join them with a per-match ticket. Game results arrive through the outcome hub and
 *   are recorded idempotently by (matchId, gameNumber); the bracket advances automatically.
 * - The room never auto-disposes while the tournament is active; after COMPLETE/CANCELLED it closes
 *   once nobody has been watching for a while.
 */
import { timingSafeEqual } from 'node:crypto';
import { matchMaker, type Delayed } from '@colyseus/core';
import {
  LIMITS,
  RATE,
  TOURNAMENT_LIMITS,
  TOURNAMENT_MSG,
  TournamentAdminSchema,
  TournamentCheckInSchema,
  TournamentClaimSchema,
  TournamentConfigSchema,
  TournamentRegisterSchema,
  TournamentWithdrawSchema,
  cleanText,
  defaultTournamentConfig,
  maskProfanity,
  randomId,
  type Phase,
  type TournamentAck,
  type TournamentAdminAction,
  type TournamentConfig,
  type TournamentGameRecord,
  type TournamentListing,
  type TournamentMatchInfo,
  type TournamentMe,
} from '@dascade/shared';
import { isProvisional } from '@dascade/game-core/rating';
import { TournamentEngine, TournamentError, isFinished, type EngineMatch, type SlotSource } from '@dascade/game-core/tournament';
import { log } from '../../lib/log.ts';
import { getRating, ratingIdentity } from '../../platform/ratings.ts';
import { tournamentStore } from '../../platform/tournamentStore.ts';
import {
  MATCH_BINDING_OPTION,
  createMatchBinding,
  getBoundRoom,
  registerTournament,
  unregisterTournament,
  type MatchRoomStatus,
  type TournamentHost,
} from '../../platform/tournaments.ts';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { TMatch, TParticipant, TournamentState } from './schema.ts';

/** Reconnect grace for players in tournament match rooms (seconds). */
const MATCH_RECONNECT_GRACE_S = 180;
/** A finished tournament closes after this long without viewers. */
const TERMINAL_IDLE_MS = 15 * 60_000;
/** An unfinished tournament nobody has looked at (and with nobody playing) for this long is cancelled. */
const ABANDONED_IDLE_MS = 6 * 60 * 60_000;
/** Minimum spacing between persistence snapshots. */
const PERSIST_EVERY_MS = 5_000;
/** Back-off after a match room failed to open. */
const LAUNCH_RETRY_MS = [2_000, 5_000, 15_000, 30_000];

interface MatchRoomEntry {
  attempt: number;
  /** '' while the room is being created. */
  roomCode: string;
  a: string;
  b: string;
  present: Set<string>;
  waiting: boolean;
  /** When exactly one participant started waiting for the other (no-show clock), 0 = not running. */
  waitingSince: number;
}

const PRE_START = new Set(['DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY']);

export class TournamentRoom extends BaseGameRoom<TournamentState, TournamentConfig> implements TournamentHost {
  readonly gameId = 'tournament' as const;
  protected readonly settingsSchema = TournamentConfigSchema;
  protected override countdownMs = 0;
  protected override settingsEditablePhases: readonly Phase[] = [];
  protected override lobbyReadyEnabled = false;

  private engine!: TournamentEngine;
  /** Unique id for persistence (room codes are reused after a room closes). */
  private tournamentId = '';
  private organizerToken = '';
  private organizerPlayerId: string | null = null;
  private organizerAssigned = false;
  /** participantId → secret participant token. */
  private readonly tokens = new Map<string, string>();
  /** matchId → participantId → ticket (stable across room relaunches). */
  private readonly tickets = new Map<string, Map<string, string>>();
  /** matchId → live match room. */
  private readonly rooms = new Map<string, MatchRoomEntry>();
  private readonly launchFailures = new Map<string, { count: number; retryAt: number }>();
  private attemptSeq = 0;
  /** playerId → last `tournament:me` JSON sent. */
  private readonly lastMe = new Map<string, string>();
  private idleSince = 0;
  private persistTimer: Delayed | null = null;
  private lastPersistAt = 0;
  private disposing = false;

  get code(): string {
    return this.roomId;
  }

  protected defaultSettings(): TournamentConfig {
    return defaultTournamentConfig('chess');
  }

  protected createState(): TournamentState {
    return new TournamentState();
  }

  protected onGameStart(): void {
    // The kiosk never "starts" like a game room (validateStart refuses); nothing to do.
  }

  protected override validateStart(): string | null {
    return 'Tournaments start from the organizer console.';
  }

  /** Only the organizer is ever host. */
  protected override canBecomeHost(player: PlayerRecord): boolean {
    return player.id === this.organizerPlayerId;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected override onRoomCreated(): void {
    this.autoDispose = false;
    this.tournamentId = randomId(24, this.rng);
    this.organizerToken = randomId(32, this.rng);
    const name = cleanName(this.settings.name);
    if (name !== this.settings.name) this.updateSettings({ ...this.settings, name });
    this.state.roomName = name.slice(0, LIMITS.roomName);
    this.engine = TournamentEngine.create(this.settings, { rng: this.rng, now: () => Date.now() });
    this.registerHandlers();
    registerTournament(this);
    this.clock.setInterval(() => this.tick(), 1000);
    this.syncState();
  }

  protected override onPlayerJoined(player: PlayerRecord): void {
    if (!this.organizerAssigned) {
      // The creator is the first player to join a fresh tournament room.
      this.organizerAssigned = true;
      this.setOrganizer(player);
    }
    this.idleSince = 0;
    this.syncState();
  }

  protected override onPlayerReconnected(): void {
    this.syncState();
  }

  protected override onPlayerDisconnected(): void {
    this.syncState();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.lastMe.delete(player.id);
    if (player.id === this.organizerPlayerId) {
      this.organizerPlayerId = null;
      this.state.organizerId = '';
    }
    this.syncState();
  }

  protected override syncPrivate(player: PlayerRecord): void {
    this.lastMe.delete(player.id);
    this.sendMe(player);
  }

  /** The organizer closing the room cancels an unfinished tournament first. */
  protected override closeRoom(): void {
    if (!this.isTerminal()) {
      this.engine.cancel('The organizer closed the tournament room.');
      this.afterChange();
    }
    super.closeRoom();
  }

  protected override onRoomDisposed(): void {
    this.disposing = true;
    unregisterTournament(this.roomId, this);
    for (const [matchId, entry] of this.rooms) {
      const bound = getBoundRoom(this.roomId, matchId);
      if (bound && bound.roomCode === entry.roomCode) {
        bound.applySeries({ status: 'closed', info: this.matchInfo(this.engine.match(matchId)!), message: 'The tournament room closed.' });
      }
    }
    this.rooms.clear();
    this.persistTimer?.clear();
    void tournamentStore.save(this.tournamentId, this.roomId, this.engine.data);
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  private registerHandlers(): void {
    this.handle(
      TOURNAMENT_MSG.register,
      TournamentRegisterSchema,
      (p, payload) =>
        this.run(p, TOURNAMENT_MSG.register, payload?.requestId, () => {
          if (this.boundParticipant(p)) throw new TournamentError('duplicate', 'You are already registered.');
          const identity = ratingIdentity(p);
          const rating = getRating(identity, this.engine.data.config.gameId);
          const entry = this.engine.register({
            name: payload?.name?.trim() || p.state.name,
            avatar: p.state.avatar,
            identity,
            rating: rating.rating,
            ratingGames: rating.games,
            provisional: isProvisional(rating),
          });
          this.tokens.set(entry.id, randomId(32, this.rng));
          p.data.participantId = entry.id;
          return `You're in, ${entry.name}!`;
        }),
      { rate: RATE.action },
    );

    this.handle(
      TOURNAMENT_MSG.claim,
      TournamentClaimSchema,
      (p, { token, requestId }) =>
        this.run(p, TOURNAMENT_MSG.claim, requestId, () => {
          const pid = [...this.tokens].find(([, t]) => safeEqual(t, token))?.[0];
          if (!pid || !this.engine.participant(pid)) throw new TournamentError('not_found', 'That tournament pass is not valid here.');
          p.data.participantId = pid;
          return `Welcome back, ${this.engine.participant(pid)!.name}.`;
        }),
      { rate: { burst: 5, perSecond: 0.5 } },
    );

    this.handle(
      TOURNAMENT_MSG.claimOrganizer,
      TournamentClaimSchema,
      (p, { token, requestId }) =>
        this.run(p, TOURNAMENT_MSG.claimOrganizer, requestId, () => {
          if (!safeEqual(this.organizerToken, token)) throw new TournamentError('not_allowed', 'That organizer pass is not valid here.');
          this.setOrganizer(p);
          return 'Organizer console restored.';
        }),
      { rate: { burst: 5, perSecond: 0.5 } },
    );

    this.handle(
      TOURNAMENT_MSG.checkIn,
      TournamentCheckInSchema,
      (p, payload) =>
        this.run(p, TOURNAMENT_MSG.checkIn, payload?.requestId, () => {
          const pid = this.requireBound(p);
          this.engine.setCheckIn(pid, true, 'participant');
          return 'Checked in — good luck!';
        }),
      { rate: RATE.action },
    );

    this.handle(
      TOURNAMENT_MSG.withdraw,
      TournamentWithdrawSchema,
      (p, { requestId }) =>
        this.run(p, TOURNAMENT_MSG.withdraw, requestId, () => {
          const pid = this.requireBound(p);
          this.engine.withdraw(pid);
          if (!this.engine.participant(pid)) this.forgetParticipant(pid);
          return 'You left the tournament.';
        }),
      { rate: RATE.action },
    );

    this.handle(
      TOURNAMENT_MSG.admin,
      TournamentAdminSchema,
      (p, action) =>
        this.run(p, action.action, action.requestId, () => {
          if (p.id !== this.organizerPlayerId) throw new TournamentError('not_allowed', 'Only the organizer can do that.');
          return this.admin(action);
        }),
      { rate: { burst: 12, perSecond: 4 }, maxBytes: 8 * 1024 },
    );
  }

  private admin(action: TournamentAdminAction): string {
    const e = this.engine;
    switch (action.action) {
      case 'updateConfig': {
        const merged = { ...e.data.config, ...action.config };
        merged.name = cleanName(merged.name);
        const parsed = TournamentConfigSchema.safeParse(merged);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new TournamentError('invalid', issue?.message ?? 'Those settings are not valid.');
        }
        const gameChanged = parsed.data.gameId !== e.data.config.gameId;
        e.updateConfig(parsed.data);
        this.updateSettings(parsed.data);
        this.state.roomName = parsed.data.name.slice(0, LIMITS.roomName);
        if (gameChanged) this.refreshRatings();
        return 'Settings saved.';
      }
      case 'openRegistration':
        e.openRegistration();
        return 'Registration is open.';
      case 'closeRegistration':
        e.closeRegistration();
        return 'Registration closed.';
      case 'openCheckIn':
        e.openCheckIn();
        if (!this.settings.checkIn) this.updateSettings({ ...this.settings, checkIn: true });
        return 'Check-in is open.';
      case 'closeCheckIn':
        e.closeCheckIn();
        return 'Check-in closed.';
      case 'checkInParticipant':
        e.setCheckIn(action.participantId, action.checkedIn, 'organizer');
        return action.checkedIn ? 'Checked in.' : 'Check-in removed.';
      case 'seed':
        this.refreshRatings();
        e.seed(action.method, action.order);
        return 'Seeds updated.';
      case 'begin':
        this.refreshRatings();
        e.begin();
        return 'The tournament has started!';
      case 'pause':
        e.pause();
        return 'New matches are paused.';
      case 'resume':
        e.resume();
        return 'Resumed.';
      case 'forfeit':
        e.forfeit(action.matchId, action.participantId, cleanReason(action.reason), 'organizer');
        return 'Forfeit recorded.';
      case 'disqualify':
        e.disqualify(action.participantId, cleanReason(action.reason));
        if (!e.participant(action.participantId)) this.forgetParticipant(action.participantId);
        return 'Participant disqualified.';
      case 'override':
        e.override(action.matchId, action.outcome, action.winnerId ?? null, cleanReason(action.reason));
        return 'Result recorded.';
      case 'relaunchMatch': {
        const m = e.match(action.matchId);
        if (!m || (m.status !== 'READY' && m.status !== 'IN_PROGRESS')) throw new TournamentError('not_allowed', 'That match is not being played.');
        const entry = this.rooms.get(m.id);
        if (entry) this.closeMatchRoom(m.id, entry, 'The organizer opened a fresh room for this match.');
        this.launchFailures.delete(m.id);
        e.note('organizer', 'relaunch', `${m.label}: match room reopened by the organizer.`, { matchId: m.id });
        return 'A fresh match room is opening.';
      }
      case 'end':
        e.end(cleanReason(action.reason));
        return 'The tournament is complete.';
      case 'cancel':
        e.cancel(cleanReason(action.reason));
        return 'The tournament was cancelled.';
    }
  }

  /** Run a tournament action: ack the sender, then publish every consequence. */
  private run(p: PlayerRecord, action: string, requestId: string | undefined, fn: () => string): void {
    let ack: TournamentAck;
    try {
      const message = fn();
      ack = { action, ok: true, message };
    } catch (err) {
      if (err instanceof TournamentError) ack = { action, ok: false, message: err.message };
      else {
        log.error('tournament action failed', { room: this.roomId, action, err: err as Error });
        ack = { action, ok: false, message: 'Something went wrong — please try again.' };
      }
    }
    if (requestId) ack.requestId = requestId;
    this.afterChange();
    // Flush the state patch first so the client already sees the result when its ack arrives.
    this.broadcastPatch();
    this.sendTo(p, TOURNAMENT_MSG.ack, ack);
  }

  // ===========================================================================
  // TournamentHost — callbacks from bound match rooms (in-process)
  // ===========================================================================

  listing(): TournamentListing | null {
    const d = this.engine.data;
    if (this.disposing || d.config.visibility !== 'public' || d.status === 'DRAFT' || d.status === 'CANCELLED') return null;
    const inField = PRE_START.has(d.status)
      ? this.engine.entries()
      : d.participants.filter((p) => p.seed > 0 && !['withdrawn', 'disqualified', 'no_show'].includes(p.status));
    return {
      code: this.roomId,
      name: d.config.name,
      gameId: d.config.gameId,
      format: d.config.format,
      status: d.status,
      paused: d.paused,
      bestOf: d.config.bestOf,
      participants: inField.length,
      checkedIn: d.participants.filter((p) => p.checkedIn).length,
      maxField: d.config.maxField,
      checkIn: d.config.checkIn,
      currentRound: this.engine.currentRound(),
      totalRounds: d.totalRounds,
      stageLabel: this.engine.stageLabel(),
      organizerName: this.state.organizerName,
      viewers: this.clients.length,
      liveMatches: [...this.rooms.values()].filter((r) => r.roomCode).length,
      createdAt: d.createdAt,
    };
  }

  matchRoomStatus(matchId: string, roomCode: string, status: MatchRoomStatus): void {
    const entry = this.rooms.get(matchId);
    if (!entry || entry.roomCode !== roomCode) return;
    entry.present = new Set(status.present.filter((pid) => pid === entry.a || pid === entry.b));
    entry.waiting = status.waiting;
    const oneWaiting = status.waiting && entry.present.size === 1;
    if (oneWaiting && !entry.waitingSince) entry.waitingSince = Date.now();
    if (!oneWaiting) entry.waitingSince = 0;
    this.syncState();
  }

  matchGameStarted(matchId: string, roomCode: string): void {
    const entry = this.rooms.get(matchId);
    if (!entry || entry.roomCode !== roomCode) return;
    entry.waiting = false;
    entry.waitingSince = 0;
    this.engine.markStarted(matchId);
    this.afterChange();
  }

  matchGameOutcome(matchId: string, roomCode: string, gameNumber: number, winner: string | null, reason: string): void {
    const entry = this.rooms.get(matchId);
    if (!entry || entry.roomCode !== roomCode) {
      log.warn('tournament result from a stale match room ignored', { code: this.roomId, match: matchId, room: roomCode });
      return;
    }
    const result = this.engine.recordGame(matchId, gameNumber, winner, reason);
    if (!result.accepted) {
      log.warn('tournament result ignored', { code: this.roomId, match: matchId, game: gameNumber, reason: result.reason });
      return;
    }
    const m = this.engine.match(matchId)!;
    const bound = getBoundRoom(this.roomId, matchId);
    const sameRoom = bound && bound.roomCode === roomCode ? bound : undefined;
    if (isFinished(m)) {
      // Decided by play: the room shows the result; stop tracking it (it closes when everyone leaves).
      this.rooms.delete(matchId);
      sameRoom?.applySeries({ status: 'decided', info: this.matchInfo(m) });
    } else {
      sameRoom?.applySeries({ status: 'next', info: this.matchInfo(m) });
    }
    this.afterChange();
  }

  matchRoomClosed(matchId: string, roomCode: string): void {
    if (this.disposing) return;
    const entry = this.rooms.get(matchId);
    if (!entry || entry.roomCode !== roomCode) return;
    this.rooms.delete(matchId);
    const m = this.engine.match(matchId);
    if (m && (m.status === 'READY' || m.status === 'IN_PROGRESS')) {
      this.engine.note('system', 'relaunch', `${m.label}: the match room closed unexpectedly — reopening it (series score kept).`, { matchId });
    }
    this.afterChange();
  }

  // ===========================================================================
  // Match rooms
  // ===========================================================================

  /** Open rooms for live matches; close rooms whose match was decided elsewhere or re-derived. */
  private reconcileRooms(): void {
    if (this.disposing) return;
    const now = Date.now();
    for (const [matchId, entry] of [...this.rooms]) {
      const m = this.engine.match(matchId);
      const live = m && (m.status === 'READY' || m.status === 'IN_PROGRESS') && m.a === entry.a && m.b === entry.b;
      if (!live) this.closeMatchRoom(matchId, entry, m ? closingMessage(this.engine, m) : 'This match was re-paired.');
    }
    if (this.engine.status !== 'IN_PROGRESS') return;
    for (const m of this.engine.data.matches) {
      if ((m.status !== 'READY' && m.status !== 'IN_PROGRESS') || this.rooms.has(m.id)) continue;
      const failure = this.launchFailures.get(m.id);
      if (failure && failure.retryAt > now) continue;
      this.launch(m);
    }
  }

  private launch(m: EngineMatch): void {
    const entry: MatchRoomEntry = { attempt: ++this.attemptSeq, roomCode: '', a: m.a!, b: m.b!, present: new Set(), waiting: true, waitingSince: 0 };
    this.rooms.set(m.id, entry);
    const config = this.engine.data.config;
    const ticketMap: Record<string, string> = {};
    for (const [pid, ticket] of this.ticketsFor(m)) ticketMap[ticket] = pid;
    const key = createMatchBinding({
      tournamentCode: this.roomId,
      matchId: m.id,
      attempt: entry.attempt,
      gameId: config.gameId,
      info: this.matchInfo(m),
      tickets: ticketMap,
      reconnectGraceSeconds: MATCH_RECONNECT_GRACE_S,
    });
    const options = {
      name: 'Tournament',
      roomName: m.label.slice(0, LIMITS.roomName),
      settings: config.gameSettings,
      maxPlayers: 2,
      [MATCH_BINDING_OPTION]: key,
    };
    matchMaker
      .handleCreateRoom(config.gameId, options)
      .then((cache) => {
        if (this.disposing || this.rooms.get(m.id) !== entry) {
          // Superseded while the room was being created (match decided / tournament closed).
          void matchMaker.getLocalRoomById(cache.roomId)?.disconnect();
          return;
        }
        entry.roomCode = cache.roomId;
        this.launchFailures.delete(m.id);
        this.afterChange();
      })
      .catch((err: unknown) => {
        if (this.rooms.get(m.id) === entry) this.rooms.delete(m.id);
        if (this.disposing) return;
        const prev = this.launchFailures.get(m.id)?.count ?? 0;
        const count = prev + 1;
        this.launchFailures.set(m.id, { count, retryAt: Date.now() + LAUNCH_RETRY_MS[Math.min(count - 1, LAUNCH_RETRY_MS.length - 1)]! });
        log.error('tournament match room failed to open', { code: this.roomId, match: m.id, game: config.gameId, err: err as Error });
        if (count === 3) {
          this.engine.note('system', 'room_failed', `${m.label}: the match room could not be opened. Retrying — the organizer can also decide the match manually.`, { matchId: m.id });
          this.afterChange();
        }
      });
  }

  private closeMatchRoom(matchId: string, entry: MatchRoomEntry, message: string): void {
    this.rooms.delete(matchId);
    const bound = getBoundRoom(this.roomId, matchId);
    const m = this.engine.match(matchId);
    if (bound && entry.roomCode && bound.roomCode === entry.roomCode && m) {
      bound.applySeries({ status: 'closed', info: this.matchInfo(m), message });
    } else if (entry.roomCode) {
      void matchMaker.getLocalRoomById(entry.roomCode)?.disconnect();
    }
  }

  /** Tickets are per match and participant, and survive room relaunches. */
  private ticketsFor(m: EngineMatch): Map<string, string> {
    let map = this.tickets.get(m.id);
    if (!map) {
      map = new Map();
      this.tickets.set(m.id, map);
    }
    for (const pid of [m.a, m.b]) if (pid && !map.has(pid)) map.set(pid, randomId(32, this.rng));
    return map;
  }

  /** Public match info for the bound room (`tournamentJson`). */
  private matchInfo(m: EngineMatch): TournamentMatchInfo {
    const config = this.engine.data.config;
    const next = this.engine.nextGame(m);
    const series = this.engine.series(m);
    const finished = isFinished(m);
    const participant = (pid: string) => this.engine.participant(pid);
    return {
      tournamentCode: this.roomId,
      tournamentName: config.name,
      matchId: m.id,
      roundLabel: m.roundLabel,
      format: config.format,
      bestOf: m.bestOf,
      gameNumber: next?.n ?? Math.max(1, m.games.length),
      decider: next?.decider ?? '',
      seriesScore: series ? { ...series.points } : {},
      seriesStatus: finished ? 'decided' : 'waiting',
      nextGameAt: 0,
      result: finished ? { winnerId: m.winner, kind: m.resultKind ?? 'played', note: m.resultNote } : null,
      participants: [m.a, m.b]
        .filter((pid): pid is string => Boolean(pid))
        .map((pid) => ({
          participantId: pid,
          name: participant(pid)?.name ?? 'Player',
          seed: participant(pid)?.seed ?? 0,
          playerId: null,
          ...(this.engine.sides && next?.firstId ? { side: next.firstId === pid ? ('first' as const) : ('second' as const) } : {}),
        })),
    };
  }

  // ===========================================================================
  // Ticking: check-in deadline, no-shows, launch retries, idle cleanup
  // ===========================================================================

  private tick(): void {
    if (this.disposing) return;
    const now = Date.now();
    let changed = this.engine.tick(now);
    const noShowMs = this.noShowMs();
    if (noShowMs > 0 && this.engine.status === 'IN_PROGRESS') {
      for (const [matchId, entry] of [...this.rooms]) {
        if (!entry.waitingSince || now - entry.waitingSince < noShowMs) continue;
        const absent = [entry.a, entry.b].find((pid) => !entry.present.has(pid));
        if (!absent) continue;
        try {
          this.engine.forfeit(matchId, absent, 'did not show up', 'system');
          changed = true;
        } catch (err) {
          log.warn('no-show forfeit failed', { code: this.roomId, match: matchId, err: err as Error });
          entry.waitingSince = 0;
        }
      }
    }
    for (const f of this.launchFailures.values()) if (f.retryAt <= now) changed = true;
    if (changed) this.afterChange();
    this.checkIdle(now);
  }

  private checkIdle(now: number): void {
    if (this.clients.length > 0) {
      this.idleSince = 0;
      return;
    }
    if (!this.idleSince) this.idleSince = now;
    const idle = now - this.idleSince;
    if (this.isTerminal()) {
      if (idle >= terminalIdleMs()) void this.disconnect();
      return;
    }
    const someonePlaying = [...this.rooms.values()].some((r) => r.present.size > 0);
    if (idle >= ABANDONED_IDLE_MS && !someonePlaying) {
      this.engine.cancel('Nobody was here for six hours.');
      this.afterChange();
      void this.disconnect();
    }
  }

  // ===========================================================================
  // State mirroring
  // ===========================================================================

  private afterChange(): void {
    if (this.disposing) return;
    for (const event of this.engine.drainEvents()) this.broadcast(TOURNAMENT_MSG.event, event);
    this.reconcileRooms();
    this.syncState();
    this.sendMeAll();
    this.schedulePersist();
  }

  private syncState(): void {
    const d = this.engine.data;
    const st = this.state;
    const standings = this.engine.standings();
    const rows = new Map(standings.rows.map((r) => [r.participantId, r]));
    const online = new Set<string>();
    for (const p of this.players.values()) {
      const pid = this.boundParticipant(p);
      if (pid && p.client) online.add(pid);
    }
    assign(st, 'status', d.status);
    assign(st, 'paused', d.paused);
    assign(st, 'organizerId', this.organizerPlayerId ?? '');
    assign(st, 'seedingMethod', d.seedingMethod ?? '');
    assign(st, 'currentRound', this.engine.currentRound());
    assign(st, 'totalRounds', d.totalRounds);
    assign(st, 'championId', d.championId ?? '');
    assign(st, 'checkInEndsAt', d.checkInEndsAt);
    assign(st, 'createdAt', d.createdAt);
    assign(st, 'startedAt', d.startedAt);
    assign(st, 'completedAt', d.completedAt);

    const seen = new Set<string>();
    for (const p of d.participants) {
      seen.add(p.id);
      let view = st.participants.get(p.id);
      if (!view) {
        view = new TParticipant();
        view.id = p.id;
        st.participants.set(p.id, view);
      }
      const row = rows.get(p.id);
      const table = d.config.format === 'round_robin' || d.config.format === 'swiss';
      assign(view, 'name', p.name);
      assign(view, 'avatar', p.avatar);
      assign(view, 'seed', p.seed);
      assign(view, 'status', p.status);
      assign(view, 'checkedIn', p.checkedIn);
      assign(view, 'rating', Math.max(0, Math.min(65535, Math.round(p.rating))));
      assign(view, 'provisional', p.provisional);
      assign(view, 'entry', p.entry);
      assign(view, 'online', online.has(p.id));
      assign(view, 'place', row && (!table || d.status === 'COMPLETE') ? row.rank : 0);
      assign(view, 'points', row?.points ?? 0);
      assign(view, 'wins', row?.wins ?? 0);
      assign(view, 'draws', row?.draws ?? 0);
      assign(view, 'losses', row?.losses ?? 0);
      assign(view, 'byes', p.byes);
      assign(view, 'currentMatchId', this.engine.activeMatchFor(p.id)?.id ?? '');
    }
    for (const id of [...st.participants.keys()]) if (!seen.has(id)) st.participants.delete(id);

    const noShowMs = this.noShowMs();
    const matchIds = new Set<string>();
    const byId = new Map(d.matches.map((m) => [m.id, m]));
    const fieldSize = d.participants.filter((p) => p.seed > 0).length;
    for (const m of d.matches) {
      matchIds.add(m.id);
      let view = st.matches.get(m.id);
      if (!view) {
        view = new TMatch();
        view.id = m.id;
        st.matches.set(m.id, view);
      }
      const live = m.status === 'READY' || m.status === 'IN_PROGRESS';
      const next = live ? this.engine.nextGame(m) : null;
      const series = this.engine.series(m);
      const entry = this.rooms.get(m.id);
      assign(view, 'bracket', m.bracket);
      assign(view, 'round', m.round);
      assign(view, 'order', m.order);
      assign(view, 'label', m.label);
      assign(view, 'roundLabel', m.roundLabel);
      assign(view, 'status', m.status);
      assign(view, 'aId', m.a ?? '');
      assign(view, 'bId', m.b ?? '');
      assign(view, 'aLabel', slotLabel(m, 0, byId, fieldSize));
      assign(view, 'bLabel', slotLabel(m, 1, byId, fieldSize));
      assign(view, 'aFrom', sourceMatch(m.sources[0], m));
      assign(view, 'bFrom', sourceMatch(m.sources[1], m));
      assign(view, 'aFromTake', sourceTake(m.sources[0], m));
      assign(view, 'bFromTake', sourceTake(m.sources[1], m));
      assign(view, 'nextMatchId', m.next?.matchId ?? '');
      assign(view, 'nextSlot', m.next ? (m.next.slot === 0 ? 'a' : 'b') : '');
      assign(view, 'loserNextMatchId', m.loserNext?.matchId ?? '');
      assign(view, 'loserNextSlot', m.loserNext ? (m.loserNext.slot === 0 ? 'a' : 'b') : '');
      assign(view, 'conditional', m.conditional);
      assign(view, 'bestOf', m.bestOf);
      assign(view, 'gameNumber', next?.n ?? m.games.length);
      assign(view, 'aPoints', (m.a && series?.points[m.a]) || 0);
      assign(view, 'bPoints', (m.b && series?.points[m.b]) || 0);
      assign(
        view,
        'gamesJson',
        JSON.stringify(m.games.map((g): TournamentGameRecord => ({ n: g.n, winnerId: g.winnerId, firstId: g.firstId, decider: g.decider, reason: g.reason, at: g.at }))),
      );
      assign(view, 'winnerId', m.winner ?? '');
      assign(view, 'loserId', m.loser ?? '');
      assign(view, 'draw', m.draw);
      assign(view, 'resultKind', m.resultKind ?? '');
      assign(view, 'resultNote', m.resultNote);
      assign(view, 'firstId', m.firstId ?? '');
      assign(view, 'decider', next?.decider ?? '');
      assign(view, 'roomCode', entry?.roomCode ?? '');
      assign(view, 'aPresent', Boolean(entry && m.a && entry.present.has(m.a)));
      assign(view, 'bPresent', Boolean(entry && m.b && entry.present.has(m.b)));
      assign(view, 'noShowAt', entry && entry.waitingSince && noShowMs > 0 ? entry.waitingSince + noShowMs : 0);
      assign(view, 'startedAt', m.startedAt);
      assign(view, 'completedAt', m.completedAt);
    }
    for (const id of [...st.matches.keys()]) if (!matchIds.has(id)) st.matches.delete(id);

    assign(st, 'roundsJson', JSON.stringify(this.engine.rounds()));
    assign(st, 'standingsJson', JSON.stringify(standings));
    assign(st, 'auditJson', JSON.stringify(d.audit.slice(-TOURNAMENT_LIMITS.audit)));
    this.markMetadataDirty();
  }

  private meFor(player: PlayerRecord): TournamentMe {
    const pid = this.boundParticipant(player);
    const isOrganizer = player.id === this.organizerPlayerId;
    let activeMatch: TournamentMe['activeMatch'] = null;
    if (pid) {
      const m = this.engine.activeMatchFor(pid);
      const entry = m ? this.rooms.get(m.id) : undefined;
      const ticket = m ? this.tickets.get(m.id)?.get(pid) : undefined;
      if (m && entry?.roomCode && ticket) {
        const opponentId = m.a === pid ? m.b : m.a;
        const next = this.engine.nextGame(m);
        activeMatch = {
          matchId: m.id,
          gameId: this.engine.data.config.gameId,
          roomCode: entry.roomCode,
          ticket,
          label: m.label,
          opponentId,
          opponentName: opponentId ? (this.engine.participant(opponentId)?.name ?? 'Opponent') : 'Opponent',
          side: this.engine.sides && next?.firstId ? (next.firstId === pid ? 'first' : 'second') : null,
        };
      }
    }
    return {
      isOrganizer,
      organizerToken: isOrganizer ? this.organizerToken : null,
      participantId: pid,
      participantToken: pid ? (this.tokens.get(pid) ?? null) : null,
      activeMatch,
    };
  }

  private sendMe(player: PlayerRecord): void {
    if (!player.client) return;
    const me = this.meFor(player);
    const json = JSON.stringify(me);
    if (this.lastMe.get(player.id) === json) return;
    this.lastMe.set(player.id, json);
    this.sendTo(player, TOURNAMENT_MSG.me, me);
  }

  private sendMeAll(): void {
    for (const p of this.players.values()) this.sendMe(p);
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    const wait = Math.max(0, this.lastPersistAt + PERSIST_EVERY_MS - Date.now());
    this.persistTimer = this.clock.setTimeout(() => {
      this.persistTimer = null;
      this.lastPersistAt = Date.now();
      void tournamentStore.save(this.tournamentId, this.roomId, this.engine.data);
    }, wait);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private setOrganizer(player: PlayerRecord): void {
    this.organizerPlayerId = player.id;
    this.state.organizerId = player.id;
    this.state.organizerName = player.state.name;
    this.assignHost(player);
    this.lastMe.clear();
  }

  private boundParticipant(player: PlayerRecord): string | null {
    const pid = player.data.participantId;
    if (typeof pid !== 'string' || !this.engine.participant(pid)) return null;
    return pid;
  }

  private requireBound(player: PlayerRecord): string {
    const pid = this.boundParticipant(player);
    if (!pid) throw new TournamentError('not_allowed', 'Register (or use your tournament pass) first.');
    return pid;
  }

  /** A participant entry was deleted (withdrew before the start): drop its secrets and bindings. */
  private forgetParticipant(pid: string): void {
    this.tokens.delete(pid);
    for (const p of this.players.values()) if (p.data.participantId === pid) delete p.data.participantId;
  }

  private refreshRatings(): void {
    const gameId = this.engine.data.config.gameId;
    for (const p of this.engine.data.participants) {
      if (!p.identity) continue;
      const r = getRating(p.identity, gameId);
      this.engine.setRating(p.id, r.rating, r.games, isProvisional(r));
    }
  }

  /** No-show window. Non-production environments may shorten it (tests) with DASCADE_TOURNAMENT_NOSHOW_MS. */
  private noShowMs(): number {
    const minutes = this.engine.data.config.noShowMinutes;
    if (minutes <= 0) return 0;
    const override = Number(process.env.DASCADE_TOURNAMENT_NOSHOW_MS);
    if (process.env.NODE_ENV !== 'production' && process.env.DASCADE_TOURNAMENT_NOSHOW_MS !== undefined && override > 0) return override;
    return minutes * 60_000;
  }

  private isTerminal(): boolean {
    return this.engine.status === 'COMPLETE' || this.engine.status === 'CANCELLED';
  }
}

/** Non-production environments may shorten the finished-tournament idle window (tests) with DASCADE_TOURNAMENT_IDLE_MS. */
function terminalIdleMs(): number {
  const raw = process.env.DASCADE_TOURNAMENT_IDLE_MS;
  if (process.env.NODE_ENV !== 'production' && raw !== undefined && Number(raw) > 0) return Number(raw);
  return TERMINAL_IDLE_MS;
}

function cleanName(raw: string): string {
  return maskProfanity(cleanText(raw, TOURNAMENT_LIMITS.name)) || 'DASCADE Tournament';
}

function cleanReason(raw: string): string {
  return maskProfanity(cleanText(raw, TOURNAMENT_LIMITS.reason)) || 'No reason given';
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Assign only when changed (keeps Schema patches minimal). */
function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] !== value) target[key] = value;
}

function sourceMatch(src: SlotSource | null, m: EngineMatch): string {
  if (!src || src.kind === 'seed' || m.conditional) return '';
  return src.matchId;
}

function sourceTake(src: SlotSource | null, m: EngineMatch): string {
  if (!src || src.kind === 'seed' || m.conditional) return '';
  return src.kind;
}

function slotLabel(m: EngineMatch, slot: 0 | 1, byId: Map<string, EngineMatch>, fieldSize: number): string {
  const pid = slot === 0 ? m.a : m.b;
  const src = m.sources[slot];
  if (m.conditional) return slot === 0 ? 'Winners-bracket champion' : 'Losers-bracket champion';
  if (!src) return pid ? '' : m.resultKind === 'bye' || m.status === 'VOID' ? 'Bye' : '';
  if (src.kind === 'seed') return !pid && src.seed > fieldSize && fieldSize > 0 ? 'Bye' : `Seed ${src.seed}`;
  const from = byId.get(src.matchId);
  if (!pid && from && isFinished(from)) return 'Bye';
  return `${src.kind === 'winner' ? 'Winner' : 'Loser'} of ${src.matchId}`;
}

function closingMessage(engine: TournamentEngine, m: EngineMatch): string {
  if (m.status === 'VOID') return m.resultNote ? `This match is void (${m.resultNote.toLowerCase()}).` : 'This match is void.';
  if (isFinished(m)) {
    const winner = m.winner ? engine.participant(m.winner)?.name : null;
    const how = m.resultKind === 'forfeit' ? 'by forfeit' : m.resultKind === 'dq' ? '(opponent out of the tournament)' : 'by organizer decision';
    return winner ? `${winner} wins this match ${how}.` : 'This match was decided without a winner.';
  }
  return 'The pairing for this match changed.';
}
