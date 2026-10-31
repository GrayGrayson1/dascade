/**
 * DAS Tanks — authoritative scorched-earth artillery room.
 *
 * Flow: LOBBY (team picks, host settings incl. CPU tanks) → COUNTDOWN (the match and the
 * first battlefield are built and visible) → PLAYING, a run of battles:
 *   shop (credits → weapons and defenses; skipped when nobody can buy anything)
 *   → intro ("Battle 2 of 5") → turns or volleys of { aim/drive/items → fire → resolve }
 *   (with the odd hazard) → battle_over (earnings) → next battle … → over (match standings)
 * → RESULTS → LOBBY (or straight into a rematch).
 *
 * Clients send intents only (aim, one-step drives, items, fire with the current turn id,
 * buy/sell/ready in the shop). Every shot is simulated here by `@dascade/game-core/tanks`;
 * the resulting ShotScript is broadcast for playback and the battle moves on once its
 * duration has elapsed.
 *
 * Anti-stall: every turn and volley has a timer; disconnected players get a short turn;
 * away/absent players are skipped at once (and never hold up a volley or the shop); when
 * only one side is still manned the absent side forfeits; a round limit ends marathon
 * battles; leaving scuttles your tank and takes your crew out of the match.
 */
import { EmptySchema, RATE } from '@dascade/shared';
import {
  BATTLE_THEMES,
  CPU_SKILL_LABEL,
  DEFAULT_TANKS_SETTINGS,
  FUEL_PER_TURN,
  MAX_TANKS,
  MOVE_STEP,
  PERSONAS,
  PERSONA_INFO,
  SHIELD_HP,
  TANKS_AIM_RATE,
  TANKS_FIRE_RATE,
  TANKS_ITEM_RATE,
  TANKS_MOVE_RATE,
  TANKS_MSG,
  TANKS_SHOP_RATE,
  TANKS_TIMING,
  TEAM_NAMES,
  TanksAimSchema,
  TanksBuySchema,
  TanksFireSchema,
  TanksItemSchema,
  TanksMoveSchema,
  TanksReadySchema,
  TanksSettingsSchema,
  TanksTeamSchema,
  WIND_MAX,
  type Persona,
  type ShopId,
  type ShotScript,
  type TanksEvent,
  type TanksSettings,
  type UsableItemId,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import {
  abandon,
  allLocked,
  allReady,
  assignTeams,
  basketString,
  beginVolley,
  burialDepth,
  buy,
  checkForfeit,
  createBattle,
  createMatch,
  drive,
  encodeTerrain,
  endByRounds,
  finishMatch,
  fire,
  fleetMember,
  isBuried,
  lock,
  nextTurn,
  openShop,
  planItems,
  planShop,
  planShot,
  prepareBattle,
  resolveVolley,
  sell,
  setAim,
  setReady,
  settleBattle,
  shopOpens,
  skipTurn,
  strikeHazard,
  tankById,
  upcoming,
  useItem,
  type Battle,
  type BattleTank,
  type BotContext,
  type FleetMember,
  type Match,
  type MatchMember,
} from '@dascade/game-core/tanks';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { Crew, Fleet, Tank, TanksState } from './TanksState.ts';

const CPU_COLORS = ['#a78bfa', '#a3e635', '#60a5fa', '#fb7185', '#facc15', '#2dd4bf', '#f472b6'];
/** Chance a new round opens with a hazard (when hazards are on). */
const HAZARD_CHANCE = 0.3;

const ITEM_REFUSAL: Record<string, string> = {
  not_your_turn: 'Items can only be used while you can act.',
  none_left: 'You have none of those left.',
  full_armor: 'Your armor is already full.',
  no_driving: 'Driving is off in this battle.',
};

const SHOP_REFUSAL: Record<string, string> = {
  closed: 'The shop is closed.',
  unknown: 'That isn’t for sale.',
  credits: 'Not enough credits.',
  full: 'You can’t carry any more of those.',
  blocked: 'That’s no use in this battle.',
  not_in_basket: 'You can only sell back what you bought this visit.',
};

type Timing = { -readonly [K in keyof typeof TANKS_TIMING]: number };

export class TanksRoom extends BaseGameRoom<TanksState, TanksSettings> {
  readonly gameId = 'tanks' as const;
  protected readonly settingsSchema = TanksSettingsSchema;
  /** Overridable by integration tests. */
  protected timing: Timing = { ...TANKS_TIMING };
  /** CPU "thinking" time range before it aims, and its aim → fire beat (ms). */
  protected botThinkMs: [number, number] = [900, 1800];
  protected botFireDelayMs = 850;
  /** Chance per new round of a hazard (tests set 0 or 1). */
  protected hazardChance = HAZARD_CHANCE;

  protected match: Match | null = null;
  protected battle: Battle | null = null;
  private finishing = false;
  private battleSerial = 0;
  /** The last round that already had its hazard roll. */
  private hazardRound = 0;
  /** Consecutive timed-out turns per player (reset when they aim, drive or fire). */
  private readonly idleStrikes = new Map<string, number>();
  /** CPU persona per CPU id. */
  private readonly personas = new Map<string, Persona>();
  /** Diagnostics for tests. */
  readonly stats = { shots: 0, skips: 0, hazards: 0, lastScript: null as ShotScript | null };

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
      maxNodes: 8, // schema maximum 4
    });
    this.handle(TANKS_MSG.move, TanksMoveSchema, (p, { dir }) => this.onMove(p, dir), {
      phases: ['PLAYING'],
      playersOnly: true,
      silent: true,
      rate: TANKS_MOVE_RATE,
      maxNodes: 8, // schema maximum 2
    });
    this.handle(TANKS_MSG.fire, TanksFireSchema, (p, shot) => this.onFire(p, shot), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: TANKS_FIRE_RATE,
    });
    this.handle(TANKS_MSG.item, TanksItemSchema, (p, { item, turnId }) => this.onItem(p, item, turnId), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: TANKS_ITEM_RATE,
    });
    this.handle(TANKS_MSG.buy, TanksBuySchema, (p, { id }) => this.onShop(p, id, 'buy'), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: TANKS_SHOP_RATE,
    });
    this.handle(TANKS_MSG.sell, TanksBuySchema, (p, { id }) => this.onShop(p, id, 'sell'), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: TANKS_SHOP_RATE,
    });
    this.handle(TANKS_MSG.ready, TanksReadySchema, (p, { ready }) => this.onReady(p, ready), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
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
    if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN') return;
    const member = this.match ? fleetMember(this.match, player.id) : undefined;
    if (member && !member.gone) {
      member.gone = true;
      member.ready = true;
      this.syncFleet(member);
    }
    const b = this.battle;
    if (!b || !tankById(b, player.id)) {
      this.checkShopDone();
      return;
    }
    const stage = this.state.battle.stage;
    const wasActive = b.activeId === player.id && stage === 'aim';
    if (!abandon(b, player.id)) return;
    this.syncTanks();
    this.broadcast(TANKS_MSG.event, { kind: 'eliminated', playerId: player.id, reason: 'left' } satisfies TanksEvent);
    if (this.phase !== 'PLAYING') return;
    if (stage === 'shop') return this.checkShopDone();
    if (stage === 'resolving' || stage === 'battle_over' || stage === 'over' || stage === 'intro') return; // picked up when the stage ends
    if (b.config.turnMode === 'volley' && stage === 'aim') {
      if (b.result) return this.finishBattle();
      return this.checkVolleyDone();
    }
    if (wasActive) this.endTurnEarly();
    if (b.result) this.finishBattle();
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.state.battle.stage !== 'aim') return;
    if (b.config.turnMode === 'volley') return this.checkVolleyDone();
    if (b.activeId !== player.id) return;
    const left = this.state.battle.turnEndsAt - Date.now();
    if (left > this.timing.disconnectedTurnMs) this.armTurnTimer(this.timing.disconnectedTurnMs, 'timeout');
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING') return;
    const stage = this.state.battle.stage;
    if (stage === 'shop') return this.checkShopDone();
    if (stage === 'aim') {
      if (b.config.turnMode === 'volley') this.checkVolleyDone();
      else if (b.activeId === player.id) this.skipActive('absent');
    }
    this.checkForfeitNow();
  }

  private present(id: string): boolean {
    if (id.startsWith('cpu-')) return true;
    const p = this.players.get(id);
    return Boolean(p && !p.away && !p.state.spectator);
  }

  /** Present and not idling (volleys and the shop don't wait for idle players). */
  private engaged(id: string): boolean {
    if (!this.present(id)) return false;
    const p = this.players.get(id);
    if (p && !p.client) return false;
    return (this.idleStrikes.get(id) ?? 0) < this.timing.idleStrikes;
  }

  private checkForfeitNow(): boolean {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.finishing) return false;
    const stage = this.state.battle.stage;
    if (stage !== 'aim' && stage !== 'idle' && stage !== 'resolving') return false;
    const result = checkForfeit(b, (id) => this.present(id));
    if (!result) return false;
    if (stage !== 'resolving') this.finishBattle();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lobby → match
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
    this.setupMatch();
  }

  private setupMatch(): void {
    const s = this.getSettings();
    const humans = this.humans();
    const cpus = this.cpuCount(humans.length);
    const teams = s.mode === 'teams';
    const assignment = teams ? this.teamPreview(humans, cpus) : new Map<string, number>();
    const used = new Set(humans.map((p) => p.state.color.toLowerCase()));
    const members: MatchMember[] = humans.map((p) => ({
      id: p.id,
      name: p.state.name,
      color: p.state.color,
      team: assignment.get(p.id) ?? -1,
    }));
    const cpuColors = CPU_COLORS.filter((c) => !used.has(c));
    const personas = [...PERSONAS];
    for (let i = personas.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [personas[i], personas[j]] = [personas[j]!, personas[i]!];
    }
    this.personas.clear();
    for (let i = 0; i < cpus; i++) {
      const id = `cpu-${i + 1}`;
      const persona = personas[i % personas.length]!;
      this.personas.set(id, persona);
      members.push({
        id,
        name: PERSONA_INFO[persona].name,
        color: cpuColors[i % Math.max(1, cpuColors.length)] ?? CPU_COLORS[i % CPU_COLORS.length]!,
        team: assignment.get(id) ?? -1,
        cpu: true,
        persona,
      });
    }
    this.match = createMatch(members, { battles: s.battles, economy: s.economy, startCredits: s.startCredits, mode: s.mode });
    this.finishing = false;
    this.idleStrikes.clear();
    this.stats.lastScript = null;
    this.state.fleet.clear();
    for (const f of this.match.fleet) this.syncFleet(f);
    this.buildBattle();
    if (cpus > 0 && !this.isSolo)
      this.systemChat(`${cpus} CPU tank${cpus === 1 ? '' : 's'} (${CPU_SKILL_LABEL[s.cpuSkill]}) joined the battle.`);
  }

  /** Generate the next battlefield (visible during the shop) and place every crew still in the match. */
  private buildBattle(): void {
    const m = this.match!;
    const s = this.getSettings();
    const entrants = prepareBattle(m, this.rng);
    const theme = BATTLE_THEMES[this.rng.int(BATTLE_THEMES.length)]!;
    this.battle = createBattle(this.rng, entrants, {
      mode: s.mode,
      turnMode: s.turnMode,
      style: s.terrain,
      walls: s.walls,
      gravity: s.gravity,
      windMax: WIND_MAX[s.wind],
      fuelPerTurn: FUEL_PER_TURN[s.movement],
      armor: s.armor,
      maxRounds: s.maxRounds,
      friendlyFire: s.friendlyFire,
      theme,
      talk: s.talk,
      order: 'given',
    });
    this.hazardRound = 0;
    this.battleSerial = (this.battleSerial + 1) & 0xffff;
    const meta = this.state.battle;
    meta.stage = 'idle';
    meta.battleSerial = this.battleSerial;
    meta.theme = theme;
    meta.style = this.battle.style;
    meta.walls = this.battle.walls;
    meta.gravity = s.gravity;
    meta.economy = s.economy;
    meta.width = this.battle.terrain.width;
    meta.height = this.battle.terrain.height;
    meta.wind = 0;
    meta.turnId = 0;
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.stageEndsAt = 0;
    meta.resolveEndsAt = 0;
    meta.shotSeq = 0;
    meta.mode = s.mode;
    meta.turnMode = s.turnMode;
    meta.maxRounds = s.maxRounds;
    meta.friendlyFire = s.friendlyFire;
    meta.battleNo = m.battleNo;
    meta.battles = m.config.battles;
    meta.winnerTeam = -1;
    meta.winners = '';
    meta.reason = '';
    meta.queue = '';
    this.state.round = 0;
    this.state.tanks.clear();
    this.syncTerrain();
    this.syncTanks();
    for (const f of m.fleet) this.syncFleet(f);
  }

  protected onGameStart(): void {
    if (!this.match || !this.battle) this.setupMatch();
    const b = this.battle!;
    for (const t of b.tanks) {
      if (!t.cpu && !this.players.has(t.id)) {
        abandon(b, t.id);
        const f = fleetMember(this.match!, t.id);
        if (f) f.gone = true;
      }
    }
    // Someone left (or dropped) during the countdown and the battle is already decided: nobody fired
    // a shot, so there is nothing to report — back to the lobby instead.
    if (b.result || checkForfeit(b, (id) => this.present(id))) {
      this.systemChat('Not enough tanks left before the first shot — back to the lobby.');
      this.returnToLobby();
      return;
    }
    this.openShopOrIntro();
  }

  // ---------------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------------

  /** Things this battle can't use (no fuel cans without driving). */
  private blockedItems(): Set<ShopId> {
    return new Set<ShopId>(FUEL_PER_TURN[this.getSettings().movement] <= 0 ? ['fuel'] : []);
  }

  private openShopOrIntro(): void {
    const m = this.match!;
    if (!shopOpens(m)) return this.startIntro();
    openShop(m);
    const meta = this.state.battle;
    meta.stage = 'shop';
    meta.stageEndsAt = Date.now() + this.timing.shopMs;
    this.setTimer(this.timing.shopMs);
    const s = this.getSettings();
    const last = m.battleNo >= m.config.battles;
    for (const f of m.fleet) {
      if (f.cpu && !f.gone) {
        const persona = this.personas.get(f.id) ?? 'gunner';
        for (const id of planShop(f, { skill: s.cpuSkill, persona }, this.rng, { lastBattle: last, blocked: this.blockedItems() }))
          buy(m, f.id, id, this.blockedItems());
        f.ready = true;
      }
      this.syncFleet(f);
    }
    this.broadcast(TANKS_MSG.event, { kind: 'shop', battleNo: m.battleNo, battles: m.config.battles } satisfies TanksEvent);
    this.schedule('stage', this.timing.shopMs, () => this.closeShop());
    this.checkShopDone();
  }

  private onShop(player: PlayerRecord, id: ShopId, action: 'buy' | 'sell'): void {
    const m = this.match;
    if (!m || this.state.battle.stage !== 'shop') return this.reject(player, TANKS_MSG[action], 'wrong_phase', SHOP_REFUSAL.closed!);
    const f = fleetMember(m, player.id);
    if (!f || f.gone) return this.reject(player, TANKS_MSG[action], 'not_allowed', 'You aren’t in this match.');
    if (f.ready) return this.reject(player, TANKS_MSG[action], 'not_allowed', 'You’re marked ready — un-ready to keep shopping.');
    const err = action === 'buy' ? buy(m, player.id, id, this.blockedItems()) : sell(m, player.id, id);
    if (err) return this.reject(player, TANKS_MSG[action], 'not_allowed', SHOP_REFUSAL[err] ?? 'Not possible.');
    this.idleStrikes.delete(player.id);
    this.syncFleet(f);
  }

  private onReady(player: PlayerRecord, ready: boolean): void {
    const m = this.match;
    if (!m || this.state.battle.stage !== 'shop') return;
    if (!setReady(m, player.id, ready)) return;
    this.idleStrikes.delete(player.id);
    this.syncFleet(fleetMember(m, player.id)!);
    this.checkShopDone();
  }

  private checkShopDone(): void {
    const m = this.match;
    if (!m || this.phase !== 'PLAYING' || this.state.battle.stage !== 'shop') return;
    if (allReady(m, (id) => this.present(id))) {
      this.cancel('stage');
      // A short beat so the last "ready" registers on screen.
      this.schedule('stage', 600, () => this.closeShop());
    }
  }

  private closeShop(): void {
    if (this.phase !== 'PLAYING' || this.state.battle.stage !== 'shop') return;
    const m = this.match!;
    for (const f of m.fleet) {
      f.ready = false;
      f.basket.clear();
      this.syncFleet(f);
    }
    this.startIntro();
  }

  private startIntro(): void {
    const b = this.battle!;
    const m = this.match!;
    const meta = this.state.battle;
    meta.stage = 'intro';
    meta.stageEndsAt = Date.now() + this.timing.introMs;
    this.setTimer(0);
    this.syncTanks();
    this.broadcast(TANKS_MSG.event, {
      kind: 'battle',
      battleNo: m.battleNo,
      battles: m.config.battles,
      style: b.style,
      walls: b.walls,
    } satisfies TanksEvent);
    this.schedule('stage', this.timing.introMs, () => {
      if (this.phase !== 'PLAYING' || this.state.battle.stage !== 'intro') return;
      meta.stageEndsAt = 0;
      meta.stage = 'idle';
      if (b.result || this.checkForfeitNow()) return this.finishBattle();
      this.beginNextTurn();
    });
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
    const b = this.battle!;
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
    s.maxFuel = Math.max(b.config.fuelPerTurn, t.fuel);
    s.shield = t.shield;
    s.shieldKind = t.shieldKind;
    s.shieldMax = t.shieldKind ? SHIELD_HP[t.shieldKind] : 0;
    s.buried = t.alive && isBuried(b.terrain, t.x, t.y) ? Math.min(65535, Math.round(burialDepth(b.terrain, t.x, t.y))) : 0;
    s.locked = t.locked;
    s.place = t.place;
    s.kills = Math.min(255, t.kills);
    s.damage = Math.min(65535, t.damage);
    s.shots = Math.min(65535, t.shots);
    s.hits = Math.min(65535, t.hits);
    s.gone = t.gone;
    s.cpu = t.cpu;
  }

  private syncTanks(): void {
    if (!this.battle) return;
    for (const t of this.battle.tanks) this.syncTank(t);
  }

  private syncFleet(f: FleetMember): void {
    let s = this.state.fleet.get(f.id);
    if (!s) {
      s = new Fleet();
      s.id = f.id;
      this.state.fleet.set(f.id, s);
    }
    s.name = f.name;
    s.color = f.color;
    s.team = f.team;
    s.cpu = f.cpu;
    s.persona = f.persona;
    s.credits = f.credits;
    s.score = f.score;
    s.wins = Math.min(255, f.wins);
    s.kills = Math.min(65535, f.kills);
    s.damage = f.damage;
    s.ready = f.ready;
    s.basket = basketString(f);
    s.earned = f.earn.total;
    s.earnBase = f.earn.base;
    s.earnDamage = f.earn.damage;
    s.earnKills = f.earn.kills;
    s.earnSurvive = f.earn.survive;
    s.earnWin = f.earn.win;
    s.earnPenalty = f.earn.penalty;
    s.battleScore = f.battleScore;
    s.place = f.place;
    s.gone = f.gone;
    const ammo = s.ammo as unknown as Record<string, number>;
    for (const [id, n] of Object.entries(f.ammo)) if (ammo[id] !== n) ammo[id] = n;
    const items = s.items as unknown as Record<string, number>;
    for (const [id, n] of Object.entries(f.items)) if (items[id] !== n) items[id] = n;
  }

  private syncFleetOf(id: string): void {
    const f = this.match ? fleetMember(this.match, id) : undefined;
    if (f) this.syncFleet(f);
  }

  // ---------------------------------------------------------------------------
  // Turns and volleys
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
      if (this.state.battle.turnId !== turnId || this.state.battle.stage !== 'aim') return;
      if (this.battle?.config.turnMode === 'volley') this.closeVolley();
      else this.skipActive(reason);
    });
  }

  private cancelTurnTimers(): void {
    this.cancel('turn');
    this.cancel('bot');
    this.cancel('bot-fire');
    for (const t of this.battle?.tanks ?? []) {
      this.cancel(`bot:${t.id}`);
      this.cancel(`bot-fire:${t.id}`);
    }
    this.cancel('volley-close');
  }

  private beginNextTurn(): void {
    const b = this.battle;
    if (!b || this.phase !== 'PLAYING' || this.finishing) return;
    this.cancelTurnTimers();
    if (b.result || this.checkForfeitNow()) return this.finishBattle();
    if (this.maybeHazard()) return;
    if (b.config.turnMode === 'volley') return this.beginVolley();
    const present = (id: string) => this.present(id);
    const r = nextTurn(b, this.rng, present);
    if (r.kind === 'round_limit') {
      endByRounds(b);
      return this.finishBattle();
    }
    if (r.kind !== 'turn') return this.finishBattle();
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
    this.broadcast(TANKS_MSG.event, {
      kind: 'turn',
      turnId: r.turnId,
      playerId: r.activeId,
      round: r.round,
      wind: r.wind,
    } satisfies TanksEvent);

    const turnMs = this.turnMs();
    if (tank.cpu) {
      this.armTurnTimer(turnMs, 'timeout');
      const [lo, hi] = this.botThinkMs;
      const think = lo + this.rng.int(Math.max(1, hi - lo + 1));
      this.schedule('bot', think, () => this.botTurn(r.turnId, tank.id));
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

  private beginVolley(): void {
    const b = this.battle!;
    const r = beginVolley(b, this.rng);
    if (r.kind === 'round_limit') {
      endByRounds(b);
      return this.finishBattle();
    }
    if (r.kind !== 'volley') return this.finishBattle();
    const meta = this.state.battle;
    this.state.round = r.round;
    meta.stage = 'aim';
    meta.activeId = '';
    meta.turnId = r.turnId;
    meta.wind = r.wind;
    meta.resolveEndsAt = 0;
    meta.queue = '';
    this.syncTanks();
    this.broadcast(TANKS_MSG.event, { kind: 'volley', turnId: r.turnId, round: r.round, wind: r.wind, ids: r.ids } satisfies TanksEvent);
    this.armTurnTimer(this.turnMs(), 'timeout');
    const [lo, hi] = this.botThinkMs;
    for (const id of r.ids) {
      const t = tankById(b, id)!;
      if (!t.cpu) continue;
      const think = lo + this.rng.int(Math.max(1, hi - lo + 1));
      this.schedule(`bot:${id}`, think, () => this.botTurn(r.turnId, id));
    }
    this.checkVolleyDone();
  }

  /** Volley mode: everyone who's at the controls has locked in → fire. */
  private checkVolleyDone(): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || this.phase !== 'PLAYING' || meta.stage !== 'aim' || b.config.turnMode !== 'volley') return;
    if (b.result) return this.finishBattle();
    if (!allLocked(b, (id) => this.engaged(id))) return;
    if (this.isScheduled('volley-close')) return;
    const turnId = meta.turnId;
    this.schedule('volley-close', 350, () => {
      if (meta.turnId === turnId && meta.stage === 'aim') this.closeVolley();
    });
  }

  /** Volley mode: the aim window closed — fire every locked-in shot. */
  private closeVolley(): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim' || this.finishing) return;
    // Crews at the controls who never locked in let the clock run out.
    for (const id of b.acting) {
      const t = tankById(b, id);
      if (!t || !t.alive || t.locked || t.cpu) continue;
      const p = this.players.get(id);
      if (p?.client) {
        const strikes = (this.idleStrikes.get(id) ?? 0) + 1;
        this.idleStrikes.set(id, strikes);
        this.toast(
          p,
          'warning',
          strikes >= this.timing.idleStrikes
            ? 'Out of time again — the next volleys won’t wait for you until you fire.'
            : 'Out of time — you held fire this volley.',
        );
      }
    }
    this.cancelTurnTimers();
    const script = resolveVolley(b, { seed: this.rng.int(0x7fffffff), rng: this.rng });
    meta.turnEndsAt = 0;
    this.setTimer(0);
    if (!script) {
      this.stats.skips++;
      meta.stage = 'idle';
      this.syncTanks();
      this.schedule('next', this.timing.afterSkipMs, () => this.beginNextTurn());
      return;
    }
    this.playScript(script);
  }

  /** A hazard may open a new round. Returns true when one is under way. */
  private maybeHazard(): boolean {
    const b = this.battle!;
    if (!this.getSettings().hazards || b.round === 0) return false;
    // Turns mode: the next turn starts a new round when the side order wraps; volleys: every volley is a round.
    const nextRound = b.round + 1;
    const opensRound = b.config.turnMode === 'volley' || b.sideIdx >= b.sides.length - 1;
    if (!opensRound || nextRound <= this.hazardRound) return false;
    this.hazardRound = nextRound;
    if (this.rng.next() >= this.hazardChance) return false;
    const what = this.rng.int(2) === 0 ? 'meteor' : 'lightning';
    const meta = this.state.battle;
    meta.stage = 'idle';
    meta.activeId = '';
    this.broadcast(TANKS_MSG.event, { kind: 'hazard', what } satisfies TanksEvent);
    this.systemChat(what === 'meteor' ? 'Meteor shower incoming!' : 'Lightning storm overhead!');
    this.schedule('hazard', this.timing.hazardWarnMs, () => {
      if (this.phase !== 'PLAYING' || !this.battle || this.finishing) return;
      this.stats.hazards++;
      this.playScript(strikeHazard(this.battle, this.rng, what, { seed: this.rng.int(0x7fffffff), rng: this.rng }));
    });
    return true;
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
    this.cancelTurnTimers();
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
      this.toast(
        p,
        'warning',
        idle ? 'Out of time again — your turns are short until you aim or fire.' : 'Out of time — your turn was skipped.',
      );
    }
    this.schedule('next', this.timing.afterSkipMs, () => this.beginNextTurn());
  }

  /** The active player left mid-turn: move on after a short beat. */
  private endTurnEarly(): void {
    const meta = this.state.battle;
    this.cancelTurnTimers();
    meta.stage = 'idle';
    meta.turnEndsAt = 0;
    this.setTimer(0);
    if (!this.battle?.result) this.schedule('next', this.timing.afterSkipMs, () => this.beginNextTurn());
  }

  private canAct(player: PlayerRecord): boolean {
    const b = this.battle;
    if (!b || this.state.battle.stage !== 'aim' || this.finishing) return false;
    const t = tankById(b, player.id);
    if (!t || !t.alive) return false;
    return b.config.turnMode === 'volley' ? b.acting.includes(player.id) && !t.locked : b.activeId === player.id;
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

  private onItem(player: PlayerRecord, item: UsableItemId, turnId: number): void {
    const b = this.battle;
    if (!b || this.state.battle.stage !== 'aim' || this.finishing)
      return this.reject(player, TANKS_MSG.item, 'wrong_phase', 'Hold on — the battlefield is settling.');
    if (turnId !== b.turnId) return this.reject(player, TANKS_MSG.item, 'not_allowed', 'That was for an earlier turn.');
    const err = useItem(b, player.id, item);
    if (err)
      return this.reject(
        player,
        TANKS_MSG.item,
        err === 'not_your_turn' ? 'not_your_turn' : 'not_allowed',
        ITEM_REFUSAL[err] ?? 'Not possible.',
      );
    this.markActive(player);
    this.syncTank(tankById(b, player.id)!);
    this.syncFleetOf(player.id);
    this.broadcast(TANKS_MSG.event, { kind: 'item', playerId: player.id, item } satisfies TanksEvent);
  }

  private onFire(player: PlayerRecord, shot: { turnId: number; angle: number; power: number; weapon: WeaponId }): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim' || this.finishing)
      return this.reject(player, TANKS_MSG.fire, 'wrong_phase', 'Hold fire — the battlefield is settling.');
    if (shot.turnId !== b.turnId) return this.reject(player, TANKS_MSG.fire, 'not_allowed', 'That shot was from an earlier turn.');
    const tank = tankById(b, player.id);
    if (!tank || !tank.alive) return this.reject(player, TANKS_MSG.fire, 'not_allowed', 'Your tank is out of this battle.');
    if (tank.ammo[shot.weapon] === 0) return this.reject(player, TANKS_MSG.fire, 'not_allowed', 'Out of that ammo — pick another weapon.');
    if (b.config.turnMode === 'volley') {
      const err = lock(b, player.id, shot.angle, shot.power, shot.weapon);
      if (err)
        return this.reject(
          player,
          TANKS_MSG.fire,
          err === 'locked' ? 'not_allowed' : 'not_your_turn',
          err === 'locked' ? 'Already locked in.' : 'You can’t fire this volley.',
        );
      this.markActive(player);
      this.syncTank(tank);
      this.broadcast(TANKS_MSG.event, { kind: 'locked', turnId: b.turnId, playerId: player.id } satisfies TanksEvent);
      return this.checkVolleyDone();
    }
    if (b.activeId !== player.id) return this.reject(player, TANKS_MSG.fire, 'not_your_turn', "It's not your turn.");
    this.markActive(player);
    this.executeShot(player.id, shot.angle, shot.power, shot.weapon);
  }

  private executeShot(id: string, angle: number, power: number, weapon: WeaponId): void {
    const b = this.battle;
    if (!b) return;
    const script = fire(b, id, angle, power, weapon, { seed: this.rng.int(0x7fffffff), rng: this.rng });
    if (typeof script === 'string') return;
    this.cancelTurnTimers();
    this.playScript(script);
  }

  /** Broadcast a resolved script and move on once it has played out. */
  private playScript(script: ShotScript): void {
    const b = this.battle!;
    this.stats.shots += script.launches.length;
    this.stats.lastScript = script;
    const meta = this.state.battle;
    meta.stage = 'resolving';
    meta.shotSeq = script.seq;
    meta.turnEndsAt = 0;
    meta.activeId = '';
    meta.resolveEndsAt = Date.now() + script.durationMs;
    this.setTimer(0);
    this.syncTerrain();
    this.syncTanks();
    for (const l of script.launches) this.syncFleetOf(l.shooterId);
    for (const t of b.tanks) this.syncFleetOf(t.id);
    this.broadcast(TANKS_MSG.shot, script);
    for (const ev of script.events) {
      if (ev.k !== 'death') continue;
      const v = tankById(b, ev.id);
      if (!v) continue;
      const killer = ev.by ? tankById(b, ev.by) : undefined;
      this.systemChat(
        !ev.by
          ? `${v.name} was wiped out by the storm!`
          : killer?.id === v.id
            ? `${v.name} was caught in their own blast!`
            : `${killer?.name ?? 'Someone'} destroyed ${v.name}!`,
      );
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
    if (!b || this.phase !== 'PLAYING' || this.state.battle.stage !== 'resolving') return;
    this.state.battle.stage = 'idle';
    if (b.result || this.checkForfeitNow()) return this.finishBattle();
    this.beginNextTurn();
  }

  // ---------------------------------------------------------------------------
  // CPU
  // ---------------------------------------------------------------------------

  private botContext(id: string): BotContext {
    const scores: Record<string, number> = {};
    for (const f of this.match?.fleet ?? []) scores[f.id] = f.score;
    return { skill: this.getSettings().cpuSkill, persona: this.personas.get(id) ?? 'gunner', scores };
  }

  private botTurn(turnId: number, id: string): void {
    const b = this.battle;
    const meta = this.state.battle;
    if (!b || meta.stage !== 'aim' || meta.turnId !== turnId || this.finishing) return;
    const tank = tankById(b, id);
    if (!tank?.cpu || !tank.alive) return;
    const ctx = this.botContext(id);
    for (const item of planItems(b, id, ctx, this.rng)) {
      if (!useItem(b, id, item)) this.broadcast(TANKS_MSG.event, { kind: 'item', playerId: id, item } satisfies TanksEvent);
    }
    const plan = planShot(b, id, ctx, this.rng);
    setAim(b, id, plan.angle, plan.power, plan.weapon);
    this.syncTank(tank);
    this.syncFleetOf(id);
    const volley = b.config.turnMode === 'volley';
    this.schedule(volley ? `bot-fire:${id}` : 'bot-fire', this.botFireDelayMs, () => {
      if (meta.stage !== 'aim' || meta.turnId !== turnId) return;
      if (volley) {
        if (!lock(b, id, plan.angle, plan.power, plan.weapon)) {
          this.syncTank(tank);
          this.broadcast(TANKS_MSG.event, { kind: 'locked', turnId, playerId: id } satisfies TanksEvent);
          this.checkVolleyDone();
        }
        return;
      }
      this.executeShot(id, plan.angle, plan.power, plan.weapon);
    });
  }

  // ---------------------------------------------------------------------------
  // Battles and the match
  // ---------------------------------------------------------------------------

  /** A battle was decided: pay out, show the battle results, then the next shop/battle or the match result. */
  private finishBattle(): void {
    const b = this.battle;
    const m = this.match;
    if (!b || !m || this.finishing || this.phase !== 'PLAYING') return;
    const stage = this.state.battle.stage;
    if (stage === 'battle_over' || stage === 'over') return;
    const result = b.result ?? endByRounds(b);
    this.cancelTurnTimers();
    this.cancel('next');
    this.cancel('hazard');
    settleBattle(m, b);
    const meta = this.state.battle;
    meta.stage = 'battle_over';
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.queue = '';
    meta.winnerTeam = result.winnerTeam;
    meta.winners = result.winners.join(',');
    meta.reason = result.reason;
    meta.stageEndsAt = Date.now() + this.timing.battleOverMs;
    this.setTimer(0);
    this.syncTanks();
    for (const f of m.fleet) this.syncFleet(f);
    this.broadcast(TANKS_MSG.event, {
      kind: 'battle_over',
      battleNo: m.battleNo,
      winners: result.winners,
      team: result.winnerTeam,
      reason: result.reason,
    } satisfies TanksEvent);
    const names = result.winners.map((id) => tankById(b, id)?.name ?? '?');
    const tag = m.config.battles > 1 ? `Battle ${m.battleNo}: ` : '';
    if (result.reason === 'draw') this.systemChat(`${tag}mutual destruction — a draw!`);
    else if (result.winnerTeam >= 0) this.systemChat(`${tag}Team ${TEAM_NAMES[result.winnerTeam]} takes it!`);
    else this.systemChat(`${tag}${names.join(' & ')} win${names.length === 1 ? 's' : ''}!`);

    // Fewer than two sides still in the match (everyone else left): no point in another battle.
    const sides = new Set(
      m.fleet.filter((f) => !f.gone && (f.cpu || this.players.has(f.id))).map((f) => (m.config.mode === 'teams' ? f.team : f.id)),
    );
    const more = m.battleNo < m.config.battles && sides.size >= 2;
    this.schedule('stage', this.timing.battleOverMs, () => {
      if (this.phase !== 'PLAYING' || this.state.battle.stage !== 'battle_over') return;
      if (more) {
        this.buildBattle();
        this.openShopOrIntro();
      } else this.finishMatchNow();
    });
  }

  private finishMatchNow(): void {
    const m = this.match;
    const b = this.battle;
    if (!m || !b || this.finishing || this.phase !== 'PLAYING') return;
    this.finishing = true;
    const result = finishMatch(m);
    this.cancelTurnTimers();
    this.cancel('next');
    const meta = this.state.battle;
    meta.stage = 'over';
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.stageEndsAt = 0;
    meta.queue = '';
    meta.winnerTeam = result.winnerTeam;
    meta.winners = result.winners.join(',');
    meta.reason = result.reason;
    this.setTimer(0);
    for (const f of m.fleet) {
      this.syncFleet(f);
      const p = this.players.get(f.id);
      if (p) p.state.score = f.score;
    }
    const scores: Record<string, number> = {};
    for (const f of m.fleet) scores[f.id] = f.score;
    const cpuIds = m.fleet.filter((f) => f.cpu).map((f) => f.id);
    this.reportOutcome({
      // CPU crews keep their places (a human behind a CPU didn't win) but are never credited.
      placements: result.placements,
      nonPlayerIds: cpuIds,
      scores,
      reason: result.reason,
      details: {
        mode: m.config.mode,
        battles: m.battleNo,
        economy: m.config.economy,
        cpu: cpuIds.length,
        winnerTeam: result.winnerTeam,
        playerStats: Object.fromEntries(
          m.fleet
            .filter((f) => !f.cpu)
            .map((f) => [
              f.id,
              {
                damage: f.damage,
                kills: f.kills,
                shots: f.shots,
                hits: f.hits,
                battlesWon: f.wins,
                maxDamage: f.damage,
                bestMatchScore: Math.max(0, f.score),
              },
            ]),
        ),
      },
    });
    this.broadcast(TANKS_MSG.event, {
      kind: 'victory',
      winners: result.winners,
      team: result.winnerTeam,
      reason: result.reason,
    } satisfies TanksEvent);
    const names = result.winners.map((id) => fleetMember(m, id)?.name ?? '?');
    if (result.reason === 'draw') this.systemChat('The match is a draw!');
    else if (result.winnerTeam >= 0) this.systemChat(`Team ${TEAM_NAMES[result.winnerTeam]} wins the match!`);
    else this.systemChat(`${names.join(' & ')} win${names.length === 1 ? 's' : ''} the match!`);

    this.schedule('results', this.timing.victoryMs, () => {
      if (this.phase !== 'PLAYING') return;
      this.endMatch({
        players: m.fleet
          .filter((f) => !f.cpu)
          .map((f) => {
            const p = this.players.get(f.id);
            return { playerId: f.id, name: f.name, guestId: p?.guestId, userId: p?.userId, score: f.score, placement: f.place };
          }),
        details: { mode: m.config.mode, reason: result.reason, battles: m.battleNo, winners: result.winners, cpu: cpuIds.length },
      });
    });
  }

  protected override onReturnToLobby(): void {
    this.match = null;
    this.battle = null;
    this.finishing = false;
    this.idleStrikes.clear();
    this.personas.clear();
    this.state.tanks.clear();
    this.state.fleet.clear();
    const meta = this.state.battle;
    meta.stage = 'idle';
    meta.activeId = '';
    meta.turnEndsAt = 0;
    meta.stageEndsAt = 0;
    meta.resolveEndsAt = 0;
    meta.winners = '';
    meta.winnerTeam = -1;
    meta.reason = '';
    meta.queue = '';
    meta.terrain = '';
    meta.battleNo = 0;
    for (const p of this.players.values()) if (!this.state.crew.has(p.id)) this.state.crew.set(p.id, new Crew());
  }

  protected override onRoomDisposed(): void {
    this.match = null;
    this.battle = null;
  }
}
