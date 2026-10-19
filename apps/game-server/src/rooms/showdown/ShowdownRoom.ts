/**
 * DAS Survey Showdown — a presenter-run survey game show (see @dascade/shared/games/showdown).
 *
 * Roles
 *  - Presenter: the room's creator. Only the presenter is ever host (canBecomeHost), only the presenter
 *    receives the answer sheet / presenter pass / custom rounds, and only the presenter's show controls
 *    are accepted. The role never migrates by itself: the secret pass reclaims it from any device and
 *    the presenter may hand it over. A show whose presenter is gone for PRESENTER_AWAY_MS ends with
 *    the scores as they stand, so a room never stalls.
 *  - Everyone else seated is on Team 1 or Team 2 (auto-balanced on join; free to switch until round 1)
 *    and plays the audience game: cheers fill their team's hype meter, private guesses score
 *    "called it" points when a matching answer is revealed.
 *  - Stage displays (`showdown:screen`) join no team.
 *  - Presenter Showcase (mode 'showcase') has no teams at all: everyone else is just the audience.
 *    The room adds what the pure engine doesn't hold: wrong answers (broadcast only, never state), the
 *    round clock (server time; clients count down with serverNow()), the "Reveal remaining" sweep
 *    (run here on timers, #10 → #1, so a hidden console tab can't stall it) and the stage cards.
 *
 * Authority: the show is a pure state machine (@dascade/game-core/showdown). Presenter commands carry
 * the board revision they were made against; a stale or duplicate command (double click, a console
 * that hadn't caught up) is ignored, and reveals are idempotent by slot. Every applied command keeps
 * the previous state on an undo stack. Hidden answers never enter synchronized state.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Phase } from '@dascade/shared';
import { RATE, randomId } from '@dascade/shared';
import {
  SHOWDOWN_EVENT_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_MISS_GAP_MS,
  SHOWDOWN_MSG,
  SHOWDOWN_REACTION_KINDS,
  ShowdownActSchema,
  ShowdownCardSchema,
  ShowdownClaimSchema,
  ShowdownContentSchema,
  ShowdownCueSchema,
  ShowdownGuessSchema,
  ShowdownHandoverSchema,
  ShowdownMoveSchema,
  ShowdownPresetSchema,
  ShowdownReactSchema,
  ShowdownScreenSchema,
  ShowdownSettingsSchema,
  ShowdownTakeoverSchema,
  ShowdownTeamSchema,
  defaultShowdownSettings,
  teamName,
  validateShowContent,
  type ShowdownActPayload,
  type ShowdownCard,
  type ShowdownClockOp,
  type ShowdownContentPrivate,
  type ShowdownEvent,
  type ShowdownEventId,
  type ShowdownFinale,
  type ShowdownReactions,
  type ShowdownRoundDef,
  type ShowdownRoundInput,
  type ShowdownSettings,
  type TeamIndex,
  type TeamSlot,
} from '@dascade/shared/games/showdown';
import {
  GUESS_REJECTION_TEXT,
  GuessBook,
  SHOWDOWN_EVENT_ROUNDS,
  boardView,
  createShow,
  currentRound,
  finalizeShow,
  nextSweepSlot,
  pickRounds,
  revealedIn,
  sheetView,
  showWinner,
  specialSlot,
  step,
  type ShowCommand,
  type ShowState,
} from '@dascade/game-core/showdown';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { ShowdownState } from './schema.ts';

const PRESENTER_AWAY_MS = 10 * 60_000;
const TICK_MS = 250;
/** Hype points a cheer adds / drained per tick (100 → 0 in ~30 s of silence). */
const HYPE_PER_CHEER = 3;
const HYPE_DRAIN = 0.8;
const LIVE_STAGES = new Set(['live', 'steal']);
const PRESENTER_PHASES: readonly Phase[] = ['LOBBY', 'COUNTDOWN', 'PLAYING', 'INTERMISSION', 'RESULTS'];
/**
 * Reveal remaining: the beat before the first tile, between tiles, the drumroll before the special
 * answer, and the celebration after it.
 */
const SWEEP_MS = { lead: 900, step: 1700, suspense: 2600, special: 4200 };

export class ShowdownRoom extends BaseGameRoom<ShowdownState, ShowdownSettings> {
  readonly gameId = 'showdown' as const;
  protected readonly settingsSchema = ShowdownSettingsSchema;
  /** The show opens on its own marquee (no shared 3-2-1). */
  protected override countdownMs = 0;
  /** Test hook: how long a show waits for an absent presenter before it ends. */
  protected presenterAwayMs = PRESENTER_AWAY_MS;
  /** Test hooks: the sweep's pacing and the length of a clock "minute". */
  protected sweepMs = SWEEP_MS;
  protected minuteMs = 60_000;

