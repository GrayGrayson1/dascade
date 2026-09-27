/**
 * DAS Ships — authoritative hidden-fleet duel.
 *
 * Flow (all inside the PLAYING phase): `placement` (both captains privately deploy their fleets
 * against a clock) → `battle` (turn-based targeting; the server resolves every shot) → `over`
 * (fleets revealed, a short pause on the final volley) → RESULTS (rematch / lobby).
 *
 * Security model:
 *  - Fleets exist only in this room's memory (`boards`/`drafts`). A captain receives their own fleet
 *    via `ships:private` (re-sent on reconnect by syncPrivate). Opponents and spectators never do.
 *  - Public state/broadcasts carry only shot results. A hit doesn't name the vessel; a vessel is
 *    named (and its squares published) only when it sinks — at which point every square is hit.
 *  - Clients send intents (layouts, target squares) — validated with Zod, then against the rules,
 *    the turn, the turn sequence number and the shots already fired. Duplicates are refused.
 *
 * Clocks & absence (documented rules):
 *  - Deployment always has a clock (settings.placementSeconds). When it runs out, any captain who
 *    isn't ready gets their draft completed with random placements and locked in.
 *  - Optional turn clock (settings.turnSeconds; tournament matches use at least a 60 s clock). On
 *    timeout the server either auto-fires at random untargeted squares ('autofire') or passes the
 *    turn ('skip'). SHIPS_TIMEOUT_STRIKES consecutive timeouts forfeit the game.
 *  - Untimed games still have an inactivity limit (SHIPS_UNTIMED_IDLE_SECONDS, no visible clock): an
 *    idle captain auto-fires at random and it counts as a timeout strike, so nobody can stall a room.
 *  - A captain who disconnects has the reconnect grace (90 s) to return, otherwise they forfeit
 *    ('abandoned'). Leaving (or being removed from) the room mid-game forfeits at once.
 */
import { type CreateOptions } from '@dascade/shared';
import {
  DEFAULT_SHIPS_SETTINGS,
  SHIPS_LOG_LIMIT,
  SHIPS_MSG,
  SHIPS_TIMEOUT_STRIKES,
  SHIPS_TOURNAMENT_TURN_SECONDS,
  SHIPS_UNTIMED_IDLE_SECONDS,
  ShipsEmptySchema,
  ShipsFireSchema,
  ShipsLayoutSchema,
  ShipsRematchSchema,
  ShipsSettingsSchema,
  VESSELS,
  coordLabel,
  type ShipsCell,
  type ShipsEndReason,
  type ShipsEvent,
  type ShipsFirePayload,
  type ShipsLayoutPayload,
  type ShipsLogView,
  type ShipsPlacement,
  type ShipsPrivatePayload,
  type ShipsSettings,
  type ShipsShotView,
  type ShipsVesselView,
} from '@dascade/shared/games/ships';
import {
  createBoard,
  fleetOf,
  isDefeated,
  keepsTurn,
  orderByFleet,
  publicBoard,
  randomLayout,
  randomTargets,
  resolveVolley,
  rulesFromSettings,
  shotsAllowed,
  sunkVessels,
  validateLayout,
  validateVolley,
  vesselsAfloat,
  type Board,
  type ShipsRules,
} from '@dascade/game-core/ships';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { ShipsLogEntry, ShipsShot, ShipsSide, ShipsState, ShipsVessel } from './ShipsState.ts';

/** Max rematch offers per captain per results screen (anti-spam on top of the rate limit). */
const MAX_REMATCH_OFFERS = 4;

/** Pacing (ms). Instance-level so integration tests can speed the room up. */
export interface ShipsTiming {
  /** Pause on the final volley (fleets revealed) before the results screen. */
  over: number;
  /** Overrides settings.turnSeconds when > 0. */
  turnMs: number;
  /** Overrides settings.placementSeconds when > 0. */
  placementMs: number;
  /** Disconnected captains forfeit after this long (0 = the room's reconnect grace). */
  abandonMs: number;
  /** Untimed games: inactivity limit per turn (0/undefined = SHIPS_UNTIMED_IDLE_SECONDS). */
  idleMs?: number;
}

