/**
 * DAS Boardroom kit — abstract room for two-player, turn-based board games (chess, checkers…).
 *
 * The kit owns everything that is the same for every board game so each game only writes its rules:
 *  - sides: tournament sides (`participants[].side`, 'first' moves first), casual side mode
 *    (random / host first / host second) and colour swap on rematch;
 *  - the server clock (base + Fischer increment, flag timer, overdue check before every action,
 *    "flag vs. no mating material = draw" through `canWinOnTime`);
 *  - resign, draw offers (one per own move, a move declines the opponent's offer), take-back
 *    requests (casual + unrated only, executed only after the opponent accepts), rematch votes
 *    (RESULTS phase; both players → new game, colours swapped);
 *  - untimed games: an idle rule (the waiting player may claim the win after UNTIMED_CLAIM_MS without a
 *    move; the idle side forfeits automatically after UNTIMED_FORFEIT_MS), so nobody can stall a room;
 *  - disconnects: the clock keeps running; a seated player who stays away longer than the room's
 *    reconnect grace (catalog: 120 s for chess/checkers) forfeits by abandonment; leaving mid-game
 *    forfeits at once; a host who kicks their own opponent concedes (a kick never wins a game);
 *  - host powers never decide a result: a playing host who ends a live game (back to lobby / close
 *    room) concedes it; a host who isn't playing can't kick a player out of, or end, a rated game;
 *  - the ending: result state, `reportOutcome` (ratings/stats/tournaments), rating deltas, `endMatch`.
 *
 * Subclass contract (see docs/GAME_GUIDE.md §6, Boardroom kit):
 *  - implement `sideName`, `onBoardSetup` (start position), and your move handler(s) registered in
 *    `onBoardCreated` using `guardTurn` → validate/apply → `completeTurn` → `finish` when the rules end it;
 *  - optionally `onBoardStart`, `onBoardReset`, `supportsUndo` + `takeBack`, `canWinOnTime`,
 *    `resultDetails`, `onBoardEnd`.
 *  - If you override a Base lifecycle hook the kit uses (onRoomCreated, onCountdownStart, onGameStart,
 *    onReturnToLobby, onPlayerDisconnected/Reconnected/Away/Removed, ratedOptIn) call `super` first.
 */
import { RATE, type CreateOptions } from '@dascade/shared';
import {
  BOARD_REASONS,
  UNTIMED_CLAIM_MS,
  UNTIMED_FORFEIT_MS,
  BoardEmptySchema,
  BoardOfferSchema,
  boardMsg,
  otherSide,
  type BoardEvent,
  type BoardOfferPayload,
  type BoardSettings,
  type BoardSide,
} from '@dascade/shared/games/boardroom';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { getRating, ratingIdentity } from '../../platform/ratings.ts';
import { log } from '../../lib/log.ts';
import { ServerClock, type ClockTimes } from './clock.ts';
import { BoardSeat, type BoardRoomState } from './schema.ts';

export interface BoardResult {
  winner: BoardSide | 'draw';
  /** Machine reason ('checkmate', 'resign', 'timeout', 'agreement', 'stalemate'…). */
  reason: string;
  /** Human sentence; defaults to `defaultResultText`. */
  text?: string;
}

interface SeatIdentity {
  playerId: string;
  name: string;
  guestId?: string;
  userId?: string;
}

const IDLE_TIMER = 'boardroom:idle';

/** Max rematch offers per player per results screen (anti-spam on top of the rate limit). */
const MAX_REMATCH_OFFERS = 4;

export abstract class BoardGameRoom<S extends BoardRoomState, Settings extends BoardSettings> extends BaseGameRoom<S, Settings> {
  /** Test hook: overrides the settings' time control (e.g. `{ baseMs: 400, incrementMs: 0 }`). */
  clockOverride: ClockTimes | null = null;
  /** Untimed games: the waiting side may claim the win after this long without a move (tests shorten it). */
  untimedClaimMs = UNTIMED_CLAIM_MS;
  /** Untimed games: the idle side forfeits automatically after this long without a move. */
  untimedForfeitMs = UNTIMED_FORFEIT_MS;
  /** Games without draws (e.g. ships) turn this off. */
  protected drawOffersEnabled = true;