  private presenterId = '';
  /** The first player to join (the creator) becomes the presenter — once per room. */
  private presenterAssigned = false;
  private presenterPass = '';
  private show: ShowState | null = null;
  private undoStack: ShowState[] = [];
  private custom: ShowdownContentPrivate = { rounds: [], issues: [], dropped: 0 };
  private readonly guesses = new GuessBook();
  /** Pack questions already played in this room (later shows prefer fresh ones). */
  private readonly seen = new Set<string>();
  /**
   * Team of everyone who played this show, including players who left (for the outcome). -1 = an
   * audience member of a Presenter Showcase (no teams).
   */
  private readonly playedFor = new Map<string, TeamSlot>();
  /** Names of everyone in `playedFor` (leavers keep theirs on the results screen). */
  private readonly playedNames = new Map<string, string>();
  private readonly lastMe = new Map<string, string>();
  private lastSheet = '';
  /** Audience guesses changed the presenter's sheet (cloud, matches): sent on the next tick, not per guess. */
  private sheetDirty = false;
  private hype: [number, number] = [0, 0];
  private reactions: ShowdownReactions = emptyReactions();
  private reactionsPending = false;
  private cueSeq = 0;
  /** Wrong answers this round (Presenter Showcase) and when the last one landed. */
  private misses = 0;
  private lastMissAt = 0;
  /** The round clock ran out this round (the "time's up" event went out). */
  private timeUp = false;
  /** The clock hasn't run yet this round: showing the question starts it. */
  private clockArmed = false;
  /** Running sweep: the round it belongs to, and whether the special answer's drumroll has played. */
  private sweepRound = -1;
  private sweepSuspense = false;

  protected defaultSettings(): ShowdownSettings {
    return defaultShowdownSettings(new Date());
  }

  protected createState(): ShowdownState {
    return new ShowdownState();
  }

  /** Only the presenter is ever host (lobby settings, start, kick… are presenter powers). */
  protected override canBecomeHost(player: PlayerRecord): boolean {
    return player.id === this.presenterId;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected override onRoomCreated(): void {
    this.presenterPass = randomId(24, this.rng);
    // A presenter hammering 1–0 to flip a board fast must never be throttled.
    const presenter = { rate: { burst: 20, perSecond: 8 } } as const;
    this.handle(SHOWDOWN_MSG.act, ShowdownActSchema, (p, payload) => this.act(p, payload), { phases: ['PLAYING'], ...presenter });
    this.handle(SHOWDOWN_MSG.cue, ShowdownCueSchema, (p, { cue }) => this.cue(p, cue), { phases: ['PLAYING', 'RESULTS'], rate: { burst: 6, perSecond: 2 } });
    this.handle(SHOWDOWN_MSG.team, ShowdownTeamSchema, (p, { team }) => this.pickTeam(p, team), { phases: ['LOBBY', 'PLAYING'], playersOnly: true });
    this.handle(SHOWDOWN_MSG.move, ShowdownMoveSchema, (p, payload) => this.movePlayer(p, payload.playerId, payload.team), { phases: ['LOBBY', 'PLAYING'] });
    this.handle(SHOWDOWN_MSG.screen, ShowdownScreenSchema, (p, { on }) => this.setScreen(p, on), { phases: PRESENTER_PHASES });
    this.handle(SHOWDOWN_MSG.guess, ShowdownGuessSchema, (p, payload) => this.guess(p, payload.round, payload.text), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.chat,
    });
    this.handle(SHOWDOWN_MSG.react, ShowdownReactSchema, (p, { r }) => this.react(p, r), {
      phases: ['PLAYING', 'RESULTS'],
      rate: { burst: 10, perSecond: 5 },
      silent: true,
    });
    this.handle(SHOWDOWN_MSG.claim, ShowdownClaimSchema, (p, { pass }) => this.claim(p, pass), { phases: PRESENTER_PHASES, rate: { burst: 5, perSecond: 0.5 } });
    this.handle(SHOWDOWN_MSG.handover, ShowdownHandoverSchema, (p, { playerId }) => this.handover(p, playerId), { phases: PRESENTER_PHASES });
    this.handle(SHOWDOWN_MSG.takeover, ShowdownTakeoverSchema, (p) => this.takeover(p), { phases: ['LOBBY', 'RESULTS'], rate: { burst: 3, perSecond: 0.5 } });
    this.handle(SHOWDOWN_MSG.content, ShowdownContentSchema, (p, { rounds }) => this.saveContent(p, rounds), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 4, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.preset, ShowdownPresetSchema, (p, { id }) => this.loadPreset(p, id), { phases: ['LOBBY', 'RESULTS'], rate: { burst: 4, perSecond: 1 } });
    this.handle(SHOWDOWN_MSG.card, ShowdownCardSchema, (p, { card }) => this.setCard(p, card), { phases: PRESENTER_PHASES, rate: { burst: 8, perSecond: 2 } });
    this.clock.setInterval(() => this.tick(), TICK_MS);
  }

  private get showcase(): boolean {
    return this.getSettings().mode === 'showcase';
  }

  protected override validateStart(): string | null {
    const settings = this.getSettings();
    if (settings.source === 'custom' && this.custom.rounds.length === 0) {
      return 'Add at least one custom round (Settings → Custom rounds), or switch to the question packs.';
    }
    if (settings.mode === 'classic' && settings.source === 'custom') {
      const ranked = this.custom.rounds.findIndex((r) => r.ranked);
      if (ranked >= 0) {
        return `Round ${ranked + 1} ranks its answers without survey points, and Team Showdown scores points. Give its answers points, or switch the format to Presenter Showcase.`;
      }
    }
    return null;
  }

  /** Switching the format in the lobby: a showcase has no teams; back to teams, everyone gets one. */
  protected override onSettingsChanged(prev: ShowdownSettings, next: ShowdownSettings): void {
    if (prev.mode === next.mode) return;
    if (next.mode === 'showcase') {
      this.state.teams.clear();
      return;
    }
    for (const p of this.seatedPlayers()) if (this.isAudience(p) && this.teamOf(p) === null) this.assignTeam(p, this.smallestTeam());
  }

