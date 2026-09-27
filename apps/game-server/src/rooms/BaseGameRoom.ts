/**
 * BaseGameRoom — the one shared multiplayer lifecycle for every DASCADE game.
 *
 * Owns: room codes, join/rejoin, logical player identity (playerId ≠ sessionId),
 * reconnect grace + seat-token rejoin, host migration, lobby controls, settings,
 * phases/countdown, chat, validated + rate-limited messages, private messaging,
 * timers and match summaries.
 *
 * Game rooms extend this class and implement the protected hooks. Do NOT override
 * the Colyseus lifecycle methods (onCreate/onJoin/onDrop/onReconnect/onLeave/onDispose)
 * — use the hooks below instead.
 *
 * Concurrency rule: message handlers must be synchronous with respect to game
 * state. Never mutate state after an `await` without re-validating the phase.
 */
import { Room, ServerError, CloseCode, type Client, type AuthContext, type Delayed, type Deferred } from '@colyseus/core';
import type { z } from 'zod';
import {
  AVATARS,
  CHAT,
  CreateOptionsSchema,
  ChatSendSchema,
  DEFAULT_COUNTDOWN_MS,
  EmptySchema,
  GAME_CATALOG,
  HOST_MIGRATION_DELAY_MS,
  JoinErrorCode,
  JoinOptionsSchema,
  KeyedRateLimiter,
  LIMITS,
  LOBBY,
  PLAYER_COLORS,
  ProfileSchema,
  RATE,
  RECONNECT_GRACE_SECONDS,
  ReadySchema,
  RoomCloseCode,
  RoomUpdateSchema,
  SYS,
  SettingsUpdateSchema,
  SpectateSchema,
  StartSchema,
  TargetPlayerSchema,
  TimeSyncRequestSchema,
  TokenBucket,
  cleanNickname,
  cleanText,
  createCryptoRng,
  maskProfanity,
  randomId,
  type ActionErrorCode,
  type Avatar,
  type ChatKind,
  type ChatMessage,
  type CreateOptions,
  type GameCatalogEntry,
  type GameId,
  type GameOutcome,
  type JoinOptions,
  type Phase,
  type RateSpec,
  type RemovedPayload,
  type Rng,
  type RoomMetadata,
  type ToastKind,
  type TournamentMatchInfo,
  type WelcomePayload,
} from '@dascade/shared';
import { isProvisional, type Rating } from '@dascade/game-core/rating';
import { PlayerState, type BaseRoomState } from '../schema/base.ts';
import { primeRoomStateContext } from '../schema/typeContext.ts';
import { allocateRoomCode, releaseRoomCode } from '../lib/roomCodes.ts';
import { clientIpFromAuth, ipRateKey } from '../lib/clientIp.ts';
import { log } from '../lib/log.ts';
import { config } from '../config.ts';
import { matchSink, type MatchSummary } from '../persistence/index.ts';
import { emitOutcome, type OutcomePlayer } from '../platform/hub.ts';
import { getRating, ratingIdentity } from '../platform/ratings.ts';
import {
  MATCH_BINDING_OPTION,
  consumeMatchBinding,
  getTournament,
  registerBoundRoom,
  unregisterBoundRoom,
  type BoundMatchRoom,
  type SeriesUpdate,
} from '../platform/tournaments.ts';

export interface PlayerRecord {
  /** Stable logical id for the lifetime of the room. Use this for all game state. */
  readonly id: string;
  /** Secret the client stores to reclaim this seat after a refresh / long disconnect. */
  readonly seatToken: string;
  guestId?: string;
  /** Verified Supabase user id (only when persistence is configured). */
  userId?: string;
  /** Current transport session (null while away). */
  sessionId: string | null;
  client: Client | null;
  /** The synchronized public player object in state.players. */
  readonly state: PlayerState;
  /** Grace period expired mid-match; seat retained for seat-token rejoin. */
  away: boolean;
  readonly joinedAt: number;
  /** Per-message-type rate buckets. */
  readonly buckets: Map<string, TokenBucket>;
  /** Scratch space for game rooms (e.g. cached private view). */
  data: Record<string, unknown>;
}

export type RemovalReason = 'left' | 'kicked' | 'disconnected' | 'room_closed';

export interface MessageOptions {
  /** Token bucket spec (defaults to RATE.action). */
  rate?: RateSpec;
  /** Share a bucket between several message types. */
  bucket?: string;
  /** Only accepted in these phases. */
  phases?: readonly Phase[];
  /** Only the host may send it. */
  hostOnly?: boolean;
  /** Spectators may not send it. */
  playersOnly?: boolean;
  /** Don't reply with sys:error on rejection (use for high-frequency streams). */
  silent?: boolean;
  /**
   * Reject payloads whose JSON encoding exceeds this many characters before running the Zod
   * schema (a cheap guard for handlers that accept arrays/strings, e.g. drawing batches).
   */
  maxBytes?: number;
}

type Handler<T> = (player: PlayerRecord, payload: T, client: Client) => void;

/** A player's DASCADE rating for this room's game (see @dascade/game-core/rating). */
export interface PlayerRating extends Rating {
  provisional: boolean;
}

// Per-IP matchmaking throttles. Generous on purpose: whole offices often share one public IP.
let ipLimiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 300, perSecond: 5 });
let createLimiter = new KeyedRateLimiter(config.relaxedLimits ? { burst: 5000, perSecond: 500 } : { burst: 40, perSecond: 1 });

/** Override matchmaking throttles (tests). */
export function setMatchmakingLimits(join: RateSpec, create: RateSpec): void {
  ipLimiter = new KeyedRateLimiter(join);
  createLimiter = new KeyedRateLimiter(create);
}

export abstract class BaseGameRoom<
  S extends BaseRoomState = BaseRoomState,
  Settings extends object = Record<string, unknown>,