  protected boardClock!: ServerClock;
  private prepared = false;
  private rematchPending = false;
  private lastSides: { first: string; second: string } | null = null;
  private identities: Partial<Record<BoardSide, SeatIdentity>> = {};
  private ownMoves: Record<BoardSide, number> = { first: 0, second: 0 };
  private drawOfferedAt: Record<BoardSide, number> = { first: -1, second: -1 };
  /** Position serial (see `position`) at each side's last take-back request. */
  private undoRequestedAt: Record<BoardSide, number> = { first: -1, second: -1 };
  /** Bumps on every move and every accepted take-back (ply goes down after one, so it can't key this). */
  private position = 0;
  private rematchOffers: Record<BoardSide, number> = { first: 0, second: 0 };

  // ===========================================================================
  // Subclass API
  // ===========================================================================

  /** "White" / "Black", "Dark" / "Light"… */
  protected abstract sideName(side: BoardSide): string;
  /** Sides are assigned: build the start position (called at COUNTDOWN so clients can render it). */
  protected abstract onBoardSetup(): void;
  /** Register your own message handlers here (moves…). */
  protected onBoardCreated(_options: CreateOptions): void {}
  /** The game is live (PLAYING) and the first side's clock is running. */
  protected onBoardStart(): void {}
  /** Back in the lobby: clear the position. */
  protected onBoardReset(): void {}
  /** Whether this game supports take-backs at all (casual + unrated rooms only, decided by the kit). */
  protected supportsUndo(): boolean {
    return false;
  }
  /** Revert the last `plies` turns. Return false if impossible. The kit fixes ply/turn/clock after. */
  protected takeBack(_plies: number): boolean {
    return false;
  }
  /** Could `side` still possibly win (e.g. chess: has mating material)? A flag against such a side is a draw. */
  protected canWinOnTime(_side: BoardSide): boolean {
    return true;
  }
  /** Small JSON extras for reportOutcome / match summary (e.g. PGN length). */
  protected resultDetails(_result: BoardResult): Record<string, unknown> | undefined {
    return undefined;
  }
  /** The game just ended (state.result is filled, clocks stopped). Publish final records (PGN…). */
  protected onBoardEnd(_result: BoardResult): void {}

  /** Human result sentence ("White wins by checkmate", "Draw by agreement"). Override for game terms. */
  protected defaultResultText(result: BoardResult): string {
    const reasons: Record<string, string> = {
      [BOARD_REASONS.resign]: 'resignation',
      [BOARD_REASONS.timeout]: 'timeout',
      [BOARD_REASONS.timeoutInsufficient]: 'timeout vs. insufficient material',
      [BOARD_REASONS.agreement]: 'agreement',
      [BOARD_REASONS.abandoned]: 'abandonment',
      [BOARD_REASONS.forfeit]: 'forfeit',
      [BOARD_REASONS.idle]: 'inactivity',
    };
    const why = reasons[result.reason] ?? result.reason.replace(/_/g, ' ');
    if (result.winner === 'draw') return `Draw by ${why}`;
    return `${this.sideName(result.winner)} wins by ${why}`;
  }

  // ===========================================================================
  // Helpers for subclasses
  // ===========================================================================

  /** `this.msg('move')` → 'chess:move'. */
  protected msg(action: string): string {
    return `${this.gameId}:${action}`;
  }

  protected seatFor(side: BoardSide): BoardSeat {
    return this.state.seats[side === 'first' ? 0 : 1]!;
  }

  /** The side a player is playing in the current game (null for spectators / outsiders). */
  protected sideOf(player: PlayerRecord | string): BoardSide | null {
    const id = typeof player === 'string' ? player : player.id;
    if (!id) return null;
    for (const seat of this.state.seats) if (seat.playerId === id) return seat.side as BoardSide;
    return null;
  }

  protected playerOn(side: BoardSide): PlayerRecord | undefined {
    const id = this.seatFor(side).playerId;
    return id ? this.getPlayer(id) : undefined;
  }

  protected get turn(): BoardSide {
    return this.state.turn as BoardSide;
  }

