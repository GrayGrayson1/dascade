/**
 * DASQuest — cooperative branching adventure. The server owns the run: it renders
 * scenes, collects votes, breaks ties, rolls every die with the crypto RNG, applies
 * consequences and signs checkpoint saves. Clients only send intents (pick hero,
 * vote, use item).
 *
 * Stage machine (inside the platform's PLAYING phase):
 *   voting ──(all voted + lock-in | timer | host "decide now")──▶ tally
 *     tally ──(host-mode tie)──▶ tiebreak ──(host pick | timeout → auto rule)──▶ resolve
 *     resolve ──(check)──▶ rolling (dice animation) ──▶ next scene (voting) … ending ──▶ RESULTS
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { EmptySchema, randomId } from '@dascade/shared';
import {
  DEFAULT_QUEST_SETTINGS,
  QUEST_ARCHETYPES,
  QUEST_MSG,
  QuestClaimSchema,
  QuestDebugSchema,
  QuestHeroPickSchema,
  QuestLoadSchema,
  QuestSettingsSchema,
  QuestTiebreakSchema,
  QuestUseSchema,
  QuestVoteSchema,
  QUEST_DIFFICULTY_DC,
  type QuestArchetypeId,
  type QuestCatalogView,
  type QuestChangeView,
  type QuestCheckpointPayload,
  type QuestEventPayload,
  type QuestLogEntryView,
  type QuestOutcomeView,
  type QuestPrivatePayload,
  type QuestRollView,
  type QuestSaveInfo,
  type QuestSettings,
  type QuestTieView,
  type QuestTone,
} from '@dascade/shared/games/quest';
import {
  availableChoices,
  breakTieAuto,
  buildResults,
  choiceOdds,
  compactSlots,
  createRun,
  enterNode,
  getNode,
  getPack,
  hasPack,
  interpolate,
  makeHero,
  omensFor,
  packCatalog,
  presentScene,
  recordVotes,
  resolveChoice,
  restoreRun,
  snapshotRun,
  tallyVotes,
  tieRuleText,
  useItem,
  type Adventure,
  type EnterResult,
  type HeroSeed,
  type Resolution,
  type RunState,
} from '@dascade/game-core/quest';
import { BaseRoomState } from '../../schema/base.ts';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { config } from '../../config.ts';
import { log } from '../../lib/log.ts';
import { signSave, verifySave } from './saves.ts';

// ---------------------------------------------------------------------------
// Synchronized state
// ---------------------------------------------------------------------------

export const QuestHero = schema(
  {
    playerId: t.string().default(''),
    name: t.string().default(''),
    color: t.string().default('#a3e635'),
    archetype: t.string().default(''),
    hp: t.int16().default(0),
    maxHp: t.int16().default(0),
    statuses: t.array('string'),
    ko: t.boolean().default(false),
    slot: t.int8().default(-1),
    present: t.boolean().default(true),
  },
  'QuestHero',
);
export type QuestHero = SchemaType<typeof QuestHero>;

export const QuestLogEntry = schema(
  {
    id: t.uint32().default(0),
    kind: t.string().default('system'),
    text: t.string().default(''),
    turn: t.uint16().default(0),
    tone: t.string().default(''),
  },
  'QuestLogEntry',
);
export type QuestLogEntry = SchemaType<typeof QuestLogEntry>;

export const QuestState = BaseRoomState.extend(
  {
    stage: t.string().default('lobby'),
    packId: t.string().default(''),
    packTitle: t.string().default(''),
    packsJson: t.string().default('[]'),
    catalogJson: t.string().default(''),
    heroes: t.map(QuestHero),
    inventory: t.map('number'),
    credits: t.int32().default(0),
    score: t.int32().default(0),
    turn: t.uint16().default(0),
    chapter: t.uint8().default(0),
    sceneJson: t.string().default(''),
    sceneRev: t.uint32().default(0),
    votes: t.map('string'),
    tieJson: t.string().default(''),
    rollJson: t.string().default(''),
    outcomeJson: t.string().default(''),
    resultJson: t.string().default(''),
    saveJson: t.string().default(''),
    log: t.array(QuestLogEntry),
  },
  'QuestState',
);
export type QuestState = SchemaType<typeof QuestState>;

/** Tunable timings (tests shrink these). */
export interface QuestTiming {
  /** Milliseconds per "vote second" from settings. */
  voteMsPerSecond: number;
  /** Grace after everyone has voted, so last-second changes still count. */
  lockInMs: number;
  soloLockInMs: number;
  /** How long the dice animation plays before the next scene. */
  rollRevealMs: number;
  /** Host tie-break window. */
  tiebreakMs: number;
  /** Re-check interval while the vote is paused (nobody connected). */
  pauseRecheckMs: number;
}

const LOG_LIMIT = 80;

interface PendingSave {
  info: QuestSaveInfo;
  run: RunState;
}

export class QuestRoom extends BaseGameRoom<QuestState, QuestSettings> {
  readonly gameId = 'quest' as const;
  protected readonly settingsSchema = QuestSettingsSchema;
  protected timing: QuestTiming = {
    voteMsPerSecond: 1000,
    lockInMs: 1500,
    soloLockInMs: 600,
    rollRevealMs: 4200,
    tiebreakMs: 15_000,
    pauseRecheckMs: 5000,
  };

