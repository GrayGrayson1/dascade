/**
 * DAS Hold'em — authoritative no-limit Texas Hold'em room (virtual chips only).
 *
 * The rules live in @dascade/game-core/holdem; this room seats players, runs the
 * continuous hand loop and the clocks, and publishes public state. Hole cards and
 * the undealt deck never enter synchronized state: each player receives their own
 * cards with a private `holdem:private` message (re-sent on reconnect).
 */
import { formatChips, type ActionErrorCode, type CreateOptions } from '@dascade/shared';
import {
  DEFAULT_HOLDEM_SETTINGS,
  HOLDEM_DISCONNECT_GRACE_MS,
  HOLDEM_LOG_LIMIT,
  HOLDEM_MAX_SEATS,
  HOLDEM_MSG,
  HOLDEM_TIMEOUTS_TO_SIT_OUT,
  HoldemActSchema,
  HoldemEmptySchema,
  HoldemSettingsSchema,
  HoldemSitOutSchema,
  HoldemSitSchema,
  type HoldemActPayload,
  type HoldemEvent,
  type HoldemPrivatePayload,
  type HoldemSettings,
  type HoldemStreet,
} from '@dascade/shared/games/holdem';
import {
  applyAction,
  blindsForLevel,
  cancelHand,
  collectedPots,
  dealNextStreet,
  evaluateBest,
  exposedSeats,
  forceFold,
  legalActions,
  moveButton,
  playerAt,
  resolveShowdown,
  startHand,
  type HandState,
  type LogLine,
} from '@dascade/game-core/holdem';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted, withLeaversLast } from '../outcomePlacements.ts';
import { HoldemLogEntry, HoldemPot, HoldemSeat, HoldemStanding, HoldemState, HoldemWinner } from './HoldemState.ts';

/** Pacing (ms). Instance-level so integration tests can speed the table up. */
export interface HoldemTiming {
  firstHand: number;
  street: number;
  runout: number;
  showdown: number;
  intermission: number;
  intermissionUncontested: number;
  waitingPoll: number;
  disconnectGrace: number;
  /** Overrides settings.actionSeconds when > 0 (tests). */
  actionMs: number;
}

const DEFAULT_TIMING: HoldemTiming = {
  firstHand: 900,
  street: 850,
  runout: 1500,
  showdown: 1000,
  intermission: 5500,
  intermissionUncontested: 3000,
  waitingPoll: 1500,
  disconnectGrace: HOLDEM_DISCONNECT_GRACE_MS,
  actionMs: 0,
};

interface Bankroll {
  stack: number;
  buyIns: number;
  rebuys: number;
  handsWon: number;
  bestPot: number;
}

/** Departed players remembered per game (keys; a player can have a guest and an account key). */
const MAX_BANKROLLS = 512;

const ENGINE_CODES: Record<string, ActionErrorCode> = {
  not_your_turn: 'not_your_turn',
  insufficient_chips: 'insufficient_chips',
  illegal_action: 'not_allowed',
  bad_amount: 'not_allowed',
};

export class HoldemRoom extends BaseGameRoom<HoldemState, HoldemSettings> {
  readonly gameId = 'holdem' as const;
  protected readonly settingsSchema = HoldemSettingsSchema;
  override settingsEditablePhases = ['LOBBY', 'PLAYING', 'INTERMISSION'] as const;

  timing: HoldemTiming = { ...DEFAULT_TIMING };

  /** The hand in progress (server-only: contains the deck and every hole card). */
  private hand: HandState | null = null;
  /** The last finished hand (for reconnect replays and voluntary shows). */
  private lastHand: HandState | null = null;
  private logCursor = 0;
  private prevButton = -1;
  private handsDealt = 0;
  private consecutiveTimeouts = new Map<string, number>();
  /** Per-player game stats for the leaderboard. */
  private stats = new Map<string, { handsWon: number; bestPot: number }>();
  /**
   * What departed players left the table with, keyed by guest/account identity, so leaving and
   * rejoining can't reset a balance (a fresh stack for a short or busted player, or a way around
   * "no rebuys"). Cleared when a new game starts.
   */
  private bankrolls = new Map<string, Bankroll>();
  private turn = { seat: -1, seq: -1, startedAt: 0, ms: 0 };

  protected defaultSettings(): HoldemSettings {
    return structuredClone(DEFAULT_HOLDEM_SETTINGS);
  }