  protected onGameStart(): void {
    const settings = this.getSettings();
    const rounds: ShowdownRoundDef[] =
      settings.source === 'custom' ? structuredClone(this.custom.rounds) : pickRounds(settings.packs, settings.rounds, this.rng, this.seen);
    for (const r of rounds) if (settings.source === 'packs') this.seen.add(r.id);
    this.show = createShow(rounds, { scoring: settings.scoring, steal: settings.steal, mode: settings.mode });
    this.undoStack = [];
    this.guesses.clear();
    this.lastMe.clear();
    this.hype = [0, 0];
    this.state.finaleJson = '';
    this.state.guessesIn = 0;
    // The opening plays on a clean stage: a lobby holding card comes down when the show starts.
    this.state.card = '';
    this.playedFor.clear();
    this.playedNames.clear();
    this.stopSweep(false);
    this.resetClock(settings.mode === 'showcase' ? settings.minutes * this.minuteMs : 0);
    this.state.clockShow = settings.stageClock;
    // Lobby leftovers: players who moved to spectating keep no team.
    for (const id of [...this.state.teams.keys()]) {
      const p = this.getPlayer(id);
      if (!p || p.state.spectator || !this.isAudience(p) || settings.mode === 'showcase') this.state.teams.delete(id);
    }
    for (const p of this.seatedPlayers()) {
      if (!this.isAudience(p)) continue;
      if (settings.mode === 'showcase') {
        this.recordPlayer(p, -1);
        continue;
      }
      if (this.teamOf(p) === null) this.assignTeam(p, this.smallestTeam());
      const team = this.teamOf(p);
      if (team !== null) this.recordPlayer(p, team);
    }
    this.publish([{ type: 'intro', rev: this.show.rev }]);
    if (!this.presenterOnline()) this.watchPresenter();
  }

  protected override onReturnToLobby(): void {
    this.stopSweep(false);
    this.resetClock(0);
    this.show = null;
    this.undoStack = [];
    this.guesses.clear();
    this.lastMe.clear();
    this.playedFor.clear();
    this.playedNames.clear();
    this.hype = [0, 0];
    this.state.boardJson = '';
    this.state.rev = 0;
    this.state.finaleJson = '';
    this.state.guessesIn = 0;
    this.state.hype0 = 0;
    this.state.hype1 = 0;
    this.cancel('presenter-away');
    this.refreshSheet();
  }

  protected override onPlayerJoined(player: PlayerRecord, _info: { lateJoin: boolean }): void {
    if (!this.presenterAssigned) {
      this.presenterAssigned = true;
      this.setPresenter(player, false);
      return;
    }
    if (!this.isAudience(player) || player.state.spectator) return;
    if (!this.showcase) this.assignTeam(player, this.smallestTeam());
    else if (this.show && this.phase === 'PLAYING') this.recordPlayer(player, -1);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    if (player.id === this.presenterId) this.cancel('presenter-away');
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    if (player.id === this.presenterId) this.watchPresenter();
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    if (player.id === this.presenterId) this.watchPresenter();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.lastMe.delete(player.id);
    this.state.teams.delete(player.id);
    this.state.screens.delete(player.id);
    // Mid-show leavers keep their team for the outcome (leaving never dodges a result).
    if (!this.show || this.phase !== 'PLAYING') this.forgetPlayer(player.id);
    else if (this.playedFor.has(player.id)) this.playedNames.set(player.id, player.state.name);
    if (player.id === this.presenterId) {
      this.presenterId = '';
      this.state.presenterId = '';
      this.watchPresenter();
    }
  }

  protected override syncPrivate(player: PlayerRecord): void {
    if (player.id === this.presenterId) {
      this.sendTo(player, SHOWDOWN_MSG.pass, { pass: this.presenterPass });
      this.sendTo(player, SHOWDOWN_MSG.content, this.custom);
      this.lastSheet = '';
      this.refreshSheet();
      return;
    }
    this.lastMe.delete(player.id);
    this.refreshMe(player);
  }

  protected override onRoomDisposed(): void {
    this.show = null;
    this.guesses.clear();
  }

  // ===========================================================================
  // Presenter
  // ===========================================================================

  private isPresenter(player: PlayerRecord): boolean {
    return player.id !== '' && player.id === this.presenterId;
  }

  private presenterOnline(): boolean {
    return Boolean(this.presenterId && this.getPlayer(this.presenterId)?.client);
  }

  /** The show can't run without its presenter: end it if nobody presents for a while. */
  private watchPresenter(): void {
    if (this.phase !== 'PLAYING' || !this.show || this.isScheduled('presenter-away')) return;
    this.schedule('presenter-away', this.presenterAwayMs, () => {
      if (this.phase !== 'PLAYING' || this.presenterOnline()) return;
      this.systemChat('The presenter did not come back — the show ends with the scores as they stand.');
      this.finishShow('presenter_left');
      this.releasePresenter();
    });
  }

  /**
   * The presenter is gone (their seat may still be held): free the role so someone in the room can run
   * the next show (Become the presenter). Their pass keeps working until a takeover changes it.
   */
  private releasePresenter(): void {
    const gone = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    if (gone?.client) return;
    this.presenterId = '';
    this.state.presenterId = '';
    if (gone && this.hostRecord === gone) this.assignHost(null);
  }