  private adv: Adventure | null = null;
  private run: RunState | null = null;
  private pendingSave: PendingSave | null = null;
  private lastCheckpoint: QuestCheckpointPayload | null = null;
  private logSeq = 0;
  private rollSeq = 0;
  private paused = false;
  /** Endings discovered in this room across replays. */
  private readonly endingsFound = new Set<string>();
  /** Omens for the current scene (sent privately to Signal Seers). */
  private omens: QuestPrivatePayload = { rev: 0, omens: [] };

  protected defaultSettings(): QuestSettings {
    return structuredClone(DEFAULT_QUEST_SETTINGS);
  }

  protected createState(): QuestState {
    return new QuestState();
  }

  // =========================================================================
  // Setup
  // =========================================================================

  protected override onRoomCreated(): void {
    const catalog = packCatalog((id, err) => log.error('DASQuest pack failed validation', { pack: id, err: err as Error }));
    this.state.packsJson = JSON.stringify(catalog);
    if (!catalog.some((p) => p.id === this.settings.pack)) {
      this.updateSettings({ ...this.settings, pack: catalog[0]?.id ?? DEFAULT_QUEST_SETTINGS.pack });
    }
    this.publishPack();

    this.handle(QUEST_MSG.hero, QuestHeroPickSchema, (p, { archetype }) => this.pickHero(p, archetype), { phases: ['LOBBY'], playersOnly: true });
    this.handle(QUEST_MSG.claim, QuestClaimSchema, (p, { slot }) => this.claimSlot(p, slot), { phases: ['LOBBY'], playersOnly: true });
    this.handle(QUEST_MSG.load, QuestLoadSchema, (p, { blob }) => this.loadSave(p, blob), { phases: ['LOBBY'], hostOnly: true, rate: { burst: 5, perSecond: 0.5 } });
    this.handle(
      QUEST_MSG.unload,
      EmptySchema,
      () => {
        this.clearPendingSave();
        this.systemChat('The host set the saved adventure aside.');
      },
      { phases: ['LOBBY'], hostOnly: true },
    );
    this.handle(QUEST_MSG.vote, QuestVoteSchema, (p, payload) => this.castVote(p, payload.choiceId, payload.rev), { phases: ['PLAYING'], playersOnly: true });
    this.handle(
      QUEST_MSG.decide,
      EmptySchema,
      (p) => {
        if (this.state.stage !== 'voting') return this.reject(p, QUEST_MSG.decide, 'wrong_phase', 'There is no vote to decide right now.');
        this.pushLog('system', `${p.state.name} called the vote early.`);
        this.finalizeVote('host');
      },
      { phases: ['PLAYING'], hostOnly: true },
    );
    this.handle(QUEST_MSG.tiebreak, QuestTiebreakSchema, (p, { choiceId }) => this.hostTiebreak(p, choiceId), { phases: ['PLAYING'], hostOnly: true });
    this.handle(QUEST_MSG.use, QuestUseSchema, (p, payload) => this.useItem(p, payload.itemId, payload.targetId), { phases: ['PLAYING'], playersOnly: true });
    this.handle(QUEST_MSG.debug, QuestDebugSchema, (p, payload) => this.debug(p, payload), { phases: ['PLAYING'], hostOnly: true });
  }

  private publishPack(): void {
    try {
      const adv = getPack(this.settings.pack);
      this.state.packId = adv.id;
      this.state.packTitle = adv.title;
    } catch {
      this.state.packId = this.settings.pack;
      this.state.packTitle = '';
    }
  }

  protected override onSettingsChanged(prev: QuestSettings, next: QuestSettings): void {
    if (!hasPack(next.pack)) {
      const host = this.hostRecord;
      if (host) this.toast(host, 'error', 'That adventure pack is not installed on this server.');
      this.updateSettings({ ...next, pack: prev.pack });
      return;
    }
    if (prev.pack !== next.pack) {
      this.publishPack();
      if (this.pendingSave && this.pendingSave.info.packId !== next.pack) this.clearPendingSave();
      this.systemChat(`Adventure set to ${this.state.packTitle}.`);
    }
    this.normalizePicks();
  }

  protected override validateStart(): string | null {
    let adv: Adventure;
    try {
      adv = getPack(this.settings.pack);
    } catch {
      return 'The selected adventure pack failed to load.';
    }
    const seated = this.seatedPlayers().length;
    if (!this.settings.allowDuplicates && seated > adv.archetypes.length) {
      return `Only ${adv.archetypes.length} unique heroes exist — allow duplicate heroes for a party of ${seated}.`;
    }
    return null;
  }

  // =========================================================================
  // Lobby: hero picks & saves
  // =========================================================================

  private heroFor(player: PlayerRecord): QuestHero {
    let hero = this.state.heroes.get(player.id);
    if (!hero) {
      hero = new QuestHero();
      hero.playerId = player.id;
      hero.name = player.state.name;
      hero.color = player.state.color;
      this.state.heroes.set(player.id, hero);
    }
    return hero;
  }

