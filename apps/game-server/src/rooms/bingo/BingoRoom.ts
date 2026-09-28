/**
 * DAS Bingo — authoritative room.
 *
 * - Cards are dealt from a per-match seed (reproducible, revealed at the end) and sent
 *   privately; other players' cards stay hidden until a verified win reveals them. A fixed
 *   seed is never part of the (public) settings: only the host who typed it ever sees it, and
 *   each game deals from a one-way per-game seed derived from it — the one revealed at the end
 *   of a game says nothing about the next game's cards.
 * - Calls come only from the server: the automatic caller or the host's manual caller.
 *   Draws use the room's crypto RNG.
 * - Claims carry no data. The server checks the claimant's real card against the real call
 *   list (never client marks). The first valid claim stops the caller and opens a short
 *   tie window; other valid claims inside it share the round.
 * - A false claim locks the claimant out for the configured penalty.
 * - A card dealt mid-round (late join, or leaving and rejoining as a new player) only counts
 *   calls made after it was dealt, so re-rolling a card can't cash in balls already drawn.
 * - Balls hand-picked by the manual caller are the only ones that can be undone, and whoever
 *   picked a ball in the current call sequence can't win with it (the caller doesn't play).
 */
import { createHash } from 'node:crypto';
import { randomId } from '@dascade/shared';
import {
  BINGO_EXHAUSTED_GRACE_MS,
  BINGO_MSG,
  BingoCallerModeSchema,
  BingoCallSchema,
  BingoClaimSchema,
  BingoEmptySchema,
  BingoMarkSchema,
  BingoPauseSchema,
  BingoSeedSchema,
  BingoSettingsSchema,
  BingoSpeedSchema,
  DEFAULT_BINGO_SETTINGS,
  type BingoCardPayload,
  type BingoClaimReason,
  type BingoClaimResultPayload,
  type BingoEvent,
  type BingoPlanRound,
  type BingoRoundStatus,
  type BingoSeedPayload,
  type BingoSettings,
} from '@dascade/shared/games/bingo';
import {
  FREE,
  boardSpec,
  buildPlan,
  callLabel,
  dealCard,
  drawToken,
  isCallable,
  remainingTokens,
  resolveRound,
  roundsInPlay,
  setupProblems,
  squaresToGo,
  validateClaim,
  type BoardSpec,
  type ResolvedPattern,
} from '@dascade/game-core/bingo';
import { BaseGameRoom, type PlayerRecord } from '../BaseGameRoom.ts';
import { BingoPlayer, BingoState, BingoWinner } from './BingoState.ts';

interface CardRecord {
  deal: number;
  serial: number;
  cells: number[];
  marks: Set<number>;
  /** Calls before this index in state.calls don't count on this card (dealt mid-round). */
  fromCall: number;
}

/** Pause between a round starting and its first automatic call. */
const FIRST_CALL_DELAY_MS = 2200;

const T = {
  call: 'bingo-call',
  claimWindow: 'bingo-claim-window',
  exhausted: 'bingo-exhausted',
  next: 'bingo-next',
} as const;

export class BingoRoom extends BaseGameRoom<BingoState, BingoSettings> {
  readonly gameId = 'bingo' as const;
  protected readonly settingsSchema = BingoSettingsSchema;

  private spec: BoardSpec = boardSpec(DEFAULT_BINGO_SETTINGS);
  private plan: BingoPlanRound[] = [];
  private roundPatterns: ResolvedPattern[] = [];
  private items: string[] = [];
  private matchSeed = '';
  /** Host-chosen fixed card seed ('' = random per match). Private: knowing it reveals every card. */
  private customSeed = '';
  /** Who typed the fixed seed; only they are ever sent its value. */
  private customSeedBy = '';
  /** Games dealt from the current fixed seed (game N deals from fixedGameSeed(seed, N)). */
  private customSeedGames = 0;
  private readonly cards = new Map<string, CardRecord>();
  private dealKeys = new Set<string>();
  private serialCounter = 0;
  /** For each call in the current sequence: the player who hand-picked it, or null for a random draw. */
  private callPicker: Array<string | null> = [];
  /** Calls up to this count are referenced by an accepted claim and can't be undone. */
  private undoFloor = 0;
  private readonly roundWinnerIds = new Set<string>();
  private readonly everWon = new Set<string>();