> extends Room<{ state: S; metadata: RoomMetadata }> {
  // ---------------------------------------------------------------------------
  // Required by subclasses
  // ---------------------------------------------------------------------------
  abstract readonly gameId: GameId;
  /** Zod schema validating the COMPLETE settings object. */
  protected abstract readonly settingsSchema: z.ZodType<Settings>;
  protected abstract defaultSettings(): Settings;
  /** Return a fresh instance of the game's state class (extends BaseRoomState). */
  protected abstract createState(): S;
  /** Called when the countdown finishes and the phase becomes PLAYING. */
  protected abstract onGameStart(): void;

  // ---------------------------------------------------------------------------
  // Tunables for subclasses
  // ---------------------------------------------------------------------------
  /** Pre-game countdown length (0 = start immediately). */
  protected countdownMs = DEFAULT_COUNTDOWN_MS;
  /** Phases in which the host may change settings. */
  protected settingsEditablePhases: readonly Phase[] = ['LOBBY'];
  /** Seconds a dropped client may resume its session. */
  protected reconnectGraceSeconds = RECONNECT_GRACE_SECONDS;
  /** How long a disconnected host keeps host powers. */
  protected hostMigrationDelayMs = HOST_MIGRATION_DELAY_MS;
  /** Max serialized settings size accepted from clients. */
  protected maxSettingsBytes = 64 * 1024;

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------
  protected settings!: Settings;
  /** Cryptographically strong RNG for everything that decides gameplay. */
  protected readonly rng: Rng = createCryptoRng();
  protected catalog!: GameCatalogEntry;
  protected isSolo = false;
  protected matchStartedAt = 0;
  /** Set when the Tournament Center created this room for one of its matches (see tournamentMatch). */
  protected tournamentInfo: TournamentMatchInfo | null = null;
  /** Increments every time a match starts; reportOutcome() accepts one outcome per match. */
  private matchSerial = 0;
  private outcomeReportedFor = -1;
  /** Seated players of the current match (kept even if they leave, for outcomes/forfeits). */
  private matchRoster = new Map<string, OutcomePlayer>();
  /** Server-only Tournament Center binding (see "Tournament Center binding" below). */
  private tournamentBinding: TournamentBindingState | null = null;
  /** Platform timers (tournament series) — kept out of `timers` so games' clearAllTimers() can't cancel them. */
  private readonly platformTimers = new Map<string, Delayed>();
  /** Whether `lobby:ready` means anything in this room (the Tournament Center kiosk turns it off). */
  protected lobbyReadyEnabled = true;

  /** All player records keyed by logical player id (includes spectators and away players). */
  protected readonly players = new Map<string, PlayerRecord>();
  private readonly bySession = new Map<string, PlayerRecord>();
  private readonly pendingReconnects = new Map<string, Deferred<Client>>();
  private readonly timers = new Map<string, Delayed>();
  private readonly banned = new Set<string>();
  /** Sessions kicked while disconnected (in their reconnect grace period). */
  private readonly kickedSessions = new Set<string>();
  /** Host migration is platform-owned: kept out of `timers` so games' clearAllTimers()/returnToLobby() can't cancel it. */
  private hostMigrationTimer: Delayed | null = null;
  private emptyMatchCheck: Delayed | null = null;
  private chatLog: ChatMessage[] = [];
  private joinCounter = 0;
  private codeAllocated = false;
  private metadataDirty = false;
  private unknownTypeWarned = new Set<string>();
  /** Per-room byte budget for host settings updates (each one is re-broadcast to everyone). */
  private readonly settingsBytes = new TokenBucket(SETTINGS_BYTE_BUDGET);

  // ===========================================================================
  // Optional hooks (override in game rooms)
  // ===========================================================================
  /** Room created; register game message handlers here with this.handle(...). */
  protected onRoomCreated(_options: CreateOptions): void {}
  /**
   * The phase just became COUNTDOWN (host pressed Start / startMatch()), before the countdown timer
   * runs: build the match's start state here (grid, seats…) so clients can render it during 3-2-1.
   * Not called when `countdownMs` is 0 — onGameStart() follows immediately then.
   */
  protected onCountdownStart(): void {}
  /** A brand-new player joined (not a rejoin). `lateJoin` = joined outside LOBBY. */
  protected onPlayerJoined(_player: PlayerRecord, _info: { lateJoin: boolean }): void {}
  /** Transport dropped; the player may come back within the grace period. */
  protected onPlayerDisconnected(_player: PlayerRecord): void {}
  /** Player resumed (Colyseus reconnect or seat-token rejoin). Private state is re-sent via syncPrivate afterwards. */
  protected onPlayerReconnected(_player: PlayerRecord): void {}
  /** Grace period expired mid-match. Seat retained; they may rejoin later with their seat token. */
  protected onPlayerAway(_player: PlayerRecord): void {}
  /** Player permanently removed (left, kicked, or disconnected outside a match). */
  protected onPlayerRemoved(_player: PlayerRecord, _reason: RemovalReason): void {}
  protected onHostChanged(_next: PlayerRecord | null, _prev: PlayerRecord | null): void {}
  /** Return a human-readable reason to block starting, or null to allow. */
  protected validateStart(): string | null {
    return null;
  }
  /**
   * Return a human-readable reason to refuse a host settings change right now (checked after
   * `settingsEditablePhases`), or null to allow — e.g. a solo run in progress whose board or
   * scoring depends on the settings it started with.
   */
  protected settingsLockReason(): string | null {
    return null;
  }
  protected onSettingsChanged(_prev: Settings, _next: Settings): void {}
  /** Host returned the room to the lobby (reset game state here). */
  protected onReturnToLobby(): void {}
  /** Re-send every piece of private information this player should currently see. */
  protected syncPrivate(_player: PlayerRecord): void {}
  /** Return true to consume a chat line (e.g. DASketch guesses) instead of broadcasting it. */
  protected interceptChat(_player: PlayerRecord, _text: string): boolean {
    return false;
  }
  protected onRoomDisposed(): void {}
  /**
   * Whether a player may be *given* the host role (transfer or migration). Default: anyone in the
   * lobby/results; mid-match only seated players, so a spectator can't gain host-only powers
   * (spins, deals, "next round") in the middle of a game. A host keeps the role once held.
   */
  protected canBecomeHost(player: PlayerRecord): boolean {
    return !player.state.spectator || !IN_MATCH_PHASES.has(this.phase);
  }
  /**
   * Return a reason to refuse a host kick, or null to allow it. Hidden-team games override this so a
   * host can't remove opponents mid-match to swing the result (moderation still works in the lobby).
   */
  protected kickBlocker(_target: PlayerRecord): string | null {
    return null;
  }
  /**
   * The host is ending a match in progress ("Back to lobby" or closing the room mid-game). Games whose
   * result matters settle it here before the match is torn down (e.g. a playing host concedes, so a
   * losing host can't erase a rated game), or return a reason to refuse. Default: allowed, no result.
   */
  protected hostEndsMatch(_host: PlayerRecord): string | null {
    return null;
  }
  /**
   * Casual rooms of a rated game may opt in to rating changes (e.g. a "Rated" lobby toggle).
   * Tournament matches of rated games are always rated.
   */
  protected ratedOptIn(): boolean {
    return false;
  }

  // ===========================================================================
  // Colyseus lifecycle (do not override in game rooms)
  // ===========================================================================

  /** Per-IP matchmaking throttle (applies to create/join before a seat is reserved). */
  static override async onAuth(_token: string, _options: unknown, context: AuthContext): Promise<boolean> {
    // Never trust client-supplied X-Forwarded-For / X-Real-IP here (Colyseus' context.ip does):
    // the HTTP server stamps the socket address (or the trusted proxy hop) — see server.ts.
    const ip = ipRateKey(clientIpFromAuth(context));
    if (!ipLimiter.take(ip)) {
      throw new ServerError(JoinErrorCode.RATE_LIMITED, 'Too many attempts — please wait a moment and try again.');
    }
    const url = String((context.req as { url?: string } | undefined)?.url ?? '');
    if (url.includes('/create/') && !createLimiter.take(ip)) {
      throw new ServerError(JoinErrorCode.RATE_LIMITED, 'You are creating rooms too quickly — please wait a moment.');
    }
    return true;
  }

  override async onCreate(rawOptions: unknown): Promise<void> {
    const parsed = CreateOptionsSchema.safeParse(rawOptions ?? {});
    const options: CreateOptions = parsed.success ? parsed.data : { name: 'Player' };
    this.catalog = GAME_CATALOG[this.gameId];

    const code = await allocateRoomCode(this.presence, this.rng);
    this.codeAllocated = true;
    this.roomId = code;

    this.isSolo = Boolean(options.solo && this.catalog.capacity.supportsSolo);
    if (this.reconnectGraceSeconds === RECONNECT_GRACE_SECONDS && this.catalog.reconnectGraceSeconds) {
      this.reconnectGraceSeconds = this.catalog.reconnectGraceSeconds;
    }
    const cap = this.catalog.capacity;
    this.maxClients = cap.maxRoomSize;
    // Hard per-connection ceiling; Colyseus disconnects (it can't drop) above it. Fairness comes from
    // the per-handler token buckets in handle(); this only stops floods. Generous enough that a
    // stalled streaming client (e.g. 30 Hz input) flushing a few seconds of buffered frames at once
    // isn't kicked right after a network hiccup.
    this.maxMessagesPerSecond = 240;
    this.autoDispose = true;

    const state = this.createState();
    state.gameId = this.gameId;
    state.code = code;
    state.phase = 'LOBBY';
    state.allowSpectators = cap.supportsSpectators && !this.isSolo;
    state.locked = this.isSolo;
    state.maxPlayers = this.isSolo
      ? 1
      : clamp(options.maxPlayers ?? cap.defaultMaxPlayers, Math.max(1, cap.minPlayers), cap.maxPlayersLimit);
    const fallbackName = `${cleanNickname(options.name, LIMITS.nickname)}'s ${this.catalog.title}`;
    // Same profanity masking as a lobby rename (the name is public, e.g. via /api/rooms/:code).
    state.roomName = maskProfanity(cleanText(options.roomName ?? '', LIMITS.roomName) || (this.isSolo ? `Solo ${this.catalog.title}` : fallbackName));
    // Describe only this room's schema types to joining clients (not every cabinet's; see typeContext.ts).
    primeRoomStateContext(state);
    this.state = state;

    this.settings = this.defaultSettings();
    const defaults = this.settings;
    if (options.settings && JSON.stringify(options.settings).length <= this.maxSettingsBytes) {
      const merged = this.settingsSchema.safeParse({ ...this.settings, ...options.settings });
      if (merged.success) this.settings = merged.data;
    }
    this.publishSettings();
    this.bindTournament(rawOptions);
    this.registerBaseMessages();
    // Unknown message types: Colyseus would drop the client in production. A stale or buggy client
    // shouldn't lose its seat over it, so ignore them (logged once per type).
    this.onMessage('*', (_client: Client, type: string | number) => {
      const key = String(type).slice(0, 64);
      if (this.unknownTypeWarned.size < 50 && !this.unknownTypeWarned.has(key)) {
        this.unknownTypeWarned.add(key);
        log.warn('unknown message type ignored', { room: this.roomId, game: this.gameId, type: key });
      }
    });
    this.onRoomCreated(options);
    // Create-time settings go through the same hook as lobby edits (after handlers are registered).
    if (this.settings !== defaults) this.safeHook(() => this.onSettingsChanged(defaults, this.settings), 'onSettingsChanged');
    this.markMetadataDirty();
    this.flushMetadata();
    this.clock.setInterval(() => this.flushMetadata(), 1000);
  }

  override onJoin(client: Client, rawOptions: unknown): void {
    const parsed = JoinOptionsSchema.safeParse(rawOptions ?? {});
    if (!parsed.success) throw new ServerError(JoinErrorCode.INVALID_OPTIONS, 'Invalid join request.');
    const options = parsed.data;

    // The host closed the room: nobody (re)joins while it shuts down.
    if (this.state.phase === 'ENDED') throw new ServerError(JoinErrorCode.MATCH_ENDED, 'This match has already ended.');

    // --- Rejoin an existing seat with its secret token -----------------------
    if (options.seatToken) {
      const existing = [...this.players.values()].find((p) => p.seatToken === options.seatToken);
      if (existing) {
        this.rebind(existing, client);
        return;
      }
    }

    // Tournament match rooms: a valid ticket seats its participant; everyone else spectates.
    if (this.tournamentBinding) {
      this.joinTournamentMatch(client, options);
      return;
    }

    if (options.seatToken && this.banned.has(options.seatToken)) this.rejectKicked();
    if (options.guestId && this.banned.has(`guest:${options.guestId}`)) this.rejectKicked();
    if (this.state.locked && !(this.isSolo && this.players.size === 0)) {
      throw new ServerError(JoinErrorCode.ROOM_LOCKED, 'This room is locked by the host.');
    }

    const inMatch = this.state.phase !== 'LOBBY';
    const seated = this.seatedCount();
    let spectator = Boolean(options.spectator) && this.state.allowSpectators;
    let queued = false;
    let notice: string | null = null;
    if (!spectator) {
      if (seated >= this.state.maxPlayers) {
        if (!this.state.allowSpectators) throw new ServerError(JoinErrorCode.ROOM_FULL, 'This room is full.');
        spectator = true;
        notice = 'The room is full, so you joined as a spectator.';
      } else if (inMatch && !this.catalog.capacity.lateJoinAsPlayer) {
        if (!this.state.allowSpectators) throw new ServerError(JoinErrorCode.ROOM_LOCKED, 'This match is already in progress.');
        spectator = true;
        queued = true;
        notice = 'A match is in progress — you are spectating and will be dealt in next round.';
      }
    }

    const record = this.createRecord(client, options, spectator, queued);
    this.claimHostIfOrphaned(record);

    this.sendWelcome(record, false);
    this.sendChatHistory(record);
    this.systemChat(`${record.state.name} joined${spectator ? ' as a spectator' : ''}.`);
    if (notice) this.toast(record, 'info', notice);
    this.markMetadataDirty();
    // Game hooks must not be able to abort a join half-way (the record already exists).
    this.safeHook(() => this.onPlayerJoined(record, { lateJoin: inMatch }), 'onPlayerJoined');
    this.safeHook(() => this.syncPrivate(record), 'syncPrivate');

    if (options.accessToken) void this.verifyAccount(record, options.accessToken);
  }

  override onDrop(client: Client): void {
    const record = this.bySession.get(client.sessionId);
    if (!record || record.sessionId !== client.sessionId) return;
    record.state.connected = false;
    record.client = null;
    if (record.id === this.state.hostId) this.scheduleHostMigration();
    this.safeHook(() => this.onPlayerDisconnected(record), 'onPlayerDisconnected');
    this.markMetadataDirty();
    this.tournamentPresenceChanged();

    const deferred = this.allowReconnection(client, this.reconnectGraceSeconds);
    this.pendingReconnects.set(client.sessionId, deferred);
    // The deferred rejects on timeout; onLeave handles the outcome.
    void Promise.resolve(deferred).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    this.pendingReconnects.delete(client.sessionId);
    if (this.state.phase === 'ENDED') {
      client.leave(RoomCloseCode.ROOM_CLOSED);
      return;
    }
    const record = this.bySession.get(client.sessionId);
    if (!record || record.sessionId !== client.sessionId) {
      if (this.kickedSessions.delete(client.sessionId)) {
        // Kicked while disconnected: tell the client why instead of a generic "seat moved" close.
        client.leave(RoomCloseCode.KICKED);
        return;
      }
      // Seat was re-claimed from another tab/session meanwhile; drop this stale session.
      client.leave(CloseCode.CONSENTED);
      return;
    }
    record.client = client;
    record.away = false;
    record.state.connected = true;
    this.claimHostIfOrphaned(record);
    this.markMetadataDirty();
    this.sendWelcome(record, true);
    this.sendChatHistory(record);
    this.safeHook(() => this.onPlayerReconnected(record), 'onPlayerReconnected');
    this.safeHook(() => this.syncPrivate(record), 'syncPrivate');
    this.tournamentPresenceChanged();
  }

  override onLeave(client: Client, code?: number): void {
    this.pendingReconnects.delete(client.sessionId);
    this.kickedSessions.delete(client.sessionId);
    const record = this.bySession.get(client.sessionId);
    this.bySession.delete(client.sessionId);
    if (!record || record.sessionId !== client.sessionId) return;

    const consented = code === CloseCode.CONSENTED;
    const inMatch = this.state.phase !== 'LOBBY' && this.state.phase !== 'RESULTS' && this.state.phase !== 'ENDED';
    if (consented || !inMatch || record.state.spectator) {
      this.removePlayer(record, consented ? 'left' : 'disconnected');
      return;
    }

    // Grace expired mid-match: keep the seat so they can come back with their token.
    record.sessionId = null;
    record.client = null;
    record.away = true;
    record.state.connected = false;
    if (record.id === this.state.hostId) this.migrateHost();
    this.systemChat(`${record.state.name} lost connection.`);
    this.safeHook(() => this.onPlayerAway(record), 'onPlayerAway');
    this.markMetadataDirty();
    this.tournamentPresenceChanged();
  }

  override async onDispose(): Promise<void> {
    this.clearAllTimers();
    this.disposeTournamentBinding();
    this.cancelHostMigration();
    this.emptyMatchCheck?.clear();
    this.emptyMatchCheck = null;
    this.safeHook(() => this.onRoomDisposed(), 'onRoomDisposed');
    if (this.codeAllocated) await releaseRoomCode(this.presence, this.roomId).catch(() => undefined);
  }

  override onUncaughtException(error: unknown, methodName: string): void {
    // Colyseus also reports deliberate join refusals (room locked or full, kicked, match over, rate
    // limited) here, wrapped around our ServerError: those are answers to the player, not faults.
    const cause = error instanceof Error ? error.cause : undefined;
    if ((methodName === 'onJoin' || methodName === 'onAuth') && cause instanceof ServerError) {
      log.debug('join refused', { room: this.roomId, game: this.gameId, code: cause.code, reason: cause.message });
      return;
    }
    log.error('room exception', { room: this.roomId, game: this.gameId, methodName, error: error as Error });
  }

  // ===========================================================================
  // Messaging helpers for game rooms
  // ===========================================================================

  /**
   * Register a validated, rate-limited, phase/role-guarded message handler.
   * The handler receives the resolved PlayerRecord (never trust ids in payloads).
   */
  protected handle<T>(type: string, schema: z.ZodType<T>, handler: Handler<T>, opts: MessageOptions = {}): void {
    const rate = opts.rate ?? RATE.action;
    this.onMessage(type, (client: Client, raw: unknown) => {
      const player = this.bySession.get(client.sessionId);
      if (!player || player.client !== client) return;
      const bucketKey = opts.bucket ?? type;
      let bucket = player.buckets.get(bucketKey);
      if (!bucket) {
        bucket = new TokenBucket(rate);
        player.buckets.set(bucketKey, bucket);
      }
      if (!bucket.take()) {
        if (!opts.silent) this.reject(client, type, 'rate_limited', 'Whoa — slow down a little!');
        return;
      }
      // Cheap role/phase guards first, so spectators or wrong-phase streams never cost a full parse.
      if (opts.phases && !opts.phases.includes(this.state.phase as Phase)) {
        if (!opts.silent) this.reject(client, type, 'wrong_phase', 'That action is not available right now.');
        return;
      }
      if (opts.hostOnly && player.id !== this.state.hostId) {
        if (!opts.silent) this.reject(client, type, 'not_host', 'Only the host can do that.');
        return;
      }
      if (opts.playersOnly && player.state.spectator) {
        if (!opts.silent) this.reject(client, type, 'not_allowed', 'Spectators cannot do that.');
        return;
      }
      if (opts.maxBytes !== undefined && jsonLength(raw) > opts.maxBytes) {
        if (!opts.silent) this.reject(client, type, 'invalid_payload', 'That action is too large.');
        return;
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        if (!opts.silent) this.reject(client, type, 'invalid_payload', 'That action could not be understood.');
        return;
      }
      try {
        const result = handler.call(this, player, parsed.data, client) as unknown;
        if (result instanceof Promise) {
          result.catch((err: unknown) => this.handlerFailed(client, type, err));
        }
      } catch (err) {
        this.handlerFailed(client, type, err);
      }
    });
  }

  /** Send a private message to one player (no-op if they are disconnected). */
  protected sendTo(player: PlayerRecord | string, type: string, payload?: unknown): void {
    const record = typeof player === 'string' ? this.players.get(player) : player;
    record?.client?.send(type, payload);
  }

  /** Send to every connected player matching a predicate. */
  protected sendWhere(predicate: (p: PlayerRecord) => boolean, type: string, payload?: unknown): void {
    for (const p of this.players.values()) if (p.client && predicate(p)) p.client.send(type, payload);
  }

  /** Reply to a specific client that an action was rejected. */
  protected reject(target: Client | PlayerRecord, type: string | undefined, code: ActionErrorCode, message: string): void {
    const client = 'send' in target ? target : target.client;
    client?.send(SYS.error, { type, code, message });
  }

  protected toast(target: PlayerRecord | 'all', kind: ToastKind, text: string): void {
    if (target === 'all') this.broadcast(SYS.toast, { kind, text });
    else this.sendTo(target, SYS.toast, { kind, text });
  }

  /** Post a system line in room chat. */
  protected systemChat(text: string, kind: ChatKind = 'system'): void {
    this.pushChat({ id: randomId(10), playerId: null, name: 'DASCADE', text, ts: Date.now(), kind });
  }

  /** Post a chat line on behalf of a player, optionally only to some recipients. */
  protected pushChat(message: ChatMessage, recipients?: (p: PlayerRecord) => boolean): void {
    if (recipients) {
      this.sendWhere(recipients, CHAT.msg, message);
      return;
    }
    this.chatLog.push(message);
    if (this.chatLog.length > LIMITS.chatHistory) this.chatLog.splice(0, this.chatLog.length - LIMITS.chatHistory);
    this.broadcast(CHAT.msg, message);
  }

  // ===========================================================================
  // Phase + match helpers
  // ===========================================================================

  protected get phase(): Phase {
    return this.state.phase as Phase;
  }

  /** Change lifecycle phase; optional timer is published as phaseEndsAt (server epoch ms). */
  protected setPhase(phase: Phase, durationMs = 0): void {
    this.state.phase = phase;
    this.state.phaseEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
    this.markMetadataDirty();
    // Results/lobby need a connected host ("Play again"); mid-match a spectator couldn't take the
    // role, but now anyone connected can.
    if (phase === 'RESULTS') this.repairHost();
  }

  /** Publish a timer end (server epoch ms) without changing phase. */
  protected setTimer(durationMs: number): void {
    this.state.phaseEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
  }

  /** Programmatic start (used by solo modes). Bypasses host checks, not validateStart. */
  protected startMatch(): boolean {
    if (this.phase !== 'LOBBY') return false;
    const reason = this.startBlocker();
    if (reason) return false;
    this.beginCountdown();
    return true;
  }

  /** End the match: RESULTS phase + optional stats summary. */
  protected endMatch(summary?: Omit<MatchSummary, 'gameId' | 'roomCode' | 'startedAt' | 'endedAt'>): void {
    this.cancel('phase');
    this.setPhase('RESULTS');
    if (summary && !this.isSolo) {
      void matchSink.record({
        ...summary,
        gameId: this.gameId,
        roomCode: this.roomId,
        startedAt: this.matchStartedAt,
        endedAt: Date.now(),
      });
    }
  }

  /**
   * Report the structured result of ONE finished game (call it when the game ends, alongside
   * endMatch()). The platform uses it for DASCADE ratings, stats and Tournament Center series and
   * bracket advancement. Accepted once per match — later calls for the same match are ignored, so
   * a duplicate timer or message can never advance a tournament twice.
   */
  protected reportOutcome(outcome: GameOutcome): void {
    if (this.outcomeReportedFor === this.matchSerial) {
      log.warn('duplicate outcome ignored', { room: this.roomId, game: this.gameId });
      return;
    }
    // Everyone who was seated at the start plus anyone seated mid-match (late joiners, promoted queue).
    const roster = new Map(this.matchRoster);
    for (const p of this.seatedPlayers()) {
      if (!roster.has(p.id)) roster.set(p.id, { playerId: p.id, name: p.state.name, guestId: p.guestId, userId: p.userId, spectator: false });
    }
    const seen = new Set<string>();
    const placements = outcome.placements
      .map((group) => group.filter((id) => roster.has(id) && !seen.has(id) && (seen.add(id), true)))
      .filter((group) => group.length > 0);
    if (placements.length === 0) return;
    this.outcomeReportedFor = this.matchSerial;
    emitOutcome(
      { ...outcome, placements },
      {
        gameId: this.gameId,
        roomCode: this.roomId,
        rated: this.isRatedMatch(),
        players: roster,
        tournament: this.tournamentInfo ? structuredClone(this.tournamentInfo) : null,
        startedAt: this.matchStartedAt,
        endedAt: Date.now(),
      },
    );
    this.afterTournamentOutcome();
  }

  /**
   * Room player ids of players seated when the current match started who have since left the room,
   * so a game can still list them in its outcome (usually as the last group).
   */
  protected matchLeaverIds(): string[] {
    return [...this.matchRoster.keys()].filter((id) => !this.players.has(id));
  }

  /** The Tournament Center match this room is playing, or null for ordinary rooms. */
  protected get tournamentMatch(): TournamentMatchInfo | null {
    return this.tournamentInfo;
  }

  /** Whether the current match changes DASCADE ratings. */
  protected isRatedMatch(): boolean {
    return Boolean(this.catalog.rated) && !this.isSolo && (this.tournamentInfo !== null || this.ratedOptIn());
  }

  /** A player's current DASCADE rating for this game (default rating for anonymous players). */
  protected ratingOf(player: PlayerRecord): PlayerRating {
    const rating = getRating(ratingIdentity(player), this.gameId);
    return { ...rating, provisional: isProvisional(rating) };
  }

  /**
   * Reset to LOBBY: clears timers, drops away players, resets readies, promotes queued spectators,
   * then calls onReturnToLobby(). The phase is LOBBY *before* away players are removed, so games'
   * onPlayerRemoved takes its lobby path instead of replaying mid-match logic (e.g. ending a turn);
   * onReturnToLobby still runs last and sees the final lobby roster.
   */
  protected returnToLobby(): void {
    this.clearAllTimers();
    this.state.round = 0;
    this.state.statusText = '';
    this.setPhase('LOBBY');
    for (const p of [...this.players.values()]) {
      if (p.away) this.removePlayer(p, 'disconnected');
    }
    for (const p of this.players.values()) {
      p.state.ready = false;
      if (p.state.queued) {
        p.state.queued = false;
        if (this.seatedCount() < this.state.maxPlayers) p.state.spectator = false;
      }
    }
    this.safeHook(() => this.onReturnToLobby(), 'onReturnToLobby');
    this.repairHost();
    this.tournamentReturnedToLobby();
  }

  /** Seat queued spectators now (e.g. between poker hands). Returns promoted players. */
  protected promoteQueued(): PlayerRecord[] {
    const promoted: PlayerRecord[] = [];
    for (const p of this.players.values()) {
      if (p.state.queued && p.client && this.seatedCount() < this.state.maxPlayers) {
        p.state.queued = false;
        p.state.spectator = false;
        promoted.push(p);
      }
    }
    if (promoted.length) this.markMetadataDirty();
    return promoted;
  }

  // ===========================================================================
  // Player queries
  // ===========================================================================

  protected getPlayer(id: string): PlayerRecord | undefined {
    return this.players.get(id);
  }

  protected playerForClient(client: Client): PlayerRecord | undefined {
    return this.bySession.get(client.sessionId);
  }

  /** Non-spectator players (connected or temporarily disconnected/away), in join order. */
  protected seatedPlayers(): PlayerRecord[] {
    return [...this.players.values()].filter((p) => !p.state.spectator).sort((a, b) => a.state.joinOrder - b.state.joinOrder);
  }

  /** Non-spectators with a live connection, in join order. */
  protected activePlayers(): PlayerRecord[] {
    return this.seatedPlayers().filter((p) => p.client !== null);
  }

  protected isHost(player: PlayerRecord): boolean {
    return player.id === this.state.hostId;
  }

  protected get hostRecord(): PlayerRecord | undefined {
    return this.players.get(this.state.hostId);
  }

  protected getSettings(): Settings {
    return this.settings;
  }

  /** Replace settings from game code (e.g. wheel removing a winner). Re-validates and publishes. */
  protected updateSettings(next: Settings): void {
    const parsed = this.settingsSchema.safeParse(next);
    if (!parsed.success) {
      log.warn('updateSettings rejected invalid settings', { game: this.gameId });
      return;
    }
    const prev = this.settings;
    this.settings = parsed.data;
    this.publishSettings();
    this.safeHook(() => this.onSettingsChanged(prev, this.settings), 'onSettingsChanged');
  }

  // ===========================================================================
  // Timers (auto-cleared on dispose / returnToLobby)
  // ===========================================================================

  /** Schedule a named timeout; re-scheduling the same key replaces it. */
  protected schedule(key: string, ms: number, fn: () => void): void {
    this.cancel(key);
    const delayed = this.clock.setTimeout(() => {
      this.timers.delete(key);
      try {
        fn();
      } catch (err) {
        log.error('timer failed', { room: this.roomId, key, err: err as Error });
      }
    }, Math.max(0, ms));
    this.timers.set(key, delayed);
  }

  protected cancel(key: string): void {
    this.timers.get(key)?.clear();
    this.timers.delete(key);
  }

  protected isScheduled(key: string): boolean {
    return this.timers.has(key);
  }

  protected clearAllTimers(): void {
    for (const t of this.timers.values()) t.clear();
    this.timers.clear();
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private registerBaseMessages(): void {
    this.handle(
      SYS.time,
      TimeSyncRequestSchema,
      (_p, { t0 }, client) => client.send(SYS.time, { t0, server: Date.now() }),
      { rate: { burst: 10, perSecond: 2 }, silent: true },
    );

    this.handle(
      LOBBY.ready,
      ReadySchema,
      (p, { ready }) => {
        if (!this.lobbyReadyEnabled || this.tournamentBinding) {
          return this.reject(p, LOBBY.ready, 'not_allowed', this.tournamentBinding ? 'Tournament games start automatically.' : 'There is nothing to get ready for here.');
        }
        p.state.ready = ready && !p.state.spectator;
      },
      { phases: ['LOBBY'] },
    );

    this.handle(
      LOBBY.spectate,
      SpectateSchema,
      (p, { spectator }) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.spectate, 'not_allowed', 'Seats in a tournament match are fixed.');
        if (spectator) {
          if (!this.state.allowSpectators) return this.reject(p, LOBBY.spectate, 'not_allowed', 'Spectating is disabled in this room.');
          p.state.spectator = true;
          p.state.ready = false;
        } else {
          if (!p.state.spectator) return;
          if (this.seatedCount() >= this.state.maxPlayers) return this.reject(p, LOBBY.spectate, 'not_allowed', 'All player seats are taken.');
          p.state.spectator = false;
        }
        if (p.id === this.state.hostId || !this.hostRecord) this.ensureHost();
        this.markMetadataDirty();
      },
      { phases: ['LOBBY'] },
    );

    this.handle(
      LOBBY.profile,
      ProfileSchema,
      (p, { name, avatar }) => {
        if (name !== undefined && this.tournamentBinding) return this.reject(p, LOBBY.profile, 'not_allowed', 'Tournament players keep their registered names.');
        if (name !== undefined) {
          const clean = this.uniqueName(maskProfanity(cleanNickname(name, LIMITS.nickname)), p.id);
          if (clean !== p.state.name) {
            this.systemChat(`${p.state.name} is now ${clean}.`);
            p.state.name = clean;
          }
        }
        if (avatar !== undefined) p.state.avatar = avatar;
      },
      { phases: ['LOBBY', 'RESULTS'] },
    );

    this.handle(
      LOBBY.settings,
      SettingsUpdateSchema,
      (p, { settings }) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.settings, 'not_allowed', 'Tournament match settings are set by the organizer.');
        if (!this.settingsEditablePhases.includes(this.phase)) {
          return this.reject(p, LOBBY.settings, 'wrong_phase', 'Settings are locked right now.');
        }
        const lockReason = this.settingsLockReason();
        if (lockReason) return this.reject(p, LOBBY.settings, 'wrong_phase', lockReason);
        if (JSON.stringify(settings).length > this.maxSettingsBytes) {
          return this.reject(p, LOBBY.settings, 'invalid_payload', 'Those settings are too large.');
        }
        const parsed = this.settingsSchema.safeParse({ ...this.settings, ...settings });
        if (parsed.success) {
          // Every change re-broadcasts the whole settings JSON to every client: budget bytes, not just messages.
          const bytes = JSON.stringify(parsed.data).length;
          if (!this.settingsBytes.take(Math.min(bytes, SETTINGS_BYTE_BUDGET.burst))) {
            return this.reject(p, LOBBY.settings, 'rate_limited', 'Settings are changing too fast — give it a second.');
          }
        }
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
          return this.reject(p, LOBBY.settings, 'invalid_payload', `Invalid settings — ${where}${issue?.message ?? 'check your values'}`);
        }
        const prev = this.settings;
        this.settings = parsed.data;
        this.publishSettings();
        this.safeHook(() => this.onSettingsChanged(prev, this.settings), 'onSettingsChanged');
      },
      { hostOnly: true, rate: { burst: 20, perSecond: 5 } },
    );

    this.handle(
      LOBBY.room,
      RoomUpdateSchema,
      (p, update) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.room, 'not_allowed', 'Tournament match rooms are managed by the Tournament Center.');
        // Mid-match renames are refused: the name is visible to everyone and could leak hidden
        // information (e.g. a host broadcasting the DASketch word).
        if (update.roomName !== undefined && IN_MATCH_PHASES.has(this.phase)) {
          return this.reject(p, LOBBY.room, 'wrong_phase', 'The room name can only change between matches.');
        }
        if (update.roomName !== undefined) {
          const name = maskProfanity(cleanText(update.roomName, LIMITS.roomName));
          if (name) this.state.roomName = name;
        }
        if (update.locked !== undefined && !this.isSolo) this.state.locked = update.locked;
        if (update.allowSpectators !== undefined && this.catalog.capacity.supportsSpectators && !this.isSolo) {
          this.state.allowSpectators = update.allowSpectators;
        }
        if (update.maxPlayers !== undefined) {
          if (this.phase !== 'LOBBY') return this.reject(p, LOBBY.room, 'wrong_phase', 'Player limit can only change in the lobby.');
          const cap = this.catalog.capacity;
          const floor = Math.max(cap.minPlayers, this.seatedCount(), 1);
          this.state.maxPlayers = clamp(update.maxPlayers, floor, cap.maxPlayersLimit);
        }
        this.markMetadataDirty();
      },
      { hostOnly: true },
    );

    this.handle(
      LOBBY.kick,
      TargetPlayerSchema,
      (p, { playerId }) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.kick, 'not_allowed', 'Nobody can be removed from a tournament match.');
        const target = this.players.get(playerId);
        if (!target || target.id === p.id) return;
        const blocked = this.kickBlocker(target);
        if (blocked) return this.reject(p, LOBBY.kick, 'not_allowed', blocked);
        this.banned.add(target.seatToken);
        if (target.guestId) this.banned.add(`guest:${target.guestId}`);
        const payload: RemovedPayload = { reason: 'kicked', message: 'The host removed you from the room.' };
        const client = target.client;
        // Disconnected (in grace): remember the session so an auto-reconnect is told it was kicked.
        if (!client && target.sessionId && this.pendingReconnects.has(target.sessionId)) this.kickedSessions.add(target.sessionId);
        client?.send(SYS.removed, payload);
        this.removePlayer(target, 'kicked');
        if (client) this.clock.setTimeout(() => client.leave(RoomCloseCode.KICKED), 50);
      },
      { hostOnly: true },
    );

    this.handle(
      LOBBY.transferHost,
      TargetPlayerSchema,
      (p, { playerId }) => {
        const target = this.players.get(playerId);
        if (!target || !target.client) return;
        if (!this.hostEligible(target)) {
          return this.reject(p, LOBBY.transferHost, 'not_allowed', 'Spectators can take over as host after this match.');
        }
        this.setHost(target);
      },
      { hostOnly: true },
    );

    this.handle(
      LOBBY.start,
      StartSchema,
      (p) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.start, 'not_allowed', 'Tournament games start automatically when both players are here.');
        const reason = this.startBlocker();
        if (reason) return this.reject(p, LOBBY.start, 'not_allowed', reason);
        this.beginCountdown();
      },
      { hostOnly: true, phases: ['LOBBY'] },
    );

    this.handle(
      LOBBY.toLobby,
      EmptySchema,
      (p) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.toLobby, 'not_allowed', 'The tournament runs this match — the next game starts automatically.');
        if (this.phase === 'LOBBY' || this.phase === 'ENDED') return;
        if (IN_MATCH_PHASES.has(this.phase)) {
          const blocked = this.hostEndsMatch(p);
          if (blocked) return this.reject(p, LOBBY.toLobby, 'not_allowed', blocked);
        }
        this.returnToLobby();
      },
      { hostOnly: true },
    );

    this.handle(
      LOBBY.close,
      EmptySchema,
      (p) => {
        if (this.tournamentBinding) return this.reject(p, LOBBY.close, 'not_allowed', 'Tournament match rooms close by themselves when the match is over.');
        if (IN_MATCH_PHASES.has(this.phase)) {
          const blocked = this.hostEndsMatch(p);
          if (blocked) return this.reject(p, LOBBY.close, 'not_allowed', blocked);
        }
        this.closeRoom();
      },
      { hostOnly: true },
    );

    this.handle(
      CHAT.send,
      ChatSendSchema,
      (p, { text }) => {
        const clean = cleanText(text, LIMITS.chat);
        if (!clean) return;
        if (this.interceptChat(p, clean)) return;
        this.pushChat({
          id: randomId(10),
          playerId: p.id,
          name: p.state.name,
          color: p.state.color,
          text: maskProfanity(clean),
          ts: Date.now(),
          kind: 'chat',
        });
      },
      { rate: RATE.chat },
    );
  }

  /** Host closes the room for everyone. */
  protected closeRoom(): void {
    this.setPhase('ENDED');
    const payload: RemovedPayload = { reason: 'room_closed', message: 'The host closed this room.' };
    this.broadcast(SYS.removed, payload);
    this.clock.setTimeout(() => void this.disconnect(RoomCloseCode.ROOM_CLOSED), 150);
  }

  private startBlocker(): string | null {
    const tournament = this.tournamentStartBlocker();
    if (tournament) return tournament;
    const active = this.activePlayers().length;
    const min = this.catalog.capacity.minPlayers;
    if (active < min) return `Need at least ${min} player${min === 1 ? '' : 's'} to start.`;
    return this.validateStart();
  }

  private beginCountdown(): void {
    this.state.round = 0;
    for (const p of this.players.values()) p.state.score = 0;
    const start = () => {
      this.matchStartedAt = Date.now();
      this.matchSerial++;
      this.matchRoster = new Map(
        this.seatedPlayers().map((p) => [
          p.id,
          { playerId: p.id, name: p.state.name, guestId: p.guestId, userId: p.userId, spectator: false },
        ]),
      );
      this.setPhase('PLAYING');
      this.tournamentGameStarted();
      this.safeHook(() => this.onGameStart(), 'onGameStart');
    };
    if (this.countdownMs > 0) {
      this.setPhase('COUNTDOWN', this.countdownMs);
      this.safeHook(() => this.onCountdownStart(), 'onCountdownStart');
      // The hook may have cancelled the start (e.g. returned to the lobby).
      if (this.phase === 'COUNTDOWN') this.schedule('phase', this.countdownMs, start);
    } else start();
  }

  private createRecord(client: Client, options: JoinOptions, spectator: boolean, queued: boolean): PlayerRecord {
    const ps = new PlayerState();
    const id = randomId(12, this.rng);
    ps.id = id;
    ps.name = this.uniqueName(maskProfanity(cleanNickname(options.name, LIMITS.nickname)));
    ps.avatar = options.avatar ?? (AVATARS[this.joinCounter % AVATARS.length] as Avatar);
    ps.color = this.nextColor();
    ps.spectator = spectator;
    ps.queued = queued;
    ps.connected = true;
    ps.joinOrder = ++this.joinCounter;
    const record: PlayerRecord = {
      id,
      seatToken: randomId(24, this.rng),
      guestId: options.guestId,
      sessionId: client.sessionId,
      client,
      state: ps,
      away: false,
      joinedAt: Date.now(),
      buckets: new Map(),
      data: {},
    };
    this.players.set(id, record);
    this.bySession.set(client.sessionId, record);
    this.state.players.set(id, ps);
    return record;
  }

  /** Attach a new transport session to an existing seat (seat-token rejoin, duplicate tab, or after away). */
  private rebind(record: PlayerRecord, client: Client): void {
    const previousSession = record.sessionId;
    const previousClient = record.client;
    if (previousSession) {
      this.bySession.delete(previousSession);
      const pending = this.pendingReconnects.get(previousSession);
      if (pending) {
        this.pendingReconnects.delete(previousSession);
        // allowReconnection() may return a plain rejected Promise (e.g. client dropped mid-handshake).
        if (typeof (pending as Partial<Deferred<Client>>).reject === 'function') pending.reject(new Error('seat reclaimed'));
      }
    }
    if (previousClient && previousClient !== client) {
      previousClient.send(SYS.toast, { kind: 'info', text: 'You opened this seat somewhere else.' });
      previousClient.leave(CloseCode.CONSENTED);
    }
    record.sessionId = client.sessionId;
    record.client = client;
    record.away = false;
    record.state.connected = true;
    this.bySession.set(client.sessionId, record);
    this.claimHostIfOrphaned(record);
    this.markMetadataDirty();
    this.sendWelcome(record, true);
    this.sendChatHistory(record);
    this.safeHook(() => this.onPlayerReconnected(record), 'onPlayerReconnected');
    this.safeHook(() => this.syncPrivate(record), 'syncPrivate');
    this.tournamentPresenceChanged();
  }

  /** Permanently remove a player record. */
  protected removePlayer(record: PlayerRecord, reason: RemovalReason): void {
    if (!this.players.has(record.id)) return;
    this.players.delete(record.id);
    if (record.sessionId) this.bySession.delete(record.sessionId);
    this.state.players.delete(record.id);
    const wasHost = record.id === this.state.hostId;
    if (wasHost) {
      this.state.hostId = '';
      this.cancelHostMigration();
    }
    if (reason === 'kicked') this.systemChat(`${record.state.name} was removed by the host.`);
    else if (reason !== 'room_closed') this.systemChat(`${record.state.name} left.`);
    this.safeHook(() => this.onPlayerRemoved(record, reason), 'onPlayerRemoved');
    if (wasHost) this.migrateHost();
    this.markMetadataDirty();
    this.forgetTournamentSeat(record);
    if (!record.state.spectator) this.checkEmptyMatch();
  }

  /**
   * A match nobody is seated in any more (everyone left or was kicked; only spectators remain)
   * can never finish: return it to the lobby. Deferred so it never re-enters game hooks.
   */
  private checkEmptyMatch(): void {
    if (this.emptyMatchCheck || !IN_MATCH_PHASES.has(this.phase)) return;
    this.emptyMatchCheck = this.clock.setTimeout(() => {
      this.emptyMatchCheck = null;
      if (!IN_MATCH_PHASES.has(this.phase) || this.seatedPlayers().length > 0 || this.players.size === 0) return;
      this.systemChat('Everyone left the match — back to the lobby.');
      this.returnToLobby();
    }, 0);
  }

  private setHost(next: PlayerRecord | null): void {
    const prev = this.hostRecord ?? null;
    if (prev === next) return;
    const prevHostId = this.state.hostId;
    if (prev) prev.state.isHost = false;
    this.state.hostId = next?.id ?? '';
    if (next) {
      next.state.isHost = true;
      if (prev) this.systemChat(`${next.state.name} is now the host.`);
      // A hand-over is news; the player who creates the room doesn't need a toast saying they host it.
      if (prevHostId && prevHostId !== next.id) this.toast(next, 'info', 'You are now the host.');
    }
    this.cancelHostMigration();
    this.safeHook(() => this.onHostChanged(next, prev), 'onHostChanged');
  }

  /**
   * Move host to the best connected candidate (players before spectators, then join order).
   * With no connected candidate the current host keeps the role (e.g. a solo player or a whole
   * room on flaky Wi-Fi) — whoever comes back first reclaims it via claimHostIfOrphaned().
   */
  protected migrateHost(): void {
    const current = this.hostRecord;
    if (current?.client) return;
    const candidates = [...this.players.values()]
      .filter((p) => p.client && !p.away && this.hostEligible(p))
      .sort((a, b) => Number(a.state.spectator) - Number(b.state.spectator) || a.state.joinOrder - b.state.joinOrder);
    const next = candidates[0];
    if (next) this.setHost(next);
    else if (!current && this.state.hostId) this.setHost(null);
  }

  private ensureHost(): void {
    if (!this.hostRecord?.client) this.migrateHost();
  }

  /** A player (re)connected: take over an empty host role, or one whose holder is gone with no migration pending. */
  private claimHostIfOrphaned(record: PlayerRecord): void {
    const host = this.hostRecord;
    if (!host) {
      if (this.hostEligible(record)) this.setHost(record);
      return;
    }
    if (host === record) {
      this.cancelHostMigration();
      return;
    }
    if (!host.client && !this.hostMigrationTimer) this.migrateHost();
  }

  /** Make sure a connected host exists unless a (delayed) migration is already pending. */
  private repairHost(): void {
    const host = this.hostRecord;
    if (host?.client || (host && this.hostMigrationTimer)) return;
    this.migrateHost();
  }

  private scheduleHostMigration(): void {
    this.cancelHostMigration();
    this.hostMigrationTimer = this.clock.setTimeout(() => {
      this.hostMigrationTimer = null;
      this.migrateHost();
    }, Math.max(0, this.hostMigrationDelayMs));
  }

  private cancelHostMigration(): void {
    this.hostMigrationTimer?.clear();
    this.hostMigrationTimer = null;
  }

  private seatedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.state.spectator) n++;
    return n;
  }

  private uniqueName(base: string, selfId?: string): string {
    // Reserve the system sender's name so nobody can impersonate platform messages.
    if (RESERVED_NAMES.has(base.toLowerCase().replace(/[^a-z]/g, ''))) base = 'Player';
    const taken = new Set([...this.players.values()].filter((p) => p.id !== selfId).map((p) => p.state.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    // Slice by code point so emoji / astral characters are never split into lone surrogates.
    const chars = Array.from(base);
    for (let i = 2; i < 100; i++) {
      const candidate = `${chars.slice(0, LIMITS.nickname - 3).join('').trimEnd()} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${chars.slice(0, 12).join('').trimEnd()} ${randomId(4, this.rng)}`;
  }

  private nextColor(): string {
    const used = new Set([...this.players.values()].map((p) => p.state.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? (PLAYER_COLORS[this.joinCounter % PLAYER_COLORS.length] as string);
  }

  private sendWelcome(record: PlayerRecord, rejoined: boolean): void {
    const payload: WelcomePayload = {
      playerId: record.id,
      seatToken: record.seatToken,
      code: this.roomId,
      gameId: this.gameId,
      serverNow: Date.now(),
      rejoined,
      reconnectGraceSeconds: this.reconnectGraceSeconds,
    };
    record.client?.send(SYS.welcome, payload);
  }

  private sendChatHistory(record: PlayerRecord): void {
    record.client?.send(CHAT.history, this.chatLog);
  }

  private publishSettings(): void {
    this.state.settingsJson = JSON.stringify(this.settings);
    this.state.settingsRev = (this.state.settingsRev + 1) >>> 0;
  }

  private rejectKicked(): never {
    throw new ServerError(JoinErrorCode.KICKED, 'The host removed you from this room.');
  }

  private handlerFailed(client: Client, type: string, err: unknown): void {
    log.error('message handler failed', { room: this.roomId, game: this.gameId, type, err: err as Error });
    this.reject(client, type, 'server_error', 'Something went wrong handling that action.');
  }

  private safeHook(fn: () => void, name: string): void {
    try {
      fn();
    } catch (err) {
      log.error('room hook failed', { room: this.roomId, game: this.gameId, hook: name, err: err as Error });
    }
  }

  private async verifyAccount(record: PlayerRecord, token: string): Promise<void> {
    const userId = await matchSink.verifyUser(token);
    if (userId && this.players.get(record.id) === record) record.userId = userId;
  }

  // ===========================================================================
  // Tournament Center binding — rooms the kiosk creates for one match
  // (isolated here; ordinary rooms never have a binding and skip all of this)
  // ===========================================================================

  /** Consume a server-created binding. The key must exist in this process — client create options can't forge one. */
  private bindTournament(rawOptions: unknown): void {
    const key = (rawOptions as Record<string, unknown> | null | undefined)?.[MATCH_BINDING_OPTION];
    if (key === undefined) return;
    const binding = consumeMatchBinding(key);
    if (!binding || binding.gameId !== this.gameId) {
      log.warn('invalid tournament binding ignored', { room: this.roomId, game: this.gameId });
      return;
    }
    const handle: BoundMatchRoom = {
      roomCode: this.roomId,
      attempt: binding.attempt,
      applySeries: (update) => this.applyTournamentSeries(update),
    };
    this.tournamentBinding = {
      code: binding.tournamentCode,
      matchId: binding.matchId,
      tickets: new Map(Object.entries(binding.tickets)),
      playerOf: new Map(),
      status: 'waiting',
      handle,
    };
    this.isSolo = false;
    this.tournamentInfo = { ...structuredClone(binding.info), seriesStatus: 'waiting', nextGameAt: 0, result: null };
    for (const p of this.tournamentInfo.participants) p.playerId = null;
    this.state.locked = true;
    this.state.maxPlayers = 2;
    this.state.allowSpectators = this.catalog.capacity.supportsSpectators;
    this.reconnectGraceSeconds = Math.max(this.reconnectGraceSeconds, binding.reconnectGraceSeconds);
    this.autoDispose = false;
    this.publishTournamentInfo();
    registerBoundRoom(binding.tournamentCode, binding.matchId, handle);
  }

  /** Join a bound room: a valid ticket seats (or re-seats) its participant; anyone else spectates. */
  private joinTournamentMatch(client: Client, options: JoinOptions): void {
    const binding = this.tournamentBinding!;
    const info = this.tournamentInfo!;
    const participantId = options.ticket && binding.status !== 'closed' ? binding.tickets.get(options.ticket) : undefined;
    let record: PlayerRecord;
    let notice: string | null = null;
    if (participantId) {
      const existing = this.players.get(binding.playerOf.get(participantId) ?? '');
      if (existing) {
        this.rebind(existing, client);
        return;
      }
      const entry = info.participants.find((p) => p.participantId === participantId);
      record = this.createRecord(client, { ...options, name: entry?.name ?? options.name }, false, false);
      record.data.tournamentParticipantId = participantId;
      binding.playerOf.set(participantId, record.id);
      if (entry) entry.playerId = record.id;
      this.publishTournamentInfo();
    } else {
      if (!this.state.allowSpectators) throw new ServerError(JoinErrorCode.ROOM_LOCKED, 'Only the two tournament players can join this match.');
      record = this.createRecord(client, options, true, false);
      if (options.ticket) notice = 'That match ticket is not valid here — you joined as a spectator.';
    }
    const spectator = record.state.spectator;
    this.claimHostIfOrphaned(record);
    this.sendWelcome(record, false);
    this.sendChatHistory(record);
    this.systemChat(`${record.state.name} joined${spectator ? ' as a spectator' : ''}.`);
    if (notice) this.toast(record, 'warning', notice);
    this.markMetadataDirty();
    this.safeHook(() => this.onPlayerJoined(record, { lateJoin: this.phase !== 'LOBBY' }), 'onPlayerJoined');
    this.safeHook(() => this.syncPrivate(record), 'syncPrivate');
    if (options.accessToken) void this.verifyAccount(record, options.accessToken);
    this.tournamentPresenceChanged();
  }

  /** Hand the host role to a specific player (rooms with their own host rules, e.g. the tournament organizer). */
  protected assignHost(player: PlayerRecord | null): void {
    this.setHost(player);
  }

  /** Host powers in a bound room only ever go to one of the two participants. */
  private hostEligible(player: PlayerRecord): boolean {
    if (this.tournamentBinding && !player.data.tournamentParticipantId) return false;
    return this.canBecomeHost(player);
  }

  private publishTournamentInfo(): void {
    this.state.tournamentJson = this.tournamentInfo ? JSON.stringify(this.tournamentInfo) : '';
  }

  /** Participants connected right now. */
  private presentParticipants(): string[] {
    const binding = this.tournamentBinding;
    if (!binding) return [];
    return [...binding.playerOf].filter(([, playerId]) => this.players.get(playerId)?.client).map(([pid]) => pid);
  }

  private tournamentPresenceChanged(): void {
    const binding = this.tournamentBinding;
    if (!binding || binding.status === 'closed') return;
    const waiting = this.phase === 'LOBBY' && (binding.status === 'waiting' || binding.status === 'intermission');
    getTournament(binding.code)?.matchRoomStatus(binding.matchId, this.roomId, { present: this.presentParticipants(), waiting });
    this.maybeAutoStartTournamentGame();
  }

  private tournamentStartBlocker(): string | null {
    const binding = this.tournamentBinding;
    if (!binding) return null;
    if (binding.status === 'decided' || binding.status === 'closed') return 'This tournament match is over.';
    if (binding.status !== 'waiting') return 'The next game starts automatically.';
    const missing = this.tournamentInfo!.participants.filter((p) => {
      const record = p.playerId ? this.players.get(p.playerId) : undefined;
      return !record?.client || record.state.spectator;
    });
    if (missing.length) return `Waiting for ${missing.map((p) => p.name).join(' and ')}.`;
    return null;
  }

  /** Both participants are here: start the game shortly (the series runs itself). */
  private maybeAutoStartTournamentGame(): void {
    const binding = this.tournamentBinding;
    if (!binding || this.phase !== 'LOBBY' || binding.status !== 'waiting') return;
    if (this.tournamentStartBlocker()) {
      this.cancelPlatformTimer('tournament:start');
      return;
    }
    if (this.platformTimers.has('tournament:start')) return;
    this.platformSchedule('tournament:start', tournamentTiming('START_DELAY', 2_500), () => {
      if (this.phase === 'LOBBY' && !this.startBlocker()) this.beginCountdown();
    });
  }

  private tournamentGameStarted(): void {
    const binding = this.tournamentBinding;
    if (!binding || !this.tournamentInfo) return;
    binding.status = 'playing';
    this.tournamentInfo.seriesStatus = 'playing';
    this.tournamentInfo.nextGameAt = 0;
    this.publishTournamentInfo();
    getTournament(binding.code)?.matchGameStarted(binding.matchId, this.roomId, this.tournamentInfo.gameNumber);
  }

  /** After reportOutcome(): the kiosk normally answered synchronously via applySeries(). */
  private afterTournamentOutcome(): void {
    const binding = this.tournamentBinding;
    if (!binding || binding.status !== 'playing') return;
    if (!getTournament(binding.code)) {
      // The tournament is gone: nothing more to play for here.
      this.applyTournamentSeries({ status: 'closed', info: this.tournamentInfo!, message: 'The tournament is no longer running.' });
    }
  }

  /** A game was abandoned without a result (e.g. everyone left): it will be replayed. */
  private tournamentReturnedToLobby(): void {
    const binding = this.tournamentBinding;
    if (!binding || binding.status !== 'playing') return;
    binding.status = 'waiting';
    this.tournamentInfo!.seriesStatus = 'waiting';
    this.publishTournamentInfo();
    this.tournamentPresenceChanged();
  }

  /** Kiosk → room: next game, series decided, or the match was resolved elsewhere. */
  private applyTournamentSeries(update: SeriesUpdate): void {
    const binding = this.tournamentBinding;
    if (!binding || binding.status === 'closed' || this.phase === 'ENDED') return;
    // Keep this room's player ids; everything else comes from the kiosk.
    const playerIds = new Map(binding.playerOf);
    const info: TournamentMatchInfo = structuredClone(update.info);
    for (const p of info.participants) p.playerId = playerIds.get(p.participantId) ?? null;
    this.tournamentInfo = info;
    this.cancelPlatformTimer('tournament:start');
    if (update.status === 'next') {
      binding.status = 'intermission';
      info.seriesStatus = 'intermission';
      const intermission = tournamentTiming('INTERMISSION', 8_000);
      info.nextGameAt = Date.now() + intermission;
      this.publishTournamentInfo();
      this.platformSchedule('tournament:next', intermission, () => this.nextTournamentGame());
      return;
    }
    if (update.status === 'decided') {
      binding.status = 'decided';
      info.seriesStatus = 'decided';
      info.nextGameAt = 0;
      this.publishTournamentInfo();
      this.autoDispose = true;
      this.platformSchedule('tournament:dispose', TOURNAMENT_DECIDED_TTL_MS, () => void this.disconnect());
      return;
    }
    binding.status = 'closed';
    info.seriesStatus = 'void';
    info.nextGameAt = 0;
    this.publishTournamentInfo();
    this.autoDispose = true;
    const message = update.message ?? 'The organizer resolved this match.';
    this.systemChat(message);
    this.toast('all', 'info', message);
    this.platformSchedule('tournament:close', tournamentTiming('CLOSE_DELAY', 4_000), () => {
      this.setPhase('ENDED');
      const payload: RemovedPayload = { reason: 'room_closed', message };
      this.broadcast(SYS.removed, payload);
      this.clock.setTimeout(() => void this.disconnect(RoomCloseCode.ROOM_CLOSED), 150);
    });
  }

  private nextTournamentGame(): void {
    const binding = this.tournamentBinding;
    if (!binding || binding.status !== 'intermission') return;
    if (this.phase !== 'LOBBY') this.returnToLobby();
    binding.status = 'waiting';
    this.tournamentInfo!.seriesStatus = 'waiting';
    this.tournamentInfo!.nextGameAt = 0;
    // Records re-created after a removal get their new player id.
    for (const p of this.tournamentInfo!.participants) p.playerId = binding.playerOf.get(p.participantId) ?? null;
    this.publishTournamentInfo();
    if (!this.startBlocker()) this.beginCountdown();
    else this.tournamentPresenceChanged();
  }

  /** A participant's record is gone for good (they can come back with their ticket). */
  private forgetTournamentSeat(record: PlayerRecord): void {
    const binding = this.tournamentBinding;
    const participantId = record.data.tournamentParticipantId;
    if (!binding || typeof participantId !== 'string') return;
    if (binding.playerOf.get(participantId) === record.id) binding.playerOf.delete(participantId);
    const entry = this.tournamentInfo?.participants.find((p) => p.participantId === participantId);
    if (entry && entry.playerId === record.id) entry.playerId = null;
    this.publishTournamentInfo();
    this.tournamentPresenceChanged();
  }

  private disposeTournamentBinding(): void {
    for (const timer of this.platformTimers.values()) timer.clear();
    this.platformTimers.clear();
    const binding = this.tournamentBinding;
    if (!binding) return;
    unregisterBoundRoom(binding.code, binding.matchId, binding.handle);
    // Died before the series was decided: the kiosk re-launches the match (the series score is kept).
    if (binding.status !== 'decided' && binding.status !== 'closed') getTournament(binding.code)?.matchRoomClosed(binding.matchId, this.roomId);
  }

  private platformSchedule(key: string, ms: number, fn: () => void): void {
    this.cancelPlatformTimer(key);
    const delayed = this.clock.setTimeout(() => {
      this.platformTimers.delete(key);
      try {
        fn();
      } catch (err) {
        log.error('platform timer failed', { room: this.roomId, key, err: err as Error });
      }
    }, Math.max(0, ms));
    this.platformTimers.set(key, delayed);
  }

  private cancelPlatformTimer(key: string): void {
    this.platformTimers.get(key)?.clear();
    this.platformTimers.delete(key);
  }

  protected markMetadataDirty(): void {
    this.metadataDirty = true;
  }

  private flushMetadata(): void {
    if (!this.metadataDirty) return;
    this.metadataDirty = false;
    const meta: RoomMetadata = {
      gameId: this.gameId,
      roomName: this.state.roomName,
      phase: this.phase,
      players: this.seatedCount(),
      maxPlayers: this.state.maxPlayers,
      locked: this.state.locked,
      allowSpectators: this.state.allowSpectators,
      solo: this.isSolo,
    };
    void this.setMetadata(meta).catch(() => undefined);
  }
}

const IN_MATCH_PHASES: ReadonlySet<Phase> = new Set<Phase>(['COUNTDOWN', 'PLAYING', 'INTERMISSION']);

/** Tournament match rooms: delay before an automatic game start, the pause between series games, cleanup. */
const TOURNAMENT_DECIDED_TTL_MS = 30 * 60_000;
/** Timing knobs; non-production environments may shorten them (tests) via DASCADE_TOURNAMENT_*_MS. */
function tournamentTiming(name: 'START_DELAY' | 'INTERMISSION' | 'CLOSE_DELAY', fallback: number): number {
  if (process.env.NODE_ENV === 'production') return fallback;
  const raw = Number(process.env[`DASCADE_TOURNAMENT_${name}_MS`]);
  return Number.isFinite(raw) && raw >= 0 && process.env[`DASCADE_TOURNAMENT_${name}_MS`] !== undefined ? raw : fallback;
}

interface TournamentBindingState {
  code: string;
  matchId: string;
  /** ticket → participantId. */
  tickets: Map<string, string>;
  /** participantId → room player id. */
  playerOf: Map<string, string>;
  status: 'waiting' | 'playing' | 'intermission' | 'decided' | 'closed';
  handle: BoundMatchRoom;
}
/** ~64 KB/s of settings JSON per room (typical settings are < 2 KB; a 200-segment wheel ≈ 50 KB). */
const SETTINGS_BYTE_BUDGET: RateSpec = { burst: 256 * 1024, perSecond: 64 * 1024 };

/** JSON length of a decoded message payload (Infinity if it can't be encoded). */
function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value ?? null)?.length ?? 0;
  } catch {
    return Infinity;
  }
}
const RESERVED_NAMES = new Set(['dascade', 'system', 'server', 'admin', 'moderator']);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