  private pickHero(player: PlayerRecord, archetype: QuestArchetypeId): void {
    const adv = getPack(this.settings.pack);
    if (!adv.archetypes.includes(archetype)) {
      return this.reject(player, QUEST_MSG.hero, 'not_allowed', `${QUEST_ARCHETYPES[archetype].name} isn't available in this adventure.`);
    }
    if (!this.settings.allowDuplicates) {
      const taken = [...this.state.heroes.values()].find((h) => h.playerId !== player.id && h.archetype === archetype && this.isSeated(h.playerId));
      if (taken) return this.reject(player, QUEST_MSG.hero, 'not_allowed', `${taken.name} already picked the ${QUEST_ARCHETYPES[archetype].name}.`);
    }
    const hero = this.heroFor(player);
    hero.archetype = archetype;
    hero.name = player.state.name;
    hero.color = player.state.color;
    hero.maxHp = QUEST_ARCHETYPES[archetype].maxHp;
    hero.hp = hero.maxHp;
  }

  private isSeated(playerId: string): boolean {
    const p = this.players.get(playerId);
    return Boolean(p && !p.state.spectator);
  }

  /** Drop picks that no longer fit the pack / duplicate rules (earliest joiner keeps a contested pick). */
  private normalizePicks(): void {
    if (this.phase !== 'LOBBY') return;
    let adv: Adventure;
    try {
      adv = getPack(this.settings.pack);
    } catch {
      return;
    }
    const seen = new Set<string>();
    const ordered = [...this.state.heroes.values()].sort((a, b) => (this.players.get(a.playerId)?.state.joinOrder ?? 0) - (this.players.get(b.playerId)?.state.joinOrder ?? 0));
    for (const hero of ordered) {
      if (!hero.archetype) continue;
      const clash = !this.settings.allowDuplicates && seen.has(hero.archetype) && this.isSeated(hero.playerId);
      if (!adv.archetypes.includes(hero.archetype as QuestArchetypeId) || clash) {
        hero.archetype = '';
        const p = this.players.get(hero.playerId);
        if (p) this.toast(p, 'info', 'Your hero pick was cleared by a settings change — pick again.');
      } else if (this.isSeated(hero.playerId)) {
        seen.add(hero.archetype);
      }
    }
  }

  private claimSlot(player: PlayerRecord, slot: number): void {
    if (!this.pendingSave) return this.reject(player, QUEST_MSG.claim, 'not_allowed', 'No saved adventure is loaded.');
    const hero = this.heroFor(player);
    if (slot === -1) {
      hero.slot = -1;
      return;
    }
    const saved = this.pendingSave.info.heroes.find((h) => h.slot === slot);
    if (!saved) return this.reject(player, QUEST_MSG.claim, 'invalid_payload', 'That hero is not in the saved party.');
    const owner = [...this.state.heroes.values()].find((h) => h.slot === slot && h.playerId !== player.id);
    if (owner) return this.reject(player, QUEST_MSG.claim, 'not_allowed', `${owner.name} already claimed that hero.`);
    hero.slot = slot;
    hero.archetype = saved.archetype;
    hero.maxHp = saved.maxHp;
    hero.hp = saved.hp;
  }

  private loadSave(player: PlayerRecord, blob: string): void {
    const verified = verifySave(blob);
    if (!verified.ok) return this.reject(player, QUEST_MSG.load, 'not_allowed', verified.error);
    if (!hasPack(verified.info.packId)) return this.reject(player, QUEST_MSG.load, 'not_allowed', 'That adventure is not installed on this server.');
    const adv = getPack(verified.info.packId);
    const restored = restoreRun(adv, verified.run);
    if (!restored.ok) return this.reject(player, QUEST_MSG.load, 'not_allowed', restored.error);
    if (this.settings.pack !== adv.id) this.updateSettings({ ...this.settings, pack: adv.id });
    this.pendingSave = { info: verified.info, run: restored.run };
    this.state.saveJson = JSON.stringify(verified.info);
    for (const hero of this.state.heroes.values()) hero.slot = -1;
    this.systemChat(`${player.state.name} loaded a saved adventure: ${adv.title}, chapter ${verified.info.chapter} — ${verified.info.nodeTitle}. Claim your hero!`);
    this.toast(player, 'success', 'Save loaded. Everyone can now claim a saved hero.');
  }

  private clearPendingSave(): void {
    this.pendingSave = null;
    this.state.saveJson = '';
    for (const hero of this.state.heroes.values()) {
      hero.slot = -1;
      if (hero.archetype) {
        hero.maxHp = QUEST_ARCHETYPES[hero.archetype as QuestArchetypeId].maxHp;
        hero.hp = hero.maxHp;
      }
    }
  }

  // =========================================================================
  // Match lifecycle
  // =========================================================================

