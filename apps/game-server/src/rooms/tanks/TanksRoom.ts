/**
 * DAS Tanks — authoritative turn-based artillery room.
 *
 * Flow: LOBBY (team picks, host settings incl. CPU tanks) → COUNTDOWN (battlefield built
 * and visible) → PLAYING: turns of { aim/drive → fire → resolve } → victory celebration →
 * RESULTS → LOBBY (or straight into a rematch).
 *
 * Clients send intents only (aim, one-step drives, fire with the current turn id). The
 * shot is simulated here by `@dascade/game-core/tanks`; the resulting ShotScript is
 * broadcast for playback and the next turn starts once its duration has elapsed.
 *
 * Anti-stall: every turn has a timer (auto-skip); disconnected players get a short turn;
 * away/absent players are skipped at once; when only one side is still manned the absent
 * side forfeits; a round limit ends marathon battles; leaving scuttles your tank.
 */
import { EmptySchema, RATE } from '@dascade/shared';
import {
  CPU_SKILL_LABEL,
  DEFAULT_TANKS_SETTINGS,
  FUEL_PER_TURN,
  MAX_TANKS,
  MOVE_STEP,
  TANKS_AIM_RATE,
  TANKS_FIRE_RATE,
  TANKS_MOVE_RATE,
  TANKS_MSG,
  TANKS_TIMING,
  TEAM_NAMES,
  TanksAimSchema,
  TanksFireSchema,
  TanksMoveSchema,
  TanksSettingsSchema,
  TanksTeamSchema,
  BATTLE_THEMES,
  WIND_MAX,
  type TanksEvent,
  type TanksSettings,
  type ShotScript,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import {
  abandon,
  assignTeams,
  checkForfeit,
  createBattle,
  drive,
  encodeTerrain,
  endByRounds,
  fire,
  nextTurn,
  planShot,
  setAim,
  skipTurn,
  tankById,
  upcoming,
  type Battle,
  type BattleEntrant,
  type BattleTank,
} from '@dascade/game-core/tanks';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { Crew, Tank, TanksState } from './TanksState.ts';

const CPU_NAMES = ['Unit-7', 'Ironclad', 'Sparky', 'Rustbucket', 'Mortar Mo', 'Tin Lizzie', 'Boomer'];
const CPU_COLORS = ['#a78bfa', '#a3e635', '#60a5fa', '#fb7185', '#facc15', '#2dd4bf', '#f472b6'];

type Timing = { -readonly [K in keyof typeof TANKS_TIMING]: number };

export class TanksRoom extends BaseGameRoom<TanksState, TanksSettings> {
  readonly gameId = 'tanks' as const;
  protected readonly settingsSchema = TanksSettingsSchema;
  /** Overridable by integration tests. */
  protected timing: Timing = { ...TANKS_TIMING };
  /** CPU "thinking" time range before it aims, and its aim → fire beat (ms). */
  protected botThinkMs: [number, number] = [900, 1800];
  protected botFireDelayMs = 850;

  protected battle: Battle | null = null;
  private finishing = false;
  /** Consecutive timed-out turns per player (reset when they aim, drive or fire). */
  private readonly idleStrikes = new Map<string, number>();
  /** Diagnostics for tests. */
  readonly stats = { shots: 0, skips: 0, lastScript: null as ShotScript | null };

  protected defaultSettings(): TanksSettings {
    return structuredClone(DEFAULT_TANKS_SETTINGS);
  }

  protected createState(): TanksState {
    return new TanksState();
  }

  protected override onRoomCreated(): void {
    if (this.isSolo && this.getSettings().cpu === 0) this.updateSettings({ ...this.getSettings(), cpu: 1 });

    this.handle(TANKS_MSG.aim, TanksAimSchema, (p, aim) => this.onAim(p, aim.angle, aim.power, aim.weapon), {
      phases: ['PLAYING'],
      playersOnly: true,
      silent: true,
      rate: TANKS_AIM_RATE,
    });
    this.handle(TANKS_MSG.move, TanksMoveSchema, (p, { dir }) => this.onMove(p, dir), {
      phases: ['PLAYING'],
      playersOnly: true,
      silent: true,
      rate: TANKS_MOVE_RATE,
    });
    this.handle(TANKS_MSG.fire, TanksFireSchema, (p, shot) => this.onFire(p, shot), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: TANKS_FIRE_RATE,
    });
    this.handle(
      TANKS_MSG.team,
      TanksTeamSchema,
      (p, { team }) => {
        const crew = this.state.crew.get(p.id);
        if (crew) crew.team = team;
      },
      { phases: ['LOBBY'], rate: RATE.action },
    );
    this.handle(
      TANKS_MSG.rematch,
      EmptySchema,
      () => {
        this.returnToLobby();
        this.startMatch();
      },
      { phases: ['RESULTS'], hostOnly: true, rate: { burst: 2, perSecond: 0.5 } },
    );
  }

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  protected override onPlayerJoined(player: PlayerRecord): void {
    if (!this.state.crew.has(player.id)) this.state.crew.set(player.id, new Crew());
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.state.crew.delete(player.id);
    const b = this.battle;
    if (!b || !tankById(b, player.id) || (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN')) return;
    const wasActive = b.activeId === player.id && this.state.battle.stage === 'aim';
    if (!abandon(b, player.id)) return;
    this.syncTanks();
    this.broadcast(TANKS_MSG.event, { kind: 'eliminated', playerId: player.id, reason: 'left' } satisfies TanksEvent);
    if (this.phase !== 'PLAYING') return;
    if (this.state.battle.stage === 'resolving') return; // afterShot() picks it up
    if (wasActive) this.endTurnEarly();
    if (b.result) this.finish();
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.state.battle.stage !== 'aim' || b.activeId !== player.id) return;
    const left = this.state.battle.turnEndsAt - Date.now();
    if (left > this.timing.disconnectedTurnMs) this.armTurnTimer(this.timing.disconnectedTurnMs, 'timeout');
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING') return;
    if (this.state.battle.stage === 'aim' && b.activeId === player.id) this.skipActive('absent');
    this.checkForfeitNow();
  }

  private present(id: string): boolean {
    const tank = this.battle ? tankById(this.battle, id) : undefined;
    if (tank?.cpu) return true;
    const p = this.players.get(id);
    return Boolean(p && !p.away && !p.state.spectator);
  }

  private checkForfeitNow(): boolean {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.finishing) return false;
    const result = checkForfeit(b, (id) => this.present(id));
    if (!result) return false;
    if (this.state.battle.stage !== 'resolving') this.finish();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lobby → battle
  // ---------------------------------------------------------------------------

  private humans(): PlayerRecord[] {
    return this.seatedPlayers().filter((p) => !p.away);
  }

  private cpuCount(humans: number): number {
    const s = this.getSettings();
    const wanted = this.isSolo ? Math.max(1, s.cpu) : s.cpu;
    return Math.max(0, Math.min(wanted, MAX_TANKS - humans));
  }

  private teamPreview(humans: PlayerRecord[], cpus: number): Map<string, number> {
    const entries = humans.map((p) => ({ id: p.id, pick: this.state.crew.get(p.id)?.team ?? -1 }));
    for (let i = 0; i < cpus; i++) entries.push({ id: `cpu-${i + 1}`, pick: -1 });
    return assignTeams(entries, this.rng);
  }

  protected override validateStart(): string | null {
    const humans = this.humans();
    const cpus = this.cpuCount(humans.length);
    if (humans.length + cpus < 2) return 'Artillery needs two tanks — invite a friend or add a CPU tank in the settings.';
    if (humans.length > MAX_TANKS) return `The battlefield holds ${MAX_TANKS} tanks.`;
    if (this.getSettings().mode === 'teams') {
      const teams = new Set(this.teamPreview(humans, cpus).values());
      if (teams.size < 2) return `Both teams need at least one tank — someone switch to Team ${TEAM_NAMES[1]} or ${TEAM_NAMES[0]}.`;
    }
    return null;
  }

  protected override onCountdownStart(): void {
    this.setupBattle();
  }

  private setupBattle(): void {
    const s = this.getSettings();
    const humans = this.humans();
    const cpus = this.cpuCount(humans.length);
    const teams = s.mode === 'teams';
    const assignment = teams ? this.teamPreview(humans, cpus) : new Map<string, number>();
    const firstIds = new Set((this.tournamentMatch?.participants ?? []).filter((p) => p.side === 'first').map((p) => p.playerId));
    const used = new Set(humans.map((p) => p.state.color.toLowerCase()));
    const entrants: BattleEntrant[] = humans.map((p) => ({
      id: p.id,
      name: p.state.name,
      color: p.state.color,
      team: assignment.get(p.id) ?? -1,
      first: firstIds.has(p.id),
    }));
    const cpuColors = CPU_COLORS.filter((c) => !used.has(c));
    for (let i = 0; i < cpus; i++) {
      const id = `cpu-${i + 1}`;
      entrants.push({
        id,
        name: `${CPU_NAMES[i % CPU_NAMES.length]}`,
        color: cpuColors[i % Math.max(1, cpuColors.length)] ?? CPU_COLORS[i % CPU_COLORS.length]!,
        team: assignment.get(id) ?? -1,
        cpu: true,
      });
    }
    const theme = BATTLE_THEMES[this.rng.int(BATTLE_THEMES.length)]!;
    this.battle = createBattle(this.rng, entrants, {
      mode: s.mode,
      style: s.terrain,
      windMax: WIND_MAX[s.wind],
      fuelPerTurn: FUEL_PER_TURN[s.movement],
      armor: s.armor,
      arsenal: s.arsenal,
      maxRounds: s.maxRounds,
      friendlyFire: s.friendlyFire,
      theme,
    });
    this.finishing = false;
    this.idleStrikes.clear();
    this.stats.lastScript = null;
    const meta = this.state.battle;
    meta.stage = 'idle';
    meta.theme = theme;
    meta.style = this.battle.style;
    meta.width = this.battle.terrain.width;
    meta.height = this.battle.terrain.height;
    meta.wind = 0;
    meta.turnId = 0;
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.resolveEndsAt = 0;
    meta.shotSeq = 0;
    meta.mode = s.mode;
    meta.maxRounds = s.maxRounds;
    meta.friendlyFire = s.friendlyFire;
    meta.winnerTeam = -1;
    meta.winners = '';
    meta.reason = '';
    meta.queue = '';
    this.state.tanks.clear();
    this.syncTerrain();
    this.syncTanks();
    if (cpus > 0 && !this.isSolo) this.systemChat(`${cpus} CPU tank${cpus === 1 ? '' : 's'} (${CPU_SKILL_LABEL[s.cpuSkill]}) joined the battle.`);
  }

  protected onGameStart(): void {
    if (!this.battle) this.setupBattle();
    const b = this.battle!;
    for (const t of b.tanks) {
      if (!t.cpu && !this.players.has(t.id)) abandon(b, t.id);
    }
    // Someone left (or dropped) during the countdown and the battle is already decided: nobody fired
    // a shot, so there is nothing to report — back to the lobby instead.
    if (b.result || checkForfeit(b, (id) => this.present(id))) {
      this.systemChat('Not enough tanks left before the first shot — back to the lobby.');
      this.returnToLobby();
      return;
    }
    this.beginNextTurn();
  }

  // ---------------------------------------------------------------------------
  // State mirroring
  // ---------------------------------------------------------------------------

  private syncTerrain(): void {
    if (!this.battle) return;
    this.state.battle.terrain = encodeTerrain(this.battle.terrain);
    this.state.battle.terrainRev = (this.state.battle.terrainRev + 1) & 0xffff;
  }

  private syncTank(t: BattleTank): void {
    let s = this.state.tanks.get(t.id);
    if (!s) {
      s = new Tank();
      s.id = t.id;
      this.state.tanks.set(t.id, s);
    }
    s.slot = t.slot;
    s.name = t.name;
    s.color = t.color;
    s.team = t.team;
    s.x = t.x;
    s.y = t.y;
    s.hp = Math.max(0, t.hp);
    s.maxHp = t.maxHp;
    s.alive = t.alive;
    s.angle = t.angle;
    s.power = t.power;
    s.weapon = t.weapon;
    s.fuel = t.fuel;
    s.maxFuel = this.battle?.config.fuelPerTurn ?? 0;
    s.place = t.place;
    s.kills = Math.min(255, t.kills);
    s.damage = Math.min(65535, t.damage);
    s.shots = Math.min(65535, t.shots);
    s.hits = Math.min(65535, t.hits);
    s.gone = t.gone;
    s.cpu = t.cpu;
    const ammo = s.ammo;
    for (const [w, n] of Object.entries(t.ammo) as Array<[WeaponId, number]>) {
      if (ammo[w] !== n) ammo[w] = n;
    }
  }

  private syncTanks(): void {
    if (!this.battle) return;
    for (const t of this.battle.tanks) this.syncTank(t);
  }

  // ---------------------------------------------------------------------------
  // Turns
  // ---------------------------------------------------------------------------

  /** Turn length (tests shorten it). */
  protected turnMs(): number {
    return this.getSettings().turnSeconds * 1000;
  }

  private armTurnTimer(ms: number, reason: 'timeout' | 'absent'): void {
    const turnId = this.state.battle.turnId;
    this.state.battle.turnEndsAt = Date.now() + ms;
    this.setTimer(ms);
    this.schedule('turn', ms, () => {
      if (this.state.battle.turnId === turnId && this.state.battle.stage === 'aim') this.skipActive(reason);
    });
  }

  private beginNextTurn(): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.finishing) return;
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    if (b.result || this.checkForfeitNow()) {
      this.finish();
      return;
    }
    const present = (id: string) => this.present(id);
    const r = nextTurn(b, this.rng, present);
    if (r.kind === 'round_limit') {
      endByRounds(b);
      this.finish();
      return;
    }
    if (r.kind === 'over') {
      this.finish();
      return;
    }
    const meta = this.state.battle;
    const tank = tankById(b, r.activeId)!;
    this.state.round = r.round;
    meta.stage = 'aim';
    meta.activeId = r.activeId;
    meta.turnId = r.turnId;
    meta.wind = r.wind;
    meta.resolveEndsAt = 0;
    meta.queue = upcoming(b, 4, present).join(',');
    this.syncTank(tank);
    this.broadcast(TANKS_MSG.event, { kind: 'turn', turnId: r.turnId, playerId: r.activeId, round: r.round, wind: r.wind } satisfies TanksEvent);

    const turnMs = this.turnMs();
    if (tank.cpu) {
      this.armTurnTimer(turnMs, 'timeout');
      const [lo, hi] = this.botThinkMs;
      const think = lo + this.rng.int(Math.max(1, hi - lo + 1));
      this.schedule('bot', think, () => this.botAim(r.turnId));
      return;
    }
    const player = this.players.get(r.activeId);
    if (!player || player.away) {
      this.armTurnTimer(this.timing.absentSkipMs, 'absent');
      return;
    }
    const idle = (this.idleStrikes.get(player.id) ?? 0) >= this.timing.idleStrikes;
    const ms = !player.client ? Math.min(turnMs, this.timing.disconnectedTurnMs) : idle ? Math.min(turnMs, this.timing.idleTurnMs) : turnMs;
    this.armTurnTimer(ms, 'timeout');
  }

  /** The active player did something: they're not idle (any more). */
  private markActive(player: PlayerRecord): void {
    if (this.idleStrikes.has(player.id)) this.idleStrikes.delete(player.id);
  }

  private skipActive(reason: 'timeout' | 'absent'): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim') return;
    const id = meta.activeId;
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    skipTurn(b);
    this.stats.skips++;
    meta.stage = 'idle';
    meta.turnEndsAt = 0;
    this.setTimer(0);
    this.broadcast(TANKS_MSG.event, { kind: 'skip', turnId: meta.turnId, playerId: id, reason } satisfies TanksEvent);
    const p = this.players.get(id);
    // Turns that ran out while the player was disconnected aren't idling (they get short turns anyway).
    if (p?.client && reason === 'timeout') {
      const strikes = (this.idleStrikes.get(id) ?? 0) + 1;
      this.idleStrikes.set(id, strikes);
      const idle = strikes >= this.timing.idleStrikes;
      this.toast(p, 'warning', idle ? 'Out of time again — your turns are short until you aim or fire.' : 'Out of time — your turn was skipped.');
    }
    this.schedule('next', this.timing.afterSkipMs, () => this.beginNextTurn());
  }

  /** The active player left mid-turn: move on after a short beat. */
  private endTurnEarly(): void {
    const meta = this.state.battle;
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    meta.stage = 'idle';
    meta.turnEndsAt = 0;
    this.setTimer(0);
    if (!this.battle?.result) this.schedule('next', this.timing.afterSkipMs, () => this.beginNextTurn());
  }

  private canAct(player: PlayerRecord): boolean {
    const b = this.battle;
    return Boolean(b && this.state.battle.stage === 'aim' && b.activeId === player.id && !this.finishing);
  }

  private onAim(player: PlayerRecord, angle: number, power: number, weapon: WeaponId): void {
    if (!this.canAct(player)) return;
    this.markActive(player);
    if (setAim(this.battle!, player.id, angle, power, weapon)) this.syncTank(tankById(this.battle!, player.id)!);
  }

  private onMove(player: PlayerRecord, dir: -1 | 1): void {
    if (!this.canAct(player)) return;
    this.markActive(player);
    const r = drive(this.battle!, player.id, dir, MOVE_STEP);
    if (r.moved > 0) this.syncTank(tankById(this.battle!, player.id)!);
  }

  private onFire(player: PlayerRecord, shot: { turnId: number; angle: number; power: number; weapon: WeaponId }): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim' || this.finishing) return this.reject(player, TANKS_MSG.fire, 'wrong_phase', 'Hold fire — the battlefield is settling.');
    if (b.activeId !== player.id) return this.reject(player, TANKS_MSG.fire, 'not_your_turn', "It's not your turn.");
    if (shot.turnId !== b.turnId) return this.reject(player, TANKS_MSG.fire, 'not_allowed', 'That shot was from an earlier turn.');
    const tank = tankById(b, player.id)!;
    if (tank.ammo[shot.weapon] === 0) return this.reject(player, TANKS_MSG.fire, 'not_allowed', 'Out of that ammo — pick another weapon.');
    this.markActive(player);
    this.executeShot(player.id, shot.angle, shot.power, shot.weapon);
  }

  private executeShot(id: string, angle: number, power: number, weapon: WeaponId): void {
    const b = this.battle;
    if (!b) return;
    const script = fire(b, id, angle, power, weapon);
    if (typeof script === 'string') return;
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    this.stats.shots++;
    this.stats.lastScript = script;
    const meta = this.state.battle;
    meta.stage = 'resolving';
    meta.shotSeq = script.seq;
    meta.turnEndsAt = 0;
    meta.resolveEndsAt = Date.now() + script.durationMs;
    this.setTimer(0);
    this.syncTerrain();
    this.syncTanks();
    this.broadcast(TANKS_MSG.shot, script);
    const shooter = tankById(b, id)!;
    for (const ev of script.events) {
      if (ev.k !== 'death') continue;
      const v = tankById(b, ev.id);
      if (!v) continue;
      this.systemChat(v.id === shooter.id ? `${v.name} was caught in their own blast!` : `${shooter.name} destroyed ${v.name}!`);
      this.broadcast(TANKS_MSG.event, { kind: 'eliminated', playerId: v.id, reason: 'destroyed' } satisfies TanksEvent);
    }
    this.schedule('resolve', this.resolveDelayMs(script), () => this.afterShot());
  }

  /** How long the server waits for clients to play a shot back (tests shorten it). */
  protected resolveDelayMs(script: ShotScript): number {
    return script.durationMs + this.timing.afterShotMs;
  }

  private afterShot(): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING') return;
    this.state.battle.stage = 'idle';
    if (b.result || this.checkForfeitNow()) {
      this.finish();
      return;
    }
    this.beginNextTurn();
  }

  // ---------------------------------------------------------------------------
  // CPU
  // ---------------------------------------------------------------------------

  private botAim(turnId: number): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim' || meta.turnId !== turnId || this.finishing) return;
    const id = meta.activeId;
    const tank = tankById(b, id);
    if (!tank?.cpu) return;
    const plan = planShot(b, id, this.getSettings().cpuSkill, this.rng);
    setAim(b, id, plan.angle, plan.power, plan.weapon);
    this.syncTank(tank);
    this.schedule('bot-fire', this.botFireDelayMs, () => {
      if (meta.stage !== 'aim' || meta.turnId !== turnId) return;
      this.executeShot(id, plan.angle, plan.power, plan.weapon);
    });
  }

  // ---------------------------------------------------------------------------
  // Victory
  // ---------------------------------------------------------------------------

  private finish(): void {
    const b = this.battle;
    if (!b || this.finishing || this.phase !== 'PLAYING') return;
    this.finishing = true;
    const result = b.result ?? endByRounds(b);
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    this.cancel('next');
    const meta = this.state.battle;
    meta.stage = 'over';
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.queue = '';
    meta.winnerTeam = result.winnerTeam;
    meta.winners = result.winners.join(',');
    meta.reason = result.reason;
    this.setTimer(0);
    this.syncTanks();

    const scores: Record<string, number> = {};
    for (const t of b.tanks) {
      scores[t.id] = t.damage;
      const p = this.players.get(t.id);
      if (p) p.state.score = t.damage;
    }
    const cpuIds = b.tanks.filter((t) => t.cpu).map((t) => t.id);
    const cpuCount = cpuIds.length;
    this.reportOutcome({
      // CPU tanks keep their places (a human behind a CPU didn't win) but are never credited.
      placements: result.placements,
      nonPlayerIds: cpuIds,
      scores,
      reason: result.reason,
      details: {
        mode: b.config.mode,
        rounds: b.round,
        terrain: b.style,
        cpu: cpuCount,
        winnerTeam: result.winnerTeam,
        playerStats: Object.fromEntries(
          b.tanks.filter((t) => !t.cpu).map((t) => [t.id, { damage: t.damage, kills: t.kills, shots: t.shots, hits: t.hits, maxDamage: t.damage }]),
        ),
      },
    });
    this.broadcast(TANKS_MSG.event, { kind: 'victory', winners: result.winners, team: result.winnerTeam, reason: result.reason } satisfies TanksEvent);
    const names = result.winners.map((id) => tankById(b, id)?.name ?? '?');
    if (result.reason === 'draw') this.systemChat('Mutual destruction — the battle is a draw!');
    else if (result.winnerTeam >= 0) this.systemChat(`Team ${TEAM_NAMES[result.winnerTeam]} wins the battle!`);
    else this.systemChat(`${names.join(' & ')} win${names.length === 1 ? 's' : ''} the battle!`);

    this.schedule('results', this.timing.victoryMs, () => {
      if (this.phase !== 'PLAYING') return;
      this.endMatch({
        players: b.tanks
          .filter((t) => !t.cpu)
          .map((t) => {
            const p = this.players.get(t.id);
            return { playerId: t.id, name: t.name, guestId: p?.guestId, userId: p?.userId, score: t.damage, placement: t.place };
          }),
        details: { mode: b.config.mode, reason: result.reason, rounds: b.round, winners: result.winners, cpu: cpuCount },
      });
    });
  }

  protected override onReturnToLobby(): void {
    this.battle = null;
    this.finishing = false;
    this.idleStrikes.clear();
    this.state.tanks.clear();
    const meta = this.state.battle;
    meta.stage = 'idle';
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.resolveEndsAt = 0;
    meta.winners = '';
    meta.winnerTeam = -1;
    meta.reason = '';
    meta.queue = '';
    meta.terrain = '';
    for (const p of this.players.values()) if (!this.state.crew.has(p.id)) this.state.crew.set(p.id, new Crew());
  }

  protected override onRoomDisposed(): void {
    this.battle = null;
  }
}
