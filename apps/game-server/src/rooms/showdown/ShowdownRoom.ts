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
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Phase } from '@dascade/shared';
import { RATE, cleanText, isValidRoomCode, maskProfanity, randomId, type CreateOptions, type RoomMetadata } from '@dascade/shared';
import {
  SHOWDOWN_AUDIO_READY,
  SHOWDOWN_AUDIO_SILENT,
  SHOWDOWN_EVENT_GRACE_SECONDS,
  SHOWDOWN_EVENT_IDS,
  SHOWDOWN_EVENT_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_MISS_GAP_MS,
  SHOWDOWN_MSG,
  SHOWDOWN_PICK_LAND_MS,
  SHOWDOWN_REACTION_KINDS,
  SHOWDOWN_REROLL_INFO,
  SHOWDOWN_ROLE_INFO,
  SHOWDOWN_SONG_MS,
  SHOWDOWN_STATION_TIMEOUT_MS,
  ShowdownActSchema,
  ShowdownAssignSchema,
  ShowdownAudioSchema,
  ShowdownCrewClaimSchema,
  ShowdownCrewIssueSchema,
  ShowdownCrewRevokeSchema,
  ShowdownEmptySchema,
  ShowdownHideSchema,
  ShowdownPickSchema,
  ShowdownRenameSchema,
  ShowdownSkipSchema,
  ShowdownStationSchema,
  permissionsOf,
  SHOWDOWN_STANDINGS_CARD,
  isSceneCard,
  ShowdownCardSchema,
  ShowdownJoinPopSchema,
  ShowdownClaimSchema,
  ShowdownCreditSchema,
  ShowdownFinaleSchema,
  answerValue,
  emptyMedals,
  finaleSteps,
  medalCount,
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
  type ShowdownAuditEntry,
  type ShowdownAuditFile,
  type ShowdownAuditView,
  type ShowdownBlackBox,
  type ShowdownCard,
  type ShowdownSceneCard,
  type ShowdownCrewPrivate,
  type ShowdownCrewRole,
  type ShowdownIssuableRole,
  type ShowdownMe,
  type ShowdownMyGuess,
  type ShowdownPermission,
  type ShowdownScoreboard,
  type ShowdownScoresFile,
  type ShowdownScoresView,
  type ShowdownPickPayload,
  type ShowdownPickerPrivate,
  type ShowdownPreflightData,
  type ShowdownRerollReason,
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
  drawPick,
  finalizeShow,
  lateIn,
  nextSweepSlot,
  pickPool,
  pickRounds,
  revealedIn,
  scoreShow,
  sheetView,
  showWinner,
  specialSlot,
  step,
  type PickRules,
  type PickSeat,
  type ScoreTurn,
  type ShowScores,
  type ShowCommand,
  type ShowState,
} from '@dascade/game-core/showdown';
import { BaseGameRoom, hashSeatToken, type PlayerRecord, type RemovalReason, type RestoredSeat } from '../BaseGameRoom.ts';
import { log } from '../../lib/log.ts';
import { processStartedAt, runningCommit } from '../../lib/process.ts';
import { ShowdownState } from './schema.ts';
import { AuditLog, AUDIT_VIEW, type AuditInput } from './audit.ts';
import { blackBoxEnabled, openBlackBox, sealBlackBox } from './blackbox.ts';
import { CrewBook, type CrewLinkRecord } from './crew.ts';

const PRESENTER_AWAY_MS = 10 * 60_000;
/** Event rooms wait much longer for an absent presenter (OPS-01: keep-alive). */
const EVENT_PRESENTER_AWAY_MS = 30 * 60_000;
/** An event room nobody is connected to closes after this long (the keep-alive's safety timer). */
const EVENT_EMPTY_MS = 30 * 60_000;
/** Black box: at most one snapshot per second, and a fresh one this often while the clock runs. */
const SNAPSHOT_GAP_MS = 1000;
const SNAPSHOT_CLOCK_MS = 15_000;
/** Audit entries a black box carries (the snapshot must fit a create request). */
const SNAPSHOT_AUDIT = 300;
const SNAPSHOT_MAX_CHARS = 110_000;
/** Restored seats nobody reclaimed are dropped after this long (outside a live show). */
const RESTORE_CLAIM_MS = 15 * 60_000;
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
/** The public scoreboard: the top Guessers on the stage, and how many Spotlight Stars it lists. */
const TOP_SHOWN = 5;
const STARS_SHOWN = 12;
const NO_GUESSES: ReadonlyMap<string, readonly { slot: number; pos: number; repeat: boolean }[]> = new Map();

export class ShowdownRoom extends BaseGameRoom<ShowdownState, ShowdownSettings> {
  readonly gameId = 'showdown' as const;
  protected readonly settingsSchema = ShowdownSettingsSchema;
  /** The show opens on its own marquee (no shared 3-2-1). */
  protected override countdownMs = 0;
  /** Test hook: how long a show waits for an absent presenter before it ends. */
  protected presenterAwayMs = PRESENTER_AWAY_MS;
  /** Test hook: the same in an event room (keep-alive: much longer). */
  protected eventPresenterAwayMs = EVENT_PRESENTER_AWAY_MS;
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
  /** When the "Pick the Answer" song last started (it isn't stacked). */
  private songAt = 0;
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
  /** The round clock's cues this round: the 1:00 warning went out; the last tick number sent (11 = none yet). */
  private clockWarned = false;
  private lastTick = 11;

  // ---- Event rooms (crew, audit, sound station, keep-alive, black box) ----
  /** The event preset that made this an event room ('' = an ordinary room). */
  private event: '' | ShowdownEventId = '';
  private readonly crew = new CrewBook(this.rng);
  private readonly audit = new AuditLog(() => this.roomId);
  /** When a guest's last refused attempt was logged (see logRefusal). */
  private readonly refusalAt = new Map<string, number>();
  /** Last crew view sent to each player (JSON), to send only changes. */
  private readonly lastCrew = new Map<string, string>();
  /** Sound station heartbeats: playerId → when, and whether that device can play right now. */
  private readonly beats = new Map<string, { at: number; ready: boolean }>();
  /** When the current station was chosen (a fresh station gets one timeout to report in). */
  private stationSince = 0;
  /** Since when nobody is connected to a live event room (0 = someone is). */
  private emptySince = 0;
  private snapshotDirty = false;
  private lastSnapshotAt = 0;
  /** A sealed snapshot being restored (between prepareRestore and applyRestore). */
  private restoring: ShowdownSnapshot | null = null;

  // ---- The picker (Presenter Showcase) ----
  /** Participants who switched Skip me on (private: never in synchronized state). */
  private readonly skips = new Set<string>();
  /** Participants a moderator hid from the stage and the pool. */
  private readonly hidden = new Set<string>();
  /** Turns this show (Mark done counts one): Fair mode draws the fewest first. */
  private readonly turns = new Map<string, number>();
  /** Out of random draws until included again (the presenter and crew decide; by name still works). */
  private readonly excluded = new Set<string>();
  /** Whom the last draw picked: True random never draws them twice in a row. */
  private lastPicked = '';
  /** "Called by": `${round}:${slot}` → who was in the hot seat when it flipped, and for which draw. */
  private readonly credits = new Map<string, { id: string; name: string; draw?: number }>();