  protected onGameStart(): void {
    const adv = getPack(this.settings.pack);
    this.adv = adv;
    this.logSeq = 0;
    this.state.log.clear();
    this.state.resultJson = '';
    this.state.rollJson = '';
    this.state.outcomeJson = '';
    this.state.packId = adv.id;
    this.state.packTitle = adv.title;
    this.state.catalogJson = JSON.stringify(this.catalogView(adv));

    const seated = this.seatedPlayers();
    const picks = this.assignArchetypes(adv, seated);
    let enter: EnterResult | null = null;

    if (this.pendingSave) {
      this.run = this.restoreParty(adv, this.pendingSave, seated, picks);
      this.pushLog('system', `Resumed ${adv.title} — chapter ${this.run.chapter}: ${adv.chapterTitle(this.run.chapter)}.`, 'good');
      this.pendingSave = null;
      this.state.saveJson = '';
    } else {
      const seeds: HeroSeed[] = seated.map((p) => ({ playerId: p.id, name: p.state.name, color: p.state.color, archetype: picks.get(p.id)! }));
      const created = createRun(adv, seeds, { runId: randomId(12, this.rng), dcShift: QUEST_DIFFICULTY_DC[this.settings.difficulty], leaderSlot: 0 }, this.rng);
      this.run = created.run;
      enter = created.enter;
      this.pushLog('system', `${adv.title} begins. Party: ${this.run.heroes.map((h) => `${h.name} the ${QUEST_ARCHETYPES[h.archetype].name}`).join(', ')}.`);
    }
    this.run.dcShift = QUEST_DIFFICULTY_DC[this.settings.difficulty];
    this.syncRun();
    this.startScene(enter, null);
  }

  private catalogView(adv: Adventure): QuestCatalogView {
    const items: QuestCatalogView['items'] = {};
    for (const [id, item] of Object.entries(adv.items)) {
      const bonus = item.bonus ? `${item.bonus.amount > 0 ? '+' : ''}${item.bonus.amount} ${item.bonus.stat ?? `${item.bonus.tag} checks`}` : undefined;
      items[id] = {
        id,
        name: item.name,
        description: item.description,
        icon: item.icon,
        usable: Boolean(item.use),
        ...(item.use ? { useLabel: item.use.label, useTarget: item.use.target } : {}),
        key: item.key,
        ...(bonus ? { bonus } : {}),
      };
    }
    const statuses: QuestCatalogView['statuses'] = {};
    for (const [id, s] of Object.entries(adv.statuses)) statuses[id] = { id, name: s.name, description: s.description, tone: s.tone };
    return { items, statuses };
  }

  /** Players without a pick get the least-used allowed archetype (ties broken by the server RNG). */
  private assignArchetypes(adv: Adventure, seated: PlayerRecord[]): Map<string, QuestArchetypeId> {
    const picks = new Map<string, QuestArchetypeId>();
    const counts = new Map<QuestArchetypeId, number>(adv.archetypes.map((a) => [a, 0]));
    for (const p of seated) {
      const a = this.state.heroes.get(p.id)?.archetype as QuestArchetypeId | '' | undefined;
      if (a && counts.has(a)) {
        picks.set(p.id, a);
        counts.set(a, (counts.get(a) ?? 0) + 1);
      }
    }
    for (const p of seated) {
      if (picks.has(p.id)) continue;
      const min = Math.min(...counts.values());
      const options = [...counts.entries()].filter(([, n]) => n === min).map(([a]) => a);
      const chosen = options[this.rng.int(options.length)] as QuestArchetypeId;
      picks.set(p.id, chosen);
      counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
      this.toast(p, 'info', `You didn't pick a hero, so you'll play the ${QUEST_ARCHETYPES[chosen].name}.`);
    }
    return picks;
  }

  /** Map saved heroes onto current players: claims first, then join order; extra players get fresh heroes. */
  private restoreParty(adv: Adventure, save: PendingSave, seated: PlayerRecord[], picks: Map<string, QuestArchetypeId>): RunState {
    const run = structuredClone(save.run);
    const saved = new Map(run.heroes.map((h) => [h.slot, h]));
    const assigned = new Map<string, number>();
    for (const p of seated) {
      const slot = this.state.heroes.get(p.id)?.slot ?? -1;
      if (slot >= 0 && saved.has(slot) && ![...assigned.values()].includes(slot)) assigned.set(p.id, slot);
    }
    const free = [...saved.keys()].filter((s) => ![...assigned.values()].includes(s)).sort((a, b) => a - b);
    for (const p of seated) if (!assigned.has(p.id) && free.length) assigned.set(p.id, free.shift()!);
    const heroes = [];
    for (const p of seated) {
      const slot = assigned.get(p.id);
      if (slot !== undefined) {
        const h = saved.get(slot)!;
        heroes.push({ ...h, playerId: p.id, name: p.state.name, color: p.state.color });
      } else {
        heroes.push(makeHero(adv, { playerId: p.id, name: p.state.name, color: p.state.color, archetype: picks.get(p.id)! }, 99, seated.length));
      }
    }
    run.heroes = heroes;
    compactSlots(run);
    return run;
  }

  protected override onReturnToLobby(): void {
    this.adv = null;
    this.run = null;
    this.paused = false;
    this.omens = { rev: 0, omens: [] };
    this.state.stage = 'lobby';
    this.state.sceneJson = '';
    this.state.votes.clear();
    this.state.tieJson = '';
    this.state.rollJson = '';
    this.state.outcomeJson = '';
    this.state.resultJson = '';
    this.state.inventory.clear();
    this.state.credits = 0;
    this.state.score = 0;
    this.state.turn = 0;
    this.state.chapter = 0;
    this.state.log.clear();
    // Keep each seated player's pick for the replay; forget heroes of players who left.
    for (const [id, hero] of [...this.state.heroes.entries()]) {
      if (!this.players.has(id)) {
        this.state.heroes.delete(id);
        continue;
      }
      hero.ko = false;
      hero.statuses.clear();
      hero.present = true;
      hero.slot = -1;
      hero.maxHp = hero.archetype ? QUEST_ARCHETYPES[hero.archetype as QuestArchetypeId].maxHp : 0;
      hero.hp = hero.maxHp;
    }
    this.normalizePicks();
    this.publishPack();
  }