  protected createState(): HoldemState {
    const state = new HoldemState();
    for (let i = 0; i < HOLDEM_MAX_SEATS; i++) state.seats.push(new HoldemSeat({ index: i }));
    return state;
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  protected override onRoomCreated(_options: CreateOptions): void {
    this.state.tableSize = this.clampTable(this.state.maxPlayers);
    this.applyBlindsPreview();

    this.handle(HOLDEM_MSG.act, HoldemActSchema, (p, payload) => this.onAct(p, payload), { phases: ['PLAYING'], playersOnly: true });
    this.handle(HOLDEM_MSG.sit, HoldemSitSchema, (p, { seat }) => this.onSit(p, seat), { phases: ['LOBBY', 'PLAYING', 'INTERMISSION'] });
    this.handle(HOLDEM_MSG.sitOut, HoldemSitOutSchema, (p, { sittingOut }) => this.onSitOut(p, sittingOut), {
      phases: ['PLAYING', 'INTERMISSION'],
      playersOnly: true,
    });
    this.handle(HOLDEM_MSG.rebuy, HoldemEmptySchema, (p) => this.onRebuy(p), { phases: ['PLAYING', 'INTERMISSION'], playersOnly: true });
    this.handle(HOLDEM_MSG.show, HoldemEmptySchema, (p) => this.onShow(p), { phases: ['PLAYING', 'INTERMISSION'], playersOnly: true });
    this.handle(HOLDEM_MSG.end, HoldemEmptySchema, () => this.requestEnd(), { phases: ['PLAYING', 'INTERMISSION'], hostOnly: true });

    // Housekeeping: keep lobby seats consistent with spectate toggles / table size,
    // and make sure the hand loop can never stall.
    this.clock.setInterval(() => {
      if (this.phase === 'LOBBY') this.normalizeLobbySeats();
      else this.watchdog();
    }, 500);
  }

  protected override validateStart(): string | null {
    const seated = this.seatedPlayers().length;
    if (seated > HOLDEM_MAX_SEATS) return `DAS Hold'em seats at most ${HOLDEM_MAX_SEATS} players.`;
    return null;
  }

  /**
   * The leaderboard is decided by chips, and a removed player drops to the bottom of it — so while a
   * game runs, the host can't remove anyone who still has chips at the table (e.g. the chip leader
   * right before ending the game). Busted players and the rail can still be removed; everyone can
   * again once the game is over.
   */
  protected override kickBlocker(target: PlayerRecord): string | null {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return null;
    const index = this.seatOf(target.id);
    if (index < 0) return null;
    const seat = this.state.seats[index]!;
    if (seat.left) return null;
    const h = this.hand;
    const hp = h && h.stage !== 'complete' ? playerAt(h, index) : undefined;
    if (seat.stack > 0 || (hp && hp.id === target.id)) return 'Players with chips on the table can’t be removed mid-game — end the game first.';
    return null;
  }

  /**
   * "Back to lobby" / "Close room" mid-game settles the game first, so the session is still
   * reported. A hand whose betting is still open is never cancelled for it (that would refund a pot
   * someone is losing): the game ends after that hand instead, and the host is told to try again.
   */
  protected override hostEndsMatch(): string | null {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return null;
    if (this.handUndecided()) {
      this.requestEnd();
      return 'A hand is still being played — the game ends when it’s over. Try again then.';
    }
    this.finishGame('host_ended');
    return null;
  }

  protected onGameStart(): void {
    const settings = this.settings;
    this.state.tableSize = this.clampTable(this.state.maxPlayers);
    this.normalizeLobbySeats();
    for (const p of this.seatedPlayers()) if (this.seatOf(p.id) < 0) this.autoSeat(p);
    for (const seat of this.state.seats) {
      if (!seat.playerId) continue;
      seat.stack = settings.startingStack;
      seat.buyIns = settings.startingStack;
      seat.rebuys = 0;
      seat.busted = false;
      seat.sittingOut = false;
      seat.sitOutReason = '';
      seat.waiting = false;
      seat.left = false;
      this.resetSeatHand(seat);
    }
    this.hand = null;
    this.lastHand = null;
    this.handsDealt = 0;
    this.prevButton = -1;
    this.consecutiveTimeouts.clear();
    this.stats.clear();
    this.bankrolls.clear();
    this.state.endRequested = false;
    this.state.handNumber = 0;
    this.state.log.clear();
    this.state.standings.clear();
    this.clearHandView();
    this.applyBlindsPreview();
    this.pushLog({ kind: 'info', text: `Game on! ${formatChips(settings.startingStack)} virtual chips each.` }, 0);
    this.state.tableMessage = 'Shuffling up…';
    this.schedule('hand', this.timing.firstHand, () => this.startNextHand());
  }

  protected override onReturnToLobby(): void {
    this.hand = null;
    this.lastHand = null;
    this.handsDealt = 0;
    this.prevButton = -1;
    this.consecutiveTimeouts.clear();
    this.bankrolls.clear();
    this.clearHandView();
    this.state.endRequested = false;
    this.state.handNumber = 0;
    this.state.log.clear();
    this.state.standings.clear();
    this.state.tableMessage = '';
    for (const seat of this.state.seats) {
      if (seat.left || !seat.playerId || !this.getPlayer(seat.playerId)) {
        this.clearSeat(seat);
        continue;
      }
      seat.stack = 0;
      seat.buyIns = 0;
      seat.rebuys = 0;
      seat.busted = false;
      seat.sittingOut = false;
      seat.sitOutReason = '';
      seat.waiting = false;
      this.resetSeatHand(seat);
    }
    this.applyBlindsPreview();
    for (const p of this.players.values()) this.syncPrivate(p);
  }

  protected override onSettingsChanged(prev: HoldemSettings, next: HoldemSettings): void {
    if (this.phase === 'LOBBY') {
      this.applyBlindsPreview();
      return;
    }
    if (prev.smallBlind !== next.smallBlind || prev.bigBlind !== next.bigBlind || prev.blindIncreaseEvery !== next.blindIncreaseEvery) {
      this.pushLog({ kind: 'info', text: `Blinds ${formatChips(next.smallBlind)}/${formatChips(next.bigBlind)} from the next hand` });
    }
    if (prev.allowRebuys !== next.allowRebuys) this.pushLog({ kind: 'info', text: next.allowRebuys ? 'Rebuys are on' : 'Rebuys are off' });
  }

  // ===========================================================================
  // Player lifecycle
  // ===========================================================================

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const seat = this.seatOf(player.id);
    if (seat >= 0 && this.hand?.stage === 'betting' && this.hand.toAct === seat) this.armTurnClock(true);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    const seat = this.seatOf(player.id);
    if (seat < 0) return;
    const s = this.state.seats[seat]!;
    if (s.sittingOut && s.sitOutReason === 'away') {
      s.sittingOut = false;
      s.sitOutReason = '';
      this.consecutiveTimeouts.set(player.id, 0);
    }
    if (this.hand?.stage === 'betting' && this.hand.toAct === seat) this.armTurnClock(true);
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    const seat = this.seatOf(player.id);
    if (seat < 0) return;
    const s = this.state.seats[seat]!;
    s.sittingOut = true;
    s.sitOutReason = 'away';
    if (this.hand?.stage === 'betting' && this.hand.toAct === seat) this.armTurnClock(true);
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    this.consecutiveTimeouts.delete(player.id);
    const seatIndex = this.seatOf(player.id);
    if (seatIndex < 0) return;
    const seat = this.state.seats[seatIndex]!;
    const h = this.hand;
    const hp = h && h.stage !== 'complete' ? playerAt(h, seatIndex) : undefined;
    if (reason !== 'kicked' && (this.phase === 'PLAYING' || this.phase === 'INTERMISSION')) {
      this.saveBankroll(player, seat, hp && hp.id === player.id ? hp.stack : seat.stack);
    }
    if (h && hp && hp.id === player.id) {
      seat.left = true;
      seat.sittingOut = true;
      if (reason === 'kicked') {
        // A kick must never decide a pot (e.g. the host removing an all-in opponent who is ahead on the
        // runout). The hand stays live and the clock plays it like an absent player's: check if free,
        // otherwise fold; an all-in hand runs to showdown. Whatever it wins leaves with the player.
        if (h.stage === 'betting' && h.toAct === seatIndex) this.armTurnClock(true);
        return;
      }
      // Leaving mid-hand folds the hand; the chips already bet stay in the pot, the rest leaves with the player.
      if (forceFold(h, seatIndex)) {
        this.state.actionSeq++;
        this.afterEngineChange();
      }
      return;
    }
    this.clearSeat(seat);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const seat = this.seatOf(player.id);
    const h = this.hand ?? this.lastHand;
    const hp = h && seat >= 0 && !this.state.seats[seat]!.left ? playerAt(h, seat) : undefined;
    const payload: HoldemPrivatePayload =
      h && hp && hp.id === player.id
        ? { handNumber: h.handNumber, seat, cards: [...hp.hole] }
        : { handNumber: this.state.handNumber, seat: -1, cards: [] };
    this.sendTo(player, HOLDEM_MSG.private, payload);
  }