  /** PLAYING and not finished. */
  protected get boardLive(): boolean {
    return this.phase === 'PLAYING' && !this.state.result.over;
  }

  /**
   * Gate for a move-like action: game live, sender seated, flag not fallen, sender's turn and (when
   * given) the client's `ply` matches (stale / duplicate messages are refused). Rejects with a message
   * and returns null, or returns the mover's side.
   */
  protected guardTurn(player: PlayerRecord, type: string, ply?: number): BoardSide | null {
    if (!this.boardLive) {
      this.reject(player, type, 'wrong_phase', 'The game is not in progress.');
      return null;
    }
    const side = this.sideOf(player);
    if (!side) {
      this.reject(player, type, 'not_allowed', 'You are not playing in this game.');
      return null;
    }
    if (this.checkFlag()) return null;
    if (side !== this.turn) {
      this.reject(player, type, 'not_your_turn', 'Wait for your turn.');
      return null;
    }
    if (ply !== undefined && ply !== this.state.ply) {
      this.reject(player, type, 'not_allowed', 'The position changed — try that again.');
      return null;
    }
    return side;
  }

  /** Call after applying a legal turn for `mover`: clocks, offers, ply and turn advance. */
  protected completeTurn(mover: BoardSide): void {
    this.boardClock.switchAfterMove(mover);
    this.ownMoves[mover]++;
    this.state.ply++;
    this.position++;
    this.state.turn = otherSide(mover);
    this.beginTurn();
    const offers = this.state.offers;
    // Moving instead of answering declines the opponent's draw offer; your own offer stands.
    if (offers.drawBy && offers.drawBy !== mover) {
      const by = offers.drawBy as BoardSide;
      offers.drawBy = '';
      this.boardEvent({ type: 'offer', kind: 'draw', side: by, action: 'expired' });
    }
    // Any move changes the position a take-back request referred to.
    if (offers.undoBy) {
      const by = offers.undoBy as BoardSide;
      offers.undoBy = '';
      offers.undoPlies = 0;
      this.boardEvent({ type: 'offer', kind: 'undo', side: by, action: 'expired' });
    }
  }

  /** End the game (idempotent). Winner 'draw' for draws. */
  protected finish(result: BoardResult): void {
    if (this.state.result.over || this.phase !== 'PLAYING') return;
    this.boardClock.stop();
    this.cancel(IDLE_TIMER);
    this.state.idleClaimAt = 0;
    this.state.idleForfeitAt = 0;
    const text = result.text ?? this.defaultResultText(result);
    const r = this.state.result;
    r.over = true;
    r.winner = result.winner;
    r.reason = result.reason;
    r.text = text;
    this.clearOffers();

    const first = this.identities.first;
    const second = this.identities.second;
    const before = {
      first: this.seatFor('first').rating,
      second: this.seatFor('second').rating,
    };
    if (first && second) {
      const placements =
        result.winner === 'draw'
          ? [[first.playerId, second.playerId]]
          : result.winner === 'first'
            ? [[first.playerId], [second.playerId]]
            : [[second.playerId], [first.playerId]];
      this.reportOutcome({
        placements,
        reason: result.reason,
        details: { winnerSide: result.winner, plies: this.state.ply, ...this.resultDetails(result) },
      });
      if (this.state.rated) {
        for (const side of ['first', 'second'] as const) {
          const id = this.identities[side];
          const identity = id ? ratingIdentity(id) : null;
          if (!identity) continue;
          const after = getRating(identity, this.gameId);
          const seat = this.seatFor(side);
          seat.ratingDelta = after.rating - before[side];
        }
      }
    }
    this.safeCall(() => this.onBoardEnd({ ...result, text }));
    this.boardEvent({ type: 'end', winner: result.winner, reason: result.reason, text });
    this.systemChat(`${text}.`);

    const score = (side: BoardSide) => (result.winner === 'draw' ? 0.5 : result.winner === side ? 1 : 0);
    const placement = (side: BoardSide) => (result.winner === 'draw' || result.winner === side ? 1 : 2);
    this.endMatch({
      players: (['first', 'second'] as const)
        .map((side) => ({ side, id: this.identities[side] }))
        .filter((e): e is { side: BoardSide; id: SeatIdentity } => Boolean(e.id))
        .map(({ side, id }) => ({
          playerId: id.playerId,
          name: id.name,
          guestId: id.guestId,
          userId: id.userId,
          score: score(side),
          placement: placement(side),
        })),
      details: { winner: result.winner, reason: result.reason, plies: this.state.ply },
    });
  }