  // =========================================================================
  // Scenes & voting
  // =========================================================================

  private leaderSlot(): number {
    const hero = this.run?.heroes.find((h) => h.playerId === this.state.hostId);
    return hero?.slot ?? 0;
  }

  private startScene(enter: EnterResult | null, outcome: QuestOutcomeView | null): void {
    const adv = this.adv!;
    const run = this.run!;
    this.clearStageTimers();
    this.state.votes.clear();
    this.state.tieJson = '';
    this.state.outcomeJson = outcome ? JSON.stringify(outcome) : '';
    if (enter) for (const c of enter.changes) this.pushLog('effect', c.text, c.tone);
    if (run.endingId) {
      this.finish();
      return;
    }
    this.state.sceneRev += 1;
    const scene = presentScene(adv, run, { leaderSlot: this.leaderSlot(), rev: this.state.sceneRev });
    this.state.sceneJson = JSON.stringify(scene);
    this.pushLog('scene', `Ch. ${scene.chapter} · ${scene.title}`);
    this.event({ kind: 'scene', text: scene.title });
    this.omens = { rev: this.state.sceneRev, omens: omensFor(adv, run) };
    for (const p of this.players.values()) this.sendOmens(p);
    if (enter?.checkpoint || (!enter && getNode(adv, run.nodeId).checkpoint)) this.emitCheckpoint();
    this.state.stage = 'voting';
    this.paused = false;
    const ms = this.settings.voteSeconds * this.timing.voteMsPerSecond;
    this.setTimer(ms);
    this.schedule('vote', ms, () => this.finalizeVote('timer'));
  }

  private rerenderScene(): void {
    if (!this.adv || !this.run || this.run.endingId) return;
    const scene = presentScene(this.adv, this.run, { leaderSlot: this.leaderSlot(), rev: this.state.sceneRev });
    this.state.sceneJson = JSON.stringify(scene);
    const available = new Set(scene.choices.filter((c) => c.available).map((c) => c.id));
    for (const [pid, choiceId] of [...this.state.votes.entries()]) if (!available.has(choiceId)) this.state.votes.delete(pid);
    this.omens = { rev: this.state.sceneRev, omens: omensFor(this.adv, this.run) };
    for (const p of this.players.values()) this.sendOmens(p);
  }

  private clearStageTimers(): void {
    for (const key of ['vote', 'lockin', 'tiebreak', 'advance', 'pause']) this.cancel(key);
  }

  /** Connected, seated players whose votes count right now. */
  private eligibleVoters(): PlayerRecord[] {
    return this.activePlayers().filter((p) => !p.away);
  }

  private castVote(player: PlayerRecord, choiceId: string | null, rev: number): void {
    if (this.state.stage !== 'voting' || !this.adv || !this.run) {
      return this.reject(player, QUEST_MSG.vote, 'wrong_phase', 'Voting is closed for this scene.');
    }
    if (rev !== this.state.sceneRev) return this.reject(player, QUEST_MSG.vote, 'wrong_phase', 'That scene has already moved on.');
    if (choiceId === null) {
      this.state.votes.delete(player.id);
      this.cancel('lockin');
      return;
    }
    if (!availableChoices(this.adv, this.run).some((c) => c.id === choiceId)) {
      return this.reject(player, QUEST_MSG.vote, 'not_allowed', "That choice isn't available.");
    }
    this.state.votes.set(player.id, choiceId);
    this.checkAllVoted();
  }

  private checkAllVoted(): void {
    if (this.state.stage !== 'voting') return;
    const eligible = this.eligibleVoters();
    const allIn = eligible.length > 0 && eligible.every((p) => this.state.votes.has(p.id));
    if (!allIn) {
      this.cancel('lockin');
      return;
    }
    const ms = eligible.length === 1 ? this.timing.soloLockInMs : this.timing.lockInMs;
    this.schedule('lockin', ms, () => this.finalizeVote('all'));
  }