  // ---- Two-tier scoring (Presenter Showcase): crowd points and hot-seat medals, derived ----
  /** Turns marked done this show (a turn with nothing credited to its draw is a Brave ribbon). */
  private doneTurns: ScoreTurn[] = [];
  /** The latest recomputation (null outside a show). */
  private scores: ShowScores | null = null;
  /** Last full list sent to the presenter / scores crew, per player (JSON), to send only changes. */
  private readonly lastScores = new Map<string, string>();

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
    this.handle(SHOWDOWN_MSG.cue, ShowdownCueSchema, (p, { cue }) => this.cue(p, cue), {
      phases: ['PLAYING', 'RESULTS'],
      rate: { burst: 6, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.team, ShowdownTeamSchema, (p, { team }) => this.pickTeam(p, team), {
      phases: ['LOBBY', 'PLAYING'],
      playersOnly: true,
    });
    this.handle(SHOWDOWN_MSG.move, ShowdownMoveSchema, (p, payload) => this.movePlayer(p, payload.playerId, payload.team), {
      phases: ['LOBBY', 'PLAYING'],
    });
    this.handle(SHOWDOWN_MSG.screen, ShowdownScreenSchema, (p, { on }) => this.setScreen(p, on), { phases: PRESENTER_PHASES });
    this.handle(SHOWDOWN_MSG.guess, ShowdownGuessSchema, (p, payload) => this.guess(p, payload.round, payload.text, payload.pos), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.chat,
    });
    this.handle(SHOWDOWN_MSG.react, ShowdownReactSchema, (p, { r }) => this.react(p, r), {
      phases: ['PLAYING', 'RESULTS'],
      rate: { burst: 10, perSecond: 5 },
      silent: true,
    });
    this.handle(SHOWDOWN_MSG.claim, ShowdownClaimSchema, (p, { pass }) => this.claim(p, pass), {
      phases: PRESENTER_PHASES,
      rate: { burst: 5, perSecond: 0.5 },
    });
    this.handle(SHOWDOWN_MSG.handover, ShowdownHandoverSchema, (p, { playerId }) => this.handover(p, playerId), {
      phases: PRESENTER_PHASES,
    });
    this.handle(SHOWDOWN_MSG.takeover, ShowdownTakeoverSchema, (p) => this.takeover(p), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 3, perSecond: 0.5 },
    });
    this.handle(SHOWDOWN_MSG.content, ShowdownContentSchema, (p, { rounds }) => this.saveContent(p, rounds), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 4, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.preset, ShowdownPresetSchema, (p, { id }) => this.loadPreset(p, id), {
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 4, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.finale, ShowdownFinaleSchema, (p, { step }) => this.finaleStep(p, step), {
      phases: ['RESULTS'],
      rate: { burst: 6, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.scoresExport, ShowdownEmptySchema, (p) => this.exportScores(p), {
      phases: PRESENTER_PHASES,
      rate: { burst: 3, perSecond: 0.5 },
    });
    this.handle(SHOWDOWN_MSG.credit, ShowdownCreditSchema, (p, { round, slot }) => this.removeCredit(p, round, slot), {
      phases: ['PLAYING'],
      rate: { burst: 6, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.card, ShowdownCardSchema, (p, { card }) => this.setCard(p, card), {
      phases: PRESENTER_PHASES,
      rate: { burst: 8, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.joinPop, ShowdownJoinPopSchema, (p, { on }) => this.joinPop(p, on), {
      phases: PRESENTER_PHASES,
      rate: { burst: 4, perSecond: 1 },
    });
    // ---- The picker ----
    // Include / exclude work in any phase (people are set up before doors); draws need a live show.
    this.handle(SHOWDOWN_MSG.pick, ShowdownPickSchema, (p, payload) => this.pickAct(p, payload), {
      phases: PRESENTER_PHASES,
      rate: { burst: 12, perSecond: 4 },
    });
    this.handle(SHOWDOWN_MSG.skip, ShowdownSkipSchema, (p, { on }) => this.setSkip(p, on), {
      phases: PRESENTER_PHASES,
      rate: { burst: 6, perSecond: 2 },
    });
    // ---- Event rooms: crew, moderation, audit ----
    const crewRate = { rate: { burst: 5, perSecond: 0.5 } } as const;
    this.handle(SHOWDOWN_MSG.crewClaim, ShowdownCrewClaimSchema, (p, { link }) => this.claimCrew(p, link), {
      phases: PRESENTER_PHASES,
      ...crewRate,
    });
    this.handle(SHOWDOWN_MSG.crewIssue, ShowdownCrewIssueSchema, (p, { role, name }) => this.issueCrew(p, role, name), {
      phases: PRESENTER_PHASES,
      rate: { burst: 6, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.crewRevoke, ShowdownCrewRevokeSchema, (p, { id }) => this.revokeCrew(p, id), {
      phases: PRESENTER_PHASES,
      rate: { burst: 6, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.assign, ShowdownAssignSchema, (p, { playerId, reason }) => this.assign(p, playerId, reason ?? ''), {
      phases: PRESENTER_PHASES,
      ...crewRate,
    });
    this.handle(SHOWDOWN_MSG.rename, ShowdownRenameSchema, (p, { playerId, name }) => this.moderateRename(p, playerId, name), {
      phases: PRESENTER_PHASES,
      rate: { burst: 10, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.hide, ShowdownHideSchema, (p, { playerId, on }) => this.moderateHide(p, playerId, on), {
      phases: PRESENTER_PHASES,
      rate: { burst: 10, perSecond: 2 },
    });
    this.handle(SHOWDOWN_MSG.auditExport, ShowdownEmptySchema, (p) => this.exportAudit(p), {
      phases: PRESENTER_PHASES,
      rate: { burst: 3, perSecond: 0.2 },
    });
    // ---- Event rooms: sound station, preflight ----
    this.handle(SHOWDOWN_MSG.audio, ShowdownAudioSchema, (p, payload) => this.audioBeat(p, payload), {
      phases: PRESENTER_PHASES,
      rate: { burst: 4, perSecond: 1 },
      silent: true,
    });
    this.handle(SHOWDOWN_MSG.station, ShowdownStationSchema, (p, { playerId }) => this.setStation(p, playerId), {
      phases: PRESENTER_PHASES,
      rate: { burst: 6, perSecond: 1 },
    });
    this.handle(SHOWDOWN_MSG.preflight, ShowdownEmptySchema, (p) => this.preflight(p), {
      phases: PRESENTER_PHASES,
      rate: { burst: 4, perSecond: 1 },
    });
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
    // Turns count per show: a new show starts everyone level.
    this.turns.clear();
    this.lastPicked = '';
    this.resetPicker();
    this.credits.clear();
    this.doneTurns = [];
    this.state.finaleStep = 0;
    this.publish([{ type: 'intro', rev: this.show.rev }]);
    if (!this.presenterOnline()) this.watchPresenter();
    if (this.event) {
      // Keep-alive (OPS-01): a live event room never closes just because nobody is connected for a moment.
      this.autoDispose = false;
      this.djLockChanged();
    }
    this.markSnapshot();
  }

  protected override onReturnToLobby(): void {
    this.autoDispose = true;
    this.turns.clear();
    this.lastPicked = '';
    this.resetPicker();
    this.credits.clear();
    this.doneTurns = [];
    this.scores = null;
    this.state.scoreJson = '';
    this.state.finaleStep = 0;
    this.refreshScoresAll();
    this.markSnapshot();
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
    this.markSnapshot();
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
    this.refreshCrewAll();
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    if (player.id === this.presenterId) this.watchPresenter();
    // The sound station went away: the presenter's console takes over at once (AUD-02).
    if (this.state.soundStation === player.id) this.stationFailover();
    this.refreshCrewAll();
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    if (player.id === this.presenterId) this.watchPresenter();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.lastMe.delete(player.id);
    this.lastCrew.delete(player.id);
    this.lastScores.delete(player.id);
    this.state.teams.delete(player.id);
    this.state.screens.delete(player.id);
    this.state.seats.delete(player.id);
    this.state.done.delete(player.id);
    this.state.audio.delete(player.id);
    this.beats.delete(player.id);
    this.skips.delete(player.id);
    this.hidden.delete(player.id);
    this.turns.delete(player.id);
    this.excluded.delete(player.id);
    if (this.state.soundStation === player.id) this.stationFailover();
    if (this.state.hotSeat === player.id) this.endTurn(null, 'cleared');
    // A crew link's holder left for good: the link can be opened again (on any device).
    for (const link of this.crew.heldBy(player.id)) link.holderId = '';
    this.markSnapshot();
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
    this.lastCrew.delete(player.id);
    this.lastScores.delete(player.id);
    this.refreshCrew(player);
    this.refreshScores(player);
    if (this.can(player, 'audit.read')) this.sendTo(player, SHOWDOWN_MSG.audit, this.auditView());
    if (player.id === this.presenterId) {
      this.sendTo(player, SHOWDOWN_MSG.pass, { pass: this.presenterPass });
      this.sendTo(player, SHOWDOWN_MSG.content, this.custom);
      this.lastSheet = '';
      this.refreshSheet();
      // The console carries the black box: hand it a fresh one.
      this.markSnapshot();
      return;
    }
    this.lastMe.delete(player.id);
    this.refreshMe(player);
  }

  protected override onRoomDisposed(): void {
    this.show = null;
    this.guesses.clear();
  }

  /** A deploy or a clean stop: the presenter's console gets the freshest black box before the room closes. */
  protected override onServerShutdown(): void {
    if (this.event) this.sendBlackBox();
  }

  /** The presenter closed the room on purpose: nothing to restore any more. */
  protected override closeRoom(): void {
    const presenter = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    if (this.event && presenter) this.sendTo(presenter, SHOWDOWN_MSG.blackbox, null);
    super.closeRoom();
  }

  protected override reconnectGraceFor(player: PlayerRecord): number {
    // Keep-alive (OPS-01): the presenter's and the crew's seats wait 30 minutes in an event room.
    if (this.event && (player.id === this.presenterId || this.crew.rolesOf(player.id).length > 0)) {
      return Math.max(SHOWDOWN_EVENT_GRACE_SECONDS, this.reconnectGraceSeconds);
    }
    return this.reconnectGraceSeconds;
  }

  protected override metadataExtra(): Partial<RoomMetadata> {
    return this.event ? { event: this.event } : {};
  }

  protected override djLockReason(): string | null {
    return this.event && this.phase === 'PLAYING' ? 'The Room DJ is paused while the show is on — it’s back in the breaks.' : null;
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
    this.schedule('presenter-away', this.event ? this.eventPresenterAwayMs : this.presenterAwayMs, () => {
      if (this.phase !== 'PLAYING' || this.presenterOnline()) return;
      this.systemChat('The presenter did not come back — the show ends with the scores as they stand.');
      if (this.event)
        this.log({ actorId: '', actorName: 'Server', role: 'server', action: 'show.end', reason: 'The presenter was away too long' });
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
    // ADM-04 B: in an event room every change of presenter rotates the pass, so an old presenter link
    // stops working. The new presenter gets the new pass privately below; nobody has to reload.
    if (this.event) this.presenterPass = randomId(24, this.rng);
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
      // Only the presenter carries the black box: an old one must never win a restore.
      if (this.event) this.sendTo(prev, SHOWDOWN_MSG.blackbox, null);
      this.toast(prev, 'info', `${next.state.name} is presenting now.`);
      if (this.isAudience(prev) && !prev.state.spectator) this.joinAudience(prev);
    }
    this.syncPrivate(next);
    if (next.client) this.cancel('presenter-away');
    if (announce) this.systemChat(`${next.state.name} is now the presenter.`);
    // A presenter on stage isn't a guest in the pool; the old one may be again.
    if (this.state.hotSeat === next.id) this.endTurn(null, 'cleared');
    this.refreshCrewAll();
    this.markSnapshot();
  }

  private claim(player: PlayerRecord, pass: string): void {
    if (!safeEqual(this.presenterPass, pass)) {
      if (this.event) this.logRefusal(player, { ...this.actor(player), action: 'presenter.refused', reason: 'Invalid presenter pass' });
      return this.reject(player, SHOWDOWN_MSG.claim, 'not_allowed', 'That presenter pass is not valid for this room.');
    }
    if (this.isPresenter(player)) return;
    // A big screen shows the stage to everyone: it never receives the answer sheet.
    if (this.state.screens.get(player.id))
      return this.reject(
        player,
        SHOWDOWN_MSG.claim,
        'not_allowed',
        'A big screen can’t present — open the presenter link in a normal tab.',
      );
    // ADM-04 B: an online presenter is never replaced by a link; the producer moves the role.
    if (this.event && this.presenterOnline()) {
      this.logRefusal(player, { ...this.actor(player), action: 'presenter.refused', reason: 'The presenter is online' });
      return this.reject(player, SHOWDOWN_MSG.claim, 'not_allowed', 'The presenter is online — ask the producer to hand you the show.');
    }
    const before = this.presenterName();
    this.setPresenter(player);
    if (this.event)
      this.log({
        ...this.actor(player),
        action: 'presenter.claim',
        target: player.id,
        targetName: player.state.name,
        before,
        after: player.state.name,
        reason: 'Presenter link while the presenter was offline',
      });
    this.toast(player, 'success', 'Presenter controls are yours.');
  }

  /** Nobody presents any more (the presenter left for good): someone else may run the next show. */
  private takeover(player: PlayerRecord): void {
    // Big screens and spectators never take the show (every room).
    if (this.state.screens.get(player.id) || player.state.spectator) {
      return this.reject(player, SHOWDOWN_MSG.takeover, 'not_allowed', 'A big screen or a spectator can’t take over the show.');
    }
    // ADM-04 B: in an event room only the producer moves the presenter role.
    if (this.event && !this.can(player, 'presenter.assign')) {
      this.logRefusal(player, { ...this.actor(player), action: 'presenter.refused', reason: 'Takeover without presenter.assign' });
      return this.reject(player, SHOWDOWN_MSG.takeover, 'not_allowed', 'Ask the producer to make you the presenter.');
    }
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
    const before = this.presenterName();
    this.setPresenter(player);
    if (this.event)
      this.log({
        ...this.actor(player),
        action: 'presenter.takeover',
        target: player.id,
        targetName: player.state.name,
        before,
        after: player.state.name,
      });
    this.toast(player, 'success', 'You’re the presenter now — only you will see the answers.');
  }

  private handover(player: PlayerRecord, playerId: string): void {
    if (!this.isPresenter(player))
      return this.reject(player, SHOWDOWN_MSG.handover, 'not_host', 'Only the presenter can hand over the show.');
    const target = this.getPlayer(playerId);
    if (!target || !target.client || target === player) {
      return this.reject(player, SHOWDOWN_MSG.handover, 'not_allowed', 'Pick someone who is in the room right now.');
    }
    // A big screen shows the stage to everyone: it must never receive the answer sheet.
    if (this.state.screens.get(target.id))
      return this.reject(player, SHOWDOWN_MSG.handover, 'not_allowed', 'A big screen can’t present — pick a person.');
    this.setPresenter(target);
    if (this.event)
      this.log({
        ...this.actor(player, 'presenter'),
        action: 'presenter.handover',
        target: target.id,
        targetName: target.state.name,
        before: player.state.name,
        after: target.state.name,
      });
  }

  private saveContent(player: PlayerRecord, rounds: ShowdownRoundInput[]): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.content, 'not_host', 'Only the presenter writes the questions.');
    const report = validateShowContent(rounds);
    this.custom = report;
    this.state.customRounds = report.rounds.length;
    // The presenter's own rounds now (even if they started from the practice boards).
    this.state.rehearsal = false;
    this.sendTo(player, SHOWDOWN_MSG.content, report);
    this.markSnapshot();
  }

  /**
   * An event preset: its settings, and — unless it's settings-only (ADM-01: the real boards come from
   * the presenter's show file, never from the repo) — its rounds as this room's custom rounds. A
   * settings-only preset keeps whatever rounds are already loaded, in either order.
   */
  private loadPreset(player: PlayerRecord, id: ShowdownEventId): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.preset, 'not_host', 'Only the presenter loads a show.');
    const info = SHOWDOWN_EVENT_INFO[id];
    if (!info.settingsOnly) {
      const report = validateShowContent(SHOWDOWN_EVENT_ROUNDS[id]);
      this.custom = report;
      this.state.customRounds = report.rounds.length;
      this.state.rehearsal = info.rehearsal;
    }
    this.updateSettings({ ...this.getSettings(), ...info.settings });
    this.sendTo(player, SHOWDOWN_MSG.content, this.custom);
    if (info.event) this.becomeEventRoom(player, id);
    if (this.event) this.log({ ...this.actor(player), action: 'preset.load', after: info.title });
    const rounds = this.custom.rounds.length;
    this.toast(
      player,
      'success',
      info.settingsOnly
        ? rounds > 0
          ? `Loaded ${info.title}’s settings. Your ${rounds} loaded round${rounds === 1 ? '' : 's'} stay as they are.`
          : `Loaded ${info.title}’s settings. Now load your show file (Settings → Your own rounds → Load).`
        : `Loaded ${info.title}: ${rounds} rounds. Check them in Settings → Your own rounds.`,
    );
    this.markSnapshot();
  }

  private setCard(player: PlayerRecord, card: ShowdownCard | typeof SHOWDOWN_STANDINGS_CARD | ShowdownSceneCard | ''): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.card, 'not_host', 'Only the presenter changes the stage.');
    if (card === SHOWDOWN_STANDINGS_CARD && !this.scoringOn()) {
      return this.reject(player, SHOWDOWN_MSG.card, 'not_allowed', 'Standings need Score the crowd or medals switched on.');
    }
    if (isSceneCard(card) && !this.showcase) {
      return this.reject(player, SHOWDOWN_MSG.card, 'not_allowed', 'Stage scenes are for Presenter Showcase.');
    }
    // Leaving the Show for a card or a scene stops the round clock where it is; P starts it again (Scenes A).
    if (card !== '' && this.phase === 'PLAYING' && this.state.clockEndsAt > 0) this.runClock(false);
    this.state.card = card;
    this.markSnapshot();
  }

  /** The Join pop-up (QR A): every stage shows the join ticket for SHOWDOWN_JOIN_POP_MS from now. */
  private joinPop(player: PlayerRecord, on: boolean): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.joinPop, 'not_host', 'Only the presenter changes the stage.');
    this.state.joinAt = on ? Date.now() : 0;
  }

  private cue(player: PlayerRecord, cue: string): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.cue, 'not_host', 'Only the presenter plays sound cues.');
    if (cue === 'pickAnswer') {
      // A song: a second press while it's still playing is the same press.
      const now = Date.now();
      if (now - this.songAt < SHOWDOWN_SONG_MS) return;
      this.songAt = now;
    }
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
    // VIS-02: a tile found while someone is in the hot seat is credited to them ("called by …").
    const hot = this.state.hotSeat ? this.getPlayer(this.state.hotSeat) : undefined;
    if (hot && result.state.mode === 'showcase') {
      for (const e of result.events) {
        if (e.type === 'reveal' && !e.late)
          this.credits.set(`${result.state.round}:${e.slot}`, { id: hot.id, name: hot.state.name, draw: this.state.drawNo });
      }
    }
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
      // The standings belong to the break between rounds: the next round (or a restart) takes them down.
      if (this.state.card === SHOWDOWN_STANDINGS_CARD) this.state.card = '';
      this.resetClock(this.state.clockMax || this.getSettings().minutes * this.minuteMs);
      // PCK-05 A: the pool refills when the next round starts (late joiners included).
      this.resetPicker();
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
    if (
      from.mode === 'showcase' &&
      (from.round !== prev.round || (from.stage === 'title') !== (prev.stage === 'title') || prev.stage === 'intro')
    ) {
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
      return this.reject(
        player,
        SHOWDOWN_MSG.act,
        'wrong_phase',
        show.stage === 'done' ? 'Every answer is already on the board.' : 'Show the question first.',
      );
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
    this.clockWarned = false;
    this.lastTick = 11;
    this.markSnapshot();
  }

  private runClock(on: boolean): void {
    if (this.state.clockMax <= 0) return;
    this.markSnapshot();
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
    const next = Math.max(
      Math.min(left, this.state.clockMax + SHOWDOWN_LIMITS.minutesMax * this.minuteMs),
      Math.min(0, this.clockLeftNow()),
    );
    if (this.state.clockEndsAt > 0) this.state.clockEndsAt = Date.now() + next;
    else this.state.clockLeft = Math.round(next);
    if (next > 0) this.timeUp = false;
    // Time added past the last ten seconds: the ticks count down again at the new end.
    if (next > 10_500) this.lastTick = 11;
    this.markSnapshot();
  }

  /** The public board, with the hot-seat credits on revealed tiles (a hidden tile loses its credit: undo). */
  private boardJson(show: ShowState): string {
    const view = boardView(show, this.guesses.callers(show.round, revealedIn(show, show.round)));
    if (show.mode === 'showcase' && this.credits.size > 0) {
      view.slots.forEach((slot, i) => {
        const key = `${show.round}:${i}`;
        const credit = this.credits.get(key);
        if (!credit) return;
        if (!slot.revealed) this.credits.delete(key);
        else slot.calledBy = this.getPlayer(credit.id)?.state.name ?? credit.name;
      });
    }
    return JSON.stringify(view);
  }

  /** Board + sheet + per-player views after a change, then the events for sounds and animation. */
  private publish(events: ShowdownEvent[]): void {
    const show = this.show;
    if (!show) return;
    const revealed = revealedIn(show, show.round);
    this.state.boardJson = this.boardJson(show);
    this.state.rev = show.rev;
    this.state.round = Math.max(0, show.round + 1);
    this.state.guessesIn = show.round >= 0 ? this.guesses.count(show.round) : 0;
    const matches = this.guesses.matchesPerSlot(show.round, revealed.length);
    for (const e of events) {
      this.broadcast(SHOWDOWN_MSG.event, e.type === 'reveal' ? { ...e, callers: matches[e.slot] ?? 0 } : e);
    }
    this.recomputeScores();
    this.refreshSheet();
    this.refreshMeAll();
    this.markSnapshot();
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
    // Two-tier scoring: the crowd's points and the hot seat's medals, from the final board.
    this.recomputeScores();
    const tiers = show.mode === 'showcase' ? this.scores : null;
    const crowdPoints = tiers !== null && settings.points;
    const callers = crowdPoints
      ? tiers.people
          .filter((p) => p.calls > 0)
          .map((p) => ({
            playerId: p.playerId,
            name: p.name,
            points: p.points,
            calls: p.calls,
            team: this.playedFor.get(p.playerId) ?? -1,
          }))
      : [...this.guesses.players()]
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
      ...(tiers
        ? {
            // The podium: the top three Guessers (ties share a place); nobody a moderator hid.
            podium: crowdPoints
              ? tiers.people
                  .filter((p) => p.rank >= 1 && p.rank <= 3 && !this.hidden.has(p.playerId))
                  .map(({ playerId, name, points, rank }) => ({ playerId, name, points, rank }))
              : [],
            stars: settings.medals !== 'never' ? tiers.stars.filter((x) => !this.hidden.has(x.playerId)).slice(0, STARS_SHOWN) : [],
            medals: settings.medals,
          }
        : {}),
    };
    this.state.finaleStep = 0;
    this.state.boardJson = this.boardJson(show);
    this.state.rev = show.rev;
    this.state.finaleJson = JSON.stringify(finale);
    // The finale takes the stage: a standings card left up would hide the podium.
    if (this.state.card === SHOWDOWN_STANDINGS_CARD) this.state.card = '';
    if (this.state.hotSeat) this.endTurn(null, 'cleared');

    const placements = winner === -1 ? [[...members[0], ...members[1], ...crowd]] : [members[winner], members[winner === 0 ? 1 : 0]];
    const scores: Record<string, number> = {};
    const called = new Map(callers.map((c) => [c.playerId, c.points]));
    // A showcase has no team scores: an audience member's score is their called-it points.
    for (const [id, team] of this.playedFor) scores[id] = team === -1 ? (called.get(id) ?? 0) : show.scores[team];
    const playerStats: Record<string, Record<string, number>> = {};
    for (const c of callers) playerStats[c.playerId] = { calls: c.calls, bestCallPoints: c.points };
    // Two-tier extras: medals from the hot seat, answers called in the right spot.
    for (const p of tiers?.people ?? []) {
      const medals = medalCount(p.medals);
      if (!medals && !p.positionHits) continue;
      playerStats[p.playerId] = { ...(playerStats[p.playerId] ?? {}), medals, positionHits: p.positionHits };
    }
    // A show ended before round 1 was played reports nothing (nobody won or lost anything).
    if (show.round >= 0)
      this.reportOutcome({ placements, scores, reason, details: { playerStats, teamScores: [...show.scores], rounds: rounds.length } });
    const placeOf = (id: string) => (winner === -1 ? 1 : this.playedFor.get(id) === winner ? 1 : 2);
    this.endMatch({
      players: [...this.playedFor.keys()].map((id) => {
        const record = this.getPlayer(id);
        return {
          playerId: id,
          name: this.nameOf(id),
          guestId: record?.guestId,
          userId: record?.userId,
          score: scores[id] ?? 0,
          placement: placeOf(id),
        };
      }),
      details: { reason, winner, scores: [...show.scores] },
    });
    // The show is over: the room may close by itself again, and the Room DJ is back (the breaks).
    this.autoDispose = true;
    this.djLockChanged();
    if (this.event && reason === 'presenter')
      this.log({ actorId: '', actorName: 'Presenter', role: 'presenter', action: 'show.end', reason: 'Ended from the console' });
    this.refreshSheet();
    this.refreshMeAll();
    this.markSnapshot();
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
        return this.reject(
          player,
          SHOWDOWN_MSG.screen,
          'not_allowed',
          'You’re the presenter — open the stage window from your console instead.',
        );
      }
      this.state.screens.set(player.id, true);
      this.state.teams.delete(player.id);
      this.forgetPlayer(player.id);
      this.skips.delete(player.id);
      if (this.state.hotSeat === player.id) this.endTurn(null, 'cleared');
      return;
    }
    if (!this.state.screens.get(player.id)) return;
    this.state.screens.delete(player.id);
    this.state.audio.delete(player.id);
    if (this.state.soundStation === player.id) this.stationFailover();
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

  private guess(player: PlayerRecord, round: number, text: string, pos?: number): void {
    const show = this.show;
    const type = SHOWDOWN_MSG.guess;
    if (!this.getSettings().audience) return this.reject(player, type, 'not_allowed', 'Audience guesses are off for this show.');
    if (!this.isAudience(player)) return this.reject(player, type, 'not_allowed', 'Only the audience locks in guesses.');
    if (!show || !LIVE_STAGES.has(show.stage) || round !== show.round) {
      return this.reject(player, type, 'wrong_phase', 'Guesses open while a question is on the board.');
    }
    const def = currentRound(show);
    if (!def) return;
    const limit = this.getSettings().guesses;
    // The Top 10 scorecard: each guess is locked into a spot (Score the crowd in a showcase).
    const spot = show.mode === 'showcase' && this.getSettings().points && pos !== undefined ? pos : -1;
    const result = this.guesses.submit(player.id, show.round, def, text, revealedIn(show, show.round), limit, spot);
    if (!result.ok) {
      const message =
        result.reason === 'limit'
          ? `You’ve locked in all ${limit} guess${limit === 1 ? '' : 'es'} for this question.`
          : GUESS_REJECTION_TEXT[result.reason];
      return this.reject(player, type, 'not_allowed', message);
    }
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
    const now = Date.now();
    if (this.sheetDirty) this.refreshSheet();
    this.clockCues(now);
    this.refreshPicker();
    if (this.event) this.eventTick(now);
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

  private refreshMe(player: PlayerRecord, pool?: ReadonlySet<string>): void {
    if (!player.client || !this.isAudience(player)) return;
    const show = this.show;
    const me: ShowdownMe = show
      ? this.guesses.me(player.id, show.round, show.rounds, (r) => revealedIn(show, r))
      : { round: -1, guesses: [], points: 0, calls: 0 };
    // DSP-03 B / PCK-03 C: your place in the picker's pool, private to you (guests and crew alike).
    const settings = this.getSettings();
    if (settings.mode === 'showcase' && this.isPickable(player)) {
      me.pool = {
        in: (pool ?? new Set(this.pool())).has(player.id),
        skip: this.skips.has(player.id),
        done: this.state.done.get(player.id) === true,
        turns: this.turns.get(player.id) ?? 0,
        excluded: this.excluded.has(player.id),
        crewOut: this.isCrew(player) && !settings.crewDraw,
        mode: settings.pickMode,
      };
      me.picked = this.state.hotSeat === player.id;
    }
    // Two-tier scoring: your points, rank and medals, and your scorecard's spots and bonuses.
    if (show && show.mode === 'showcase' && this.scores) {
      const sc = this.scores.byId.get(player.id);
      me.score = {
        points: sc?.points ?? 0,
        rank: sc?.rank ?? 0,
        of: this.scores.of,
        medals: sc ? { ...sc.medals } : emptyMedals(),
        positionHits: sc?.positionHits ?? 0,
        perfect: sc?.perfect ?? 0,
        gems: sc?.gems ?? 0,
        round: show.round >= 0 ? (sc?.rounds[show.round] ?? 0) : 0,
      };
      if (settings.points) {
        me.guesses = this.scorecard(player.id, show);
        me.points = me.score.points;
        me.calls = sc?.calls ?? 0;
      }
    }
    const json = JSON.stringify(me);
    if (this.lastMe.get(player.id) === json) return;
    this.lastMe.set(player.id, json);
    this.sendTo(player, SHOWDOWN_MSG.me, me);
  }

  /** Your guesses this round as the Top 10 scorecard shows them (a match only once its answer is up). */
  private scorecard(id: string, show: ShowState): ShowdownMyGuess[] {
    if (show.round < 0) return [];
    const revealed = revealedIn(show, show.round);
    const late = lateIn(show, show.round);
    const gems = this.getSettings().gems;
    return this.guesses.mine(id, show.round).map((g) => {
      const up = g.slot >= 0 && revealed[g.slot] === true;
      const called = up && !g.repeat;
      const gem = called && gems && late[g.slot] === true;
      return {
        text: g.text,
        slot: up ? g.slot : -1,
        points: called ? answerValue(g.slot, gem) : 0,
        pos: g.pos,
        bonus: called && g.pos === g.slot ? 1 : 0,
        ...(gem ? { gem: true } : {}),
      };
    });
  }

  private refreshMeAll(): void {
    const pool = new Set(this.pool());
    for (const p of this.players.values()) if (!p.state.spectator) this.refreshMe(p, pool);
  }

  // ===========================================================================
  // Event rooms: roles and permissions (ADM-02's smallest slice: presets as data, deny by default)
  // ===========================================================================

  /** This player's crew roles (event rooms only). */
  private rolesOf(player: PlayerRecord): ShowdownCrewRole[] {
    return this.event ? this.crew.rolesOf(player.id) : [];
  }

  /** What this player may do right now: their crew roles plus the presenter's set while they present. */
  private permsOf(player: PlayerRecord): ShowdownPermission[] {
    const roles: string[] = this.rolesOf(player);
    if (this.isPresenter(player)) roles.push('presenter');
    const perms = permissionsOf(roles);
    // Outside event rooms the presenter keeps the picker and the scores (there's no crew).
    return this.event ? perms : perms.filter((p) => p.startsWith('picker.') || p.startsWith('scores.'));
  }

  private can(player: PlayerRecord, perm: ShowdownPermission): boolean {
    return this.permsOf(player).includes(perm);
  }

  private isCrew(player: PlayerRecord): boolean {
    return this.rolesOf(player).length > 0;
  }

  /** Who acted, for the audit log. */
  private actor(player: PlayerRecord, role?: string): Pick<AuditInput, 'actorId' | 'actorName' | 'role'> {
    return {
      actorId: player.id,
      actorName: player.state.name,
      role: role ?? (this.isPresenter(player) ? 'presenter' : (this.rolesOf(player)[0] ?? 'guest')),
    };
  }

  private presenterName(): string {
    return this.presenterId ? this.nameOf(this.presenterId) : '';
  }

  private log(entry: AuditInput): void {
    this.audit.add(entry);
    this.markSnapshot();
  }

  /**
   * A refused privileged attempt. Crew and the presenter are always logged; a guest at most once a
   * minute, so nobody can flood the log (and push real entries out) by hammering a refused message.
   */
  private logRefusal(player: PlayerRecord, entry: AuditInput): void {
    if (!this.isPresenter(player) && !this.isCrew(player)) {
      const now = Date.now();
      if (now - (this.refusalAt.get(player.id) ?? 0) < 60_000) return;
      this.refusalAt.set(player.id, now);
    }
    this.log(entry);
  }

  /** The first event preset loaded makes this an event room for good; whoever loaded it is its producer. */
  private becomeEventRoom(player: PlayerRecord, id: ShowdownEventId): void {
    const first = !this.event;
    this.event = id;
    this.state.event = id;
    this.markMetadataDirty();
    if (!first) return;
    this.log({ ...this.actor(player, 'presenter'), action: 'event.start', after: SHOWDOWN_EVENT_INFO[id].title });
    const minted = this.crew.issue('producer', player.state.name);
    if (minted) {
      minted.record.holderId = player.id;
      this.log({
        ...this.actor(player, 'presenter'),
        action: 'crew.issue',
        target: minted.record.id,
        targetName: player.state.name,
        after: 'producer',
      });
      this.sendCrewFresh(player, minted.record, minted.link);
    }
    this.djLockChanged();
    this.refreshCrewAll();
  }

  // ===========================================================================
  // Crew links, presenter assignment, moderation
  // ===========================================================================

  private claimCrew(player: PlayerRecord, link: string): void {
    const type = SHOWDOWN_MSG.crewClaim;
    if (!this.event) return this.reject(player, type, 'not_allowed', 'Crew links only work in an event room.');
    const result = this.crew.verify(link);
    if (!result.ok) {
      this.logRefusal(player, { ...this.actor(player), action: 'crew.refused', reason: result.reason });
      return this.reject(
        player,
        type,
        'not_allowed',
        'That crew link isn’t valid for this room (it may have been revoked or expired). Ask the producer for a new one.',
      );
    }
    if (this.state.screens.get(player.id))
      return this.reject(player, type, 'not_allowed', 'A big screen can’t hold a crew role — open the link in a normal tab.');
    const record = result.link;
    const prev = record.holderId && record.holderId !== player.id ? this.getPlayer(record.holderId) : undefined;
    record.holderId = player.id;
    // Crew aren't guests: out of the hot seat, and in the random draw only with crewDraw from now on.
    if (this.state.hotSeat === player.id) this.endTurn(null, 'cleared');
    this.log({ ...this.actor(player, record.role), action: 'crew.claim', target: record.id, targetName: record.name, after: record.role });
    if (prev) {
      this.toast(prev, 'info', `Your ${SHOWDOWN_ROLE_INFO[record.role].title.toLowerCase()} link was opened on another device.`);
      this.lastCrew.delete(prev.id);
    }
    this.toast(player, 'success', `You’re the ${SHOWDOWN_ROLE_INFO[record.role].title.toLowerCase()} for this show.`);
    this.refreshCrewAll();
    if (this.can(player, 'audit.read')) this.sendTo(player, SHOWDOWN_MSG.audit, this.auditView());
    this.refreshMe(player);
  }

  private issueCrew(player: PlayerRecord, role: ShowdownIssuableRole, rawName: string): void {
    const type = SHOWDOWN_MSG.crewIssue;
    if (!this.can(player, 'crew.issue')) return this.reject(player, type, 'not_allowed', 'Only the producer hands out crew links.');
    const name = maskProfanity(cleanText(rawName, 40)) || SHOWDOWN_ROLE_INFO[role].title;
    const minted = this.crew.issue(role, name);
    if (!minted)
      return this.reject(player, type, 'not_allowed', 'This show has as many crew links as it can hold — revoke an old one first.');
    this.log({ ...this.actor(player), action: 'crew.issue', target: minted.record.id, targetName: name, after: role });
    this.sendCrewFresh(player, minted.record, minted.link);
    this.refreshCrewAll();
  }

  private revokeCrew(player: PlayerRecord, id: string): void {
    const type = SHOWDOWN_MSG.crewRevoke;
    if (!this.can(player, 'crew.revoke')) return this.reject(player, type, 'not_allowed', 'Only the producer revokes crew links.');
    const record = this.crew.revoke(id);
    if (!record) return this.reject(player, type, 'not_allowed', 'That link is already revoked.');
    this.log({ ...this.actor(player), action: 'crew.revoke', target: record.id, targetName: record.name, before: record.role });
    const holder = record.holderId ? this.getPlayer(record.holderId) : undefined;
    if (holder && holder !== player)
      this.toast(holder, 'warning', `Your ${SHOWDOWN_ROLE_INFO[record.role].title.toLowerCase()} link was revoked.`);
    this.refreshCrewAll();
    if (holder) this.refreshMe(holder);
  }

  /**
   * ADM-04 B: the producer makes someone the presenter (the pass rotates; the new presenter's console
   * opens without a reload). A backup presenter may make themselves presenter only while the presenter
   * is offline — the fallback when the producer is offline too.
   */
  private assign(player: PlayerRecord, playerId: string, rawReason: string): void {
    const type = SHOWDOWN_MSG.assign;
    const target = this.getPlayer(playerId);
    const selfBackup = target === player && this.rolesOf(player).includes('backup') && !this.presenterOnline();
    if (!this.can(player, 'presenter.assign') && !selfBackup) {
      if (this.event)
        this.logRefusal(player, { ...this.actor(player), action: 'presenter.refused', target: playerId, reason: 'No presenter.assign' });
      return this.reject(
        player,
        type,
        'not_allowed',
        this.rolesOf(player).includes('backup')
          ? 'The presenter is online — ask the producer to hand you the show.'
          : 'Only the producer can make someone the presenter.',
      );
    }
    if (!target || !target.client) return this.reject(player, type, 'not_allowed', 'Pick someone who is in the room right now.');
    if (this.state.screens.get(target.id) || target.state.spectator)
      return this.reject(player, type, 'not_allowed', 'A big screen or a spectator can’t present — pick a person.');
    if (this.isPresenter(target)) return;
    const before = this.presenterName();
    const reason = maskProfanity(cleanText(rawReason, 120));
    this.setPresenter(target);
    this.log({
      ...this.actor(player),
      action: 'presenter.assign',
      target: target.id,
      targetName: target.state.name,
      before,
      after: target.state.name,
      ...(reason ? { reason } : {}),
    });
    this.toast(target, 'success', 'You’re the presenter now — your console is open.');
  }

  /** JOI-02 C: rename anyone, in any phase (same cleaning as a lobby rename). Audited. */
  private moderateRename(player: PlayerRecord, playerId: string, name: string): void {
    const type = SHOWDOWN_MSG.rename;
    if (!this.can(player, 'people.rename')) return this.reject(player, type, 'not_allowed', 'Only crew can rename people.');
    const target = this.getPlayer(playerId);
    if (!target || this.state.screens.get(target.id)) return this.reject(player, type, 'not_allowed', 'That person isn’t in the room.');
    const before = target.state.name;
    // No chat line: it would repeat the name being fixed.
    const after = this.renamePlayer(target, name, false);
    if (!after) return;
    if (this.playedNames.has(target.id)) this.playedNames.set(target.id, after);
    this.log({ ...this.actor(player), action: 'people.rename', target: target.id, before, after });
    if (target !== player) this.toast(target, 'info', `A moderator changed your name to ${after}.`);
    this.refreshCrewAll();
    this.markSnapshot();
  }

  /** JOI-02 C: hide someone from the stage grid and the pool (they stay in the room). Audited. */
  private moderateHide(player: PlayerRecord, playerId: string, on: boolean): void {
    const type = SHOWDOWN_MSG.hide;
    if (!this.can(player, 'people.hide')) return this.reject(player, type, 'not_allowed', 'Only crew can hide people.');
    const target = this.getPlayer(playerId);
    if (!target || this.state.screens.get(target.id) || target.id === this.presenterId)
      return this.reject(player, type, 'not_allowed', 'Only guests can be hidden.');
    if (this.hidden.has(target.id) === on) return;
    if (on) this.hidden.add(target.id);
    else this.hidden.delete(target.id);
    if (on && this.state.hotSeat === target.id) this.endTurn(player, 'cleared');
    this.log({ ...this.actor(player), action: on ? 'people.hide' : 'people.unhide', target: target.id, targetName: target.state.name });
    this.refreshCrewAll();
    this.refreshPicker();
    this.refreshMe(target);
    this.markSnapshot();
  }

  private sendCrewFresh(player: PlayerRecord, record: CrewLinkRecord, link: string): void {
    const view = this.crewView(player);
    this.lastCrew.set(player.id, JSON.stringify(view));
    this.sendTo(player, SHOWDOWN_MSG.crew, {
      ...view,
      fresh: { id: record.id, role: record.role, name: record.name, link },
    } satisfies ShowdownCrewPrivate);
  }

  private crewView(player: PlayerRecord): ShowdownCrewPrivate {
    const perms = this.permsOf(player);
    return {
      event: Boolean(this.event),
      roles: this.rolesOf(player),
      perms,
      links: perms.includes('crew.issue')
        ? this.crew.view(
            (id) => this.nameOf(id),
            (id) => Boolean(this.getPlayer(id)?.client),
          )
        : [],
      // Moderation needs to tell a hidden guest from a crew member (both are off the stage grid).
      ...(perms.includes('people.hide') || perms.includes('people.rename')
        ? { hidden: [...this.hidden], crewIds: [...this.players.values()].filter((p) => this.isCrew(p)).map((p) => p.id) }
        : {}),
      ...(perms.includes('picker.manage') ? { picker: this.pickerPrivate() } : {}),
    };
  }

  /** The picker's people for the presenter and crew: turns, exclusions, crew, hidden — never Skip me. */
  private pickerPrivate(): ShowdownPickerPrivate {
    const turns: Record<string, number> = {};
    for (const [id, n] of this.turns) if (n > 0 && this.getPlayer(id)) turns[id] = n;
    return {
      turns,
      excluded: [...this.excluded],
      crew: [...this.players.values()].filter((p) => this.isCrew(p) && this.isPickable(p)).map((p) => p.id),
      hidden: [...this.hidden],
    };
  }

  /** Each player's crew view, sent only when it changed (null once they hold nothing). */
  private refreshCrew(player: PlayerRecord): void {
    if (!player.client) return;
    const view = this.crewView(player);
    const empty = view.perms.length === 0 && view.roles.length === 0;
    const json = empty ? 'null' : JSON.stringify(view);
    const last = this.lastCrew.get(player.id);
    if (last === json || (empty && last === undefined)) return;
    this.lastCrew.set(player.id, json);
    this.sendTo(player, SHOWDOWN_MSG.crew, empty ? null : view);
  }

  private refreshCrewAll(): void {
    for (const p of this.players.values()) {
      this.refreshCrew(p);
      this.refreshScores(p);
    }
  }

  // ===========================================================================
  // The picker (PCK-01…05): the server draws, screens replay
  // ===========================================================================

  /** A participant: a guest who could ever be drawn (never the presenter, crew, a big screen or a spectator). */
  private isParticipant(player: PlayerRecord): boolean {
    return this.isPickable(player) && !this.isCrew(player);
  }

  /** Could take the hot seat at all — by name, or at random — guests and crew alike (never the presenter, a screen or a spectator). */
  private isPickable(player: PlayerRecord): boolean {
    return !player.state.spectator && player.id !== this.presenterId && !this.state.screens.get(player.id);
  }

  private pickRules(): PickRules {
    const settings = this.getSettings();
    return { mode: settings.pickMode, crewDraw: settings.crewDraw, lastPicked: this.lastPicked };
  }

  private seatOf(player: PlayerRecord, rerolled = ''): PickSeat {
    return {
      id: player.id,
      participant: this.isParticipant(player),
      crew: this.isPickable(player) && this.isCrew(player),
      // Presence is the server's own connection state, never a client claim.
      connected: Boolean(player.client) && !player.away,
      hidden: this.hidden.has(player.id),
      skip: this.skips.has(player.id),
      excluded: this.excluded.has(player.id),
      turns: this.turns.get(player.id) ?? 0,
      hot: this.state.hotSeat === player.id,
      rerolled: player.id === rerolled,
    };
  }

  private pool(rerolled = ''): string[] {
    return pickPool(
      this.seatedPlayers().map((p) => this.seatOf(p, rerolled)),
      this.pickRules(),
    );
  }

  /**
   * The stage grid and the public pool size, kept in step. The grid holds the guests who aren't
   * hidden, crew too while they're in the random draw, and whoever is in the hot seat (a crew member
   * chosen by name gets a seat for the spotlight to land on).
   */
  private refreshPicker(): void {
    const settings = this.getSettings();
    const showcase = settings.mode === 'showcase';
    const want = new Set<string>();
    if (showcase) {
      for (const p of this.seatedPlayers()) {
        if (this.hidden.has(p.id) || !this.isPickable(p)) continue;
        if (this.isParticipant(p) || settings.crewDraw || p.id === this.state.hotSeat) want.add(p.id);
      }
    }
    for (const id of [...this.state.seats.keys()]) if (!want.has(id)) this.state.seats.delete(id);
    for (const id of want) if (!this.state.seats.get(id)) this.state.seats.set(id, true);
    const size = showcase ? this.pool().length : 0;
    if (this.state.poolSize !== size) this.state.poolSize = size;
  }

  /** A fresh round: nobody done this round, nobody in the hot seat (turns last the whole show). */
  private resetPicker(): void {
    this.state.done.clear();
    this.state.hotSeat = '';
    this.state.pickAt = 0;
    this.state.landAt = 0;
    this.refreshPicker();
    this.refreshMeAll();
    this.refreshCrewAll();
  }

  private pickAct(player: PlayerRecord, payload: ShowdownPickPayload): void {
    const type = SHOWDOWN_MSG.pick;
    switch (payload.a) {
      case 'exclude':
      case 'include':
      case 'includeAll':
        return this.manageDraw(player, payload);
    }
    const show = this.show;
    if (!show || this.phase !== 'PLAYING') return;
    if (show.mode !== 'showcase') return this.reject(player, type, 'not_allowed', 'The picker is part of Presenter Showcase.');
    if (payload.a === 'choose') {
      if (!this.can(player, 'picker.choose'))
        return this.reject(player, type, 'not_allowed', 'Only the presenter or the producer can spotlight a name.');
    } else if (!this.can(player, payload.a === 'reroll' ? 'picker.reroll' : 'picker.run')) {
      return this.reject(player, type, 'not_allowed', 'Only the presenter runs the picker.');
    }
    // Made against another draw (a double press, a console that hadn't caught up): ignore quietly.
    if (payload.drawNo !== this.state.drawNo) return;
    switch (payload.a) {
      case 'pick':
      case 'choose': {
        if (payload.round !== show.round) return;
        if (show.stage === 'intro' || show.round < 0) return this.reject(player, type, 'wrong_phase', 'Start round 1 first.');
        if (this.state.hotSeat) {
          return this.reject(player, type, 'not_allowed', `Mark ${this.nameOf(this.state.hotSeat)} done (or No answer) first.`);
        }
        if (payload.a === 'pick') return this.draw(player, '', null);
        const target = this.getPlayer(payload.playerId);
        if (!target || !this.isPickable(target))
          return this.reject(
            player,
            type,
            'not_allowed',
            'Choose someone in the audience or the crew — not the presenter or a big screen.',
          );
        if (this.hidden.has(target.id))
          return this.reject(player, type, 'not_allowed', `${target.state.name} is hidden — show them again first (Names).`);
        if (!target.client || target.away)
          return this.reject(player, type, 'not_allowed', `${target.state.name} isn’t connected right now.`);
        return this.draw(player, '', null, target);
      }
      case 'done':
      case 'noAnswer':
        if (!this.state.hotSeat) return;
        return this.endTurn(player, payload.a);
      case 'reroll': {
        if (!this.state.hotSeat) return;
        const back = this.state.hotSeat;
        this.endTurn(player, 'reroll', payload.reason);
        return this.draw(player, back, payload.reason);
      }
    }
  }

  /** Include / exclude people from random draws (any phase; by name they can still be chosen). Audited. */
  private manageDraw(player: PlayerRecord, payload: Extract<ShowdownPickPayload, { a: 'exclude' | 'include' | 'includeAll' }>): void {
    const type = SHOWDOWN_MSG.pick;
    if (!this.can(player, 'picker.manage'))
      return this.reject(player, type, 'not_allowed', 'Only the presenter and the crew can include or exclude people.');
    if (payload.a === 'includeAll') {
      if (this.excluded.size === 0) return;
      const before = `${this.excluded.size} excluded`;
      const back = [...this.excluded];
      this.excluded.clear();
      this.log({ ...this.actor(player), action: 'picker.include', targetName: 'Everyone', before, after: 'everyone in the draw' });
      return this.afterManage(back);
    }
    const target = this.getPlayer(payload.playerId);
    if (!target || !this.isPickable(target))
      return this.reject(player, type, 'not_allowed', 'Only people in the audience or the crew are in the draw.');
    const out = payload.a === 'exclude';
    if (this.excluded.has(target.id) === out) return;
    if (out) this.excluded.add(target.id);
    else this.excluded.delete(target.id);
    this.log({
      ...this.actor(player),
      action: out ? 'picker.exclude' : 'picker.include',
      target: target.id,
      targetName: target.state.name,
      after: out ? 'out of the random draw' : 'back in the random draw',
    });
    this.afterManage([target.id]);
  }

  private afterManage(ids: readonly string[]): void {
    this.refreshPicker();
    const pool = new Set(this.pool());
    for (const id of ids) {
      const p = this.getPlayer(id);
      if (p) this.refreshMe(p, pool);
    }
    // Who else is in the pool can change too (Fair mode's lowest turn count moves).
    this.refreshMeAll();
    this.refreshCrewAll();
    this.markSnapshot();
  }

  /**
   * One draw with the crypto RNG from the pool as it is right now — or, with `chosen`, Spotlight a
   * name (no draw: the presenter or the producer picked them). Every screen replays the result.
   */
  private draw(player: PlayerRecord, rerolled: string, reroll: ShowdownRerollReason | null, chosen?: PlayerRecord): void {
    const show = this.show;
    if (!show) return;
    const pool = this.pool(rerolled);
    const winnerId = chosen ? chosen.id : drawPick(pool, this.rng);
    const winner = winnerId ? this.getPlayer(winnerId) : undefined;
    if (!winner) {
      this.refreshPicker();
      return this.reject(
        player,
        SHOWDOWN_MSG.pick,
        'not_allowed',
        'Nobody is in the draw right now — include people, or spotlight a name.',
      );
    }
    const now = Date.now();
    this.state.drawNo++;
    this.state.hotSeat = winner.id;
    this.state.pickAt = now;
    this.state.landAt = now + SHOWDOWN_PICK_LAND_MS;
    this.lastPicked = winner.id;
    // The chosen person gets a seat on the stage grid (crew), then the pool is what's left.
    this.refreshPicker();
    this.log({
      ...this.actor(player),
      action: chosen ? 'picker.choose' : reroll ? 'picker.reroll' : 'picker.draw',
      target: winner.id,
      targetName: winner.state.name,
      before: chosen ? turnWords(this.turns.get(winner.id) ?? 0) : `${pool.length} in the pool`,
      after: `draw ${this.state.drawNo}`,
      ...(reroll ? { reason: SHOWDOWN_REROLL_INFO[reroll] } : {}),
    });
    const event: ShowdownEvent = {
      type: 'pick',
      rev: show.rev,
      drawNo: this.state.drawNo,
      winnerId: winner.id,
      name: winner.state.name,
      poolSize: this.state.poolSize,
      landAt: this.state.landAt,
      reroll: reroll !== null,
      ...(chosen ? { chosen: true } : {}),
    };
    this.broadcast(SHOWDOWN_MSG.event, event);
    this.refreshMeAll();
    this.markSnapshot();
  }

  /** The hot seat empties: their turn counted (done), or it didn't (no answer, reroll, cleared). */
  private endTurn(player: PlayerRecord | null, how: 'done' | 'noAnswer' | 'reroll' | 'cleared', reason?: ShowdownRerollReason): void {
    const id = this.state.hotSeat;
    if (!id) return;
    this.state.hotSeat = '';
    this.state.pickAt = 0;
    this.state.landAt = 0;
    if (how === 'done') {
      this.state.done.set(id, true);
      this.turns.set(id, (this.turns.get(id) ?? 0) + 1);
      // A finished turn: a Brave ribbon if nothing gets credited to this draw.
      if (this.show) this.doneTurns.push({ draw: this.state.drawNo, id, name: this.nameOf(id), round: this.show.round });
    }
    if (player && (how === 'done' || how === 'noAnswer')) {
      this.log({
        ...this.actor(player),
        action: how === 'done' ? 'picker.done' : 'picker.noAnswer',
        target: id,
        targetName: this.nameOf(id),
        after: `draw ${this.state.drawNo}`,
      });
    }
    void reason;
    if (this.show) {
      this.broadcast(SHOWDOWN_MSG.event, {
        type: 'pickEnd',
        rev: this.show.rev,
        drawNo: this.state.drawNo,
        playerId: id,
        how,
      } satisfies ShowdownEvent);
    }
    if (how === 'done') this.recomputeScores();
    this.refreshPicker();
    this.refreshMeAll();
    this.refreshCrewAll();
    this.markSnapshot();
  }

  /** PCK-03 C: your own Skip me switch (private: only you and the server know). Random draws only. */
  private setSkip(player: PlayerRecord, on: boolean): void {
    if (!this.isPickable(player))
      return this.reject(player, SHOWDOWN_MSG.skip, 'not_allowed', 'Only people in the audience or the crew can be picked.');
    if (on) this.skips.add(player.id);
    else this.skips.delete(player.id);
    this.refreshPicker();
    this.refreshMe(player);
    this.markSnapshot();
  }

  // ===========================================================================
  // Two-tier scoring (Presenter Showcase): crowd points and hot-seat medals, never accumulated
  // ===========================================================================

  /** Scoring shows at all: Score the crowd, or medals that aren't Never. */
  private scoringOn(): boolean {
    const s = this.getSettings();
    return s.mode === 'showcase' && (s.points || s.medals !== 'never');
  }

  /**
   * Recompute every score from the board, the guess book, the credits and the finished turns (an
   * Undo, a restart or a restore is exact; a repeated message can't score twice), then publish the
   * scoreboard — built only from revealed answers, without hidden people.
   */
  private recomputeScores(): void {
    const show = this.show;
    const settings = this.getSettings();
    if (!show || show.mode !== 'showcase' || !this.scoringOn()) {
      this.scores = null;
      if (this.state.scoreJson) this.state.scoreJson = '';
      for (const p of this.players.values()) this.refreshScores(p);
      return;
    }
    this.scores = scoreShow({
      rounds: show.rounds,
      revealed: (r) => revealedIn(show, r),
      late: (r) => lateIn(show, r),
      guesses: (r) => (settings.points ? this.guesses.round(r) : NO_GUESSES),
      credits: this.credits,
      turns: this.doneTurns,
      gems: settings.gems,
      nameOf: (id) => this.nameOf(id),
    });
    const board: ShowdownScoreboard = {
      points: settings.points,
      medals: settings.medals,
      top: settings.points
        ? this.scores.people
            .filter((p) => p.points > 0 && !this.hidden.has(p.playerId))
            .slice(0, TOP_SHOWN)
            .map(({ playerId, name, points, rank }) => ({ playerId, name, points, rank }))
        : [],
      of: this.scores.of,
      stars: settings.medals !== 'never' ? this.scores.stars.filter((x) => !this.hidden.has(x.playerId)).slice(0, STARS_SHOWN) : [],
    };
    const json = JSON.stringify(board);
    if (this.state.scoreJson !== json) this.state.scoreJson = json;
    for (const p of this.players.values()) this.refreshScores(p);
  }

  /** The full live list for the presenter and `scores.export` crew (sent only when it changed). */
  private refreshScores(player: PlayerRecord): void {
    if (!player.client) return;
    const scores = this.scores;
    const view: ShowdownScoresView | null =
      scores && this.can(player, 'scores.export')
        ? {
            people: scores.people,
            stars: scores.stars,
            credits: scores.finds.map(({ round, slot, name, medal }) => ({ round, slot, name, medal })),
          }
        : null;
    const json = view ? JSON.stringify(view) : 'null';
    const last = this.lastScores.get(player.id);
    if (last === json || (json === 'null' && last === undefined)) return;
    this.lastScores.set(player.id, json);
    this.sendTo(player, SHOWDOWN_MSG.scores, view);
  }

  private refreshScoresAll(): void {
    for (const p of this.players.values()) this.refreshScores(p);
  }

  /** The whole score record for a download: never an unrevealed answer (a mid-show export can't leak the board). */
  private exportScores(player: PlayerRecord): void {
    const type = SHOWDOWN_MSG.scoresExport;
    if (!this.can(player, 'scores.export'))
      return this.reject(player, type, 'not_allowed', 'Only the presenter or the producer can download the scores.');
    const show = this.show;
    const scores = this.scores;
    if (!show || !scores)
      return this.reject(
        player,
        type,
        'not_allowed',
        'There are no scores yet — Score the crowd or medals are off, or the show hasn’t started.',
      );
    const settings = this.getSettings();
    const finds = new Map(scores.finds.map((f) => [`${f.round}:${f.slot}`, f]));
    const rounds: ShowdownScoresFile['rounds'] = [];
    for (let r = 0; r < show.rounds.length && r <= Math.max(show.round, 0); r++) {
      const def = show.rounds[r]!;
      const revealed = revealedIn(show, r);
      const late = lateIn(show, r);
      const callers = this.guesses.matchesPerSlot(r, def.answers.length);
      const answers: ShowdownScoresFile['rounds'][number]['answers'] = [];
      def.answers.forEach((a, i) => {
        if (revealed[i] !== true) return;
        const gem = settings.gems && late[i] === true;
        const find = finds.get(`${r}:${i}`);
        answers.push({
          pos: i,
          text: a.text,
          value: answerValue(i, gem),
          late: late[i] === true,
          callers: callers[i] ?? 0,
          foundBy: find?.name ?? '',
          medal: find?.medal ?? '',
        });
      });
      rounds.push({ index: r, title: def.title ?? '', answers });
    }
    this.sendTo(player, type, {
      room: this.roomId,
      title: this.getSettings().title || 'DAS Survey Showdown',
      exportedAt: Date.now(),
      settings: { points: settings.points, medals: settings.medals, gems: settings.gems, guesses: settings.guesses },
      rounds,
      people: scores.people,
      stars: scores.stars,
    } satisfies ShowdownScoresFile);
    if (this.event) this.log({ ...this.actor(player), action: 'scores.export', after: `${scores.people.length} people` });
  }

  /** A wrong hot-seat credit (a chat answer flipped mid-turn): off the tile, and its medal with it. Audited. */
  private removeCredit(player: PlayerRecord, round: number, slot: number): void {
    if (!this.can(player, 'scores.fix'))
      return this.reject(player, SHOWDOWN_MSG.credit, 'not_allowed', 'Only the presenter or the producer can change a credit.');
    const show = this.show;
    const key = `${round}:${slot}`;
    const credit = this.credits.get(key);
    if (!show || !credit) return;
    this.credits.delete(key);
    this.log({
      ...this.actor(player),
      action: 'credit.remove',
      target: credit.id,
      targetName: credit.name,
      before: `#${slot + 1} in round ${round + 1}`,
    });
    this.state.boardJson = this.boardJson(show);
    this.recomputeScores();
    this.refreshMeAll();
    this.markSnapshot();
  }

  /** The paced finale: the presenter moves it on (or back); each step plays its cue once on every screen. */
  private finaleStep(player: PlayerRecord, step: number): void {
    if (!this.isPresenter(player)) return this.reject(player, SHOWDOWN_MSG.finale, 'not_host', 'Only the presenter runs the finale.');
    let finale: ShowdownFinale | null;
    try {
      finale = this.state.finaleJson ? (JSON.parse(this.state.finaleJson) as ShowdownFinale) : null;
    } catch {
      finale = null;
    }
    const steps = finaleSteps(finale);
    if (step >= steps.length || step === this.state.finaleStep) return;
    this.state.finaleStep = step;
    this.broadcast(SHOWDOWN_MSG.event, { type: 'finale', rev: this.show?.rev ?? 0, step, kind: steps[step]! } satisfies ShowdownEvent);
    this.markSnapshot();
  }

  // ===========================================================================
  // Clock cues (AUD-01): the 1:00 warning and the last ten seconds
  // ===========================================================================

  private clockCues(now: number): void {
    const show = this.show;
    if (!show || show.mode !== 'showcase' || this.phase !== 'PLAYING' || this.state.clockEndsAt <= 0) return;
    const left = this.state.clockEndsAt - now;
    if (left <= 0) return;
    if (!this.clockWarned && left <= 60_000 && this.state.clockMax > 60_000) {
      this.clockWarned = true;
      this.broadcast(SHOWDOWN_MSG.event, { type: 'clockWarn', rev: show.rev, round: show.round } satisfies ShowdownEvent);
    }
    const n = Math.ceil(left / 1000);
    if (n >= 1 && n <= 10 && n < this.lastTick) {
      this.lastTick = n;
      this.broadcast(SHOWDOWN_MSG.event, { type: 'tick', rev: show.rev, round: show.round, n } satisfies ShowdownEvent);
    }
  }

  // ===========================================================================
  // Event-room upkeep: sound station failover, keep-alive, audit pushes, the black box
  // ===========================================================================

  private eventTick(now: number): void {
    // AUD-02: a big-screen station that stopped answering hands the sound back to the console.
    const station = this.state.soundStation;
    if (station) {
      const beat = this.beats.get(station);
      const last = Math.max(beat?.at ?? 0, this.stationSince);
      const holder = this.getPlayer(station);
      if (!holder?.client || !this.state.screens.get(station) || now - last > SHOWDOWN_STATION_TIMEOUT_MS) this.stationFailover();
    }
    // Keep-alive's safety net: a live event room nobody is connected to closes after a while.
    if (!this.autoDispose) {
      if (this.clients.length > 0) this.emptySince = 0;
      else if (!this.emptySince) this.emptySince = now;
      else if (now - this.emptySince > EVENT_EMPTY_MS) this.autoDispose = true;
    }
    if (this.audit.dirty) {
      this.audit.dirty = false;
      const view = this.auditView();
      this.sendWhere((p) => this.can(p, 'audit.read'), SHOWDOWN_MSG.audit, view);
    }
    const clockFresh = this.state.clockEndsAt > 0 && now - this.lastSnapshotAt > SNAPSHOT_CLOCK_MS;
    if ((this.snapshotDirty || clockFresh) && now - this.lastSnapshotAt >= SNAPSHOT_GAP_MS) this.sendBlackBox();
  }

  private audioBeat(player: PlayerRecord, payload: { ready: boolean; muted: boolean; sounds: boolean }): void {
    if (!this.event) return;
    // Only consoles and big screens can ever play the show's sound.
    if (!this.isPresenter(player) && !this.state.screens.get(player.id)) return;
    const now = Date.now();
    const ready = payload.ready && !payload.muted && payload.sounds;
    this.beats.set(player.id, { at: now, ready });
    const code = ready ? SHOWDOWN_AUDIO_READY : SHOWDOWN_AUDIO_SILENT;
    if (this.state.audio.get(player.id) !== code) this.state.audio.set(player.id, code);
    const holder = this.state.soundStation || this.presenterId;
    if (holder === player.id) this.state.soundSeenAt = now;
  }

  /** AUD-02: crew move the sound station to a connected big screen, or back to the console (''). */
  private setStation(player: PlayerRecord, playerId: string): void {
    const type = SHOWDOWN_MSG.station;
    if (!this.event) return this.reject(player, type, 'not_allowed', 'The sound station is for event rooms.');
    if (!this.can(player, 'audio.station')) return this.reject(player, type, 'not_allowed', 'Only the crew can move the sound station.');
    if (playerId) {
      const target = this.getPlayer(playerId);
      if (!target?.client || !this.state.screens.get(playerId)) {
        return this.reject(player, type, 'not_allowed', 'Only a connected big screen (or the console) can play the show’s sound.');
      }
    }
    if (this.state.soundStation === playerId) return;
    const before = this.state.soundStation ? this.nameOf(this.state.soundStation) : 'Presenter console';
    this.state.soundStation = playerId;
    this.stationSince = Date.now();
    this.state.soundSeenAt = this.beats.get(playerId || this.presenterId)?.at ?? 0;
    this.log({
      ...this.actor(player),
      action: 'audio.station',
      target: playerId,
      before,
      after: playerId ? this.nameOf(playerId) : 'Presenter console',
    });
    if (this.show)
      this.broadcast(SHOWDOWN_MSG.event, { type: 'station', rev: this.show.rev, playerId, lost: false } satisfies ShowdownEvent);
  }

  /** The station dropped (or stopped answering): the presenter's console plays the sound again. */
  private stationFailover(): void {
    const lost = this.state.soundStation;
    if (!lost) return;
    this.state.soundStation = '';
    this.stationSince = Date.now();
    this.state.soundSeenAt = this.beats.get(this.presenterId)?.at ?? 0;
    this.log({
      actorId: '',
      actorName: 'Server',
      role: 'server',
      action: 'audio.failover',
      target: lost,
      before: this.nameOf(lost),
      after: 'Presenter console',
      reason: 'The sound station stopped answering',
    });
    this.broadcast(SHOWDOWN_MSG.event, { type: 'station', rev: this.show?.rev ?? 0, playerId: '', lost: true } satisfies ShowdownEvent);
  }

  /** OPS-03 B: the server's facts for the go/no-go list (crew only; /api/health stays as it is). */
  private preflight(player: PlayerRecord): void {
    if (!this.can(player, 'preflight.read'))
      return this.reject(player, SHOWDOWN_MSG.preflight, 'not_allowed', 'Only the crew can run the preflight.');
    const now = Date.now();
    const backups = this.crew.all().filter((l) => l.role === 'backup' && !l.revoked && now <= l.expiresAt);
    const holderId = this.state.soundStation || this.presenterId;
    const beat = holderId ? this.beats.get(holderId) : undefined;
    const data: ShowdownPreflightData = {
      at: now,
      uptimeSeconds: Math.round((now - processStartedAt) / 1000),
      startedAt: processStartedAt,
      commit: runningCommit(),
      event: this.event,
      rehearsal: this.state.rehearsal,
      rounds: this.custom.rounds.length,
      specials: this.custom.rounds.filter((r) => r.special !== undefined && r.special >= 0).length,
      backups: { issued: backups.length, online: backups.filter((l) => l.holderId && this.getPlayer(l.holderId)?.client).length },
      station: {
        playerId: this.state.soundStation,
        name: holderId ? this.nameOf(holderId) : '',
        ready: Boolean(beat?.ready),
        seenAgoMs: beat ? now - beat.at : null,
      },
      blackbox: blackBoxEnabled(),
    };
    this.sendTo(player, SHOWDOWN_MSG.preflight, data);
  }

  private auditView(): ShowdownAuditView {
    return { entries: this.audit.latest(AUDIT_VIEW), total: this.audit.total };
  }

  private exportAudit(player: PlayerRecord): void {
    if (!this.can(player, 'audit.export'))
      return this.reject(player, SHOWDOWN_MSG.auditExport, 'not_allowed', 'Only the producer can download the log.');
    this.sendTo(player, SHOWDOWN_MSG.auditExport, {
      room: this.roomId,
      exportedAt: Date.now(),
      entries: this.audit.all(),
    } satisfies ShowdownAuditFile);
  }

  // ===========================================================================
  // The black box (OPS-01 C): sealed snapshots the presenter's console carries, and the restore
  // ===========================================================================

  private markSnapshot(): void {
    if (this.event) this.snapshotDirty = true;
  }

  /** Seal the room as it is now and hand it to the presenter's console (event rooms only). */
  private sendBlackBox(): void {
    this.snapshotDirty = false;
    this.lastSnapshotAt = Date.now();
    const presenter = this.presenterId ? this.getPlayer(this.presenterId) : undefined;
    // A closed room has nothing to restore (closeRoom already told the console to forget it).
    if (!this.event || !presenter?.client || this.phase === 'ENDED') return;
    let blob: string | null = null;
    for (const keep of [SNAPSHOT_AUDIT, 60, 0]) {
      blob = sealBlackBox(this.snapshot(keep));
      if (!blob || blob.length <= SNAPSHOT_MAX_CHARS) break;
      blob = null;
    }
    if (!blob) {
      if (blackBoxEnabled()) log.warn('showdown black box too large to send', { room: this.roomId });
      return;
    }
    const box: ShowdownBlackBox = { code: this.roomId, takenAt: this.lastSnapshotAt, blob };
    this.sendTo(presenter, SHOWDOWN_MSG.blackbox, box);
  }

  private snapshot(auditKeep: number): ShowdownSnapshot {
    const now = Date.now();
    const phase = this.phase === 'PLAYING' || this.phase === 'RESULTS' ? this.phase : 'LOBBY';
    return {
      v: 1,
      takenAt: now,
      code: this.roomId,
      event: this.event as ShowdownEventId,
      settings: this.getSettings(),
      custom: this.custom,
      rehearsal: this.state.rehearsal,
      seen: [...this.seen],
      phase,
      show: phase === 'LOBBY' ? null : this.show,
      finaleJson: this.state.finaleJson,
      presenterId: this.presenterId,
      passHash: sha256(this.presenterPass),
      seats: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.state.name,
        avatar: p.state.avatar,
        color: p.state.color,
        joinOrder: p.state.joinOrder,
        spectator: p.state.spectator,
        ...(p.guestId ? { guestId: p.guestId } : {}),
        seatTokenHash: this.seatTokenHash(p),
      })),
      screens: [...this.state.screens.keys()],
      teams: [...this.state.teams.entries()].map(([id, team]) => [id, team] as [string, number]),
      locked: this.state.locked,
      roomName: this.state.roomName,
      startedAt: this.matchStartedAt,
      playedFor: [...this.playedFor],
      playedNames: [...this.playedNames],
      crew: this.crew.export(),
      audit: this.audit.export(auditKeep),
      picker: {
        drawNo: this.state.drawNo,
        hotSeat: this.state.hotSeat,
        pickAt: this.state.pickAt,
        landAt: this.state.landAt,
        done: [...this.state.done.keys()],
        skips: [...this.skips],
        hidden: [...this.hidden],
        credits: [...this.credits],
        turns: [...this.turns],
        excluded: [...this.excluded],
        lastPicked: this.lastPicked,
      },
      scoring: { guesses: this.guesses.export(), doneTurns: this.doneTurns, finaleStep: this.state.finaleStep },
      station: this.state.soundStation,
      clock: {
        left: Math.round(this.clockLeftNow()),
        max: this.state.clockMax,
        show: this.state.clockShow,
        timeUp: this.timeUp,
        warned: this.clockWarned,
        armed: this.clockArmed,
      },
      card: this.state.card,
      misses: this.misses,
      cueSeq: this.cueSeq,
    };
  }

  /** CreateOptions.restore: open and check the sealed snapshot; its code is the room to recreate. */
  protected override prepareRestore(blob: string, options: CreateOptions): { code: string } | null {
    const snap = openBlackBox<ShowdownSnapshot>(blob);
    if (!snap || !isSnapshot(snap)) return null;
    // Only the presenter it was sealed for can bring it back: their browser's old seat token.
    const presenterSeat = snap.seats.find((seat) => seat.id === snap.presenterId);
    if (!presenterSeat || !options.seatToken || hashSeatToken(options.seatToken) !== presenterSeat.seatTokenHash) return null;
    this.restoring = snap;
    return { code: snap.code };
  }

  /**
   * Rebuild the event room from its snapshot, silently: no events are broadcast (nothing replays on
   * any screen), the clock comes back paused where it was, and every seat waits for its owner's old
   * seat token. The pass is new (the snapshot only had its hash); the presenter's console gets it.
   */
  protected override applyRestore(): void {
    const snap = this.restoring;
    this.restoring = null;
    if (!snap) return;
    // First: nobody joining the restored room may become its presenter by being "first".
    this.presenterAssigned = true;
    this.event = snap.event;
    this.state.event = snap.event;
    this.state.locked = snap.locked;
    if (snap.roomName) this.state.roomName = snap.roomName;
    this.updateSettings(snap.settings);
    this.custom = snap.custom;
    this.state.customRounds = snap.custom.rounds.length;
    this.state.rehearsal = snap.rehearsal;
    for (const id of snap.seen) this.seen.add(id);
    for (const seat of snap.seats) this.restoreSeat(seat);
    for (const id of snap.screens) if (this.getPlayer(id)) this.state.screens.set(id, true);
    for (const [id, team] of snap.teams) if (this.getPlayer(id) && (team === 0 || team === 1)) this.state.teams.set(id, team);
    this.crew.import(snap.crew);
    this.audit.import(snap.audit);
    this.presenterAssigned = true;
    this.presenterPass = randomId(24, this.rng);
    const presenter = snap.presenterId ? this.getPlayer(snap.presenterId) : undefined;
    if (presenter) {
      this.presenterId = presenter.id;
      this.state.presenterId = presenter.id;
      this.assignHost(presenter);
    }
    for (const [id, team] of snap.playedFor) this.playedFor.set(id, team);
    for (const [id, name] of snap.playedNames) this.playedNames.set(id, name);
    for (const id of snap.picker.skips) this.skips.add(id);
    for (const id of snap.picker.hidden) this.hidden.add(id);
    for (const [key, credit] of snap.picker.credits) this.credits.set(key, credit);
    // Older black boxes (before turns and exclusions) restore with everyone level and included.
    for (const [id, n] of snap.picker.turns ?? []) if (this.getPlayer(id) && n > 0) this.turns.set(id, n);
    for (const id of snap.picker.excluded ?? []) if (this.getPlayer(id)) this.excluded.add(id);
    this.lastPicked = snap.picker.lastPicked ?? '';
    this.state.drawNo = snap.picker.drawNo;
    this.state.card = snap.card;
    this.misses = snap.misses;
    this.cueSeq = snap.cueSeq;
    this.state.soundStation = '';
    if (snap.phase !== 'LOBBY' && snap.show) {
      this.show = snap.show;
      this.matchStartedAt = snap.startedAt || Date.now();
      this.setPhase(snap.phase);
      for (const id of snap.picker.done) this.state.done.set(id, true);
      if (snap.phase === 'PLAYING') {
        this.state.hotSeat = this.getPlayer(snap.picker.hotSeat) ? snap.picker.hotSeat : '';
        this.state.pickAt = this.state.hotSeat ? snap.picker.pickAt : 0;
        this.state.landAt = this.state.hotSeat ? snap.picker.landAt : 0;
        // The clock comes back paused where it was: the presenter carries on with P.
        this.state.clockMax = snap.clock.max;
        this.state.clockLeft = snap.clock.left;
        this.state.clockEndsAt = 0;
        this.state.clockShow = snap.clock.show;
        this.timeUp = snap.clock.timeUp;
        this.clockWarned = snap.clock.warned;
        this.clockArmed = snap.clock.armed;
        this.autoDispose = false;
        this.djLockChanged();
      } else this.state.finaleJson = snap.finaleJson;
      // Guesses and scores come back with the show (before this, a restart wiped every score).
      if (snap.scoring) {
        this.guesses.import(snap.scoring.guesses);
        this.doneTurns = snap.scoring.doneTurns.map((t) => ({ ...t }));
        if (snap.phase === 'RESULTS') this.state.finaleStep = Math.max(0, Math.min(8, snap.scoring.finaleStep));
      }
      this.state.boardJson = this.boardJson(this.show);
      this.state.rev = this.show.rev;
      this.state.round = Math.max(0, this.show.round + 1);
    }
    this.log({
      actorId: '',
      actorName: 'Server',
      role: 'server',
      action: 'show.restored',
      reason: 'Restored from the presenter’s black box after a server restart',
    });
    // The presenter's seat waits for them like any absent presenter's: a live show never stalls.
    if (this.phase === 'PLAYING') this.watchPresenter();
    this.refreshPicker();
    this.recomputeScores();
    this.markMetadataDirty();
    // Seats nobody came back for leave quietly once the show isn't live.
    this.schedule('restore-claims', RESTORE_CLAIM_MS, () => {
      if (this.phase === 'PLAYING') return;
      for (const p of [...this.players.values()])
        if (typeof p.data.restoreSeatHash === 'string' && !p.client) this.removePlayer(p, 'disconnected');
    });
    log.info('showdown room restored', { room: this.roomId, phase: snap.phase, seats: snap.seats.length });
  }

  private nameOf(id: string): string {
    return this.getPlayer(id)?.state.name ?? this.playedNames.get(id) ?? 'Former player';
  }
}