  /** Broadcast a kit event (offers, undo, flag, end) — clients use it for toasts and sounds. */
  protected boardEvent(event: BoardEvent): void {
    this.broadcast(boardMsg(this.gameId, 'event'), event);
  }

  /** If the running side's flag has fallen (timer not processed yet), end the game now. */
  protected checkFlag(): boolean {
    const side = this.boardClock.overdue();
    if (!side) return false;
    this.boardClock.flag(side);
    this.onFlagFell(side);
    return true;
  }

  // ===========================================================================
  // Base hooks
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    while (this.state.seats.length < 2) this.state.seats.push(new BoardSeat({ side: this.state.seats.length === 0 ? 'first' : 'second' }));
    this.boardClock = new ServerClock(
      this.state.clock,
      { schedule: (k, ms, fn) => this.schedule(k, ms, fn), cancel: (k) => this.cancel(k) },
      (side) => this.onFlagFell(side),
    );
    this.boardClock.configure(this.clockTimes());

    this.handle(boardMsg(this.gameId, 'resign'), BoardEmptySchema, (p) => this.onResign(p), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(boardMsg(this.gameId, 'draw'), BoardOfferSchema, (p, payload) => this.onDraw(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      bucket: 'boardroom:offers',
    });
    this.handle(boardMsg(this.gameId, 'undo'), BoardOfferSchema, (p, payload) => this.onUndo(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      bucket: 'boardroom:offers',
    });
    this.handle(boardMsg(this.gameId, 'rematch'), BoardOfferSchema, (p, payload) => this.onRematch(p, payload), {
      phases: ['RESULTS'],
      playersOnly: true,
      rate: RATE.action,
    });
    this.handle(boardMsg(this.gameId, 'claim'), BoardEmptySchema, (p) => this.onClaim(p), {
      phases: ['PLAYING'],
      playersOnly: true,
      bucket: 'boardroom:offers',
    });
    this.onBoardCreated(options);
  }

  protected override ratedOptIn(): boolean {
    return Boolean(this.settings.rated);
  }

  /**
   * A kick never decides a rated game: while one is live, a host who isn't playing in it can't
   * remove either player (the removal would hand the other a rated win). A host who plays may still
   * remove their opponent — that concedes (see onPlayerRemoved) — and casual games keep the usual
   * moderation.
   */
  protected override kickBlocker(target: PlayerRecord): string | null {
    if (!this.boardLive || !this.state.rated || !this.sideOf(target)) return null;
    if (this.sideOf(this.state.hostId)) return null;
    return 'Players can’t be removed during a rated game.';
  }

  /**
   * The host ends a live game (back to lobby / close room). A playing host concedes it — nobody can
   * erase a lost or rated game that way — except a casual game nobody has moved in yet, which is
   * simply abandoned. A host who isn't playing may stop a casual game, never a rated one.
   */
  protected override hostEndsMatch(host: PlayerRecord): string | null {
    if (!this.boardLive) return null;
    const side = this.sideOf(host);
    if (!side) return this.state.rated ? 'A rated game can only be ended by its players.' : null;
    if (this.state.ply === 0 && !this.state.rated) return null;
    const winner = otherSide(side);
    this.finish({
      winner,
      reason: BOARD_REASONS.forfeit,
      text: `${this.sideName(winner)} wins — ${this.sideName(side)} ended the game`,
    });
    return null;
  }

  protected override onSettingsChanged(_prev: Settings, _next: Settings): void {
    if (this.phase === 'LOBBY') this.boardClock?.configure(this.clockTimes());
  }

  protected override onCountdownStart(): void {
    this.prepareGame();
  }