  // ===========================================================================
  // Seats
  // ===========================================================================

  private clampTable(n: number): number {
    return Math.max(2, Math.min(HOLDEM_MAX_SEATS, Math.round(n)));
  }

  private seatOf(playerId: string): number {
    const seat = this.state.seats.find((s) => s.playerId === playerId);
    return seat ? seat.index : -1;
  }

  private clearSeat(seat: HoldemSeat): void {
    seat.playerId = '';
    seat.name = '';
    seat.stack = 0;
    seat.buyIns = 0;
    seat.rebuys = 0;
    seat.busted = false;
    seat.sittingOut = false;
    seat.sitOutReason = '';
    seat.waiting = false;
    seat.left = false;
    this.resetSeatHand(seat);
  }

  private resetSeatHand(seat: HoldemSeat): void {
    seat.bet = 0;
    seat.committed = 0;
    seat.inHand = false;
    seat.folded = false;
    seat.allIn = false;
    seat.hasCards = false;
    seat.lastAction = '';
    seat.lastAmount = 0;
    if (seat.shownCards.length) seat.shownCards.clear();
    seat.handLabel = '';
    seat.won = 0;
  }

  /** Seats a player in the empty seat farthest from everyone else (nice spacing at big tables). */
  private autoSeat(player: PlayerRecord): number {
    const size = this.state.tableSize;
    const taken = this.state.seats.filter((s) => s.playerId && s.index < size).map((s) => s.index);
    let best = -1;
    let bestGap = -1;
    for (let i = 0; i < size; i++) {
      if (taken.includes(i)) continue;
      const gap = taken.length === 0 ? size : Math.min(...taken.map((t) => Math.min(Math.abs(t - i), size - Math.abs(t - i))));
      if (gap > bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (best < 0) return -1;
    this.assignSeat(player, best);
    return best;
  }

  private assignSeat(player: PlayerRecord, index: number): void {
    const seat = this.state.seats[index]!;
    this.clearSeat(seat);
    seat.playerId = player.id;
    seat.name = player.state.name;
  }

  /** Lobby: release seats of spectators / departed players and seats beyond the table size. */
  private normalizeLobbySeats(): void {
    this.state.tableSize = this.clampTable(this.state.maxPlayers);
    for (const seat of this.state.seats) {
      if (!seat.playerId) continue;
      const p = this.getPlayer(seat.playerId);
      if (!p || p.state.spectator || seat.index >= this.state.tableSize) this.clearSeat(seat);
      else if (seat.name !== p.state.name) seat.name = p.state.name;
    }
    this.applyBlindsPreview();
  }

  private onSit(player: PlayerRecord, index: number): void {
    const type = HOLDEM_MSG.sit;
    if (index >= this.state.tableSize) return this.reject(player, type, 'not_allowed', 'That seat is not at this table.');
    const seat = this.state.seats[index]!;
    if (seat.playerId && seat.playerId !== player.id) return this.reject(player, type, 'not_allowed', 'That seat is taken.');
    const current = this.seatOf(player.id);
    if (current === index) return;

    if (this.phase === 'LOBBY') {
      if (player.state.spectator) {
        if (!this.state.allowSpectators || this.seatedPlayers().length >= this.state.maxPlayers) {
          return this.reject(player, type, 'not_allowed', 'All player seats are taken.');
        }
        player.state.spectator = false;
        player.state.queued = false;
      }
      if (current >= 0) this.clearSeat(this.state.seats[current]!);
      this.assignSeat(player, index);
      return;
    }

    // In a running game: only players without a seat may sit down (no seat hopping).
    if (current >= 0) return this.reject(player, type, 'not_allowed', 'You can only change seats in the lobby.');
    if (player.state.spectator) {
      if (this.seatedPlayers().length >= this.state.maxPlayers) return this.reject(player, type, 'not_allowed', 'The table is full.');
      player.state.spectator = false;
      player.state.queued = false;
      this.markMetadataDirty();
    }
    this.assignSeat(player, index);
    this.seatBankroll(player, seat);
    seat.waiting = this.hand !== null && seat.stack > 0;
    this.pushLog({ kind: 'info', text: `${player.state.name} sits down with ${formatChips(seat.stack)}` });
    this.systemChat(`${player.state.name} took seat ${index + 1}.`);
  }

  private buyIn(seat: HoldemSeat): void {
    const amount = this.settings.startingStack;
    seat.stack = amount;
    seat.buyIns += amount;
    seat.busted = false;
  }

  private identityKeys(player: PlayerRecord): string[] {
    const keys: string[] = [];
    if (player.userId) keys.push(`user:${player.userId}`);
    if (player.guestId) keys.push(`guest:${player.guestId}`);
    return keys;
  }

  private saveBankroll(player: PlayerRecord, seat: HoldemSeat, stack: number): void {
    const keys = this.identityKeys(player);
    if (keys.length === 0) return;
    const stat = this.stats.get(player.id);
    const entry: Bankroll = { stack, buyIns: seat.buyIns, rebuys: seat.rebuys, handsWon: stat?.handsWon ?? 0, bestPot: stat?.bestPot ?? 0 };
    for (const key of keys) {
      this.bankrolls.delete(key);
      this.bankrolls.set(key, entry);
    }
    // Bounded: the oldest departures are forgotten first.
    while (this.bankrolls.size > MAX_BANKROLLS) this.bankrolls.delete(this.bankrolls.keys().next().value as string);
  }

  /**
   * Gives a player sitting down mid-game their chips: what they left with earlier in this game
   * (same guest/account), otherwise a fresh virtual buy-in.
   */
  private seatBankroll(player: PlayerRecord, seat: HoldemSeat): void {
    const key = this.identityKeys(player).find((k) => this.bankrolls.has(k));
    const saved = key ? this.bankrolls.get(key)! : null;
    if (!saved) {
      this.buyIn(seat);
      return;
    }
    for (const [k, v] of [...this.bankrolls]) if (v === saved) this.bankrolls.delete(k);
    seat.stack = saved.stack;
    seat.buyIns = saved.buyIns;
    seat.rebuys = saved.rebuys;
    seat.busted = saved.stack === 0;
    if (saved.handsWon > 0) this.stats.set(player.id, { handsWon: saved.handsWon, bestPot: saved.bestPot });
  }

  private onSitOut(player: PlayerRecord, sittingOut: boolean): void {
    const index = this.seatOf(player.id);
    if (index < 0) return this.reject(player, HOLDEM_MSG.sitOut, 'not_allowed', 'You are not seated.');
    const seat = this.state.seats[index]!;
    if (seat.left) return;
    seat.sittingOut = sittingOut;
    seat.sitOutReason = sittingOut ? 'self' : '';
    if (!sittingOut) this.consecutiveTimeouts.set(player.id, 0);
    const inHand = Boolean(this.hand && playerAt(this.hand, index) && !playerAt(this.hand, index)!.folded);
    if (sittingOut && inHand) this.toast(player, 'info', 'You will sit out from the next hand.');
    if (!sittingOut && this.phase === 'INTERMISSION' && !this.hand && this.state.phaseEndsAt === 0) {
      this.schedule('hand', 300, () => this.startNextHand());
    }
  }

  private onRebuy(player: PlayerRecord): void {
    const type = HOLDEM_MSG.rebuy;
    const index = this.seatOf(player.id);
    if (index < 0) return this.reject(player, type, 'not_allowed', 'You are not seated.');
    if (!this.settings.allowRebuys) return this.reject(player, type, 'not_allowed', 'Rebuys are turned off for this game.');
    const seat = this.state.seats[index]!;
    const live = this.hand && playerAt(this.hand, index) && !playerAt(this.hand, index)!.folded;
    if (seat.stack > 0 || live) return this.reject(player, type, 'not_allowed', 'You can rebuy once you are out of chips.');
    this.buyIn(seat);
    seat.rebuys++;
    this.pushLog({ kind: 'info', text: `${player.state.name} rebuys for ${formatChips(seat.stack)} virtual chips` });
    if (this.phase === 'INTERMISSION' && !this.hand && this.state.phaseEndsAt === 0) this.schedule('hand', 300, () => this.startNextHand());
  }

  private onShow(player: PlayerRecord): void {
    const index = this.seatOf(player.id);
    const h = this.lastHand;
    if (this.hand || !h || index < 0) return this.reject(player, HOLDEM_MSG.show, 'not_allowed', 'You can show your cards after the hand.');
    const hp = playerAt(h, index);
    const seat = this.state.seats[index]!;
    if (!hp || hp.id !== player.id || seat.shownCards.length > 0) return;
    seat.shownCards.push(...hp.hole);
    seat.handLabel = h.board.length >= 3 ? evaluateBest([...hp.hole, ...h.board]).description : '';
    this.pushLog({ kind: 'show', text: `${hp.name} shows ${hp.hole.join(' ')}` }, h.handNumber);
    this.broadcast(HOLDEM_MSG.event, { type: 'reveal', seats: [index] } satisfies HoldemEvent);
  }

  // ===========================================================================
  // Hand loop
  // ===========================================================================

  private startNextHand(): void {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    if (this.hand) return;
    if (this.state.endRequested) {
      this.finishGame('host_ended');
      return;
    }
    const settings = this.settings;

    // Seats freed by players who left during the last hand.
    for (const seat of this.state.seats) {
      if (seat.playerId && (seat.left || !this.getPlayer(seat.playerId))) this.clearSeat(seat);
    }
    // Players promoted from the rail (late joiners) and unseated players get a seat and a stack.
    for (const p of this.promoteQueued()) this.systemChat(`${p.state.name} joins the table.`);
    for (const p of this.seatedPlayers()) {
      if (this.seatOf(p.id) >= 0) continue;
      const index = this.autoSeat(p);
      if (index >= 0) {
        const seat = this.state.seats[index]!;
        this.seatBankroll(p, seat);
        this.pushLog({ kind: 'info', text: `${p.state.name} sits down with ${formatChips(seat.stack)}` });
      }
    }
    for (const seat of this.state.seats) {
      seat.waiting = false;
      if (seat.playerId) {
        const p = this.getPlayer(seat.playerId);
        if (p && seat.name !== p.state.name) seat.name = p.state.name;
      }
    }

    const occupied = this.state.seats.filter((s) => s.playerId && s.index < this.state.tableSize);
    if (!settings.allowRebuys && this.handsDealt > 0 && occupied.filter((s) => s.stack > 0).length <= 1) {
      this.finishGame();
      return;
    }

    const dealt = occupied.filter((s) => {
      const p = this.getPlayer(s.playerId);
      return p && !p.away && !s.sittingOut && s.stack > 0;
    });
    if (dealt.length < 2) {
      this.clearHandView();
      for (const seat of this.state.seats) this.resetSeatHand(seat);
      this.state.tableMessage =
        occupied.length < 2
          ? 'Waiting for another player to sit down…'
          : settings.allowRebuys && occupied.some((s) => s.stack === 0)
            ? 'Waiting for players to rebuy or come back…'
            : 'Waiting for players to come back…';
      this.setPhase('INTERMISSION');
      this.schedule('hand', this.timing.waitingPoll, () => this.startNextHand());
      return;
    }

    // Blind level for this hand.
    const every = settings.blindIncreaseEvery;
    const level = every > 0 ? Math.floor(this.handsDealt / every) : 0;
    const blinds = blindsForLevel(settings.smallBlind, settings.bigBlind, level, settings.blindIncreasePct);
    if (level > this.state.blindLevel && this.handsDealt > 0) {
      this.pushLog({ kind: 'info', text: `Blinds up: ${formatChips(blinds.smallBlind)}/${formatChips(blinds.bigBlind)}` }, this.state.handNumber + 1);
      this.toast('all', 'info', `Blinds are now ${formatChips(blinds.smallBlind)}/${formatChips(blinds.bigBlind)}`);
    }
    this.state.blindLevel = level;
    this.state.smallBlind = blinds.smallBlind;
    this.state.bigBlind = blinds.bigBlind;
    this.state.handsToNextLevel = every > 0 ? every - (this.handsDealt % every) : 0;

    const dealtSeats = dealt.map((s) => s.index);
    const button = moveButton(this.prevButton, dealtSeats, this.state.tableSize, this.rng);
    const handNumber = this.state.handNumber + 1;
    const h = startHand(
      {
        handNumber,
        tableSize: this.state.tableSize,
        button,
        smallBlind: blinds.smallBlind,
        bigBlind: blinds.bigBlind,
        players: dealt.map((s) => ({ seat: s.index, id: s.playerId, name: s.name, stack: s.stack })),
      },
      this.rng,
    );

    this.prevButton = button;
    this.handsDealt++;
    this.hand = h;
    this.lastHand = null;
    this.logCursor = 0;
    this.state.handNumber = handNumber;
    this.state.round = handNumber;
    this.state.tableMessage = '';
    this.clearHandView();
    for (const seat of this.state.seats) this.resetSeatHand(seat);
    this.setPhase('PLAYING');
    this.state.actionSeq++;

    for (const hp of h.players) {
      const record = this.getPlayer(hp.id);
      if (record) this.sendTo(record, HOLDEM_MSG.private, { handNumber, seat: hp.seat, cards: [...hp.hole] } satisfies HoldemPrivatePayload);
    }
    for (const p of this.players.values()) {
      if (!h.players.some((hp) => hp.id === p.id)) this.sendTo(p, HOLDEM_MSG.private, { handNumber, seat: -1, cards: [] } satisfies HoldemPrivatePayload);
    }
    this.broadcast(HOLDEM_MSG.event, { type: 'deal', handNumber, seats: dealtSeats, button } satisfies HoldemEvent);
    this.afterEngineChange();
  }

  private onAct(player: PlayerRecord, payload: HoldemActPayload): void {
    const type = HOLDEM_MSG.act;
    const h = this.hand;
    const index = this.seatOf(player.id);
    const hp = h && index >= 0 ? playerAt(h, index) : undefined;
    if (!h || !hp || hp.id !== player.id) return this.reject(player, type, 'not_allowed', 'You are not in this hand.');
    if (h.stage !== 'betting' || h.toAct !== index) return this.reject(player, type, 'not_your_turn', 'It is not your turn.');
    if (payload.seq !== undefined && payload.seq !== this.state.actionSeq) {
      return this.reject(player, type, 'not_your_turn', 'That decision already passed.');
    }
    const result = applyAction(h, index, { type: payload.action, amount: payload.amount });
    if (!result.ok) return this.reject(player, type, ENGINE_CODES[result.code] ?? 'not_allowed', result.message);
    this.consecutiveTimeouts.set(player.id, 0);
    this.state.actionSeq++;
    this.broadcast(HOLDEM_MSG.event, { type: 'action', seat: index, action: result.action, amount: result.amount } satisfies HoldemEvent);
    this.afterEngineChange();
  }

  private onTurnTimeout(seat: number, seq: number): void {
    const h = this.hand;
    if (!h || h.stage !== 'betting' || h.toAct !== seat || this.state.actionSeq !== seq) return;
    const hp = playerAt(h, seat)!;
    const legal = legalActions(h, seat);
    const record = this.getPlayer(hp.id);
    const offline = !record || !record.client || record.away;
    this.pushLog({ kind: 'info', text: offline ? `${hp.name} is away` : `${hp.name} ran out of time` });
    const result = applyAction(h, seat, { type: legal?.canCheck ? 'check' : 'fold' });
    if (!result.ok) return;
    const s = this.state.seats[seat]!;
    if (offline) {
      s.sittingOut = true;
      s.sitOutReason = 'away';
    } else {
      const count = (this.consecutiveTimeouts.get(hp.id) ?? 0) + 1;
      this.consecutiveTimeouts.set(hp.id, count);
      if (count >= HOLDEM_TIMEOUTS_TO_SIT_OUT && record) {
        s.sittingOut = true;
        s.sitOutReason = 'timeout';
        this.toast(record, 'warning', 'You were sat out after timing out. Tap “I’m back” to play again.');
      }
    }
    this.state.actionSeq++;
    this.broadcast(HOLDEM_MSG.event, { type: 'action', seat, action: result.action, amount: result.amount } satisfies HoldemEvent);
    this.afterEngineChange();
  }

  /** Publishes the engine state and schedules whatever comes next. */
  private afterEngineChange(): void {
    const h = this.hand;
    if (!h) return;
    this.syncFromHand(h);
    switch (h.stage) {
      case 'betting':
        this.armTurnClock(false);
        break;
      case 'street-complete':
        this.stopTurnClock();
        this.schedule('street', h.runout ? this.timing.runout : this.timing.street, () => this.dealStreet());
        break;
      case 'showdown':
        this.stopTurnClock();
        this.schedule('street', h.runout ? this.timing.runout : this.timing.showdown, () => this.showdown());
        break;
      case 'complete':
        this.stopTurnClock();
        this.finishHand(h);
        break;
    }
  }

  private dealStreet(): void {
    const h = this.hand;
    if (!h || h.stage !== 'street-complete') return;
    const cards = dealNextStreet(h);
    this.state.actionSeq++;
    this.broadcast(HOLDEM_MSG.event, { type: 'street', street: h.street, cards } satisfies HoldemEvent);
    this.afterEngineChange();
  }

  private showdown(): void {
    const h = this.hand;
    if (!h || h.stage !== 'showdown') return;
    const result = resolveShowdown(h, this.settings.showdownReveal);
    this.state.actionSeq++;
    this.broadcast(HOLDEM_MSG.event, { type: 'reveal', seats: result.shown.map((s) => s.seat) } satisfies HoldemEvent);
    this.afterEngineChange();
  }

  private finishHand(h: HandState): void {
    const result = h.result!;
    this.hand = null;
    this.lastHand = h;
    this.state.street = 'complete';
    this.state.toActSeat = -1;
    this.state.actionDeadline = 0;
    this.state.runout = false;
    this.resetLegal();

    this.state.winners.clear();
    for (const w of result.winners) {
      const hp = playerAt(h, w.seat)!;
      const win = new HoldemWinner({ seat: w.seat, playerId: hp.id, name: hp.name, potIndex: w.potIndex, amount: w.amount, description: w.description });
      win.bestCards.push(...w.bestCards);
      this.state.winners.push(win);
    }
    const totals = this.tallyWins(h);
    for (const [seat, amount] of totals) this.state.seats[seat]!.won = amount;
    for (const shown of result.shown) {
      const seat = this.state.seats[shown.seat]!;
      const label = result.winners.find((w) => w.seat === shown.seat)?.description ?? shown.hand.description;
      if (seat.shownCards.join() !== shown.cards.join()) {
        seat.shownCards.clear();
        seat.shownCards.push(...shown.cards);
      }
      seat.handLabel = label;
    }
    this.state.pots.clear();

    let bustedNow = 0;
    for (const hp of h.players) {
      const seat = this.state.seats[hp.seat]!;
      if (seat.left || seat.playerId !== hp.id) continue;
      seat.stack = hp.stack;
      seat.bet = 0;
      if (hp.stack === 0) {
        seat.busted = true;
        bustedNow++;
        const record = this.getPlayer(hp.id);
        if (record) {
          this.toast(
            record,
            'info',
            this.settings.allowRebuys
              ? `Out of chips! Rebuy for ${formatChips(this.settings.startingStack)} virtual chips whenever you're ready.`
              : 'Out of chips — you can keep watching the table.',
          );
        }
      }
    }
    this.syncLog(h);
    this.broadcast(HOLDEM_MSG.event, {
      type: 'win',
      handNumber: h.handNumber,
      seats: [...totals.keys()],
      amounts: [...totals.values()],
      uncontested: result.uncontested,
    } satisfies HoldemEvent);

    for (const seat of this.state.seats) {
      const record = seat.playerId ? this.getPlayer(seat.playerId) : undefined;
      if (record) record.state.score = seat.stack - seat.buyIns;
    }

    const occupied = this.state.seats.filter((s) => s.playerId && !s.left && s.index < this.state.tableSize);
    const gameOver = !this.settings.allowRebuys && bustedNow > 0 && occupied.filter((s) => s.stack > 0).length <= 1;
    const hostEnded = this.state.endRequested;
    const pause = result.uncontested ? this.timing.intermissionUncontested : this.timing.intermission;
    this.setPhase('INTERMISSION', pause);
    this.state.tableMessage = gameOver ? 'Final hand — last player standing!' : hostEnded ? 'That was the final hand.' : '';
    this.schedule('hand', pause, () => (gameOver ? this.finishGame() : hostEnded ? this.finishGame('host_ended') : this.startNextHand()));
  }

  /** Chips won per seat in a finished hand; also updates the leaderboard stats. */
  private tallyWins(h: HandState): Map<number, number> {
    const totals = new Map<number, number>();
    for (const w of h.result?.winners ?? []) totals.set(w.seat, (totals.get(w.seat) ?? 0) + w.amount);
    for (const [seat, amount] of totals) {
      const id = playerAt(h, seat)!.id;
      const stat = this.stats.get(id) ?? { handsWon: 0, bestPot: 0 };
      stat.handsWon++;
      stat.bestPot = Math.max(stat.bestPot, amount);
      this.stats.set(id, stat);
    }
    return totals;
  }

  // ===========================================================================
  // Clock
  // ===========================================================================

  private actionMs(): number {
    return this.timing.actionMs > 0 ? this.timing.actionMs : this.settings.actionSeconds * 1000;
  }

  /** Starts (or re-evaluates) the clock for the player to act. */
  private armTurnClock(reevaluate: boolean): void {
    const h = this.hand;
    if (!h || h.stage !== 'betting') return;
    const seat = h.toAct;
    const seq = this.state.actionSeq;
    const now = Date.now();
    if (this.turn.seat !== seat || this.turn.seq !== seq) {
      this.turn = { seat, seq, startedAt: now, ms: this.actionMs() };
    } else if (!reevaluate) return;
    const hp = playerAt(h, seat)!;
    const record = this.getPlayer(hp.id);
    let deadline = this.turn.startedAt + this.turn.ms;
    if (!record || record.away) deadline = Math.min(deadline, now + 1200);
    else if (!record.client) deadline = Math.min(deadline, now + this.timing.disconnectGrace);
    deadline = Math.max(deadline, now + 50);
    this.state.actionDeadline = deadline;
    this.state.actionMs = this.turn.ms;
    this.schedule('turn', deadline - now, () => this.onTurnTimeout(seat, seq));
  }

  private stopTurnClock(): void {
    this.cancel('turn');
    this.turn = { seat: -1, seq: -1, startedAt: 0, ms: 0 };
    this.state.actionDeadline = 0;
  }

  /** Recovers the loop if nothing is scheduled (e.g. after an unexpected error). */
  private watchdog(): void {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    if (this.isScheduled('hand') || this.isScheduled('street') || this.isScheduled('turn')) return;
    const h = this.hand;
    if (!h) {
      this.schedule('hand', this.timing.waitingPoll, () => this.startNextHand());
      return;
    }
    if (h.stage === 'betting') this.armTurnClock(true);
    else this.afterEngineChange();
  }

  // ===========================================================================
  // Public state projection
  // ===========================================================================

  private syncFromHand(h: HandState): void {
    const st = this.state;
    const exposed = new Set(exposedSeats(h));
    for (const hp of h.players) {
      const seat = st.seats[hp.seat]!;
      if (seat.playerId !== hp.id) continue;
      seat.inHand = true;
      seat.stack = hp.stack;
      seat.bet = hp.bet;
      seat.committed = hp.committed;
      seat.folded = hp.folded;
      seat.allIn = hp.allIn;
      seat.hasCards = !hp.folded && hp.hole.length > 0;
      seat.lastAction = hp.lastAction;
      seat.lastAmount = hp.lastAmount;
      if (exposed.has(hp.seat) && seat.shownCards.length === 0) seat.shownCards.push(...hp.hole);
      if (exposed.has(hp.seat) && h.board.length >= 3) seat.handLabel = evaluateBest([...hp.hole, ...h.board]).description;
    }
    if (st.board.length !== h.board.length) {
      st.board.clear();
      st.board.push(...h.board);
    }
    const pots = collectedPots(h);
    const same = st.pots.length === pots.length && pots.every((p, i) => st.pots[i]!.amount === p.amount && st.pots[i]!.eligible.join() === p.eligible.join());
    if (!same) {
      st.pots.clear();
      for (const p of pots) {
        const pot = new HoldemPot({ amount: p.amount });
        pot.eligible.push(...p.eligible);
        st.pots.push(pot);
      }
    }
    const street: HoldemStreet = h.stage === 'showdown' || (h.stage === 'complete' && !h.result?.uncontested) ? 'showdown' : h.street;
    st.street = street;
    st.button = h.button;
    st.sbSeat = h.sbSeat;
    st.bbSeat = h.bbSeat;
    st.toActSeat = h.stage === 'betting' ? h.toAct : -1;
    st.currentBet = h.currentBet;
    st.runout = h.runout;
    const legal = h.stage === 'betting' ? legalActions(h, h.toAct) : null;
    if (legal) {
      Object.assign(st.legal, {
        seat: legal.seat,
        canCheck: legal.canCheck,
        canCall: legal.canCall,
        callAmount: legal.callAmount,
        canRaise: legal.canRaise,
        isBet: legal.isBet,
        minRaiseTo: legal.minRaiseTo,
        maxRaiseTo: legal.maxRaiseTo,
      });
      st.minRaiseTo = legal.canRaise ? legal.minRaiseTo : 0;
    } else {
      this.resetLegal();
      st.minRaiseTo = 0;
    }
    this.syncLog(h);
  }

  private resetLegal(): void {
    Object.assign(this.state.legal, {
      seat: -1,
      canCheck: false,
      canCall: false,
      callAmount: 0,
      canRaise: false,
      isBet: false,
      minRaiseTo: 0,
      maxRaiseTo: 0,
    });
  }

  private clearHandView(): void {
    const st = this.state;
    st.board.clear();
    st.pots.clear();
    st.winners.clear();
    st.street = 'idle';
    st.button = this.prevButton;
    st.sbSeat = -1;
    st.bbSeat = -1;
    st.toActSeat = -1;
    st.actionDeadline = 0;
    st.currentBet = 0;
    st.minRaiseTo = 0;
    st.runout = false;
    this.resetLegal();
  }

  private applyBlindsPreview(): void {
    if (this.hand) return;
    const s = this.settings;
    if (this.phase === 'LOBBY') {
      this.state.smallBlind = s.smallBlind;
      this.state.bigBlind = s.bigBlind;
      this.state.blindLevel = 0;
      this.state.handsToNextLevel = s.blindIncreaseEvery;
    }
  }

  private syncLog(h: HandState): void {
    while (this.logCursor < h.log.length) this.pushLog(h.log[this.logCursor++]!, h.handNumber);
  }

  private pushLog(line: LogLine, hand = this.state.handNumber): void {
    this.state.log.push(new HoldemLogEntry({ hand, text: line.text, kind: line.kind }));
    const excess = this.state.log.length - HOLDEM_LOG_LIMIT;
    if (excess > 0) this.state.log.splice(0, excess);
  }

  // ===========================================================================
  // End of game
  // ===========================================================================

  /** A hand is in progress and its betting is still open (nothing about the pot is settled yet). */
  private handUndecided(): boolean {
    const h = this.hand;
    if (!h || h.stage === 'complete') return false;
    return h.stage === 'betting' || (!h.runout && h.stage !== 'showdown');
  }

  /**
   * Host "End game". An undecided hand is played to its end first — ending mid-bet would hand every
   * bet back, so a host facing a bet they'd lose could erase it. A decided hand (all-in runout,
   * showdown) or no hand at all ends the game now.
   */
  private requestEnd(): void {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    if (!this.handUndecided()) {
      this.finishGame('host_ended');
      return;
    }
    if (this.state.endRequested) return;
    this.state.endRequested = true;
    this.pushLog({ kind: 'info', text: 'The host is ending the game after this hand' });
    this.toast('all', 'info', 'The host is ending the game after this hand.');
  }

  private finishGame(reason: 'last_standing' | 'host_ended' = 'last_standing'): void {
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    this.state.endRequested = false;
    const h = this.hand;
    if (h && h.stage !== 'complete') {
      if (h.stage !== 'betting' && (h.runout || h.stage === 'showdown')) {
        // Nobody has a decision left and the hands may already be face up: the cards settle this
        // hand, not the host (ending the game must not refund an all-in the host is losing).
        while (h.stage === 'street-complete') dealNextStreet(h);
        if (h.stage === 'showdown') resolveShowdown(h, this.settings.showdownReveal);
        this.tallyWins(h);
      } else {
        // Betting is still open. Host controls never get here (they wait for the hand to finish:
        // requestEnd / hostEndsMatch); as a last resort nothing is decided yet, so every bet goes back.
        cancelHand(h);
      }
      this.syncLog(h);
      for (const hp of h.players) {
        const seat = this.state.seats[hp.seat]!;
        if (seat.playerId === hp.id && !seat.left) seat.stack = hp.stack;
      }
    }
    this.hand = null;
    this.lastHand = null;
    this.cancel('hand');
    this.cancel('street');
    this.stopTurnClock();
    this.clearHandView();
    for (const seat of this.state.seats) {
      if (seat.left) this.clearSeat(seat);
      else this.resetSeatHand(seat);
    }

    const rows = this.state.seats
      .filter((s) => s.playerId && this.getPlayer(s.playerId))
      .map((s) => ({ playerId: s.playerId, name: s.name, stack: s.stack, buyIns: s.buyIns, net: s.stack - s.buyIns }))
      .sort((a, b) => b.net - a.net || b.stack - a.stack || a.name.localeCompare(b.name));
    this.state.standings.clear();
    let rank = 0;
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      if (!prev || prev.net !== row.net || prev.stack !== row.stack) rank = i + 1;
      const stat = this.stats.get(row.playerId);
      this.state.standings.push(new HoldemStanding({ ...row, rank, handsWon: stat?.handsWon ?? 0, bestPot: stat?.bestPot ?? 0 }));
      const record = this.getPlayer(row.playerId);
      if (record) record.state.score = row.net;
    });
    this.state.tableMessage = '';
    this.pushLog({ kind: 'info', text: `Game over after ${this.state.handNumber} hand${this.state.handNumber === 1 ? '' : 's'}` });
    const standings = this.state.standings.map((s) => ({ ...s.toJSON() }));
    this.reportHoldemOutcome(standings, reason);
    this.endMatch({
      players: standings.map((s) => {
        const record = this.getPlayer(s.playerId);
        return { playerId: s.playerId, name: s.name, guestId: record?.guestId, userId: record?.userId, score: s.net, placement: s.rank };
      }),
      details: { hands: this.state.handNumber, leader: standings[0]?.name ?? null },
    });
    for (const p of this.players.values()) this.syncPrivate(p);
  }

  /**
   * DASCADE stats: places follow the final leaderboard (chip stack, net of buy-ins when rebuys differ;
   * equal rows share a place), players who left mid-game last; `scores` are final stacks.
   * A game ended before any hand was dealt is no contest.
   */
  private reportHoldemOutcome(standings: ReadonlyArray<{ playerId: string; rank: number; stack: number }>, reason: string): void {
    if (this.state.handNumber === 0) return;
    const placements = withLeaversLast(
      groupSorted(standings, (s) => s.playerId, (a, b) => a.rank === b.rank),
      this.matchLeaverIds(),
    );
    const scores: Record<string, number> = {};
    for (const s of standings) scores[s.playerId] = s.stack;
    const playerStats: Record<string, Record<string, number>> = {};
    for (const id of placements.flat()) {
      const stat = this.stats.get(id);
      playerStats[id] = { handsWon: stat?.handsWon ?? 0, bestPot: stat?.bestPot ?? 0 };
    }
    this.reportOutcome({ placements, scores, reason, details: { hands: this.state.handNumber, playerStats } });
  }
}