  private finalizeVote(reason: 'timer' | 'all' | 'host'): void {
    if (this.state.stage !== 'voting' || !this.adv || !this.run) return;
    const eligible = this.eligibleVoters();
    if (eligible.length === 0 && reason === 'timer') {
      // Nobody is here to vote: pause instead of letting the story play itself.
      this.paused = true;
      this.setTimer(0);
      this.state.statusText = 'Paused — waiting for the party to reconnect';
      this.schedule('pause', this.timing.pauseRecheckMs, () => this.resumeIfPaused());
      return;
    }
    const eligibleIds = new Set(eligible.map((p) => p.id));
    const votes: Record<string, string> = {};
    for (const [pid, choiceId] of this.state.votes.entries()) if (eligibleIds.has(pid)) votes[pid] = choiceId;
    const choices = availableChoices(this.adv, this.run);
    const options = choices.map((c) => ({ choiceId: c.id, odds: choiceOdds(this.adv!, this.run!, c) }));
    const hostVote = votes[this.state.hostId] ?? null;
    const tally = tallyVotes({ options, votes, leaderVote: hostVote, mode: this.settings.tieBreak, rng: this.rng });
    this.clearStageTimers();
    if (tally.needsHost) {
      this.state.stage = 'tiebreak';
      const tie: QuestTieView = { choiceIds: tally.tied, counts: tally.topCount };
      this.state.tieJson = JSON.stringify(tie);
      this.setTimer(this.timing.tiebreakMs);
      this.pushLog('tie', `Tie at ${tally.topCount} vote${tally.topCount === 1 ? '' : 's'} each — the host decides.`, 'neutral');
      this.event({ kind: 'tie' });
      this.schedule('tiebreak', this.timing.tiebreakMs, () => {
        if (this.state.stage !== 'tiebreak') return;
        const auto = breakTieAuto(tally.tied, options, hostVote, this.rng);
        this.resolveWinner(auto.winner, votes, eligible.length, tieRuleText(auto.rule, auto.odds));
      });
      return;
    }
    if (!tally.winner) return;
    let tieText = tieRuleText(tally.rule, tally.odds);
    if (tally.noVotes && options.length > 1) tieText = `No votes were cast — ${tieText?.replace('Tie broken by', 'decided by') ?? 'decided automatically'}`;
    this.resolveWinner(tally.winner, votes, eligible.length, tieText);
  }

  private resumeIfPaused(): void {
    if (!this.paused || this.state.stage !== 'voting') return;
    if (this.eligibleVoters().length === 0) {
      this.schedule('pause', this.timing.pauseRecheckMs, () => this.resumeIfPaused());
      return;
    }
    this.paused = false;
    this.state.statusText = '';
    const ms = this.settings.voteSeconds * this.timing.voteMsPerSecond;
    this.setTimer(ms);
    this.schedule('vote', ms, () => this.finalizeVote('timer'));
    this.checkAllVoted();
  }

  private hostTiebreak(player: PlayerRecord, choiceId: string): void {
    if (this.state.stage !== 'tiebreak') return this.reject(player, QUEST_MSG.tiebreak, 'wrong_phase', 'There is no tie to break.');
    const tie = JSON.parse(this.state.tieJson || '{"choiceIds":[]}') as QuestTieView;
    if (!tie.choiceIds.includes(choiceId)) return this.reject(player, QUEST_MSG.tiebreak, 'not_allowed', 'Pick one of the tied choices.');
    const eligibleIds = new Set(this.eligibleVoters().map((p) => p.id));
    const votes: Record<string, string> = {};
    for (const [pid, c] of this.state.votes.entries()) if (eligibleIds.has(pid)) votes[pid] = c;
    this.resolveWinner(choiceId, votes, eligibleIds.size, tieRuleText('host'));
  }

  private resolveWinner(choiceId: string, votes: Record<string, string>, voterCount: number, tieRule: string | undefined): void {
    const adv = this.adv!;
    const run = this.run!;
    this.clearStageTimers();
    this.state.tieJson = '';
    const choice = availableChoices(adv, run).find((c) => c.id === choiceId);
    if (!choice) return;
    const label = interpolate(adv, run, choice.label, this.leaderSlot());
    const count = Object.values(votes).filter((c) => c === choiceId).length;
    const slotVotes = new Map<number, string>();
    for (const [pid, c] of Object.entries(votes)) {
      const hero = run.heroes.find((h) => h.playerId === pid);
      if (hero) slotVotes.set(hero.slot, c);
    }
    recordVotes(run, slotVotes, choiceId);
    const voterSlots = [...slotVotes.entries()].filter(([, c]) => c === choiceId).map(([s]) => s);
    this.pushLog('vote', `The party chose “${label}” (${count}/${voterCount} vote${voterCount === 1 ? '' : 's'}).`);
    if (tieRule) this.pushLog('tie', `${tieRule}.`, 'neutral');

    const res = resolveChoice(adv, run, choiceId, this.rng, { leaderSlot: this.leaderSlot(), voterSlots, votes: count, voters: voterCount, tieRule });
    const outcome: QuestOutcomeView = {
      turn: run.turn,
      fromTitle: res.fromTitle,
      choiceLabel: label,
      votes: count,
      voters: voterCount,
      ...(tieRule ? { tieRule } : {}),
      success: res.success,
      crit: res.crit,
      text: res.text,
      changes: res.changes,
    };
    if (res.check) {
      const roll: QuestRollView = {
        id: ++this.rollSeq,
        turn: run.turn,
        choiceId,
        choiceLabel: label,
        stat: choice.check!.stat,
        who: choice.check!.who,
        dc: res.check.dc,
        dice: res.check.dice,
        needed: res.check.needed,
        success: res.check.success,
        crit: res.check.crit,
        ...(res.check.rerollBy ? { rerollBy: res.check.rerollBy.name } : {}),
      };
      this.state.stage = 'rolling';
      this.setTimer(0);
      this.state.rollJson = JSON.stringify(roll);
      this.broadcast(QUEST_MSG.roll, roll);
      this.schedule('advance', this.timing.rollRevealMs, () => this.advance(res, outcome, roll));
      return;
    }
    this.advance(res, outcome, null);
  }