  protected onGameStart(): void {
    if (!this.prepared && !this.prepareGame()) return;
    this.prepared = false;
    // Both players must still be here (someone may have left during the countdown).
    const missing = (['first', 'second'] as const).find((side) => !this.playerOn(side));
    if (missing) {
      this.systemChat('A player left before the first move — back to the lobby.');
      this.returnToLobby();
      return;
    }
    this.boardClock.start('first');
    this.beginTurn();
    this.onBoardStart();
  }

  protected override onReturnToLobby(): void {
    this.prepared = false;
    this.resetBoardState();
    this.boardClock.configure(this.clockTimes());
    this.safeCall(() => this.onBoardReset());
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const side = this.sideOf(player);
    // Seats are assigned at the countdown: a player dropping then shows their reconnect timer too.
    if (!side || !(this.boardLive || this.phase === 'COUNTDOWN')) return;
    this.seatFor(side).awayDeadline = Date.now() + this.reconnectGraceSeconds * 1000;
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    const side = this.sideOf(player);
    if (side) this.seatFor(side).awayDeadline = 0;
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    const side = this.sideOf(player);
    if (!side || !this.boardLive) return;
    this.seatFor(side).awayDeadline = 0;
    this.finish({ winner: otherSide(side), reason: BOARD_REASONS.abandoned });
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    const side = this.sideOf(player);
    if (!side) return;
    if (this.phase === 'COUNTDOWN') {
      // onGameStart notices the empty seat and returns to the lobby.
      return;
    }
    if (this.phase === 'RESULTS') {
      this.removeRematchVote(side);
      return;
    }
    if (!this.boardLive) return;
    this.seatFor(side).awayDeadline = 0;
    // A kick never wins a game: a host who removes their own opponent concedes.
    const hostSide = this.sideOf(this.state.hostId);
    const kickedByOpponent = reason === 'kicked' && hostSide === otherSide(side);
    this.finish({
      winner: kickedByOpponent ? side : otherSide(side),
      reason: BOARD_REASONS.forfeit,
      text: kickedByOpponent
        ? `${this.sideName(side)} wins — the opponent removed them from the room`
        : `${this.sideName(otherSide(side))} wins — ${this.sideName(side)} left the game`,
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private clockTimes(): ClockTimes {
    if (this.clockOverride) return this.clockOverride;
    const tc = this.settings.timeControl;
    return { baseMs: tc.baseMinutes * 60_000, incrementMs: tc.incrementSeconds * 1000 };
  }

  private resetBoardState(): void {
    this.state.turn = 'first';
    this.state.ply = 0;
    this.state.turnSince = 0;
    this.state.idleClaimAt = 0;
    this.state.idleForfeitAt = 0;
    this.cancel(IDLE_TIMER);
    this.clearOffers();
    this.state.offers.rematch.clear();
    const r = this.state.result;
    r.over = false;
    r.winner = '';
    r.reason = '';
    r.text = '';
    this.ownMoves = { first: 0, second: 0 };
    this.drawOfferedAt = { first: -1, second: -1 };
    this.undoRequestedAt = { first: -1, second: -1 };
    this.position = 0;
    this.rematchOffers = { first: 0, second: 0 };
    for (const seat of this.state.seats) {
      seat.ratingDelta = 0;
      seat.awayDeadline = 0;
    }
  }

  private clearOffers(): void {
    const o = this.state.offers;
    o.drawBy = '';
    o.undoBy = '';
    o.undoPlies = 0;
  }

  /** Assign sides, reset kit state and let the game build its start position. */
  private prepareGame(): boolean {
    const sides = this.pickSides();
    if (!sides) {
      this.systemChat('Two players are needed to start.');
      this.returnToLobby();
      return false;
    }
    this.lastSides = { first: sides.first.id, second: sides.second.id };
    this.rematchPending = false;
    this.resetBoardState();
    this.state.gameNumber++;
    for (const side of ['first', 'second'] as const) {
      const p = sides[side];
      const seat = this.seatFor(side);
      seat.side = side;
      seat.playerId = p.id;
      seat.name = p.state.name;
      seat.avatar = p.state.avatar;
      seat.color = p.state.color;
      const rating = this.ratingOf(p);
      seat.rating = Math.max(0, Math.min(65_535, Math.round(rating.rating)));
      seat.ratingGames = rating.games;
      seat.provisional = rating.provisional;
      seat.awayDeadline = p.client ? 0 : Date.now() + this.reconnectGraceSeconds * 1000;
      this.identities[side] = { playerId: p.id, name: p.state.name, guestId: p.guestId, userId: p.userId };
    }
    this.state.rated = this.isRatedMatch();
    this.state.undoAllowed = this.supportsUndo() && !this.tournamentMatch && !this.state.rated && Boolean(this.settings.allowUndo);
    this.state.drawOffersAllowed = this.drawOffersEnabled;
    this.boardClock.configure(this.clockTimes());
    this.onBoardSetup();
    this.prepared = true;
    return true;
  }

  private pickSides(): { first: PlayerRecord; second: PlayerRecord } | null {
    const seated = this.seatedPlayers();
    const t = this.tournamentMatch;
    if (t) {
      const bySide = (s: 'first' | 'second') => {
        const part = t.participants.find((x) => x.side === s && x.playerId);
        return part?.playerId ? this.getPlayer(part.playerId) : undefined;
      };
      const first = bySide('first');
      const second = bySide('second');
      if (first && second && first !== second) return { first, second };
    }
    if (seated.length < 2) return null;
    const [a, b] = seated as [PlayerRecord, PlayerRecord];
    if (this.rematchPending && this.lastSides) {
      const prevFirst = this.getPlayer(this.lastSides.first);
      const prevSecond = this.getPlayer(this.lastSides.second);
      if (prevFirst && prevSecond && !prevFirst.state.spectator && !prevSecond.state.spectator) {
        return { first: prevSecond, second: prevFirst };
      }
    }
    const host = this.hostRecord;
    const hostSeated = host && (host === a || host === b) ? host : undefined;
    const other = hostSeated === a ? b : a;
    switch (this.settings.sides) {
      case 'host_first':
        if (hostSeated) return { first: hostSeated, second: other };
        break;
      case 'host_second':
        if (hostSeated) return { first: other, second: hostSeated };
        break;
      default:
        break;
    }
    return this.rng.int(2) === 0 ? { first: a, second: b } : { first: b, second: a };
  }

  /** A new turn begins: stamp it and, in untimed games, arm the idle rule. */
  private beginTurn(): void {
    const now = Date.now();
    this.state.turnSince = now;
    if (this.boardClock.enabled) {
      this.state.idleClaimAt = 0;
      this.state.idleForfeitAt = 0;
      this.cancel(IDLE_TIMER);
      return;
    }
    this.state.idleClaimAt = now + this.untimedClaimMs;
    this.state.idleForfeitAt = now + this.untimedForfeitMs;
    const ply = this.state.ply;
    this.schedule(IDLE_TIMER, this.untimedForfeitMs, () => {
      if (!this.boardLive || this.state.ply !== ply) return;
      const idle = this.turn;
      this.finish({
        winner: otherSide(idle),
        reason: BOARD_REASONS.idle,
        text: `${this.sideName(otherSide(idle))} wins — ${this.sideName(idle)} stopped moving`,
      });
    });
  }

  private onClaim(player: PlayerRecord): void {
    const type = boardMsg(this.gameId, 'claim');
    if (!this.boardLive) return this.reject(player, type, 'wrong_phase', 'The game is not in progress.');
    const side = this.sideOf(player);
    if (!side) return this.reject(player, type, 'not_allowed', 'You are not playing in this game.');
    if (this.boardClock.enabled) return this.reject(player, type, 'not_allowed', 'The clock decides timed games.');
    if (side === this.turn) return this.reject(player, type, 'not_allowed', 'It is your move.');
    if (!this.state.idleClaimAt || Date.now() < this.state.idleClaimAt) {
      return this.reject(player, type, 'not_allowed', 'You can claim the win once your opponent has not moved for a while.');
    }
    this.finish({
      winner: side,
      reason: BOARD_REASONS.idle,
      text: `${this.sideName(side)} wins — ${this.sideName(otherSide(side))} stopped moving`,
    });
  }

  private onFlagFell(side: BoardSide): void {
    if (!this.boardLive) return;
    this.boardEvent({ type: 'flag', side });
    const winner = otherSide(side);
    if (!this.canWinOnTime(winner)) {
      this.finish({
        winner: 'draw',
        reason: BOARD_REASONS.timeoutInsufficient,
        text: `Draw — ${this.sideName(side)} ran out of time, but ${this.sideName(winner)} cannot win`,
      });
      return;
    }
    this.finish({ winner, reason: BOARD_REASONS.timeout, text: `${this.sideName(winner)} wins on time` });
  }

  private onResign(player: PlayerRecord): void {
    const type = boardMsg(this.gameId, 'resign');
    if (!this.boardLive) return this.reject(player, type, 'wrong_phase', 'The game is not in progress.');
    const side = this.sideOf(player);
    if (!side) return this.reject(player, type, 'not_allowed', 'You are not playing in this game.');
    if (this.checkFlag()) return;
    this.finish({
      winner: otherSide(side),
      reason: BOARD_REASONS.resign,
      text: `${this.sideName(otherSide(side))} wins — ${this.sideName(side)} resigned`,
    });
  }

  private onDraw(player: PlayerRecord, { action }: BoardOfferPayload): void {
    const type = boardMsg(this.gameId, 'draw');
    if (!this.boardLive) return this.reject(player, type, 'wrong_phase', 'The game is not in progress.');
    if (!this.drawOffersEnabled) return this.reject(player, type, 'not_allowed', 'Draws are not possible in this game.');
    const side = this.sideOf(player);
    if (!side) return this.reject(player, type, 'not_allowed', 'You are not playing in this game.');
    if (this.checkFlag()) return;
    const offers = this.state.offers;
    const opponent = otherSide(side);
    switch (action) {
      case 'offer': {
        if (offers.drawBy === opponent) return this.acceptDraw();
        if (offers.drawBy === side) return;
        if (this.drawOfferedAt[side] >= this.ownMoves[side]) {
          return this.reject(player, type, 'not_allowed', 'You can offer a draw again after your next move.');
        }
        this.drawOfferedAt[side] = this.ownMoves[side];
        offers.drawBy = side;
        this.boardEvent({ type: 'offer', kind: 'draw', side, action: 'offer' });
        return;
      }
      case 'accept':
        if (offers.drawBy !== opponent) return this.reject(player, type, 'not_allowed', 'There is no draw offer to accept.');
        return this.acceptDraw();
      case 'decline':
        if (offers.drawBy !== opponent) return;
        offers.drawBy = '';
        this.boardEvent({ type: 'offer', kind: 'draw', side: opponent, action: 'decline' });
        return;
      case 'cancel':
        if (offers.drawBy !== side) return;
        offers.drawBy = '';
        this.boardEvent({ type: 'offer', kind: 'draw', side, action: 'cancel' });
        return;
    }
  }

  private acceptDraw(): void {
    this.finish({ winner: 'draw', reason: BOARD_REASONS.agreement, text: 'Draw by agreement' });
  }

  private onUndo(player: PlayerRecord, { action }: BoardOfferPayload): void {
    const type = boardMsg(this.gameId, 'undo');
    if (!this.boardLive) return this.reject(player, type, 'wrong_phase', 'The game is not in progress.');
    if (!this.state.undoAllowed) return this.reject(player, type, 'not_allowed', 'Take-backs are off in this game.');
    const side = this.sideOf(player);
    if (!side) return this.reject(player, type, 'not_allowed', 'You are not playing in this game.');
    if (this.checkFlag()) return;
    const offers = this.state.offers;
    const opponent = otherSide(side);
    switch (action) {
      case 'offer': {
        if (offers.undoBy === side) return;
        if (offers.undoBy === opponent) return this.reject(player, type, 'not_allowed', 'Answer your opponent’s take-back request first.');
        const plies = this.turn === side ? 2 : 1;
        const myMoves = side === 'first' ? Math.ceil(this.state.ply / 2) : Math.floor(this.state.ply / 2);
        if (myMoves < 1 || this.state.ply < plies) return this.reject(player, type, 'not_allowed', 'You have no move to take back.');
        if (this.undoRequestedAt[side] === this.position) {
          return this.reject(player, type, 'not_allowed', 'You already asked to take back this move.');
        }
        this.undoRequestedAt[side] = this.position;
        offers.undoBy = side;
        offers.undoPlies = plies;
        this.boardEvent({ type: 'offer', kind: 'undo', side, action: 'offer' });
        return;
      }
      case 'accept': {
        if (offers.undoBy !== opponent) return this.reject(player, type, 'not_allowed', 'There is no take-back request to accept.');
        const plies = offers.undoPlies;
        if (plies < 1 || plies > this.state.ply || !this.takeBack(plies)) {
          offers.undoBy = '';
          offers.undoPlies = 0;
          return this.reject(player, type, 'not_allowed', 'That move can no longer be taken back.');
        }
        this.state.ply -= plies;
        this.position++;
        if (plies % 2 === 1) this.state.turn = otherSide(this.turn);
        this.clearOffers();
        this.boardClock.handTo(this.turn);
        this.beginTurn();
        this.boardEvent({ type: 'undo', plies, ply: this.state.ply });
        this.boardEvent({ type: 'offer', kind: 'undo', side: opponent, action: 'accept' });
        return;
      }
      case 'decline':
        if (offers.undoBy !== opponent) return;
        offers.undoBy = '';
        offers.undoPlies = 0;
        this.boardEvent({ type: 'offer', kind: 'undo', side: opponent, action: 'decline' });
        return;
      case 'cancel':
        if (offers.undoBy !== side) return;
        offers.undoBy = '';
        offers.undoPlies = 0;
        this.boardEvent({ type: 'offer', kind: 'undo', side, action: 'cancel' });
        return;
    }
  }

  private onRematch(player: PlayerRecord, { action }: BoardOfferPayload): void {
    const type = boardMsg(this.gameId, 'rematch');
    if (this.tournamentMatch) return this.reject(player, type, 'not_allowed', 'The Tournament Center schedules the next game.');
    const side = this.sideOf(player);
    if (!side || !this.state.result.over) return this.reject(player, type, 'not_allowed', 'Only the two players can ask for a rematch.');
    const votes = this.state.offers.rematch;
    const opponent = otherSide(side);
    switch (action) {
      case 'offer':
      case 'accept': {
        if (votes.includes(side)) return;
        if (action === 'offer' && !votes.includes(opponent)) {
          if (this.rematchOffers[side] >= MAX_REMATCH_OFFERS)
            return this.reject(player, type, 'rate_limited', 'That is enough rematch offers for now.');
          this.rematchOffers[side]++;
        }
        const opp = this.playerOn(opponent);
        if (!opp || !opp.client) return this.reject(player, type, 'not_allowed', 'Your opponent is not here any more.');
        votes.push(side);
        this.boardEvent({ type: 'offer', kind: 'rematch', side, action: votes.length === 2 ? 'accept' : 'offer' });
        if (votes.includes('first') && votes.includes('second')) this.startRematch();
        return;
      }
      case 'decline':
        if (!votes.includes(opponent)) return;
        this.removeRematchVote(opponent);
        this.boardEvent({ type: 'offer', kind: 'rematch', side: opponent, action: 'decline' });
        return;
      case 'cancel':
        if (!votes.includes(side)) return;
        this.removeRematchVote(side);
        this.boardEvent({ type: 'offer', kind: 'rematch', side, action: 'cancel' });
        return;
    }
  }

  private removeRematchVote(side: BoardSide): void {
    const votes = this.state.offers.rematch;
    const i = votes.indexOf(side);
    if (i >= 0) votes.splice(i, 1);
  }

  private startRematch(): void {
    const next = this.state.gameNumber + 1;
    this.rematchPending = true;
    this.returnToLobby();
    this.rematchPending = true;
    if (!this.startMatch()) {
      this.rematchPending = false;
      this.systemChat('The rematch could not start — back to the lobby.');
      return;
    }
    this.boardEvent({ type: 'rematch', gameNumber: next });
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error('boardroom hook failed', { room: this.roomId, game: this.gameId, err: err as Error });
    }
  }
}