  protected defaultSettings(): BingoSettings {
    return structuredClone(DEFAULT_BINGO_SETTINGS);
  }

  protected createState(): BingoState {
    return new BingoState();
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(): void {
    this.handle(BINGO_MSG.claim, BingoClaimSchema, (p) => this.handleClaim(p), {
      phases: ['PLAYING', 'INTERMISSION', 'RESULTS'],
      playersOnly: true,
      rate: { burst: 3, perSecond: 1 },
    });

    this.handle(
      BINGO_MSG.mark,
      BingoMarkSchema,
      (p, { cell, marked }) => {
        const card = this.cards.get(p.id);
        if (!card || cell >= card.cells.length || card.cells[cell] === FREE) return;
        if (marked) card.marks.add(cell);
        else card.marks.delete(cell);
      },
      { phases: ['PLAYING', 'INTERMISSION'], playersOnly: true, silent: true, rate: { burst: 40, perSecond: 15 }, maxNodes: 8 },
    );

    this.handle(BINGO_MSG.call, BingoCallSchema, (p, payload) => this.handleHostCall(p, payload?.value), {
      phases: ['PLAYING'],
      hostOnly: true,
      rate: { burst: 6, perSecond: 3 },
    });

    this.handle(BINGO_MSG.undo, BingoEmptySchema, (p) => this.handleUndo(p), { phases: ['PLAYING'], hostOnly: true });

    this.handle(
      BINGO_MSG.setSeed,
      BingoSeedSchema,
      (p, { seed }) => {
        if (seed !== this.customSeed) this.customSeedGames = 0;
        this.customSeed = seed;
        this.customSeedBy = seed ? p.id : '';
        this.state.customSeed = seed !== '';
        this.sendSeed(p);
      },
      { phases: ['LOBBY'], hostOnly: true, rate: { burst: 20, perSecond: 5 } },
    );

    this.handle(
      BINGO_MSG.pause,
      BingoPauseSchema,
      (_p, { paused }) => {
        if (this.state.paused === paused) return;
        this.state.paused = paused;
        if (paused) {
          this.stopCaller();
          this.systemChat('The host paused the caller.');
        } else {
          this.systemChat('The caller is back!');
          this.resumeAutoCaller(this.state.callIntervalMs);
        }
      },
      { phases: ['PLAYING', 'INTERMISSION'], hostOnly: true },
    );

    this.handle(
      BINGO_MSG.speed,
      BingoSpeedSchema,
      (_p, { seconds }) => {
        this.state.callIntervalMs = seconds * 1000;
        if (this.isScheduled(T.call)) {
          const due = Math.max(this.state.lastCallAt + this.state.callIntervalMs, Date.now() + 600);
          this.scheduleNextCall(due - Date.now());
        }
      },
      { phases: ['PLAYING', 'INTERMISSION'], hostOnly: true },
    );

    this.handle(
      BINGO_MSG.callerMode,
      BingoCallerModeSchema,
      (_p, { mode }) => {
        if (this.state.callerMode === mode) return;
        this.state.callerMode = mode;
        if (mode === 'manual') this.stopCaller();
        else this.resumeAutoCaller(Math.min(this.state.callIntervalMs, 3000));
        this.updateCanUndo();
        this.systemChat(mode === 'manual' ? 'The host is calling balls by hand.' : 'The automatic caller took over.');
      },
      { phases: ['PLAYING', 'INTERMISSION'], hostOnly: true },
    );

    this.handle(
      BINGO_MSG.nextRound,
      BingoEmptySchema,
      () => {
        this.cancel(T.next);
        this.startRound(this.state.round + 1);
      },
      { phases: ['INTERMISSION'], hostOnly: true },
    );

    this.handle(
      BINGO_MSG.endGame,
      BingoEmptySchema,
      () => {
        if (this.state.roundStatus !== 'closed') this.closeRound('ended');
        else this.finishMatch();
      },
      { phases: ['PLAYING', 'INTERMISSION'], hostOnly: true },
    );
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected override validateStart(): string | null {
    return setupProblems(this.settings)[0] ?? null;
  }

  protected onGameStart(): void {
    const s = this.settings;
    this.spec = boardSpec(s);
    this.items = [...s.items];
    this.plan = buildPlan(s, this.spec);
    // A fixed seed is never dealt from (or revealed) directly: each game gets its own one-way seed.
    this.matchSeed = this.customSeed ? fixedGameSeed(this.customSeed, ++this.customSeedGames) : randomId(12, this.rng);
    this.cards.clear();
    this.everWon.clear();
    this.roundWinnerIds.clear();

    const st = this.state;
    st.matchId = randomId(10, this.rng);
    st.mode = this.spec.mode;
    st.size = this.spec.size;
    st.free = this.spec.free;
    st.poolSize = this.spec.poolSize;
    st.totalRounds = this.plan.length;
    st.planJson = JSON.stringify(this.plan);
    st.callerMode = s.callerMode;
    st.manualPick = s.manualPick;
    st.callIntervalMs = s.callSeconds * 1000;
    st.paused = false;
    st.showProgress = s.showProgress;
    st.autoMark = s.autoMark;
    st.seed = '';
    st.deal = 0;
    st.winners.clear();
    st.calls.clear();
    st.bingo.clear();
    this.startRound(1);
  }

  protected override onPlayerJoined(player: PlayerRecord): void {
    if ((this.phase === 'PLAYING' || this.phase === 'INTERMISSION') && !player.state.spectator && this.state.deal > 0) {
      this.dealTo(player);
      this.refreshNeeds();
    }
  }

  protected override onPlayerRemoved(player: PlayerRecord): void {
    this.cards.delete(player.id);
    this.state.bingo.delete(player.id);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    if (this.cards.has(player.id)) this.sendCard(player);
    if (this.isHost(player)) this.sendSeed(player);
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next) this.sendSeed(next);
  }

  /**
   * Tell the host about the fixed seed. Its value only goes to the host who typed it, and only in
   * LOBBY/RESULTS: mid-match a host (even one who inherits or regains the role) just learns one is set,
   * because the seed reveals every card in play.
   */
  private sendSeed(player: PlayerRecord): void {
    const mine = player.id === this.customSeedBy && (this.phase === 'LOBBY' || this.phase === 'RESULTS');
    const payload: BingoSeedPayload = { seed: mine ? this.customSeed : '', hidden: !mine && this.customSeed !== '' };
    this.sendTo(player, BINGO_MSG.seed, payload);
  }

  protected override onReturnToLobby(): void {
    const st = this.state;
    this.cards.clear();
    this.everWon.clear();
    this.roundWinnerIds.clear();
    this.callPicker = [];
    this.undoFloor = 0;
    this.plan = [];
    this.roundPatterns = [];
    st.matchId = '';
    st.planJson = '[]';
    st.roundStatus = 'idle';
    st.calls.clear();
    st.winners.clear();
    st.bingo.clear();
    st.lastCallAt = 0;
    st.nextCallAt = 0;
    st.paused = false;
    st.canUndo = false;
    st.claimWindowEndsAt = 0;
    st.deal = 0;
    st.seed = '';
  }

  // ===========================================================================
  // Rounds
  // ===========================================================================

  private startRound(n: number): void {
    const round = roundsInPlay(this.settings)[n - 1];
    if (!round) {
      this.finishMatch();
      return;
    }
    const st = this.state;
    this.cancel(T.next);
    st.round = n;
    this.roundPatterns = resolveRound(round, this.spec.size).patterns;
    this.roundWinnerIds.clear();
    const freshCalls = n === 1 || !this.settings.continueCalls;
    const freshCards = n === 1 || this.settings.newCardsEachRound;
    if (freshCalls) {
      st.calls.clear();
      this.callPicker = [];
      this.undoFloor = 0;
      st.lastCallAt = 0;
      if (!freshCards) this.restartKeptCards();
    } else {
      // Carried-over calls were already part of an accepted result; they stay put.
      this.undoFloor = st.calls.length;
    }
    if (freshCards) this.dealAll();
    st.claimWindowEndsAt = 0;
    st.roundStatus = 'calling' satisfies BingoRoundStatus;
    this.setPhase('PLAYING');
    const plan = this.plan[n - 1];
    st.statusText = `${this.plan.length > 1 ? `Round ${n} of ${this.plan.length} · ` : ''}${plan?.title ?? ''}`;
    this.refreshNeeds();
    this.updateCanUndo();
    if (remainingTokens(this.spec, [...st.calls]).length === 0) this.onBagEmpty();
    else this.resumeAutoCaller(FIRST_CALL_DELAY_MS);
  }

  private closeRound(reason: 'won' | 'exhausted' | 'ended'): void {
    const st = this.state;
    if (st.roundStatus === 'closed') return;
    this.stopCaller();
    this.cancel(T.claimWindow);
    this.cancel(T.exhausted);
    st.roundStatus = 'closed' satisfies BingoRoundStatus;
    st.claimWindowEndsAt = 0;
    this.updateCanUndo();
    const winners = st.winners.filter((w) => w.round === st.round).map((w) => w.name);
    this.emitEvent({ kind: 'roundOver', round: st.round, winners, reason });
    if (reason === 'exhausted') this.systemChat('Every ball was called and nobody claimed — round over.');
    if (reason !== 'ended' && st.round < this.plan.length) {
      const ms = this.settings.intermissionSec * 1000;
      this.setPhase('INTERMISSION', ms);
      const next = this.plan[st.round];
      st.statusText = `Up next: round ${st.round + 1} · ${next?.title ?? ''}`;
      const upcoming = st.round + 1;
      this.schedule(T.next, ms, () => this.startRound(upcoming));
    } else {
      this.finishMatch();
    }
  }

  private finishMatch(): void {
    const st = this.state;
    this.stopCaller();
    this.cancel(T.next);
    this.cancel(T.claimWindow);
    this.cancel(T.exhausted);
    st.roundStatus = 'closed';
    st.canUndo = false;
    st.seed = this.matchSeed;
    st.statusText = st.winners.length ? 'Game over' : 'Game over — no winners this time';
    const ranked = this.seatedPlayers()
      .map((p) => ({ p, wins: st.bingo.get(p.id)?.wins ?? 0 }))
      .sort((a, b) => b.wins - a.wins || a.p.state.joinOrder - b.p.state.joinOrder);
    this.reportBingoOutcome();
    this.endMatch({
      players: ranked.map(({ p, wins }, i) => ({
        playerId: p.id,
        name: p.state.name,
        guestId: p.guestId,
        userId: p.userId,
        score: wins,
        placement: i + 1,
      })),
      details: {
        mode: this.spec.mode,
        size: this.spec.size,
        rounds: this.plan.length,
        calls: st.calls.length,
        winners: st.winners.map((w) => w.name),
      },
    });
  }

  /**
   * DASCADE stats: everyone who called a verified bingo shares first place, everyone else (leavers
   * included) shares second; a game nobody won is a draw. Ended before a single ball was called = no contest.
   */
  private reportBingoOutcome(): void {
    const st = this.state;
    if (st.winners.length === 0 && st.calls.length === 0 && st.round <= 1) return;
    const bingos = new Map<string, number>();
    for (const w of st.winners) bingos.set(w.playerId, (bingos.get(w.playerId) ?? 0) + 1);
    const winners = [...bingos.keys()];
    const others = [...this.seatedPlayers().map((p) => p.id), ...this.matchLeaverIds()].filter((id) => !bingos.has(id));
    const placements = [winners, others].filter((g) => g.length > 0);
    const playerStats: Record<string, Record<string, number>> = {};
    for (const id of placements.flat()) playerStats[id] = { bingos: bingos.get(id) ?? 0 };
    this.reportOutcome({
      placements,
      reason: winners.length ? 'bingo' : 'no_winner',
      details: { mode: this.spec.mode, rounds: this.plan.length, playerStats },
    });
  }

  // ===========================================================================
  // Cards
  // ===========================================================================

  private dealAll(): void {
    this.state.deal += 1;
    this.dealKeys = new Set();
    this.serialCounter = 0;
    this.cards.clear();
    // Everyone is dealt at the same moment, so every call (including carried ones) counts.
    for (const p of this.seatedPlayers()) this.dealTo(p, 0);
  }

  /** Deal one card. `fromCall` defaults to "now": a mid-round card can't use balls drawn before it existed. */
  private dealTo(player: PlayerRecord, fromCall = this.state.calls.length): void {
    const serial = ++this.serialCounter;
    const { cells } = dealCard(this.spec, this.matchSeed, this.state.deal, serial, this.dealKeys);
    this.cards.set(player.id, { deal: this.state.deal, serial, cells, marks: new Set(), fromCall });
    const view = this.viewFor(player);
    view.hasCard = true;
    this.sendCard(player);
  }

  private viewFor(player: PlayerRecord): BingoPlayer {
    let view = this.state.bingo.get(player.id);
    if (!view) {
      view = new BingoPlayer();
      view.id = player.id;
      this.state.bingo.set(player.id, view);
    }
    return view;
  }

  private sendCard(player: PlayerRecord): void {
    const card = this.cards.get(player.id);
    if (!card) return;
    const payload: BingoCardPayload = {
      matchId: this.state.matchId,
      deal: card.deal,
      serial: card.serial,
      size: this.spec.size,
      cells: [...card.cells],
      marks: [...card.marks],
      fromCall: card.fromCall,
      lockedUntil: this.state.bingo.get(player.id)?.lockedUntil ?? 0,
    };
    this.sendTo(player, BINGO_MSG.card, payload);
  }

  /** Calls that count on this card (everything since it was dealt). */
  private callsFor(card: CardRecord): number[] {
    const calls = [...this.state.calls];
    return card.fromCall > 0 ? calls.slice(card.fromCall) : calls;
  }

  /**
   * A new call sequence on the cards players keep: late cards now see every call of it, and the
   * daubs from the old sequence are wiped (they'd mark squares that aren't called any more — and
   * tempt a false claim). Every kept card is re-sent.
   */
  private restartKeptCards(): void {
    const n = this.state.calls.length;
    for (const [id, card] of this.cards) {
      card.fromCall = Math.min(card.fromCall, n);
      card.marks.clear();
      const player = this.players.get(id);
      if (player) this.sendCard(player);
    }
  }

  /** Keep late cards' starting points inside the call list (after an undo or a cleared sequence). */
  private clampLateCards(): void {
    const n = this.state.calls.length;
    for (const [id, card] of this.cards) {
      if (card.fromCall <= n) continue;
      card.fromCall = n;
      const player = this.players.get(id);
      if (player) this.sendCard(player);
    }
  }

  private refreshNeeds(): void {
    const called = new Set(this.state.calls);
    const show = this.settings.showProgress;
    for (const [id, view] of this.state.bingo) {
      const card = this.cards.get(id);
      view.hasCard = Boolean(card);
      if (!card || !show || !this.roundPatterns.length) {
        view.need = -1;
        continue;
      }
      view.need = squaresToGo(card.cells, card.fromCall > 0 ? new Set(this.callsFor(card)) : called, this.roundPatterns);
    }
  }

  // ===========================================================================
  // Caller
  // ===========================================================================

  private scheduleNextCall(ms: number): void {
    const delay = Math.max(0, ms);
    this.state.nextCallAt = Date.now() + delay;
    this.schedule(T.call, delay, () => this.autoCall());
  }

  private stopCaller(): void {
    this.cancel(T.call);
    this.state.nextCallAt = 0;
  }

  private resumeAutoCaller(delayMs: number): void {
    const st = this.state;
    if (this.phase !== 'PLAYING' || st.roundStatus !== 'calling' || st.callerMode !== 'auto' || st.paused) return;
    if (remainingTokens(this.spec, [...st.calls]).length === 0) return;
    this.scheduleNextCall(delayMs);
  }

  private autoCall(): void {
    const st = this.state;
    if (this.phase !== 'PLAYING' || st.roundStatus !== 'calling' || st.callerMode !== 'auto' || st.paused) return;
    const token = drawToken(this.spec, [...st.calls], this.rng);
    if (token === null) this.onBagEmpty();
    else this.performCall(token, null);
  }

  private handleHostCall(host: PlayerRecord, value: number | undefined): void {
    const st = this.state;
    if (st.roundStatus !== 'calling') return this.reject(host, BINGO_MSG.call, 'not_allowed', 'Someone just called BINGO — hang on while it is checked.');
    const calls = [...st.calls];
    let token: number | null;
    if (value !== undefined) {
      if (st.callerMode !== 'manual' || !this.settings.manualPick) {
        return this.reject(host, BINGO_MSG.call, 'not_allowed', 'Picking a specific ball is only available with the manual caller.');
      }
      if (calls.includes(value)) return this.reject(host, BINGO_MSG.call, 'not_allowed', 'That one has already been called.');
      if (!isCallable(this.spec, calls, value)) {
        return this.reject(host, BINGO_MSG.call, 'not_allowed', this.spec.mode === 'numbers' ? 'That isn’t a ball in this game (1–75).' : 'That isn’t one of the items.');
      }
      token = value;
    } else {
      token = drawToken(this.spec, calls, this.rng);
    }
    if (token === null) return this.reject(host, BINGO_MSG.call, 'not_allowed', 'Every ball has already been called.');
    this.performCall(token, value !== undefined ? host.id : null);
  }

  /** `picker` = the player who chose this exact ball (manual pick), null for a random draw. */
  private performCall(token: number, picker: string | null): void {
    const st = this.state;
    this.stopCaller();
    st.calls.push(token);
    this.callPicker.push(picker);
    st.lastCallAt = Date.now();
    this.refreshNeeds();
    this.updateCanUndo();
    if (remainingTokens(this.spec, [...st.calls]).length === 0) this.onBagEmpty();
    else this.resumeAutoCaller(st.callIntervalMs);
  }

  private onBagEmpty(): void {
    this.stopCaller();
    if (this.isScheduled(T.exhausted) || this.state.roundStatus !== 'calling') return;
    this.state.statusText = 'Every ball has been called — claim your BINGO!';
    this.setTimer(BINGO_EXHAUSTED_GRACE_MS);
    this.schedule(T.exhausted, BINGO_EXHAUSTED_GRACE_MS, () => {
      this.setTimer(0);
      this.closeRound('exhausted');
    });
  }

  private handleUndo(host: PlayerRecord): void {
    const st = this.state;
    if (!this.undoAllowed()) {
      const reason =
        st.callerMode !== 'manual'
          ? 'Undo is only available with the manual caller.'
          : st.roundStatus !== 'calling'
            ? 'A BINGO has already been accepted this round.'
            : st.calls.length <= this.undoFloor
              ? st.calls.length === 0
                ? 'Nothing to undo yet.'
                : 'That call is part of an accepted BINGO and can’t be undone.'
              : 'Only balls picked by hand can be undone — random draws are final.';
      return this.reject(host, BINGO_MSG.undo, 'not_allowed', reason);
    }
    const token = st.calls.pop() as number;
    this.callPicker.pop();
    st.lastCallAt = Date.now();
    this.clampLateCards();
    if (this.isScheduled(T.exhausted)) {
      this.cancel(T.exhausted);
      this.setTimer(0);
      const plan = this.plan[st.round - 1];
      st.statusText = `${this.plan.length > 1 ? `Round ${st.round} of ${this.plan.length} · ` : ''}${plan?.title ?? ''}`;
    }
    this.refreshNeeds();
    this.updateCanUndo();
    this.emitEvent({ kind: 'undo', token });
    this.systemChat(`The host took back ${callLabel(this.spec, token, this.items)}.`);
  }

  private undoAllowed(): boolean {
    const st = this.state;
    const n = st.calls.length;
    // Random draws are final: undoing them would let the host re-draw until a ball suits them.
    return st.callerMode === 'manual' && st.roundStatus === 'calling' && n > this.undoFloor && typeof this.callPicker[n - 1] === 'string';
  }

  private updateCanUndo(): void {
    this.state.canUndo = this.undoAllowed();
  }

  // ===========================================================================
  // Claims
  // ===========================================================================

  private claimResult(player: PlayerRecord, ok: boolean, message: string, extra: Partial<BingoClaimResultPayload> & { reason?: BingoClaimReason } = {}): void {
    const payload: BingoClaimResultPayload = { ok, message, ...extra };
    this.sendTo(player, BINGO_MSG.claimResult, payload);
  }

  private handleClaim(player: PlayerRecord): void {
    const st = this.state;
    const card = this.cards.get(player.id);
    if (!card) return this.claimResult(player, false, 'You don’t have a card in this game.', { reason: 'no_card' });
    if (this.roundWinnerIds.has(player.id)) {
      return this.claimResult(player, true, 'Your BINGO is already verified!', { reason: 'already_won' });
    }
    if (this.phase !== 'PLAYING' || st.roundStatus === 'closed' || st.roundStatus === 'idle') {
      return this.claimResult(player, false, 'This round is already over.', { reason: 'round_over' });
    }
    if (this.settings.oneWinPerPlayer && this.everWon.has(player.id)) {
      return this.claimResult(player, false, 'You already won a round — this one is for everyone else!', { reason: 'one_win' });
    }
    if (this.callPicker.includes(player.id)) {
      return this.claimResult(player, false, 'You hand-picked balls for this round, so you can’t win it — the caller doesn’t play.', { reason: 'caller' });
    }
    const view = this.viewFor(player);
    const now = Date.now();
    if (view.lockedUntil > now) {
      return this.claimResult(player, false, 'You’re still sitting out a false alarm.', { reason: 'locked', lockedUntil: view.lockedUntil });
    }

    const verdict = validateClaim({ cells: card.cells, calls: this.callsFor(card), patterns: this.roundPatterns, size: this.spec.size });
    if (!verdict.valid) {
      view.falseClaims += 1;
      const penalty = this.settings.falseClaimPenaltySec * 1000;
      view.lockedUntil = penalty > 0 ? now + penalty : 0;
      this.claimResult(
        player,
        false,
        penalty > 0 ? `Not quite — no winning pattern yet. You’re benched for ${this.settings.falseClaimPenaltySec}s.` : 'Not quite — no winning pattern yet.',
        { reason: 'no_pattern', lockedUntil: view.lockedUntil },
      );
      if (this.settings.announceFalseClaims) {
        this.emitEvent({ kind: 'falseAlarm', playerId: player.id, name: player.state.name });
        this.systemChat(`${player.state.name}'s BINGO was a false alarm.`);
      }
      return;
    }

    // Valid claim. The first one stops the caller and opens the tie window.
    const first = st.roundStatus === 'calling';
    if (first) {
      this.stopCaller();
      this.cancel(T.exhausted);
      this.setTimer(0);
      st.roundStatus = 'claiming' satisfies BingoRoundStatus;
    }
    const plan = this.plan[st.round - 1];
    const winner = new BingoWinner();
    winner.playerId = player.id;
    winner.name = player.state.name;
    winner.color = player.state.color;
    winner.avatar = player.state.avatar;
    winner.round = st.round;
    winner.callCount = st.calls.length;
    winner.patternName = verdict.match.patternName;
    winner.mask = verdict.match.maskString;
    winner.cells.push(...card.cells);
    winner.serial = card.serial;
    winner.deal = card.deal;
    winner.prize = plan?.prize ?? '';
    winner.at = now;
    st.winners.push(winner);
    this.roundWinnerIds.add(player.id);
    this.everWon.add(player.id);
    view.wins += 1;
    player.state.score = view.wins;
    this.undoFloor = st.calls.length;
    this.updateCanUndo();

    this.claimResult(player, true, 'BINGO! Verified by the caller.', { patternName: verdict.match.patternName, mask: verdict.match.maskString });
    this.emitEvent({
      kind: 'winner',
      playerId: player.id,
      name: player.state.name,
      round: st.round,
      patternName: verdict.match.patternName,
      shared: !first,
    });
    this.systemChat(`${player.state.name} called BINGO — ${verdict.match.patternName}!`, 'correct');

    if (first) {
      const window = this.settings.tieWindowMs;
      if (window <= 0) {
        this.closeRound('won');
      } else {
        st.claimWindowEndsAt = now + window;
        this.schedule(T.claimWindow, window, () => this.closeRound('won'));
      }
    }
  }

  private emitEvent(event: BingoEvent): void {
    this.broadcast(BINGO_MSG.event, event);
  }
}

/**
 * The card seed of game `game` dealt from a host's fixed seed. Reproducible (the same fixed seed
 * deals the same series of games) but one-way: the seed revealed after a game gives away neither
 * the fixed seed nor any other game's cards (unless the fixed seed itself is easy to guess).
 */
export function fixedGameSeed(seed: string, game: number): string {
  return createHash('sha256').update(`dascade-bingo\u0000${seed}\u0000${game}`).digest('base64url').slice(0, 16);
}
