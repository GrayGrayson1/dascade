/**
 * DASino — the casino-floor cabinet: European roulette, the Neon 7s slot machine
 * and Dice High/Low under one roof, sharing each player's VIRTUAL chip balance.
 *
 * Authority:
 *  - Every outcome (roulette number, reel stops, dice) is drawn here with the
 *    room's crypto RNG and settled with the pure engines in @dascade/game-core.
 *  - Clients only send intents (a spot + a chip, a pick + a chip, a spin bet).
 *    Payloads are strict Zod objects; spots are checked against the engine's
 *    full European bet map; balances, table limits and betting windows are
 *    checked on every message; betting and spins are rate limited.
 *  - Roulette and dice run continuous shared rounds while anyone is in the room.
 *    Slots are per player with one spin in flight at a time.
 *
 * Virtual chips only: no purchases, deposits, withdrawals or cash-out exist.
 */
import { RATE, randomId, type RateSpec } from '@dascade/shared';
import {
  DASINO_LIMITS,
  DASINO_MSG,
  DASINO_TIMING,
  DEFAULT_DASINO_SETTINGS,
  BetTableSchema,
  DasinoEmptySchema,
  DasinoSettingsSchema,
  DasinoTableSchema,
  DiceBetSchema,
  RouletteBetSchema,
  SlotSpinSchema,
  seatNet,
  type BetSlipEntry,
  type BetTable,
  type DasinoDicePick,
  type DasinoGame,
  type DasinoPrivatePayload,
  type DasinoSettings,
  type DasinoTiming,
  type RoundPayoutView,
  type SlotResultPayload,
} from '@dascade/shared/games/dasino';
import {
  SLOT_SYMBOL_NAMES,
  diceMinStake,
  diceOutcome,
  diceReturn,
  formatMultiplier,
  getRouletteBet,
  isDiceStakeOk,
  isPickOpen,
  pickMultiplier100,
  rollDice,
  rouletteColor,
  settleRouletteBet,
  spinRoulette,
  spinSlots,
  type DicePick,
} from '@dascade/game-core/dasino';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted, withLeaversLast } from '../outcomePlacements.ts';
import {
  DasinoSeat,
  DasinoState,
  DiceBetEntry,
  DiceHistoryEntry,
  ResultEntry,
  RouletteBetEntry,
  RoundPayout,
  TickerEntry,
} from './schema.ts';

/** One chip placement (or a batch from Rebet / Double) that Undo can take back. */
interface Placement {
  table: BetTable;
  round: number;
  items: Array<{ spot: string; amount: number }>;
}

/** The chips of a player who left mid-session, kept so rejoining can't reset a balance. */
interface DepartedSeat {
  balance: number;
  credited: number;
  refills: number;
  wagered: number;
  returned: number;
  biggestWin: number;
  spins: number;
}

/** Departed seats remembered per session (oldest dropped first). */
const MAX_DEPARTED = 256;

interface SeatPrivate {
  undo: Placement[];
  lastRoulette: BetSlipEntry[];
  lastDice: Array<{ pick: DasinoDicePick; amount: number }>;
  lastSlot: SlotResultPayload | null;
  slotBusyUntil: number;
  slotCounter: number;
}

const BET_RATE: RateSpec = { burst: 16, perSecond: 8 };
const BET_CONTROL_RATE: RateSpec = { burst: 8, perSecond: 3 };
const SPIN_RATE: RateSpec = { burst: 3, perSecond: 0.6 };
const TABLE_RATE: RateSpec = { burst: 6, perSecond: 2 };
/** Ticker threshold: a round returning at least this multiple of its stake. */
const BIG_WIN_MULTIPLE = 10;

export class DasinoRoom extends BaseGameRoom<DasinoState, DasinoSettings> {
  readonly gameId = 'dasino' as const;
  protected readonly settingsSchema = DasinoSettingsSchema;
  /** Round pacing (tests shorten these). */
  timing: DasinoTiming = { ...DASINO_TIMING };
  private readonly priv = new Map<string, SeatPrivate>();
  /** Seats of players who left this session, keyed by their guest id. */
  private readonly departed = new Map<string, DepartedSeat>();

  protected defaultSettings(): DasinoSettings {
    return structuredClone(DEFAULT_DASINO_SETTINGS);
  }