function turnWords(n: number): string {
  return `${n} turn${n === 1 ? '' : 's'} so far`;
}

function emptyReactions(): ShowdownReactions {
  return { k: Array.from({ length: SHOWDOWN_REACTION_KINDS }, () => 0), t: [0, 0] };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** What an event room's black box holds (sealed by ./blackbox.ts; only this server can read it). */
interface ShowdownSnapshot {
  v: 1;
  takenAt: number;
  code: string;
  event: ShowdownEventId;
  settings: ShowdownSettings;
  custom: ShowdownContentPrivate;
  rehearsal: boolean;
  seen: string[];
  phase: 'LOBBY' | 'PLAYING' | 'RESULTS';
  show: ShowState | null;
  finaleJson: string;
  presenterId: string;
  /** The presenter pass's hash only (a restore rotates the pass). */
  passHash: string;
  seats: RestoredSeat[];
  screens: string[];
  teams: Array<[string, number]>;
  locked: boolean;
  roomName: string;
  startedAt: number;
  playedFor: Array<[string, TeamSlot]>;
  playedNames: Array<[string, string]>;
  crew: CrewLinkRecord[];
  audit: { seq: number; entries: ShowdownAuditEntry[] };
  picker: {
    drawNo: number;
    hotSeat: string;
    pickAt: number;
    landAt: number;
    done: string[];
    skips: string[];
    hidden: string[];
    credits: Array<[string, { id: string; name: string }]>;
    /** Absent in black boxes sealed before the picker kept turns and exclusions. */
    turns?: Array<[string, number]>;
    excluded?: string[];
    lastPicked?: string;
  };
  /** Two-tier scoring (absent in black boxes sealed before it): the guess book, finished turns, the finale's step. */
  scoring?: { guesses: unknown; doneTurns: ScoreTurn[]; finaleStep: number };
  station: string;
  clock: { left: number; max: number; show: boolean; timeUp: boolean; warned: boolean; armed: boolean };
  card: string;
  misses: number;
  cueSeq: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('base64url');
}

const isArr = Array.isArray;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A sealed snapshot is ours (authenticated), but it may come from an older build: check every field
 * applyRestore reads before touching the room. Bump `v` whenever ShowdownSnapshot or ShowState changes shape.
 */
function isSnapshot(s: ShowdownSnapshot): boolean {
  const raw = s as unknown as Record<string, unknown>;
  if (
    raw.v !== 1 ||
    !isStr(raw.code) ||
    !isValidRoomCode(raw.code) ||
    !(SHOWDOWN_EVENT_IDS as readonly string[]).includes(String(raw.event))
  )
    return false;
  if (!isObj(raw.settings) || !ShowdownSettingsSchema.safeParse(raw.settings).success) return false;
  const custom = raw.custom;
  if (!isObj(custom) || !isArr(custom.rounds) || !isArr(custom.issues)) return false;
  const seatOk = (x: unknown) =>
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.name) &&
    isStr(x.avatar) &&
    isStr(x.color) &&
    isNum(x.joinOrder) &&
    typeof x.spectator === 'boolean' &&
    isStr(x.seatTokenHash);
  if (!isArr(raw.seats) || !raw.seats.every(seatOk)) return false;
  if (!['LOBBY', 'PLAYING', 'RESULTS'].includes(String(raw.phase))) return false;
  if (raw.phase !== 'LOBBY') {
    const show = raw.show;
    if (!isObj(show) || !isArr(show.rounds) || !isNum(show.round) || !isNum(show.rev) || !isStr(show.stage) || !isStr(show.mode))
      return false;
  }
  if (!isStr(raw.finaleJson) || !isStr(raw.presenterId) || !isArr(raw.screens) || !raw.screens.every(isStr)) return false;
  if (!isArr(raw.teams) || !isArr(raw.playedFor) || !isArr(raw.playedNames) || !isArr(raw.crew) || !isArr(raw.seen)) return false;
  if (typeof raw.locked !== 'boolean' || !isStr(raw.roomName) || !isNum(raw.startedAt) || typeof raw.rehearsal !== 'boolean') return false;
  const audit = raw.audit;
  if (!isObj(audit) || !isNum(audit.seq) || !isArr(audit.entries)) return false;
  const picker = raw.picker;
  if (!isObj(picker) || !isNum(picker.drawNo) || !isStr(picker.hotSeat) || !isNum(picker.pickAt) || !isNum(picker.landAt)) return false;
  if (![picker.done, picker.skips, picker.hidden].every((l) => isArr(l) && l.every(isStr)) || !isArr(picker.credits)) return false;
  if (picker.turns !== undefined && !(isArr(picker.turns) && picker.turns.every((t) => isArr(t) && isStr(t[0]) && isNum(t[1]))))
    return false;
  if (picker.excluded !== undefined && !(isArr(picker.excluded) && picker.excluded.every(isStr))) return false;
  if (picker.lastPicked !== undefined && !isStr(picker.lastPicked)) return false;
  const scoring = raw.scoring;
  if (scoring !== undefined) {
    if (!isObj(scoring) || !isArr(scoring.guesses) || !isArr(scoring.doneTurns) || !isNum(scoring.finaleStep)) return false;
    const turnOk = (t: unknown) => isObj(t) && isNum(t.draw) && isStr(t.id) && isStr(t.name) && isNum(t.round);
    if (!scoring.doneTurns.every(turnOk)) return false;
  }
  const clock = raw.clock;
  if (!isObj(clock) || !isNum(clock.left) || !isNum(clock.max) || typeof clock.show !== 'boolean') return false;
  return isStr(raw.card) && isNum(raw.misses) && isNum(raw.cueSeq);
}