  private setPresenter(next: PlayerRecord, announce = true): void {
    const prev = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    if (prev === next) return;
    this.presenterId = next.id;
    this.state.presenterId = next.id;
    // The presenter is neutral: no team, not a stage display.
    this.state.teams.delete(next.id);
    this.state.screens.delete(next.id);
    this.forgetPlayer(next.id);
    this.lastMe.delete(next.id);
    this.assignHost(next);
    if (prev) {
      // Wipe the answers from the previous presenter's screen.
      this.sendTo(prev, SHOWDOWN_MSG.sheet, null);
      this.sendTo(prev, SHOWDOWN_MSG.pass, null);
      this.sendTo(prev, SHOWDOWN_MSG.content, null);
      this.toast(prev, 'info', `${next.state.name} is presenting now.`);
      if (this.isAudience(prev) && !prev.state.spectator) this.joinAudience(prev);
    }
    this.syncPrivate(next);
    if (next.client) this.cancel('presenter-away');
    if (announce) this.systemChat(`${next.state.name} is now the presenter.`);
  }

  private claim(player: PlayerRecord, pass: string): void {
    if (!safeEqual(this.presenterPass, pass)) {
      return this.reject(player, SHOWDOWN_MSG.claim, 'not_allowed', 'That presenter pass is not valid for this room.');
    }
    if (this.isPresenter(player)) return;
    this.setPresenter(player);
    this.toast(player, 'success', 'Presenter controls are yours.');
  }

  /** Nobody presents any more (the presenter left for good): someone else may run the next show. */
  private takeover(player: PlayerRecord): void {
    const current = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    // Gone for good = no record, or their seat's reconnect window ran out during the show.
    if (current && !current.away) {
      return this.reject(player, SHOWDOWN_MSG.takeover, 'not_allowed', 'This show already has a presenter.');
    }
    // The previous presenter's prepared answers stay theirs: a new presenter starts from a clean slate.
    this.custom = { rounds: [], issues: [], dropped: 0 };
    this.state.customRounds = 0;
    this.state.rehearsal = false;
    this.presenterPass = randomId(24, this.rng);
    if (this.getSettings().source === 'custom') this.updateSettings({ ...this.getSettings(), source: 'packs' });
    this.setPresenter(player);
    this.toast(player, 'success', 'You’re the presenter now — only you will see the answers.');
  }