  protected createState(): DasinoState {
    return new DasinoState();
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected override onRoomCreated(): void {
    if (this.isSolo) this.countdownMs = 0;
    const playing = ['PLAYING'] as const;

    this.handle(DASINO_MSG.table, DasinoTableSchema, (p, { table }) => {
      const seat = this.seat(p);
      if (!seat) return this.reject(p, DASINO_MSG.table, 'not_allowed', 'Take a seat to play.');
      seat.table = table;
    }, { phases: playing, playersOnly: true, rate: TABLE_RATE });

    this.handle(DASINO_MSG.rouletteBet, RouletteBetSchema, (p, { spot, amount }) => this.placeRouletteBets(p, [{ spot, amount }], DASINO_MSG.rouletteBet), {
      phases: playing,
      playersOnly: true,
      rate: BET_RATE,
      bucket: 'dasino:bet',
    });

    this.handle(DASINO_MSG.diceBet, DiceBetSchema, (p, { pick, amount }) => this.placeDiceBets(p, [{ spot: pick, amount }], DASINO_MSG.diceBet), {
      phases: playing,
      playersOnly: true,
      rate: BET_RATE,
      bucket: 'dasino:bet',
    });

    this.handle(DASINO_MSG.undo, BetTableSchema, (p, { table }) => this.undo(p, table), {
      phases: playing,
      playersOnly: true,
      rate: BET_CONTROL_RATE,
      bucket: 'dasino:betctl',
    });

    this.handle(DASINO_MSG.clear, BetTableSchema, (p, { table }) => this.clearBets(p, table), {
      phases: playing,
      playersOnly: true,
      rate: BET_CONTROL_RATE,
      bucket: 'dasino:betctl',
    });

    this.handle(DASINO_MSG.rebet, BetTableSchema, (p, { table }) => this.rebet(p, table), {
      phases: playing,
      playersOnly: true,
      rate: BET_CONTROL_RATE,
      bucket: 'dasino:betctl',
    });

    this.handle(DASINO_MSG.double, BetTableSchema, (p, { table }) => this.double(p, table), {
      phases: playing,
      playersOnly: true,
      rate: BET_CONTROL_RATE,
      bucket: 'dasino:betctl',
    });

    this.handle(DASINO_MSG.spin, SlotSpinSchema, (p, { lineBet, lines }) => this.spinSlots(p, lineBet, lines), {
      phases: playing,
      playersOnly: true,
      rate: SPIN_RATE,
    });

    this.handle(DASINO_MSG.refill, DasinoEmptySchema, (p) => this.refill(p), { phases: playing, playersOnly: true, rate: RATE.action });

    this.handle(DASINO_MSG.sit, DasinoEmptySchema, (p) => this.takeSeat(p), { phases: playing, rate: TABLE_RATE });

    this.handle(DASINO_MSG.endSession, DasinoEmptySchema, () => this.endSession(), { phases: playing, hostOnly: true });
  }

  /**
   * The closing leaderboard ranks net chips, and a removed player drops to the bottom of it — so
   * while the floor is open, the host can't remove anyone who still has chips (e.g. the leader right
   * before closing the floor). Moderation works as usual before and after the session.
   */
  protected override kickBlocker(target: PlayerRecord): string | null {
    if (this.phase !== 'PLAYING') return null;
    const seat = this.state.seats.get(target.id);
    if (seat && seat.balance + seat.inPlay > 0) return 'Players with chips on the floor can’t be removed mid-session — close the floor first.';
    return null;
  }

  /** "Back to lobby" / "Close room" mid-session closes the floor properly first, so the session is reported. */
  protected override hostEndsMatch(): string | null {
    if (this.phase === 'PLAYING') this.endSession();
    return null;
  }

  protected onGameStart(): void {
    this.state.results.clear();
    this.departed.clear();
    for (const p of this.seatedPlayers()) this.ensureSeat(p);
    this.startRouletteRound();
    this.startDiceRound();
    for (const p of this.players.values()) this.syncPrivate(p);
  }

  protected override onPlayerJoined(player: PlayerRecord): void {
    if (this.isSolo && this.phase === 'LOBBY') {
      this.startMatch();
      return;
    }
    if (this.phase === 'PLAYING') {
      if (!player.state.spectator) this.ensureSeat(player);
      this.wakeTables();
    }
  }

  protected override onPlayerReconnected(): void {
    if (this.phase === 'PLAYING') this.wakeTables();
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    const seat = this.state.seats.get(player.id);
    if (seat && this.phase === 'PLAYING') {
      // Chips never vanish with a leaver: open bets come back, drawn spins/rolls settle now.
      this.cashOutFelt(player.id, seat);
      // Remember the seat so leaving and rejoining can't reset a balance (or a losing net).
      if (player.guestId && reason !== 'kicked') this.rememberSeat(player.guestId, seat);
    }
    this.priv.delete(player.id);
    removeWhere(this.state.roulette.bets, (b) => b.playerId === player.id);
    removeWhere(this.state.dice.bets, (b) => b.playerId === player.id);
    this.state.seats.delete(player.id);
  }

  protected override onReturnToLobby(): void {
    this.state.seats.clear();
    this.state.ticker.clear();
    this.state.results.clear();
    this.priv.clear();
    this.departed.clear();
    this.resetRoulette();
    this.resetDice();
  }

  protected override onRoomDisposed(): void {
    this.priv.clear();
    this.departed.clear();
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const priv = this.priv.get(player.id);
    const payload: DasinoPrivatePayload = {
      lastSlot: priv?.lastSlot ?? null,
      lastRoulette: priv?.lastRoulette ?? [],
      lastDice: priv?.lastDice ?? [],
    };
    this.sendTo(player, DASINO_MSG.private, payload);
  }

  // ===========================================================================
  // Seats & balances
  // ===========================================================================

  private seat(p: PlayerRecord): DasinoSeat | undefined {
    return this.state.seats.get(p.id);
  }

  private privFor(p: PlayerRecord | string): SeatPrivate {
    const id = typeof p === 'string' ? p : p.id;
    let priv = this.priv.get(id);
    if (!priv) {
      priv = { undo: [], lastRoulette: [], lastDice: [], lastSlot: null, slotBusyUntil: 0, slotCounter: 0 };
      this.priv.set(id, priv);
    }
    return priv;
  }

  private ensureSeat(p: PlayerRecord): DasinoSeat {
    let seat = this.state.seats.get(p.id);
    if (!seat) {
      seat = new DasinoSeat();
      seat.id = p.id;
      seat.balance = this.settings.startingBalance;
      seat.credited = this.settings.startingBalance;
      const back = p.guestId ? this.departed.get(p.guestId) : undefined;
      if (back && p.guestId) {
        this.departed.delete(p.guestId);
        seat.balance = back.balance;
        seat.credited = back.credited;
        seat.refills = back.refills;
        seat.wagered = back.wagered;
        seat.returned = back.returned;
        seat.biggestWin = back.biggestWin;
        seat.spins = back.spins;
        this.toast(p, 'info', `Welcome back — your ${fmt(back.balance)} chips were kept for you.`);
      }
      this.state.seats.set(p.id, seat);
      this.privFor(p);
    }
    this.touch(seat);
    return seat;
  }

  /** Mirrors the net result into the player's public score. */
  private touch(seat: DasinoSeat): void {
    const record = this.players.get(seat.id);
    if (record) record.state.score = seatNet(seat);
  }

  private rememberSeat(guestId: string, seat: DasinoSeat): void {
    this.departed.delete(guestId);
    this.departed.set(guestId, {
      balance: seat.balance,
      credited: seat.credited,
      refills: seat.refills,
      wagered: seat.wagered,
      returned: seat.returned,
      biggestWin: seat.biggestWin,
      spins: seat.spins,
    });
    while (this.departed.size > MAX_DEPARTED) this.departed.delete(this.departed.keys().next().value as string);
  }

  /**
   * Takes one player's chips off both felts: bets in an open (or closed, not yet
   * drawn) window are refunded, bets whose number/roll is already drawn settle
   * now against it (the later settlement no longer sees them). Mirrors endSession.
   */
  private cashOutFelt(playerId: string, seat: DasinoSeat): void {
    const r = this.state.roulette;
    if (r.phase === 'BETTING' || r.phase === 'CLOSED') {
      const refunded = removeWhere(r.bets, (b) => b.playerId === playerId).reduce((a, b) => a + b.amount, 0);
      if (refunded > 0) this.refund(seat, refunded);
    } else if (r.phase === 'SPINNING' && r.result >= 0) {
      const mine = removeWhere(r.bets, (b) => b.playerId === playerId);
      if (mine.length) {
        const settled = mine.map((b) => settleRouletteBet(b.spot, b.amount, r.result));
        this.settleSeat(seat, settled.reduce((a, x) => a + x.amount, 0), settled.reduce((a, x) => a + x.returned, 0));
      }
    }
    const d = this.state.dice;
    if (d.phase === 'BETTING') {
      const refunded = removeWhere(d.bets, (b) => b.playerId === playerId).reduce((a, b) => a + b.amount, 0);
      if (refunded > 0) this.refund(seat, refunded);
    } else if (d.phase === 'ROLLING') {
      const mine = removeWhere(d.bets, (b) => b.playerId === playerId);
      if (mine.length) {
        const point = d.pointA + d.pointB;
        const total = d.rollA + d.rollB;
        const staked = mine.reduce((a, b) => a + b.amount, 0);
        const returned = mine.reduce((a, b) => a + diceReturn(point, b.pick as DicePick, total, b.amount), 0);
        this.settleSeat(seat, staked, returned);
      }
    }
  }

  private hasAudience(): boolean {
    for (const p of this.players.values()) if (p.client) return true;
    return false;
  }

  private wakeTables(): void {
    if (this.state.roulette.phase === 'IDLE') this.startRouletteRound();
    if (this.state.dice.phase === 'IDLE') this.startDiceRound();
  }

  /** A spectator takes a free seat mid-session (a returning guest gets back the chips they left with). */
  private takeSeat(p: PlayerRecord): void {
    const type = DASINO_MSG.sit;
    if (!p.state.spectator) return this.reject(p, type, 'not_allowed', 'You already have a seat.');
    if (this.seatedPlayers().length >= this.state.maxPlayers) return this.reject(p, type, 'not_allowed', 'Every seat is taken right now.');
    p.state.spectator = false;
    p.state.queued = false;
    this.markMetadataDirty();
    this.ensureSeat(p);
    this.wakeTables();
    this.syncPrivate(p);
    this.systemChat(`${p.state.name} took a seat.`);
  }

  private refill(p: PlayerRecord): void {
    const seat = this.seat(p);
    if (!seat) return;
    if (!this.settings.allowRefills) return this.reject(p, DASINO_MSG.refill, 'not_allowed', 'Refills are turned off at this table.');
    if (seat.balance >= this.settings.minBet) {
      return this.reject(p, DASINO_MSG.refill, 'not_allowed', 'Refills are available once you drop below the minimum bet.');
    }
    if (seat.inPlay > 0) return this.reject(p, DASINO_MSG.refill, 'not_allowed', 'Wait for your bets on the felt to settle first.');
    const topUp = this.settings.startingBalance - seat.balance;
    seat.balance += topUp;
    seat.credited += topUp;
    seat.refills += 1;
    this.touch(seat);
    this.toast(p, 'success', `Refilled to ${this.settings.startingBalance.toLocaleString('en-US')} virtual chips.`);
  }

  // ===========================================================================
  // Betting (roulette + dice share the same slip mechanics)
  // ===========================================================================

  private betsOn(table: BetTable): Array<{ playerId: string; spot: string; amount: number }> {
    if (table === 'roulette') return this.state.roulette.bets as unknown as Array<{ playerId: string; spot: string; amount: number }>;
    return (this.state.dice.bets as unknown as Array<{ playerId: string; pick: string; amount: number }>).map((b) => ({ playerId: b.playerId, spot: b.pick, amount: b.amount }));
  }

  private roundOf(table: BetTable): number {
    return table === 'roulette' ? this.state.roulette.round : this.state.dice.round;
  }

  private bettingOpen(table: BetTable): boolean {
    return table === 'roulette' ? this.state.roulette.phase === 'BETTING' : this.state.dice.phase === 'BETTING';
  }

  /**
   * Validates a batch of placements atomically (all or nothing), then applies it.
   * Returns false (after rejecting) when anything is invalid.
   */
  private placeRouletteBets(p: PlayerRecord, items: Array<{ spot: string; amount: number }>, type: string, recordUndo = true): boolean {
    const seat = this.seat(p);
    if (!seat) {
      this.reject(p, type, 'not_allowed', 'Take a seat to play.');
      return false;
    }
    if (!this.bettingOpen('roulette')) {
      this.reject(p, type, 'wrong_phase', 'Bets are closed — wait for the next spin.');
      return false;
    }
    const mine = new Map<string, number>();
    for (const b of this.state.roulette.bets) if (b.playerId === p.id) mine.set(b.spot, b.amount);
    let total = 0;
    for (const item of items) {
      if (!getRouletteBet(item.spot)) {
        this.reject(p, type, 'invalid_payload', 'That isn’t a valid bet on a European table.');
        return false;
      }
      if (!this.chipOk(p, type, item.amount)) return false;
      const next = (mine.get(item.spot) ?? 0) + item.amount;
      if (next > this.settings.maxBet) {
        this.reject(p, type, 'not_allowed', `Table max is ${fmt(this.settings.maxBet)} per spot.`);
        return false;
      }
      mine.set(item.spot, next);
      total += item.amount;
    }
    if (mine.size > DASINO_LIMITS.maxRouletteSpots) {
      this.reject(p, type, 'not_allowed', `You can cover up to ${DASINO_LIMITS.maxRouletteSpots} spots per spin.`);
      return false;
    }
    if (total > seat.balance) {
      this.reject(p, type, 'insufficient_chips', 'Not enough chips for that bet.');
      return false;
    }
    for (const item of items) {
      const existing = this.state.roulette.bets.find((b) => b.playerId === p.id && b.spot === item.spot);
      if (existing) existing.amount += item.amount;
      else {
        const entry = new RouletteBetEntry();
        entry.playerId = p.id;
        entry.spot = item.spot;
        entry.amount = item.amount;
        this.state.roulette.bets.push(entry);
      }
    }
    this.debit(seat, total);
    if (recordUndo) this.pushUndo(p, 'roulette', items);
    return true;
  }

  private placeDiceBets(p: PlayerRecord, items: Array<{ spot: string; amount: number }>, type: string, recordUndo = true): boolean {
    const seat = this.seat(p);
    if (!seat) {
      this.reject(p, type, 'not_allowed', 'Take a seat to play.');
      return false;
    }
    if (!this.bettingOpen('dice')) {
      this.reject(p, type, 'wrong_phase', 'Bets are closed — the dice are rolling.');
      return false;
    }
    const point = this.state.dice.pointA + this.state.dice.pointB;
    const mine = new Map<string, number>();
    for (const b of this.state.dice.bets) if (b.playerId === p.id) mine.set(b.pick, b.amount);
    let total = 0;
    for (const item of items) {
      if (!isDicePick(item.spot)) {
        this.reject(p, type, 'invalid_payload', 'Pick Higher, Lower or Same.');
        return false;
      }
      if (!isPickOpen(point, item.spot)) {
        this.reject(p, type, 'not_allowed', `${cap(item.spot)} is closed on a point of ${point}.`);
        return false;
      }
      if (!this.chipOk(p, type, item.amount)) return false;
      const next = (mine.get(item.spot) ?? 0) + item.amount;
      if (next > this.settings.maxBet) {
        this.reject(p, type, 'not_allowed', `Table max is ${fmt(this.settings.maxBet)} per pick.`);
        return false;
      }
      if (!isDiceStakeOk(point, item.spot, next)) {
        const min = diceMinStake(point, item.spot);
        this.reject(p, type, 'not_allowed', `${cap(item.spot)} pays ${formatMultiplier(pickMultiplier100(point, item.spot))} — stake at least ${fmt(min)} chips so a win pays more than your bet.`);
        return false;
      }
      mine.set(item.spot, next);
      total += item.amount;
    }
    if (total > seat.balance) {
      this.reject(p, type, 'insufficient_chips', 'Not enough chips for that bet.');
      return false;
    }
    for (const item of items) {
      const existing = this.state.dice.bets.find((b) => b.playerId === p.id && b.pick === item.spot);
      if (existing) existing.amount += item.amount;
      else {
        const entry = new DiceBetEntry();
        entry.playerId = p.id;
        entry.pick = item.spot;
        entry.amount = item.amount;
        this.state.dice.bets.push(entry);
      }
    }
    this.debit(seat, total);
    if (recordUndo) this.pushUndo(p, 'dice', items);
    return true;
  }

  private chipOk(p: PlayerRecord, type: string, amount: number): boolean {
    if (!Number.isInteger(amount) || amount < this.settings.minBet) {
      this.reject(p, type, 'not_allowed', `Minimum chip is ${fmt(this.settings.minBet)}.`);
      return false;
    }
    if (amount > this.settings.maxBet) {
      this.reject(p, type, 'not_allowed', `Table max is ${fmt(this.settings.maxBet)}.`);
      return false;
    }
    return true;
  }

  private debit(seat: DasinoSeat, amount: number): void {
    seat.balance -= amount;
    seat.inPlay += amount;
    seat.wagered += amount;
    this.touch(seat);
  }

  /** Takes chips back off the felt (undo / clear / refunds). */
  private refund(seat: DasinoSeat, amount: number): void {
    seat.balance += amount;
    seat.inPlay = Math.max(0, seat.inPlay - amount);
    seat.wagered = Math.max(0, seat.wagered - amount);
    this.touch(seat);
  }

  private pushUndo(p: PlayerRecord, table: BetTable, items: Array<{ spot: string; amount: number }>): void {
    const priv = this.privFor(p);
    priv.undo.push({ table, round: this.roundOf(table), items: items.map((i) => ({ ...i })) });
    if (priv.undo.length > 200) priv.undo.splice(0, priv.undo.length - 200);
  }

  /** Removes chips from one of my spots; returns the amount actually removed. */
  private takeFromSpot(p: PlayerRecord, table: BetTable, spot: string, amount: number): number {
    if (table === 'roulette') {
      const bets = this.state.roulette.bets;
      const i = bets.findIndex((b) => b.playerId === p.id && b.spot === spot);
      if (i < 0) return 0;
      const entry = bets[i]!;
      const taken = Math.min(entry.amount, amount);
      entry.amount -= taken;
      if (entry.amount <= 0) bets.splice(i, 1);
      return taken;
    }
    const bets = this.state.dice.bets;
    const i = bets.findIndex((b) => b.playerId === p.id && b.pick === spot);
    if (i < 0) return 0;
    const entry = bets[i]!;
    const taken = Math.min(entry.amount, amount);
    entry.amount -= taken;
    if (entry.amount <= 0) bets.splice(i, 1);
    return taken;
  }

  private undo(p: PlayerRecord, table: BetTable): void {
    const seat = this.seat(p);
    if (!seat) return;
    if (!this.bettingOpen(table)) return this.reject(p, DASINO_MSG.undo, 'wrong_phase', 'Bets are locked in for this round.');
    const priv = this.privFor(p);
    const round = this.roundOf(table);
    for (let i = priv.undo.length - 1; i >= 0; i--) {
      const placement = priv.undo[i]!;
      if (placement.table !== table) continue;
      priv.undo.splice(i, 1);
      if (placement.round !== round) continue;
      let refunded = 0;
      for (const item of placement.items) refunded += this.takeFromSpot(p, table, item.spot, item.amount);
      if (refunded > 0) {
        this.refund(seat, refunded);
        return;
      }
    }
    this.reject(p, DASINO_MSG.undo, 'not_allowed', 'Nothing to undo.');
  }

  private clearBets(p: PlayerRecord, table: BetTable): void {
    const seat = this.seat(p);
    if (!seat) return;
    if (!this.bettingOpen(table)) return this.reject(p, DASINO_MSG.clear, 'wrong_phase', 'Bets are locked in for this round.');
    const refunded =
      table === 'roulette'
        ? removeWhere(this.state.roulette.bets, (b) => b.playerId === p.id).reduce((s, b) => s + b.amount, 0)
        : removeWhere(this.state.dice.bets, (b) => b.playerId === p.id).reduce((s, b) => s + b.amount, 0);
    const priv = this.privFor(p);
    priv.undo = priv.undo.filter((u) => u.table !== table);
    if (refunded > 0) this.refund(seat, refunded);
  }

  private rebet(p: PlayerRecord, table: BetTable): void {
    if (!this.seat(p)) return;
    const priv = this.privFor(p);
    const slip = table === 'roulette' ? priv.lastRoulette : priv.lastDice.map((d) => ({ spot: d.pick, amount: d.amount }));
    if (slip.length === 0) return this.reject(p, DASINO_MSG.rebet, 'not_allowed', 'No previous bets to repeat.');
    if (this.betsOn(table).some((b) => b.playerId === p.id)) {
      return this.reject(p, DASINO_MSG.rebet, 'not_allowed', 'Clear your current bets to rebet.');
    }
    if (table === 'roulette') this.placeRouletteBets(p, slip, DASINO_MSG.rebet);
    else this.placeDiceBets(p, slip, DASINO_MSG.rebet);
  }

  private double(p: PlayerRecord, table: BetTable): void {
    if (!this.seat(p)) return;
    const mine = this.betsOn(table)
      .filter((b) => b.playerId === p.id)
      .map((b) => ({ spot: b.spot, amount: b.amount }));
    if (mine.length === 0) return this.reject(p, DASINO_MSG.double, 'not_allowed', 'Place a bet first.');
    if (table === 'roulette') this.placeRouletteBets(p, mine, DASINO_MSG.double);
    else this.placeDiceBets(p, mine, DASINO_MSG.double);
  }

  // ===========================================================================
  // Roulette: BETTING → CLOSED → SPINNING → RESULT → BETTING …
  // ===========================================================================

  private resetRoulette(): void {
    const r = this.state.roulette;
    r.phase = 'IDLE';
    r.round = 0;
    r.endsAt = 0;
    r.result = -1;
    r.spinStartAt = 0;
    r.spinMs = 0;
    r.spinSeed = 0;
    r.bets.clear();
    r.history.clear();
    r.payouts.clear();
  }

  private startRouletteRound(): void {
    if (this.phase !== 'PLAYING') return;
    const r = this.state.roulette;
    r.bets.clear();
    if (!this.hasAudience()) {
      r.phase = 'IDLE';
      r.endsAt = 0;
      return;
    }
    const ms = this.settings.rouletteBettingSeconds * 1000;
    r.round += 1;
    r.phase = 'BETTING';
    r.endsAt = Date.now() + ms;
    r.payouts.clear();
    this.dropUndo('roulette');
    this.schedule('roulette', ms, () => this.closeRouletteBetting());
  }

  private closeRouletteBetting(): void {
    const r = this.state.roulette;
    r.phase = 'CLOSED';
    r.endsAt = Date.now() + this.timing.rouletteClosedMs;
    this.schedule('roulette', this.timing.rouletteClosedMs, () => this.spinRouletteWheel());
  }

  private spinRouletteWheel(): void {
    const r = this.state.roulette;
    const now = Date.now();
    r.result = spinRoulette(this.rng);
    r.spinSeed = this.rng.int(65_536);
    r.spinStartAt = now;
    r.spinMs = this.timing.rouletteSpinMs;
    r.phase = 'SPINNING';
    r.endsAt = now + this.timing.rouletteSpinMs;
    this.broadcast(DASINO_MSG.rouletteSpin, { round: r.round, result: r.result, startAt: now, durationMs: r.spinMs, seed: r.spinSeed });
    this.schedule('roulette', this.timing.rouletteSpinMs, () => this.settleRoulette());
  }

  private settleRoulette(): void {
    const r = this.state.roulette;
    const n = r.result;
    const byPlayer = new Map<string, { staked: number; returned: number; best: { spot: string; returned: number; amount: number } | null }>();
    for (const bet of r.bets) {
      const res = settleRouletteBet(bet.spot, bet.amount, n);
      const acc = byPlayer.get(bet.playerId) ?? { staked: 0, returned: 0, best: null };
      acc.staked += res.amount;
      acc.returned += res.returned;
      if (res.returned > 0 && (!acc.best || res.returned - res.amount > acc.best.returned - acc.best.amount)) {
        acc.best = { spot: res.spot, returned: res.returned, amount: res.amount };
      }
      byPlayer.set(bet.playerId, acc);
    }
    const payouts: RoundPayoutView[] = [];
    for (const [playerId, acc] of byPlayer) {
      const seat = this.state.seats.get(playerId);
      if (!seat) continue;
      this.settleSeat(seat, acc.staked, acc.returned);
      payouts.push({ playerId, staked: acc.staked, returned: acc.returned });
      const priv = this.privFor(playerId);
      priv.lastRoulette = r.bets.filter((b) => b.playerId === playerId).map((b) => ({ spot: b.spot, amount: b.amount }));
      const record = this.players.get(playerId);
      if (record) this.syncPrivate(record);
      if (acc.best && acc.returned >= acc.staked * BIG_WIN_MULTIPLE) {
        const label = `${n} ${rouletteColor(n)} · ${getRouletteBet(acc.best.spot)?.label ?? acc.best.spot}`;
        this.addTicker(playerId, 'roulette', acc.returned - acc.staked, acc.returned / acc.staked, label, Date.now());
      }
    }
    setPayouts(r.payouts, payouts);
    r.history.push(n);
    while (r.history.length > DASINO_LIMITS.historySize) r.history.shift();
    r.phase = 'RESULT';
    r.endsAt = Date.now() + this.timing.rouletteResultMs;
    this.broadcast(DASINO_MSG.rouletteSettled, { round: r.round, result: n, payouts });
    this.schedule('roulette', this.timing.rouletteResultMs, () => this.startRouletteRound());
  }

  // ===========================================================================
  // Dice High/Low: BETTING (point shown) → ROLLING → RESULT → next point = last roll
  // ===========================================================================

  private resetDice(): void {
    const d = this.state.dice;
    d.phase = 'IDLE';
    d.round = 0;
    d.endsAt = 0;
    d.pointA = 0;
    d.pointB = 0;
    d.rollA = 0;
    d.rollB = 0;
    d.rollStartAt = 0;
    d.rollMs = 0;
    d.bets.clear();
    d.history.clear();
    d.payouts.clear();
  }

  private startDiceRound(): void {
    if (this.phase !== 'PLAYING') return;
    const d = this.state.dice;
    d.bets.clear();
    if (!this.hasAudience()) {
      d.phase = 'IDLE';
      d.endsAt = 0;
      return;
    }
    if (d.rollA > 0 && d.rollB > 0) {
      d.pointA = d.rollA;
      d.pointB = d.rollB;
    } else {
      const [a, b] = rollDice(this.rng);
      d.pointA = a;
      d.pointB = b;
    }
    d.rollA = 0;
    d.rollB = 0;
    d.rollStartAt = 0;
    d.rollMs = 0;
    const ms = this.settings.diceBettingSeconds * 1000;
    d.round += 1;
    d.phase = 'BETTING';
    d.endsAt = Date.now() + ms;
    d.payouts.clear();
    this.dropUndo('dice');
    this.schedule('dice', ms, () => this.rollDiceRound());
  }

  private rollDiceRound(): void {
    const d = this.state.dice;
    const now = Date.now();
    const [a, b] = rollDice(this.rng);
    d.rollA = a;
    d.rollB = b;
    d.rollStartAt = now;
    d.rollMs = this.timing.diceRollMs;
    d.phase = 'ROLLING';
    d.endsAt = now + this.timing.diceRollMs;
    this.broadcast(DASINO_MSG.diceRoll, { round: d.round, point: d.pointA + d.pointB, a, b, startAt: now, durationMs: d.rollMs });
    this.schedule('dice', this.timing.diceRollMs, () => this.settleDice());
  }

  private settleDice(): void {
    const d = this.state.dice;
    const point = d.pointA + d.pointB;
    const total = d.rollA + d.rollB;
    const outcome = diceOutcome(point, total);
    const byPlayer = new Map<string, { staked: number; returned: number; slip: Array<{ pick: DasinoDicePick; amount: number }> }>();
    for (const bet of d.bets) {
      const pick = bet.pick as DicePick;
      const returned = diceReturn(point, pick, total, bet.amount);
      const acc = byPlayer.get(bet.playerId) ?? { staked: 0, returned: 0, slip: [] };
      acc.staked += bet.amount;
      acc.returned += returned;
      acc.slip.push({ pick, amount: bet.amount });
      byPlayer.set(bet.playerId, acc);
    }
    const payouts: RoundPayoutView[] = [];
    for (const [playerId, acc] of byPlayer) {
      const seat = this.state.seats.get(playerId);
      if (!seat) continue;
      this.settleSeat(seat, acc.staked, acc.returned);
      payouts.push({ playerId, staked: acc.staked, returned: acc.returned });
      this.privFor(playerId).lastDice = acc.slip;
      const record = this.players.get(playerId);
      if (record) this.syncPrivate(record);
      const m100 = pickMultiplier100(point, outcome);
      if (acc.returned > 0 && (acc.returned >= acc.staked * BIG_WIN_MULTIPLE || (outcome === 'same' && m100 >= 500))) {
        this.addTicker(playerId, 'dice', acc.returned - acc.staked, acc.returned / acc.staked, `${cap(outcome)} on ${point} · rolled ${total}`, Date.now());
      }
    }
    setPayouts(d.payouts, payouts);
    const h = new DiceHistoryEntry();
    h.round = d.round;
    h.point = point;
    h.a = d.rollA;
    h.b = d.rollB;
    h.outcome = outcome;
    d.history.push(h);
    while (d.history.length > DASINO_LIMITS.historySize) d.history.shift();
    d.phase = 'RESULT';
    d.endsAt = Date.now() + this.timing.diceResultMs;
    this.broadcast(DASINO_MSG.diceSettled, { round: d.round, point, total, outcome, payouts });
    this.schedule('dice', this.timing.diceResultMs, () => this.startDiceRound());
  }

  /** Moves a round's stakes off the felt and pays the returns. */
  private settleSeat(seat: DasinoSeat, staked: number, returned: number): void {
    seat.inPlay = Math.max(0, seat.inPlay - staked);
    seat.balance += returned;
    seat.returned += returned;
    seat.biggestWin = Math.max(seat.biggestWin, returned - staked);
    this.touch(seat);
  }

  private dropUndo(table: BetTable): void {
    for (const priv of this.priv.values()) priv.undo = priv.undo.filter((u) => u.table !== table);
  }

  // ===========================================================================
  // Slots: per player, settled on the server before the reels animate
  // ===========================================================================

  private spinSlots(p: PlayerRecord, lineBet: number, lines: number): void {
    const seat = this.seat(p);
    if (!seat) return this.reject(p, DASINO_MSG.spin, 'not_allowed', 'Take a seat to play.');
    const priv = this.privFor(p);
    const now = Date.now();
    if (now < priv.slotBusyUntil) return this.reject(p, DASINO_MSG.spin, 'not_allowed', 'Your reels are still spinning.');
    const totalBet = lineBet * lines;
    if (totalBet < this.settings.minBet) return this.reject(p, DASINO_MSG.spin, 'not_allowed', `Minimum total bet is ${fmt(this.settings.minBet)}.`);
    if (totalBet > this.settings.maxBet) return this.reject(p, DASINO_MSG.spin, 'not_allowed', `Maximum total bet is ${fmt(this.settings.maxBet)}.`);
    if (totalBet > seat.balance) return this.reject(p, DASINO_MSG.spin, 'insufficient_chips', 'Not enough chips for that spin.');

    const outcome = spinSlots(this.rng, lineBet, lines);
    seat.balance += outcome.totalWin - totalBet;
    seat.wagered += totalBet;
    seat.returned += outcome.totalWin;
    seat.spins += 1;
    seat.biggestWin = Math.max(seat.biggestWin, outcome.totalWin - totalBet);
    this.touch(seat);
    priv.slotBusyUntil = now + this.timing.slotSpinMs;
    priv.slotCounter += 1;

    const result: SlotResultPayload = {
      id: priv.slotCounter,
      stops: outcome.stops,
      lines,
      lineBet,
      totalBet,
      wins: outcome.wins.map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, multiplier: w.multiplier, pay: w.pay, cells: w.cells })),
      totalWin: outcome.totalWin,
      balance: seat.balance,
      at: now,
    };
    priv.lastSlot = result;
    this.sendTo(p, DASINO_MSG.slotResult, result);

    if (outcome.totalWin >= totalBet * BIG_WIN_MULTIPLE) {
      const top = [...outcome.wins].sort((a, b) => b.pay - a.pay)[0];
      const label = top ? `${top.count}× ${SLOT_SYMBOL_NAMES[top.symbol]}` : 'Neon 7s';
      // Revealed on the ticker once the spinner's reels have stopped.
      this.addTicker(p.id, 'slots', outcome.totalWin - totalBet, outcome.totalWin / totalBet, label, now + this.timing.slotRevealMs);
    }
  }

  // ===========================================================================
  // Ticker + session end
  // ===========================================================================

  private addTicker(playerId: string, game: DasinoGame, amount: number, multiple: number, label: string, at: number): void {
    const record = this.players.get(playerId);
    const entry = new TickerEntry();
    entry.id = randomId(8, this.rng);
    entry.playerId = playerId;
    entry.name = record?.state.name ?? 'Player';
    entry.game = game;
    entry.amount = amount;
    entry.multiple = Math.round(multiple * 100) / 100;
    entry.label = label.slice(0, 60);
    entry.at = at;
    this.state.ticker.push(entry);
    while (this.state.ticker.length > DASINO_LIMITS.tickerSize) this.state.ticker.shift();
    this.broadcast(DASINO_MSG.bigWin, { id: entry.id, playerId, name: entry.name, game, amount, multiple: entry.multiple, label: entry.label, at });
  }

  /** Host closes the floor: settles/refunds the felt and publishes the leaderboard. */
  private endSession(): void {
    // Spins already decided are settled now; open betting windows are refunded.
    const r = this.state.roulette;
    if (r.phase === 'SPINNING') this.settleRoulette();
    else if (r.phase === 'BETTING' || r.phase === 'CLOSED') this.refundTable('roulette');
    const d = this.state.dice;
    if (d.phase === 'ROLLING') this.settleDice();
    else if (d.phase === 'BETTING') this.refundTable('dice');
    this.cancel('roulette');
    this.cancel('dice');
    r.phase = 'IDLE';
    r.endsAt = 0;
    d.phase = 'IDLE';
    d.endsAt = 0;

    const rows = [...this.state.seats.values()]
      .map((seat) => ({ seat, record: this.players.get(seat.id) }))
      .filter((x) => x.record)
      .sort((a, b) => seatNet(b.seat) - seatNet(a.seat) || b.seat.balance - a.seat.balance);
    this.state.results.clear();
    let placement = 0;
    let lastNet: number | null = null;
    rows.forEach(({ seat, record }, i) => {
      const net = seatNet(seat);
      if (net !== lastNet) placement = i + 1;
      lastNet = net;
      const entry = new ResultEntry();
      entry.playerId = seat.id;
      entry.name = record!.state.name;
      entry.avatar = record!.state.avatar;
      entry.color = record!.state.color;
      entry.placement = placement;
      entry.net = net;
      entry.balance = seat.balance + seat.inPlay;
      entry.wagered = seat.wagered;
      entry.biggestWin = seat.biggestWin;
      entry.refills = seat.refills;
      this.state.results.push(entry);
    });
    this.reportDasinoOutcome();
    this.endMatch({
      players: this.state.results.map((e) => ({
        playerId: e.playerId,
        name: e.name,
        guestId: this.players.get(e.playerId)?.guestId,
        userId: this.players.get(e.playerId)?.userId,
        score: e.net,
        placement: e.placement,
      })),
      details: { spins: r.round, diceRounds: d.round },
    });
  }

  /**
   * DASCADE stats: places follow the closing leaderboard (chip balance, net of refills; equal nets
   * share a place), players who left mid-session last; `scores` are final balances. Solo sessions
   * count too (the house is the opponent). A session where nobody ever bet is no contest.
   */
  private reportDasinoOutcome(): void {
    const results = [...this.state.results];
    if (!results.some((e) => e.wagered > 0)) return;
    const placements = withLeaversLast(
      groupSorted(results, (e) => e.playerId, (a, b) => a.placement === b.placement),
      this.matchLeaverIds(),
    );
    const scores: Record<string, number> = {};
    const playerStats: Record<string, Record<string, number>> = {};
    for (const e of results) {
      scores[e.playerId] = e.balance;
      playerStats[e.playerId] = { chipsWagered: e.wagered, bestWin: e.biggestWin };
    }
    this.reportOutcome({
      placements,
      scores,
      reason: 'session_closed',
      details: { spins: this.state.roulette.round, diceRounds: this.state.dice.round, playerStats },
    });
  }

  private refundTable(table: BetTable): void {
    const removed =
      table === 'roulette'
        ? removeWhere(this.state.roulette.bets, () => true).map((b) => ({ playerId: b.playerId, amount: b.amount }))
        : removeWhere(this.state.dice.bets, () => true).map((b) => ({ playerId: b.playerId, amount: b.amount }));
    for (const b of removed) {
      const seat = this.state.seats.get(b.playerId);
      if (seat) this.refund(seat, b.amount);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDicePick(value: string): value is DicePick {
  return value === 'higher' || value === 'lower' || value === 'same';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Removes matching items from a schema array in place; returns the removed items. */
function removeWhere<T>(arr: { length: number; splice(start: number, deleteCount?: number): T[]; [i: number]: T }, pred: (item: T) => boolean): T[] {
  const removed: T[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i] as T;
    if (pred(item)) {
      removed.push(item);
      arr.splice(i, 1);
    }
  }
  return removed.reverse();
}

function setPayouts(target: { clear(): void; push(...items: RoundPayout[]): number }, payouts: RoundPayoutView[]): void {
  target.clear();
  for (const p of payouts) {
    const entry = new RoundPayout();
    entry.playerId = p.playerId;
    entry.staked = p.staked;
    entry.returned = p.returned;
    target.push(entry);
  }
}