const DEFAULT_TIMING: ShipsTiming = { over: 2600, turnMs: 0, placementMs: 0, abandonMs: 0 };

const VOLLEY_ERRORS: Record<string, string> = {
  wrong_count: 'Pick the right number of target squares for this turn.',
  out_of_bounds: 'That square is off the grid.',
  already_shot: 'You already fired at that square.',
  duplicate: 'Each target square can only be picked once.',
};

export class ShipsRoom extends BaseGameRoom<ShipsState, ShipsSettings> {
  readonly gameId = 'ships' as const;
  protected readonly settingsSchema = ShipsSettingsSchema;

  timing: ShipsTiming = { ...DEFAULT_TIMING };

  /** The two captains of the current match, in seat order. */
  private duel: string[] = [];
  /** Rules frozen at match start (settings are lobby-only, but never trust that implicitly). */
  private rules: ShipsRules = rulesFromSettings(DEFAULT_SHIPS_SETTINGS);
  private firing: ShipsSettings['firing'] = 'classic';
  /** Deployment drafts (valid, possibly partial) — PRIVATE. */
  private drafts = new Map<string, ShipsPlacement[]>();
  /** Battle boards — PRIVATE. */
  private boards = new Map<string, Board>();
  /** Captain who fired first last game (rematches alternate). */
  private lastFirst = '';
  /** Rematch offers per captain on this results screen (anti-spam, like the Boardroom kit). */
  private rematchOffers = new Map<string, number>();
  private setupDone = false;

  protected defaultSettings(): ShipsSettings {
    return structuredClone(DEFAULT_SHIPS_SETTINGS);
  }