  private advance(res: Resolution, outcome: QuestOutcomeView, roll: QuestRollView | null): void {
    const adv = this.adv!;
    const run = this.run!;
    if (roll) {
      const who = roll.dice.length === 1 ? roll.dice[0]!.name : `${roll.dice.filter((d) => d.success).length}/${roll.dice.length} heroes`;
      const crit = roll.crit === 'success' ? ' — CRITICAL!' : roll.crit === 'failure' ? ' — FUMBLE!' : '';
      const math = roll.dice.length === 1 ? ` (${roll.dice[0]!.kept} + ${roll.dice[0]!.modifier} = ${roll.dice[0]!.total} vs DC ${roll.dc})` : ` (needed ${roll.needed}, DC ${roll.dc})`;
      this.pushLog('roll', `${roll.stat} check by ${who}${math}: ${roll.success ? 'SUCCESS' : 'FAILURE'}${crit}`, roll.success ? 'good' : 'bad');
    }
    if (res.text) this.pushLog('effect', res.text, res.success === false ? 'bad' : res.success ? 'good' : 'neutral');
    for (const c of res.changes) this.logChange(c);
    const enter = enterNode(adv, run, res.next, this.rng, { leaderSlot: this.leaderSlot() });
    for (const c of enter.changes) {
      if (c.kind === 'ko' || c.kind === 'revive') this.event({ kind: c.kind, text: c.text, tone: c.tone });
    }
    this.syncRun();
    this.startScene(enter, { ...outcome, changes: [...outcome.changes, ...enter.changes] });
  }

  private logChange(c: QuestChangeView): void {
    this.pushLog(c.kind === 'item' ? 'item' : 'effect', c.text, c.tone);
    if (c.kind === 'ko' || c.kind === 'revive') this.event({ kind: c.kind, text: c.text, tone: c.tone });
  }

  private finish(): void {
    const adv = this.adv!;
    const run = this.run!;
    this.clearStageTimers();
    const endingId = run.endingId!;
    this.endingsFound.add(endingId);
    const results = buildResults(adv, run, { endingsFound: this.endingsFound.size });
    this.state.resultJson = JSON.stringify(results);
    this.state.sceneJson = '';
    this.state.stage = 'ended';
    this.state.score = results.score;
    this.pushLog('ending', `THE END — ${results.title}.`, results.tier === 'bad' ? 'bad' : 'good');
    this.event({ kind: 'ending', text: results.title, tone: results.tier === 'bad' ? 'bad' : 'good' });
    for (const p of this.players.values()) if (!p.state.spectator) p.state.score = results.score;
    this.endMatch({
      players: run.heroes.map((h) => ({
        playerId: h.playerId,
        name: h.name,
        score: results.score,
        placement: 1,
        ...(this.players.get(h.playerId)?.guestId ? { guestId: this.players.get(h.playerId)!.guestId } : {}),
        ...(this.players.get(h.playerId)?.userId ? { userId: this.players.get(h.playerId)!.userId } : {}),
      })),
      details: { pack: adv.id, ending: endingId, tier: results.tier, turns: run.turn },
    });
  }

  // =========================================================================
  // Items
  // =========================================================================

  private useItem(player: PlayerRecord, itemId: string, targetId: string): void {
    if (!this.adv || !this.run || (this.state.stage !== 'voting' && this.state.stage !== 'tiebreak')) {
      return this.reject(player, QUEST_MSG.use, 'wrong_phase', 'You can use items while the party is deciding.');
    }
    const actor = this.run.heroes.find((h) => h.playerId === player.id);
    const target = this.run.heroes.find((h) => h.playerId === targetId);
    const def = this.adv.items[itemId];
    if (def?.use?.target === 'hero' && !target) return this.reject(player, QUEST_MSG.use, 'invalid_payload', 'Pick a hero in the party.');
    const res = useItem(this.adv, this.run, itemId, actor?.slot, target?.slot ?? -1, this.rng);
    if (!res.ok) return this.reject(player, QUEST_MSG.use, 'not_allowed', res.error);
    const on = def?.use?.target === 'hero' && target ? ` on ${target.playerId === player.id ? 'themself' : target.name}` : '';
    this.pushLog('item', `${player.state.name} used ${res.itemName}${on}.`, 'good');
    for (const c of res.changes) this.logChange(c);
    this.event({ kind: 'item', text: `${player.state.name} used ${res.itemName}${on}` });
    this.syncRun();
    this.rerenderScene();
    this.checkAllVoted();
  }

  // =========================================================================
  // Checkpoints
  // =========================================================================

  private emitCheckpoint(): void {
    const adv = this.adv!;
    const run = this.run!;
    const node = getNode(adv, run.nodeId);
    const info: QuestSaveInfo = {
      id: run.runId,
      packId: adv.id,
      packTitle: adv.title,
      chapter: run.chapter,
      chapterTitle: adv.chapterTitle(run.chapter),
      nodeTitle: interpolate(adv, run, node.title),
      savedAt: Date.now(),
      credits: run.credits,
      score: run.score,
      heroes: run.heroes.map((h) => ({ slot: h.slot, name: h.name, archetype: h.archetype, hp: h.hp, maxHp: h.maxHp, ko: h.ko })),
    };
    const blob = signSave({ info, run: snapshotRun(run) });
    this.lastCheckpoint = { id: run.runId, name: `${adv.title} · Ch. ${run.chapter}: ${info.chapterTitle}`, blob, info };
    const host = this.hostRecord;
    if (host) this.sendTo(host, QUEST_MSG.checkpoint, this.lastCheckpoint);
    this.pushLog('system', `Checkpoint reached: ${info.chapterTitle}. The host's device saved the adventure.`, 'good');
    this.event({ kind: 'checkpoint', text: info.chapterTitle });
  }