  private handover(player: PlayerRecord, playerId: string): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.handover, 'not_host', 'Only the presenter can hand over the show.');
    const target = this.getPlayer(playerId);
    if (!target || !target.client || target === player) {
      return this.reject(player, SHOWDOWN_MSG.handover, 'not_allowed', 'Pick someone who is in the room right now.');
    }
    // A big screen shows the stage to everyone: it must never receive the answer sheet.
    if (this.state.screens.get(target.id)) return this.reject(player, SHOWDOWN_MSG.handover, 'not_allowed', 'A big screen can’t present — pick a person.');
    this.setPresenter(target);
  }

  private saveContent(player: PlayerRecord, rounds: ShowdownRoundInput[]): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.content, 'not_host', 'Only the presenter writes the questions.');
    const report = validateShowContent(rounds);
    this.custom = report;
    this.state.customRounds = report.rounds.length;
    // The presenter's own rounds now (even if they started from the practice boards).
    this.state.rehearsal = false;
    this.sendTo(player, SHOWDOWN_MSG.content, report);
  }

  /** An event preset: its settings, and its rounds (server-side content) as this room's custom rounds. */
  private loadPreset(player: PlayerRecord, id: ShowdownEventId): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.preset, 'not_host', 'Only the presenter loads a show.');
    const info = SHOWDOWN_EVENT_INFO[id];
    const report = validateShowContent(SHOWDOWN_EVENT_ROUNDS[id]);
    this.custom = report;
    this.state.customRounds = report.rounds.length;
    this.state.rehearsal = info.rehearsal;
    this.updateSettings({ ...this.getSettings(), ...info.settings });
    this.sendTo(player, SHOWDOWN_MSG.content, report);
    this.toast(player, 'success', `Loaded ${info.title}: ${report.rounds.length} rounds. Check them in Settings → Your own rounds.`);
  }

  private setCard(player: PlayerRecord, card: ShowdownCard | ''): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.card, 'not_host', 'Only the presenter changes the stage.');
    this.state.card = card;
  }

  private cue(player: PlayerRecord, cue: string): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.cue, 'not_host', 'Only the presenter plays sound cues.');
    this.broadcast(SHOWDOWN_MSG.cue, { cue, id: ++this.cueSeq });
  }

  // ===========================================================================
  // The show
  // ===========================================================================

  private act(player: PlayerRecord, payload: ShowdownActPayload): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.act, 'not_host', 'Only the presenter runs the show.');
    const show = this.show;
    if (!show) return;
    // Made against an older board (double click, or the console hadn't caught up): ignore quietly.
    if ('rev' in payload && payload.rev !== show.rev) return;
    if ('round' in payload && payload.round !== undefined && payload.round !== show.round) return;
    switch (payload.a) {
      case 'miss':
        return this.miss(player);
      case 'sweep':
        return this.startSweep(player);
      case 'halt':
        return this.stopSweep(true);
      case 'clock':
        return this.clockOp(player, payload.op);
      case 'reveal':
        // A tile flipped by hand during a sweep: the sweep carries on with the rest.
        break;
      default:
        // Any other command (next, undo, restart…) stops a sweep rather than racing it.
        this.stopSweep(true);
    }
    if (payload.a === 'undo') return this.undo(player);
    if (payload.a === 'finish') return this.finishShow('presenter');
    this.applyStep(player, payload as ShowCommand);
  }

  /** Runs one engine command (keeping the previous state for Undo) and publishes it. False if refused. */
  private applyStep(player: PlayerRecord | null, cmd: ShowCommand): boolean {
    const show = this.show;
    if (!show) return false;
    const result = step(show, cmd);
    if (!result.ok) {
      if (player && result.code !== 'noop') this.reject(player, SHOWDOWN_MSG.act, 'not_allowed', result.message);
      return false;
    }
    this.undoStack.push(show);
    if (this.undoStack.length > SHOWDOWN_LIMITS.undo) this.undoStack.shift();
    this.show = result.state;
    if (result.finished) {
      this.finishShow('completed');
      return true;
    }
    this.afterStep(show, result.state, result.events);
    this.publish(result.events);
    return true;
  }

  /** The room's side of a change: the round clock follows the board, a new round forgets its misses. */
  private afterStep(prev: ShowState, next: ShowState, events: readonly ShowdownEvent[]): void {
    if (next.mode !== 'showcase') return;
    const newRound = prev.round !== next.round || events.some((e) => e.type === 'restart' || e.type === 'reset' || e.type === 'round');
    if (newRound) {
      this.misses = 0;
      this.resetClock(this.state.clockMax || this.getSettings().minutes * this.minuteMs);
    }
    // The clock starts with the question (not when a sweep put the question up on its way).
    if (events.some((e) => e.type === 'question') && this.clockArmed && !this.state.sweep) this.runClock(true);
    // The whole board is up: nothing left to guess, so the clock stops.
    if (next.stage === 'done' && prev.stage !== 'done') this.runClock(false);
  }

  private undo(player: PlayerRecord): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.show) return this.reject(player, SHOWDOWN_MSG.act, 'not_allowed', 'There is nothing to undo.');
    // Revisions only ever go up (screens key their animations on them).
    const rev = this.show.rev + 1;
    const from = this.show;
    this.show = { ...prev, rev };
    // Undo into another round, onto a title card or out of one: the clock starts over, paused (the
    // presenter restarts it from the console if the round is live again).
    if (from.mode === 'showcase' && (from.round !== prev.round || (from.stage === 'title') !== (prev.stage === 'title') || prev.stage === 'intro')) {
      this.misses = 0;
      this.resetClock(this.state.clockMax);
    }
    this.publish([{ type: 'undo', rev }]);
  }

  // ===========================================================================
  // Presenter Showcase: wrong answers, the sweep, the clock
  // ===========================================================================

  /** A wrong answer: everyone sees the ✕ and hears the buzzer. Nothing is stored, nothing is scored. */
  private miss(player: PlayerRecord): void {
    const show = this.show;
    if (!show) return;
    if (show.mode !== 'showcase') return this.reject(player, SHOWDOWN_MSG.act, 'not_allowed', 'Use Strike in Team Showdown.');
    if (show.stage !== 'live') {
      return this.reject(player, SHOWDOWN_MSG.act, 'wrong_phase', show.stage === 'done' ? 'Every answer is already on the board.' : 'Show the question first.');
    }
    const now = Date.now();
    // A double click (or two presses at once) is one miss.
    if (now - this.lastMissAt < SHOWDOWN_MISS_GAP_MS) return;
    this.lastMissAt = now;
    this.misses++;
    this.broadcast(SHOWDOWN_MSG.event, { type: 'miss', rev: show.rev, round: show.round, n: this.misses } satisfies ShowdownEvent);
  }

  /** Reveal remaining, #10 → #1: a tile every SWEEP_STEP_MS, with a drumroll before the special one. */
  private startSweep(player: PlayerRecord): void {
    const show = this.show;
    if (!show) return;
    if (show.mode !== 'showcase') return this.reject(player, SHOWDOWN_MSG.act, 'not_allowed', 'Use Reveal the rest in Team Showdown.');
    if (show.stage === 'intro') return this.reject(player, SHOWDOWN_MSG.act, 'wrong_phase', 'Start round 1 first.');
    if (this.state.sweep || nextSweepSlot(show) < 0) return;
    this.sweepRound = show.round;
    this.sweepSuspense = false;
    this.state.sweep = true;
    // Time's up for guessing: the clock stops while the rest of the board goes up.
    this.runClock(false);
    this.broadcast(SHOWDOWN_MSG.event, { type: 'sweep', rev: show.rev, on: true } satisfies ShowdownEvent);
    this.schedule('sweep', this.sweepMs.lead, () => this.sweepStep());
  }

  private sweepStep(): void {
    const show = this.show;
    if (!show || !this.state.sweep || this.phase !== 'PLAYING' || show.round !== this.sweepRound) return this.stopSweep(false);
    const slot = nextSweepSlot(show);
    if (slot < 0) return this.stopSweep(true);
    const special = slot === specialSlot(currentRound(show));
    if (special && !this.sweepSuspense) {
      // The beat before the special answer: a drumroll and the tile in the spotlight.
      this.sweepSuspense = true;
      this.broadcast(SHOWDOWN_MSG.event, { type: 'suspense', rev: show.rev, slot } satisfies ShowdownEvent);
      return this.schedule('sweep', this.sweepMs.suspense, () => this.sweepStep());
    }
    if (!this.applyStep(null, { a: 'reveal', slot, late: true, sweep: true })) return this.stopSweep(true);
    if (nextSweepSlot(this.show!) < 0) return this.stopSweep(true);
    this.schedule('sweep', special ? this.sweepMs.special : this.sweepMs.step, () => this.sweepStep());
  }

  /** Ends a sweep (announce = tell every screen it stopped). Idempotent. */
  private stopSweep(announce: boolean): void {
    this.cancel('sweep');
    if (!this.state.sweep) return;
    this.state.sweep = false;
    this.sweepRound = -1;
    if (announce && this.show) this.broadcast(SHOWDOWN_MSG.event, { type: 'sweep', rev: this.show.rev, on: false } satisfies ShowdownEvent);
  }

  private clockOp(player: PlayerRecord, op: ShowdownClockOp): void {
    const show = this.show;
    if (!show) return;
    if (show.mode !== 'showcase') return this.reject(player, SHOWDOWN_MSG.act, 'not_allowed', 'Team Showdown has no round clock.');
    if (op === 'show' || op === 'hide') {
      this.state.clockShow = op === 'show';
      return;
    }
    if (this.state.clockMax <= 0) {
      // A show set up without a clock gets one now (the presenter asked for it).
      this.state.clockMax = (this.getSettings().minutes || 10) * this.minuteMs;
      this.state.clockLeft = this.state.clockMax;
    }
    switch (op) {
      case 'start':
        this.clockArmed = false;
        return this.runClock(true);
      case 'pause':
        return this.runClock(false);
      case 'reset':
        return this.resetClock(this.state.clockMax);
      case 'plus':
      case 'minus':
        return this.addClock(op === 'plus' ? this.minuteMs : -this.minuteMs);
    }
  }

  private clockLeftNow(): number {
    return this.state.clockEndsAt > 0 ? this.state.clockEndsAt - Date.now() : this.state.clockLeft;
  }

  /** Full time, paused (`max` 0 = no clock this show). */
  private resetClock(max: number): void {
    this.state.clockMax = Math.max(0, max);
    this.state.clockLeft = this.state.clockMax;
    this.state.clockEndsAt = 0;
    this.timeUp = false;
    this.clockArmed = this.state.clockMax > 0;
  }

  private runClock(on: boolean): void {
    if (this.state.clockMax <= 0) return;
    const left = this.clockLeftNow();
    if (on) {
      this.clockArmed = false;
      if (this.state.clockEndsAt === 0) this.state.clockEndsAt = Date.now() + left;
      return;
    }
    if (this.state.clockEndsAt === 0) return;
    this.state.clockLeft = Math.round(left);
    this.state.clockEndsAt = 0;
  }

  private addClock(ms: number): void {
    const left = this.clockLeftNow() + ms;
    // Never below zero by a click (overtime only comes from the clock running out).
    const next = Math.max(Math.min(left, this.state.clockMax + SHOWDOWN_LIMITS.minutesMax * this.minuteMs), Math.min(0, this.clockLeftNow()));
    if (this.state.clockEndsAt > 0) this.state.clockEndsAt = Date.now() + next;
    else this.state.clockLeft = Math.round(next);
    if (next > 0) this.timeUp = false;
  }

  /** Board + sheet + per-player views after a change, then the events for sounds and animation. */
  private publish(events: ShowdownEvent[]): void {
    const show = this.show;
    if (!show) return;
    const revealed = revealedIn(show, show.round);
    this.state.boardJson = JSON.stringify(boardView(show, this.guesses.callers(show.round, revealed)));
    this.state.rev = show.rev;
    this.state.round = Math.max(0, show.round + 1);
    this.state.guessesIn = show.round >= 0 ? this.guesses.count(show.round) : 0;
    const matches = this.guesses.matchesPerSlot(show.round, revealed.length);
    for (const e of events) {
      this.broadcast(SHOWDOWN_MSG.event, e.type === 'reveal' ? { ...e, callers: matches[e.slot] ?? 0 } : e);
    }
    this.refreshSheet();
    this.refreshMeAll();
  }

  private finishShow(reason: string): void {
    if (!this.show || this.phase !== 'PLAYING') return;
    this.cancel('presenter-away');
    this.stopSweep(false);
    this.runClock(false);
    const show = finalizeShow(this.show);
    this.show = show;
    this.undoStack = [];
    const settings = this.getSettings();
    const winner = showWinner(show);
    const members: [string[], string[]] = [[], []];
    /** Presenter Showcase: the whole audience, in one group (no teams, no invented winner). */
    const crowd: string[] = [];
    for (const [id, team] of this.playedFor) (team === -1 ? crowd : members[team]).push(id);
    const rounds = show.rounds;
    const callers = [...this.guesses.players()]
      .map((id) => {
        const me = this.guesses.me(id, show.round, rounds, (r) => revealedIn(show, r));
        return { playerId: id, name: this.nameOf(id), points: me.points, calls: me.calls, team: this.playedFor.get(id) ?? -1 };
      })
      .filter((c) => c.calls > 0)
      .sort((a, b) => b.points - a.points || b.calls - a.calls || a.name.localeCompare(b.name));
    const finale: ShowdownFinale = {
      mode: show.mode,
      winner,
      scores: [show.scores[0], show.scores[1]],
      names: [teamName(settings, 0), teamName(settings, 1)],
      results: show.results.map((r) => ({ ...r })),
      callers: callers.slice(0, 5).map((c) => ({ ...c, team: c.team as -1 | 0 | 1 })),
      members: [members[0].map((id) => this.nameOf(id)), members[1].map((id) => this.nameOf(id))],
    };
    this.state.boardJson = JSON.stringify(boardView(show, this.guesses.callers(show.round, revealedIn(show, show.round))));
    this.state.rev = show.rev;
    this.state.finaleJson = JSON.stringify(finale);

    const placements = winner === -1 ? [[...members[0], ...members[1], ...crowd]] : [members[winner], members[winner === 0 ? 1 : 0]];
    const scores: Record<string, number> = {};
    const called = new Map(callers.map((c) => [c.playerId, c.points]));
    // A showcase has no team scores: an audience member's score is their called-it points.
    for (const [id, team] of this.playedFor) scores[id] = team === -1 ? (called.get(id) ?? 0) : show.scores[team];
    const playerStats: Record<string, Record<string, number>> = {};
    for (const c of callers) playerStats[c.playerId] = { calls: c.calls, bestCallPoints: c.points };
    // A show ended before round 1 was played reports nothing (nobody won or lost anything).
    if (show.round >= 0) this.reportOutcome({ placements, scores, reason, details: { playerStats, teamScores: [...show.scores], rounds: rounds.length } });
    const placeOf = (id: string) => (winner === -1 ? 1 : this.playedFor.get(id) === winner ? 1 : 2);
    this.endMatch({
      players: [...this.playedFor.keys()].map((id) => {
        const record = this.getPlayer(id);
        return { playerId: id, name: this.nameOf(id), guestId: record?.guestId, userId: record?.userId, score: scores[id] ?? 0, placement: placeOf(id) };
      }),
      details: { reason, winner, scores: [...show.scores] },
    });
    this.refreshSheet();
    this.refreshMeAll();
  }

  // ===========================================================================
  // Teams + stage displays
  // ===========================================================================

  private isAudience(player: PlayerRecord): boolean {
    return player.id !== this.presenterId && !this.state.screens.get(player.id);
  }

  private teamOf(player: PlayerRecord | string): TeamIndex | null {
    const id = typeof player === 'string' ? player : player.id;
    const team = this.state.teams.get(id);
    return team === 0 || team === 1 ? team : null;
  }

  private smallestTeam(): TeamIndex {
    let a = 0;
    let b = 0;
    for (const team of this.state.teams.values()) team === 0 ? a++ : b++;
    return b < a ? 1 : 0;
  }

  private assignTeam(player: PlayerRecord, team: TeamIndex): void {
    this.state.teams.set(player.id, team);
    if (this.show && this.phase === 'PLAYING') this.recordPlayer(player, team);
  }

  private recordPlayer(player: PlayerRecord, team: TeamSlot): void {
    this.playedFor.set(player.id, team);
    this.playedNames.set(player.id, player.state.name);
  }

  private forgetPlayer(id: string): void {
    this.playedFor.delete(id);
    this.playedNames.delete(id);
  }

  private pickTeam(player: PlayerRecord, team: TeamIndex): void {
    if (this.showcase) return this.reject(player, SHOWDOWN_MSG.team, 'not_allowed', 'This show has no teams — just cheer!');
    if (player.id === this.presenterId) return this.reject(player, SHOWDOWN_MSG.team, 'not_allowed', 'The presenter stays neutral.');
    if (this.state.screens.get(player.id)) return this.reject(player, SHOWDOWN_MSG.team, 'not_allowed', 'Big screens don’t join a team.');
    const current = this.teamOf(player);
    if (current === team) return;
    const showStarted = this.phase === 'PLAYING' && this.show !== null && this.show.stage !== 'intro';
    if (showStarted && current !== null) {
      return this.reject(player, SHOWDOWN_MSG.team, 'not_allowed', 'Teams lock once round 1 starts — ask the presenter to move you.');
    }
    this.assignTeam(player, team);
  }

  private movePlayer(player: PlayerRecord, playerId: string, team: TeamIndex | -1): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.move, 'not_host', 'Only the presenter can move players.');
    if (this.showcase) return this.reject(player, SHOWDOWN_MSG.move, 'not_allowed', 'This show has no teams.');
    const target = this.getPlayer(playerId);
    if (!target || target.id === this.presenterId || target.state.spectator || this.state.screens.get(target.id)) {
      return this.reject(player, SHOWDOWN_MSG.move, 'not_allowed', 'That player can’t join a team.');
    }
    if (team === -1) {
      this.state.teams.delete(target.id);
      this.forgetPlayer(target.id);
      return;
    }
    this.assignTeam(target, team);
  }

  private setScreen(player: PlayerRecord, on: boolean): void {
    if (on) {
      if (player.id === this.presenterId) {
        return this.reject(player, SHOWDOWN_MSG.screen, 'not_allowed', 'You’re the presenter — open the stage window from your console instead.');
      }
      this.state.screens.set(player.id, true);
      this.state.teams.delete(player.id);
      this.forgetPlayer(player.id);
      return;
    }
    if (!this.state.screens.get(player.id)) return;
    this.state.screens.delete(player.id);
    if (!player.state.spectator && player.id !== this.presenterId) this.joinAudience(player);
  }

  /** A seat back in the audience: a team in Team Showdown, just a spot in the crowd in a showcase. */
  private joinAudience(player: PlayerRecord): void {
    if (!this.showcase) return this.assignTeam(player, this.smallestTeam());
    if (this.show && this.phase === 'PLAYING') this.recordPlayer(player, -1);
  }

  // ===========================================================================
  // Audience
  // ===========================================================================

  private guess(player: PlayerRecord, round: number, text: string): void {
    const show = this.show;
    const type = SHOWDOWN_MSG.guess;
    if (!this.getSettings().audience) return this.reject(player, type, 'not_allowed', 'Audience guesses are off for this show.');
    if (!this.isAudience(player)) return this.reject(player, type, 'not_allowed', 'Only the audience locks in guesses.');
    if (!show || !LIVE_STAGES.has(show.stage) || round !== show.round) {
      return this.reject(player, type, 'wrong_phase', 'Guesses open while a question is on the board.');
    }
    const def = currentRound(show);
    if (!def) return;
    const result = this.guesses.submit(player.id, show.round, def, text, revealedIn(show, show.round));
    if (!result.ok) return this.reject(player, type, 'not_allowed', GUESS_REJECTION_TEXT[result.reason]);
    this.state.guessesIn = this.guesses.count(show.round);
    this.refreshMe(player);
    // A crowd locks in hundreds of guesses in seconds: the sheet (with the whole rundown) follows at
    // most once per tick instead of once per guess.
    this.sheetDirty = true;
  }

  private react(player: PlayerRecord, kind: number): void {
    if (this.state.screens.get(player.id) || kind < 0 || kind >= SHOWDOWN_REACTION_KINDS) return;
    this.reactions.k[kind] = (this.reactions.k[kind] ?? 0) + 1;
    const team = this.teamOf(player);
    if (team !== null) {
      this.reactions.t[team]++;
      this.hype[team] = Math.min(100, this.hype[team] + HYPE_PER_CHEER);
    }
    this.reactionsPending = true;
  }

  /** Reactions go out in small batches; hype drains while nobody cheers; the round clock runs out. */
  private tick(): void {
    if (this.sheetDirty) this.refreshSheet();
    if (this.show && !this.timeUp && this.state.clockEndsAt > 0 && Date.now() >= this.state.clockEndsAt) {
      // Time's up: the console says "wrap up", the host says so on the stage. Nothing is revealed.
      this.timeUp = true;
      this.broadcast(SHOWDOWN_MSG.event, { type: 'timeup', rev: this.show.rev, round: this.show.round } satisfies ShowdownEvent);
    }
    if (this.reactionsPending) {
      this.broadcast(SHOWDOWN_MSG.reactions, this.reactions);
      this.reactions = emptyReactions();
      this.reactionsPending = false;
    }
    for (const team of [0, 1] as const) {
      if (this.hype[team] > 0) this.hype[team] = Math.max(0, this.hype[team] - HYPE_DRAIN);
      const shown = Math.round(this.hype[team]);
      if (team === 0 && this.state.hype0 !== shown) this.state.hype0 = shown;
      if (team === 1 && this.state.hype1 !== shown) this.state.hype1 = shown;
    }
  }

  // ===========================================================================
  // Private views
  // ===========================================================================

  private refreshSheet(): void {
    this.sheetDirty = false;
    const presenter = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    if (!presenter?.client) return;
    const show = this.show;
    if (!show) {
      if (this.lastSheet !== 'null') {
        this.lastSheet = 'null';
        this.sendTo(presenter, SHOWDOWN_MSG.sheet, null);
      }
      return;
    }
    const round = currentRound(show);
    const sheet = sheetView(show, {
      guessed: round ? this.guesses.matchesPerSlot(show.round, round.answers.length) : [],
      cloud: round ? this.guesses.cloud(show.round, round) : [],
      undo: this.undoStack.length,
    });
    const json = JSON.stringify(sheet);
    if (json === this.lastSheet) return;
    this.lastSheet = json;
    this.sendTo(presenter, SHOWDOWN_MSG.sheet, sheet);
  }

  private refreshMe(player: PlayerRecord): void {
    if (!player.client || !this.isAudience(player)) return;
    const show = this.show;
    const me = show
      ? this.guesses.me(player.id, show.round, show.rounds, (r) => revealedIn(show, r))
      : { round: -1, guesses: [], points: 0, calls: 0 };
    const json = JSON.stringify(me);
    if (this.lastMe.get(player.id) === json) return;
    this.lastMe.set(player.id, json);
    this.sendTo(player, SHOWDOWN_MSG.me, me);
  }

  private refreshMeAll(): void {
    for (const p of this.players.values()) if (!p.state.spectator) this.refreshMe(p);
  }

  private nameOf(id: string): string {
    return this.getPlayer(id)?.state.name ?? this.playedNames.get(id) ?? 'Former player';
  }
}

function emptyReactions(): ShowdownReactions {
  return { k: Array.from({ length: SHOWDOWN_REACTION_KINDS }, () => 0), t: [0, 0] };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