  protected createState(): ShipsState {
    return new ShipsState();
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  protected override onRoomCreated(_options: CreateOptions): void {
    this.previewSettings();
    this.handle(SHIPS_MSG.layout, ShipsLayoutSchema, (p, payload) => this.onLayout(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 12, perSecond: 4 },
      maxBytes: 2048,
    });
    this.handle(SHIPS_MSG.fire, ShipsFireSchema, (p, payload) => this.onFire(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 10, perSecond: 5 },
      maxBytes: 1024,
    });
    this.handle(SHIPS_MSG.resign, ShipsEmptySchema, (p) => this.onResign(p), { phases: ['PLAYING'], playersOnly: true });
    this.handle(SHIPS_MSG.rematch, ShipsRematchSchema, (p, { want }) => this.onRematch(p, want), {
      phases: ['RESULTS'],
      playersOnly: true,
    });
  }

  protected override onSettingsChanged(): void {
    if (this.phase === 'LOBBY') this.previewSettings();
  }

  protected override validateStart(): string | null {
    const seated = this.seatedPlayers();
    if (seated.length !== 2) return 'DAS Ships is a duel — it needs exactly two captains.';
    return null;
  }

  protected override onCountdownStart(): void {
    this.setupMatch();
  }

  protected onGameStart(): void {
    if (!this.setupDone) this.setupMatch();
    this.setupDone = false;
    // Someone left during the countdown: nothing to play.
    if (this.duel.length !== 2 || this.duel.some((id) => !this.getPlayer(id))) {
      this.systemChat('A captain left before the battle — back to the lobby.');
      this.returnToLobby();
      return;
    }
    const ms = this.timing.placementMs > 0 ? this.timing.placementMs : this.settings.placementSeconds * 1000;
    this.state.stage = 'placement';
    this.setClock(ms);
    this.schedule('placement', ms, () => this.beginBattle());
    this.pushLog('info', 'Deploy your fleet — the enemy can’t see it.');
    for (const p of this.players.values()) this.syncPrivate(p);
  }

  protected override onReturnToLobby(): void {
    this.resetMatch();
    this.previewSettings();
  }

  /** Mirror the lobby settings into state so everyone sees the format. */
  private previewSettings(): void {
    const s = this.settings;
    this.state.gridSize = s.gridSize;
    this.state.fleet = s.fleet;
    this.state.firing = s.firing;
    this.state.spacing = s.spacing;
  }

  private resetMatch(): void {
    this.duel = [];
    this.drafts.clear();
    this.boards.clear();
    this.setupDone = false;
    const st = this.state;
    st.stage = '';
    st.sides.clear();
    st.turnId = '';
    st.turnSeq = 0;
    st.turnNumber = 0;
    st.shotsAllowed = 0;
    st.deadline = 0;
    st.clockMs = 0;
    st.lastShots.clear();
    st.lastShooterId = '';
    st.winnerId = '';
    st.endReason = '';
    st.log.clear();
    st.rematch.clear();
    this.rematchOffers.clear();
  }

  private setupMatch(): void {
    this.resetMatch();
    this.setupDone = true;
    this.state.matchNo++;
    const s = this.settings;
    this.rules = rulesFromSettings(s);
    this.firing = s.firing;
    this.previewSettings();
    const seated = this.seatedPlayers().slice(0, 2);
    this.duel = seated.map((p) => p.id);
    const empty = '.'.repeat(this.rules.size * this.rules.size);
    for (const p of seated) {
      p.state.score = 0;
      this.state.sides.push(
        new ShipsSide({ playerId: p.id, name: p.state.name, ready: false, board: empty, vesselsLeft: this.rules.fleet.length }),
      );
    }
  }

  // ===========================================================================
  // Player lifecycle
  // ===========================================================================

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    if (!this.isLiveDuelist(player.id)) return;
    const ms = this.timing.abandonMs > 0 ? this.timing.abandonMs : this.reconnectGraceSeconds * 1000;
    this.pushLog('info', `${player.state.name} lost connection — ${Math.round(ms / 1000)} s to return.`);
    this.schedule(`abandon:${player.id}`, ms, () => this.forfeit(player.id, 'abandoned'));
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    if (!this.isScheduled(`abandon:${player.id}`)) return;
    this.cancel(`abandon:${player.id}`);
    if (this.isLiveDuelist(player.id)) this.pushLog('info', `${player.state.name} is back.`);
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    this.forfeit(player.id, 'abandoned');
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    this.cancel(`abandon:${player.id}`);
    if (!this.duel.includes(player.id)) return;
    if (this.phase === 'RESULTS') {
      // No rematch without both captains.
      this.state.rematch.clear();
      return;
    }
    if (this.phase === 'COUNTDOWN') {
      this.schedule('abort', 0, () => {
        if (this.phase !== 'COUNTDOWN') return;
        this.systemChat(`${player.state.name} left — back to the lobby.`);
        this.returnToLobby();
      });
      return;
    }
    // A kick never wins a game: a captain who kicks their own opponent concedes (same rule as the
    // Boardroom kit). Otherwise leaving — or being removed by a non-playing host — concedes.
    const hostId = this.state.hostId;
    if (reason === 'kicked' && hostId !== player.id && this.isLiveDuelist(hostId)) {
      this.forfeit(hostId, 'forfeit');
      return;
    }
    this.forfeit(player.id, 'forfeit');
  }

  /**
   * The host ends a live game (back to lobby / close room): a captain who does so mid-battle concedes,
   * so a losing host can't erase the game. Deployment (no shot fired yet) may still be abandoned.
   */
  protected override hostEndsMatch(host: PlayerRecord): string | null {
    if (this.phase === 'PLAYING' && this.state.stage === 'battle' && this.duel.includes(host.id)) this.forfeit(host.id, 'forfeit');
    return null;
  }

  protected override syncPrivate(player: PlayerRecord): void {
    // Only a captain of the live match ever receives a fleet — and only their own.
    if (player.state.spectator || !this.duel.includes(player.id) || this.state.stage === '') return;
    const board = this.boards.get(player.id);
    const vessels = board ? fleetOf(board) : (this.drafts.get(player.id) ?? []);
    const payload: ShipsPrivatePayload = {
      matchNo: this.state.matchNo,
      playerId: player.id,
      vessels: vessels.map((v) => ({ id: v.id, x: v.x, y: v.y, dir: v.dir })),
      ready: this.sideOf(player.id)?.ready ?? false,
    };
    this.sendTo(player, SHIPS_MSG.private, payload);
  }

  // ===========================================================================
  // Deployment
  // ===========================================================================

  private onLayout(p: PlayerRecord, { vessels, ready }: ShipsLayoutPayload): void {
    if (this.state.stage !== 'placement') return this.reject(p, SHIPS_MSG.layout, 'wrong_phase', 'The fleets are already deployed.');
    const side = this.sideOf(p.id);
    if (!side) return this.reject(p, SHIPS_MSG.layout, 'not_allowed', 'Only the two captains deploy fleets.');
    const err = validateLayout(vessels, this.rules, { complete: ready });
    if (err) {
      this.reject(p, SHIPS_MSG.layout, 'invalid_payload', err.message);
      this.syncPrivate(p);
      return;
    }
    const layout = orderByFleet(vessels, this.rules);
    if (side.ready && ready) {
      // Idempotent re-send of the locked layout; anything else must unlock first.
      if (JSON.stringify(layout) !== JSON.stringify(this.drafts.get(p.id))) {
        this.reject(p, SHIPS_MSG.layout, 'not_allowed', 'Your fleet is locked in — tap Edit fleet to change it.');
      }
      this.syncPrivate(p);
      return;
    }
    this.drafts.set(p.id, layout);
    if (side.ready !== ready) {
      side.ready = ready;
      this.broadcastEvent({ type: 'ready', playerId: p.id, ready });
      this.pushLog('info', ready ? `${p.state.name} has deployed their fleet.` : `${p.state.name} is rearranging their fleet.`);
      // Confirm the lock state privately. Plain draft saves aren't echoed (the client authored them;
      // an echo racing a newer local edit would only cause flicker) — syncPrivate re-sends on reconnect.
      this.syncPrivate(p);
    }
    if (this.state.sides.length === 2 && this.state.sides.every((s) => s.ready)) this.beginBattle();
  }

  /** Lock every fleet (auto-completing unready drafts) and open fire. */
  private beginBattle(): void {
    if (this.state.stage !== 'placement' || this.duel.length !== 2) return;
    this.cancel('placement');
    const auto: string[] = [];
    for (const id of this.duel) {
      const side = this.sideOf(id)!;
      const draft = this.drafts.get(id) ?? [];
      let layout = draft;
      if (!side.ready || validateLayout(draft, this.rules, { complete: true })) {
        layout = randomLayout(this.rng, this.rules, draft);
        auto.push(id);
      }
      this.drafts.set(id, layout);
      this.boards.set(id, createBoard(layout, this.rules));
      side.ready = true;
      side.board = publicBoard(this.boards.get(id)!);
      side.vesselsLeft = layout.length;
    }
    for (const id of auto) this.pushLog('info', `${this.nameOf(id)}’s remaining vessels were deployed automatically.`);
    const first = this.pickFirstShooter();
    this.lastFirst = first;
    this.state.stage = 'battle';
    this.broadcastEvent({ type: 'battle', firstId: first, auto });
    this.pushLog('turn', `Battle stations! ${this.nameOf(first)} fires first.`);
    for (const p of this.players.values()) this.syncPrivate(p);
    this.startTurn(first);
  }

  private pickFirstShooter(): string {
    const [a, b] = this.duel as [string, string];
    const t = this.tournamentMatch;
    if (t) {
      const firstSide = t.participants.find((pt) => pt.side === 'first' && pt.playerId && this.duel.includes(pt.playerId));
      if (firstSide?.playerId) return firstSide.playerId;
    }
    // Rematches alternate who fires first; the first game is a coin toss.
    if (this.lastFirst === a) return b;
    if (this.lastFirst === b) return a;
    return this.rng.int(2) === 0 ? a : b;
  }

  // ===========================================================================
  // Battle
  // ===========================================================================

  private turnMs(): number {
    if (this.timing.turnMs > 0) return this.timing.turnMs;
    const seconds = this.settings.turnSeconds > 0 ? this.settings.turnSeconds : this.tournamentMatch ? SHIPS_TOURNAMENT_TURN_SECONDS : 0;
    return seconds * 1000;
  }

  private startTurn(id: string): void {
    const opp = this.opponentOf(id);
    const mine = this.boards.get(id);
    const target = opp ? this.boards.get(opp) : undefined;
    if (!opp || !mine || !target) return;
    const st = this.state;
    if (st.turnId !== id) st.turnNumber++;
    st.turnId = id;
    st.turnSeq++;
    st.shotsAllowed = shotsAllowed(this.firing, mine, target);
    const ms = this.turnMs();
    const seq = st.turnSeq;
    if (ms > 0) {
      this.setClock(ms);
      this.schedule('turn', ms, () => this.onTurnTimeout(seq));
    } else {
      // Untimed: no visible clock, but an idle captain can't stall the room forever.
      this.setClock(0);
      const idle = this.timing.idleMs && this.timing.idleMs > 0 ? this.timing.idleMs : SHIPS_UNTIMED_IDLE_SECONDS * 1000;
      this.schedule('turn', idle, () => this.onTurnTimeout(seq));
    }
  }

  private onFire(p: PlayerRecord, { cells, seq }: ShipsFirePayload): void {
    const st = this.state;
    if (st.stage !== 'battle') return this.reject(p, SHIPS_MSG.fire, 'wrong_phase', 'Hold fire — the battle hasn’t started.');
    if (!this.duel.includes(p.id)) return this.reject(p, SHIPS_MSG.fire, 'not_allowed', 'Only the captains can fire.');
    if (st.turnId !== p.id) return this.reject(p, SHIPS_MSG.fire, 'not_your_turn', 'Hold fire — it’s not your turn.');
    if (seq !== st.turnSeq) return this.reject(p, SHIPS_MSG.fire, 'not_allowed', 'That shot was aimed on an earlier turn.');
    const target = this.boards.get(this.opponentOf(p.id) ?? '');
    if (!target) return;
    const err = validateVolley(target, cells, st.shotsAllowed);
    if (err) return this.reject(p, SHIPS_MSG.fire, 'invalid_payload', VOLLEY_ERRORS[err] ?? 'Invalid target.');
    const side = this.sideOf(p.id);
    if (side) side.timeouts = 0;
    this.resolveShots(p.id, cells, false);
  }

  private resolveShots(shooterId: string, cells: ShipsCell[], auto: boolean): void {
    const targetId = this.opponentOf(shooterId);
    const target = targetId ? this.boards.get(targetId) : undefined;
    const shooterSide = this.sideOf(shooterId);
    const targetSide = targetId ? this.sideOf(targetId) : undefined;
    if (!targetId || !target || !shooterSide || !targetSide) return;
    this.cancel('turn');
    const seq = this.state.turnSeq;
    const shots = resolveVolley(target, cells);

    // Stats.
    shooterSide.shots += shots.length;
    for (const s of shots) {
      if (s.result === 'miss') shooterSide.streak = 0;
      else {
        shooterSide.hits++;
        shooterSide.streak = Math.min(255, shooterSide.streak + 1);
        shooterSide.bestStreak = Math.max(shooterSide.bestStreak, shooterSide.streak);
        if (s.result === 'sunk') shooterSide.sunk++;
      }
    }
    const shooter = this.getPlayer(shooterId);
    if (shooter) shooter.state.score = shooterSide.hits;

    // Public view of the target's waters.
    targetSide.board = publicBoard(target);
    targetSide.vesselsLeft = vesselsAfloat(target);
    syncVessels(targetSide.sunkVessels, sunkVessels(target));

    this.state.lastShots.clear();
    for (const s of shots) this.state.lastShots.push(new ShipsShot({ x: s.x, y: s.y, result: s.result, vessel: s.vessel ?? '' }));
    this.state.lastShooterId = shooterId;
    this.logVolley(shooterId, targetId, shots, auto);
    this.broadcastEvent({ type: 'shot', seq, shooterId, targetId, shots, auto });

    if (isDefeated(target)) {
      this.finish(shooterId, targetId, 'fleet_destroyed');
      return;
    }
    this.startTurn(keepsTurn(this.firing, shots) ? shooterId : targetId);
  }

  private onTurnTimeout(seq: number): void {
    const st = this.state;
    if (st.stage !== 'battle' || st.turnSeq !== seq) return;
    const id = st.turnId;
    const side = this.sideOf(id);
    const opp = this.opponentOf(id);
    const target = opp ? this.boards.get(opp) : undefined;
    if (!side || !opp || !target) return;
    side.timeouts++;
    const untimed = this.turnMs() === 0;
    if (side.timeouts >= SHIPS_TIMEOUT_STRIKES) {
      this.pushLog(
        'end',
        untimed
          ? `${this.nameOf(id)} stayed idle ${SHIPS_TIMEOUT_STRIKES} turns in a row.`
          : `${this.nameOf(id)} ran out of time ${SHIPS_TIMEOUT_STRIKES} turns in a row.`,
      );
      this.finish(opp, id, 'timeout');
      return;
    }
    if (untimed) {
      // Untimed games: the inactivity limit always fires (skipping would let two idle captains loop).
      this.pushLog('info', `${this.nameOf(id)} has been idle for ${Math.round(SHIPS_UNTIMED_IDLE_SECONDS / 60)} minutes — auto-fire!`);
      this.resolveShots(id, randomTargets(this.rng, target, st.shotsAllowed), true);
    } else if (this.settings.onTimeout === 'autofire') {
      this.pushLog('info', `${this.nameOf(id)} ran out of time — auto-fire!`);
      this.resolveShots(id, randomTargets(this.rng, target, st.shotsAllowed), true);
    } else {
      this.pushLog('info', `${this.nameOf(id)} ran out of time and loses the turn.`);
      this.broadcastEvent({ type: 'skip', playerId: id });
      this.startTurn(opp);
    }
  }

  private onResign(p: PlayerRecord): void {
    const stage = this.state.stage;
    if (stage !== 'placement' && stage !== 'battle') return this.reject(p, SHIPS_MSG.resign, 'wrong_phase', 'There is no game to resign.');
    if (!this.duel.includes(p.id)) return this.reject(p, SHIPS_MSG.resign, 'not_allowed', 'Only the captains can resign.');
    this.forfeit(p.id, 'resign');
  }

  /** `loserId` concedes the live game (resign, leave, abandon). No-op outside a live game. */
  private forfeit(loserId: string, reason: ShipsEndReason): void {
    if (this.phase !== 'PLAYING') return;
    if (this.state.stage !== 'placement' && this.state.stage !== 'battle') return;
    const winner = this.opponentOf(loserId);
    if (!winner) return;
    this.finish(winner, loserId, reason);
  }

  private finish(winnerId: string, loserId: string, reason: ShipsEndReason): void {
    const st = this.state;
    if (st.stage === 'over' || st.stage === '') return;
    this.cancel('turn');
    this.cancel('placement');
    for (const id of this.duel) this.cancel(`abandon:${id}`);
    st.stage = 'over';
    st.turnId = '';
    st.shotsAllowed = 0;
    st.winnerId = winnerId;
    st.endReason = reason;
    this.setClock(0);

    // Game over: both fleets are revealed.
    for (const id of this.duel) {
      const side = this.sideOf(id);
      const board = this.boards.get(id);
      const fleet: ShipsVesselView[] = board ? fleetOf(board) : (this.drafts.get(id) ?? []).map((v) => ({ ...v }));
      if (side) syncVessels(side.revealed, fleet);
    }

    const winner = this.sideOf(winnerId);
    const loser = this.sideOf(loserId);
    this.pushLog('end', endLine(this.nameOf(winnerId), this.nameOf(loserId), reason));
    this.broadcastEvent({ type: 'over', winnerId, loserId, reason });

    const statsOf = (side: ShipsSide | undefined) => ({
      shipsSunk: side?.sunk ?? 0,
      shotsFired: side?.shots ?? 0,
      shotsHit: side?.hits ?? 0,
      maxHitStreak: side?.bestStreak ?? 0,
    });
    const details = {
      gridSize: this.rules.size,
      fleet: this.settings.fleet,
      firing: this.firing,
      turns: st.turnNumber,
      // Platform stats extras (summed, or max… keeps the best).
      playerStats: { [winnerId]: statsOf(winner), [loserId]: statsOf(loser) },
    };
    this.reportOutcome({
      placements: [[winnerId], [loserId]],
      scores: { [winnerId]: winner?.hits ?? 0, [loserId]: loser?.hits ?? 0 },
      reason,
      details,
    });
    for (const p of this.players.values()) this.syncPrivate(p);

    this.schedule('results', this.timing.over, () => {
      if (this.phase !== 'PLAYING') return;
      const players = [winnerId, loserId].map((id, i) => {
        const rec = this.getPlayer(id);
        return {
          playerId: id,
          name: this.nameOf(id),
          guestId: rec?.guestId,
          userId: rec?.userId,
          score: this.sideOf(id)?.hits ?? 0,
          placement: i + 1,
        };
      });
      this.endMatch({ players, details: { ...details, reason, winnerId } });
    });
  }

  // ===========================================================================
  // Rematch
  // ===========================================================================

  private onRematch(p: PlayerRecord, want: boolean): void {
    if (this.tournamentMatch) return this.reject(p, SHIPS_MSG.rematch, 'not_allowed', 'The Tournament Center schedules the next game.');
    if (!this.duel.includes(p.id)) return this.reject(p, SHIPS_MSG.rematch, 'not_allowed', 'Only the two captains can call a rematch.');
    const opp = this.opponentOf(p.id);
    const oppRec = opp ? this.getPlayer(opp) : undefined;
    if (want && (!oppRec || oppRec.state.spectator)) return this.reject(p, SHIPS_MSG.rematch, 'not_allowed', 'Your opponent has left.');
    if (want && !oppRec?.client) return this.reject(p, SHIPS_MSG.rematch, 'not_allowed', 'Your opponent is not connected right now.');
    const list = this.state.rematch;
    const idx = list.indexOf(p.id);
    if (want && idx >= 0) return;
    if (want) {
      // Toggling the offer on and off must not flood the chat: a few offers per results screen,
      // and only the first one is announced.
      const offers = this.rematchOffers.get(p.id) ?? 0;
      if (offers >= MAX_REMATCH_OFFERS) return this.reject(p, SHIPS_MSG.rematch, 'rate_limited', 'That is enough rematch offers for now.');
      this.rematchOffers.set(p.id, offers + 1);
      list.push(p.id);
      if (offers === 0 && list.length < 2) this.systemChat(`${p.state.name} wants a rematch.`);
    } else if (idx >= 0) list.splice(idx, 1);
    if (list.length === 2 && this.duel.every((id) => list.includes(id))) {
      this.systemChat('Rematch! Same waters, fresh fleets.');
      this.returnToLobby();
      if (!this.startMatch()) this.systemChat('The rematch could not start — both captains must be connected.');
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private sideOf(id: string): ShipsSide | undefined {
    return this.state.sides.find((s) => s.playerId === id);
  }

  private opponentOf(id: string): string | undefined {
    if (!this.duel.includes(id)) return undefined;
    return this.duel.find((d) => d !== id);
  }

  private nameOf(id: string): string {
    return this.getPlayer(id)?.state.name ?? this.sideOf(id)?.name ?? 'A captain';
  }

  private isLiveDuelist(id: string): boolean {
    return this.phase === 'PLAYING' && (this.state.stage === 'placement' || this.state.stage === 'battle') && this.duel.includes(id);
  }

  private setClock(ms: number): void {
    this.state.deadline = ms > 0 ? Date.now() + ms : 0;
    this.state.clockMs = Math.max(0, Math.round(ms));
  }

  private broadcastEvent(event: ShipsEvent): void {
    this.broadcast(SHIPS_MSG.event, event);
  }

  private pushLog(kind: ShipsLogView['kind'], text: string): void {
    const log = this.state.log;
    const last = log.length ? log[log.length - 1]!.seq : 0;
    log.push(new ShipsLogEntry({ seq: last + 1, text, kind }));
    if (log.length > SHIPS_LOG_LIMIT) log.splice(0, log.length - SHIPS_LOG_LIMIT);
  }

  private logVolley(shooterId: string, targetId: string, shots: ShipsShotView[], auto: boolean): void {
    const who = this.nameOf(shooterId);
    const prefix = auto ? `${who} (auto)` : who;
    if (shots.length === 1) {
      const s = shots[0]!;
      const at = coordLabel(s.x, s.y);
      if (s.result === 'miss') this.pushLog('miss', `${prefix} fired at ${at} — splash.`);
      else if (s.result === 'hit') this.pushLog('hit', `${prefix} fired at ${at} — HIT!`);
    } else {
      const hits = shots.filter((s) => s.result !== 'miss').length;
      const where = shots.map((s) => coordLabel(s.x, s.y)).join(' ');
      this.pushLog(
        hits ? 'hit' : 'miss',
        `${prefix} fired a ${shots.length}-shot salvo (${where}) — ${hits ? `${hits} hit${hits === 1 ? '' : 's'}` : 'all splashes'}.`,
      );
    }
    for (const s of shots) {
      if (s.result === 'sunk' && s.vessel) this.pushLog('sunk', `${who} sank ${this.nameOf(targetId)}’s ${VESSELS[s.vessel].name}!`);
    }
  }
}

/** Replace a synced vessel list when its contents changed (sunk list grows; the reveal is set once). */
function syncVessels(target: ShipsSide['sunkVessels'], vessels: ShipsVesselView[]): void {
  const key = (v: { id: string; x: number; y: number; dir: string }) => `${v.id}:${v.x}:${v.y}:${v.dir}`;
  if (target.length === vessels.length && vessels.every((v, i) => key(target[i]!) === key(v))) return;
  target.clear();
  for (const v of vessels) target.push(new ShipsVessel({ id: v.id, x: v.x, y: v.y, dir: v.dir }));
}

function endLine(winner: string, loser: string, reason: ShipsEndReason): string {
  switch (reason) {
    case 'fleet_destroyed':
      return `${winner} destroyed ${loser}’s entire fleet!`;
    case 'resign':
      return `${loser} struck their colours — ${winner} wins.`;
    case 'timeout':
      return `${winner} wins on time.`;
    case 'abandoned':
      return `${loser} didn’t come back — ${winner} wins.`;
    default:
      return `${loser} left the battle — ${winner} wins.`;
  }
}