  // =========================================================================
  // Presence hooks
  // =========================================================================

  protected override onPlayerDisconnected(): void {
    this.checkAllVoted();
  }

  protected override onPlayerAway(): void {
    this.checkAllVoted();
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    const hero = this.state.heroes.get(player.id);
    if (hero) hero.present = true;
    this.resumeIfPaused();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    if (this.phase === 'LOBBY' || this.phase === 'COUNTDOWN') {
      this.state.heroes.delete(player.id);
      return;
    }
    const hero = this.state.heroes.get(player.id);
    if (hero) hero.present = false;
    this.state.votes.delete(player.id);
    this.checkAllVoted();
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next && this.lastCheckpoint && this.phase !== 'LOBBY') this.sendTo(next, QUEST_MSG.checkpoint, this.lastCheckpoint);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    this.sendOmens(player);
    if (this.lastCheckpoint && this.phase !== 'LOBBY' && player.id === this.state.hostId) this.sendTo(player, QUEST_MSG.checkpoint, this.lastCheckpoint);
  }

  private sendOmens(player: PlayerRecord): void {
    if (!this.run) return;
    const hero = this.run.heroes.find((h) => h.playerId === player.id);
    const seer = hero && !hero.ko && hero.archetype === 'seer' && !player.state.spectator;
    this.sendTo(player, QUEST_MSG.private, seer ? this.omens : { rev: this.omens.rev, omens: [] });
  }

  // =========================================================================
  // State sync & logging
  // =========================================================================

  private syncRun(): void {
    const run = this.run;
    if (!run) return;
    const keep = new Set<string>();
    for (const h of run.heroes) {
      keep.add(h.playerId);
      let hero = this.state.heroes.get(h.playerId);
      if (!hero) {
        hero = new QuestHero();
        this.state.heroes.set(h.playerId, hero);
      }
      hero.playerId = h.playerId;
      hero.name = h.name;
      hero.color = h.color;
      hero.archetype = h.archetype;
      hero.hp = h.hp;
      hero.maxHp = h.maxHp;
      hero.ko = h.ko;
      hero.slot = h.slot;
      hero.present = this.players.has(h.playerId);
      const statuses = h.statuses.map((s) => `${s.id}:${s.turns}`);
      if (statuses.join('|') !== [...hero.statuses].join('|')) {
        hero.statuses.clear();
        hero.statuses.push(...statuses);
      }
    }
    for (const id of [...this.state.heroes.keys()]) if (!keep.has(id)) this.state.heroes.delete(id);
    for (const id of [...this.state.inventory.keys()]) if (!(run.inventory[id] > 0)) this.state.inventory.delete(id);
    for (const [id, n] of Object.entries(run.inventory)) if (this.state.inventory.get(id) !== n) this.state.inventory.set(id, n);
    this.state.credits = run.credits;
    this.state.score = run.score;
    this.state.turn = run.turn;
    this.state.chapter = run.chapter;
  }

  private pushLog(kind: QuestLogEntryView['kind'], text: string, tone: QuestTone | '' = ''): void {
    const entry = new QuestLogEntry();
    entry.id = ++this.logSeq;
    entry.kind = kind;
    entry.text = text.slice(0, 400);
    entry.turn = this.run?.turn ?? 0;
    entry.tone = tone;
    this.state.log.push(entry);
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
  }

  private event(payload: QuestEventPayload): void {
    this.broadcast(QUEST_MSG.event, payload);
  }

  // =========================================================================
  // Debug (development only: DASCADE_QUEST_DEBUG=1 and not production)
  // =========================================================================

  private debug(player: PlayerRecord, payload: { nodeId?: string; endingId?: string }): void {
    if (config.isProduction || process.env.DASCADE_QUEST_DEBUG !== '1') {
      return this.reject(player, QUEST_MSG.debug, 'not_allowed', 'Debug tools are disabled on this server.');
    }
    if (!this.adv || !this.run || this.state.stage === 'ended') return;
    if (payload.endingId) {
      const node = this.adv.nodes.find((n) => n.ending === payload.endingId);
      if (!node) return this.reject(player, QUEST_MSG.debug, 'invalid_payload', 'Unknown ending.');
      this.jumpTo(node.id);
      return;
    }
    if (payload.nodeId && this.adv.nodeMap.has(payload.nodeId)) this.jumpTo(payload.nodeId);
  }

  /** Development helper: jump the party to a node (used by visual QA scripts). */
  private jumpTo(nodeId: string): void {
    const enter = enterNode(this.adv!, this.run!, nodeId, this.rng, { leaderSlot: this.leaderSlot() });
    this.syncRun();
    this.startScene(enter, null);
  }
}
