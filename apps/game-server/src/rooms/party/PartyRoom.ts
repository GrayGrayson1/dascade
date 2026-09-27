/**
 * PartyRoom — the DAStravaganza room toolkit. Party games extend it instead of BaseGameRoom:
 *
 *   export class TriviaRoom extends PartyRoom<TriviaState, TriviaSettings> { ... }
 *
 * What it gives you (all server-authoritative, reconnect-safe):
 *  - Stage machine inside PLAYING: runStage(name, ms, onEnd) publishes `stage`, `stageSeq`,
 *    `stageMs` and `phaseEndsAt`; finishStage() is idempotent; endStageSoon() shortens the timer
 *    (e.g. everyone answered); host pause / resume / skip via the kit message `party:host`.
 *  - "Who has answered" status: openAnswers()/openVote() create an AnswerBox/VoteBox, mark the
 *    eligible seats and track `seats[id].answered` + counts. submitAnswer()/submitVote() apply the
 *    kit rules, reply with friendly rejections, flip the public flag (never the content) and end
 *    the stage early once every present eligible player has locked in.
 *  - Private mailbox: sendPrivate(player, type, payload) stores the latest payload per type and
 *    re-sends everything on reconnect / seat-token rejoin (syncPrivate). Spectators never receive
 *    mailbox payloads unless you opt in per message.
 *  - Teams: setupTeams() random balanced split; late joiners join the smallest team; team totals
 *    (sum / average), deltas and ranks published in `teams`.
 *  - Scores: addPoints() accumulates deltas, commitScores() applies them at the reveal and
 *    publishes delta / rank / prevRank (+ `scoreSeq` for the client's animated score reveal).
 *  - finishParty(): podium JSON, endMatch() summary and reportOutcome() placements in one call.
 *
 * Overriding lifecycle hooks: PartyRoom implements onPlayerJoined / onPlayerDisconnected /
 * onPlayerReconnected / onPlayerAway / onPlayerRemoved / onReturnToLobby / syncPrivate.
 * If your game overrides any of them, CALL `super.<hook>(...)` FIRST.
 */
import type { CreateOptions } from '@dascade/shared';
import {
  PARTY_MSG,
  PARTY_REASON_TEXT,
  PartyHostSchema,
  partyTeamsFor,
  type PartyHostAction,
  type PartyPodium,
  type PartyPodiumEntry,
  type PartyPodiumTeam,
  type PartyTeamScoring,
  type PartyVoteReason,
} from '@dascade/shared/party';
import {
  AnswerBox,
  VoteBox,
  assignTeams,
  placementGroups,
  rankStandings,
  smallestTeam,
  teamTotals,
  type AnswerBoxOptions,
  type Standing,
  type VoteBoxOptions,
} from '@dascade/game-core/party';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { PartySeatState, PartyTeamState, type PartyRoomState } from './schema.ts';

const STAGE_TIMER = 'party:stage';
const PAUSE_GUARD = 'party:pause-guard';

/** Anything the room waits on for "everyone answered" (AnswerBox and VoteBox both qualify). */
export interface PartyCollector {
  readonly isOpen: boolean;
  isComplete(present?: Iterable<string>): boolean;
  pending(present?: Iterable<string>): string[];
  /**
   * Optional: a late joiner — or a seated player who was offline when the prompt opened and came
   * back — may act on the open prompt (called when `lateJoinersCanAnswer`). Omit it to keep the
   * eligible list fixed.
   */
  addEligible?(playerId: string): void;
  /** Optional: a player left for good — stop waiting for them. */
  removeEligible?(playerId: string): void;
}

interface MailItem {
  payload: unknown;
  spectators: boolean;
}

export interface StartPartyOptions {
  /** Rounds / questions in this match (published as totalRounds). */
  totalRounds: number;
  /** Team mode: number of teams (2–6) and how team scores combine. Omit for free-for-all. */
  teams?: { count: number; scoring: PartyTeamScoring } | null;
}

export interface FinishPartyOptions {
  /** reportOutcome reason (default 'completed'). */
  reason?: string;
  /** Extra outcome/summary details (small, JSON-safe). */
  details?: Record<string, unknown>;
  /** Extra podium data for the results screen (awards, stats). */
  extras?: Record<string, unknown>;
  /**
   * Explicit finishing order (room player ids grouped by place, best first) for games whose result
   * isn't "highest score wins" — e.g. hidden-team games: `[[...winningTeam], [...losers]]`.
   * Overrides the score/team-derived placements for the podium places, winners, reportOutcome
   * and the match summary. Seated players missing from it are appended as a last group.
   */
  placements?: string[][];
}

export abstract class PartyRoom<S extends PartyRoomState, Settings extends object> extends BaseGameRoom<S, Settings> {
  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------
  /** Grace after the last eligible player locks in before the stage ends (lets the UI breathe). */
  protected allAnsweredDelayMs = 700;
  /** Late joiners may answer the prompt that is currently open. */
  protected lateJoinersCanAnswer = true;
  /** Stages the host may skip with `party:host {action:'skip'}` (null = any timed stage). */
  protected skippableStages: readonly string[] | null = null;
  /** A host pause auto-resumes after this long, so a room never stalls on an absent host. */
  protected maxPauseMs = 180_000;

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------
  private stageDone: (() => void) | null = null;
  private collector: PartyCollector | null = null;
  /**
   * Whether the tracked collector takes newcomers: players who join late, or seated players who
   * were offline when it opened and come back. True for openAnswers()/openVote() without an
   * explicit eligible list and for custom collectors that implement addEligible(); false when the
   * game passed an explicit list (e.g. only a prompt's authors).
   */
  private collectorAdmitsNewcomers = false;
  private readonly mailbox = new Map<string, Map<string, MailItem>>();
  private readonly pendingDeltas = new Map<string, number>();
  protected teamIds: string[] = [];
  protected readonly teamOfPlayer = new Map<string, string>();

  // ===========================================================================
  // Setup
  // ===========================================================================

  /**
   * Registers the kit's host-control message. BaseGameRoom calls onRoomCreated() once; if your
   * room overrides it, call `super.onRoomCreated(options)`.
   */
  protected override onRoomCreated(_options: CreateOptions): void {
    this.handle(PARTY_MSG.host, PartyHostSchema, (p, { action, stageSeq }) => this.hostControl(p, action, stageSeq), {
      hostOnly: true,
      phases: ['PLAYING'],
      rate: { burst: 4, perSecond: 2 },
    });
  }

  /** Call at the start of onGameStart(): resets seats, scores, podium and (optionally) teams. */
  protected startParty(opts: StartPartyOptions): void {
    this.cancelStage();
    this.untrack();
    this.mailbox.clear();
    this.pendingDeltas.clear();
    const s = this.state;
    s.totalRounds = Math.max(0, Math.round(opts.totalRounds));
    s.round = 0;
    s.podiumJson = '';
    s.scoreSeq = 0;
    s.seats.clear();
    for (const p of this.seatedPlayers()) this.seat(p.id);
    this.clearTeams();
    if (opts.teams) this.setupTeams(opts.teams.count, opts.teams.scoring);
    this.recomputeRanks(false);
  }

  // ===========================================================================
  // Stage machine
  // ===========================================================================

  protected get stage(): string {
    return this.state.stage;
  }

  /**
   * Enter a stage. `ms` > 0 publishes a deadline and calls `onEnd` when it passes (or when the host
   * skips / everyone answers). `ms` = 0 → untimed (call finishStage() or runStage() yourself).
   */
  protected runStage(stage: string, ms: number, onEnd?: () => void): void {
    this.cancel(STAGE_TIMER);
    const s = this.state;
    s.stage = stage;
    s.stageSeq = (s.stageSeq + 1) >>> 0;
    s.paused = false;
    s.pausedMs = 0;
    this.cancel(PAUSE_GUARD);
    const dur = Math.max(0, Math.round(ms));
    s.stageMs = dur;
    this.setTimer(dur);
    this.stageDone = onEnd ?? null;
    if (dur > 0 && onEnd) this.schedule(STAGE_TIMER, dur, () => this.finishStage());
  }

  /** Runs the current stage's onEnd now (once). Safe to call repeatedly. */
  protected finishStage(): void {
    const fn = this.stageDone;
    this.stageDone = null;
    this.cancel(STAGE_TIMER);
    if (fn) fn();
  }

  /** Whether the current stage is still waiting on its onEnd. */
  protected get stagePending(): boolean {
    return this.stageDone !== null;
  }

  /** Shorten the running stage so it ends in `ms` (never lengthens it). */
  protected endStageSoon(ms = this.allAnsweredDelayMs): void {
    if (!this.stageDone || this.state.paused) return;
    const endsAt = Date.now() + Math.max(0, ms);
    if (this.state.phaseEndsAt > 0 && this.state.phaseEndsAt <= endsAt) return;
    this.state.phaseEndsAt = endsAt;
    this.schedule(STAGE_TIMER, Math.max(0, ms), () => this.finishStage());
  }

  /** Cancel the stage timer without running onEnd (e.g. returning to the lobby). */
  protected cancelStage(): void {
    this.stageDone = null;
    this.cancel(STAGE_TIMER);
    this.cancel(PAUSE_GUARD);
    this.state.paused = false;
    this.state.pausedMs = 0;
  }

  protected pauseStage(): boolean {
    const s = this.state;
    if (s.paused || !this.stageDone || s.phaseEndsAt <= 0) return false;
    s.pausedMs = Math.max(0, Math.round(s.phaseEndsAt - Date.now()));
    s.paused = true;
    s.phaseEndsAt = 0;
    this.cancel(STAGE_TIMER);
    this.schedule(PAUSE_GUARD, this.maxPauseMs, () => {
      if (this.resumeStage()) this.systemChat('The pause timed out — the game continues.');
    });
    return true;
  }

  protected resumeStage(): boolean {
    const s = this.state;
    if (!s.paused) return false;
    this.cancel(PAUSE_GUARD);
    const left = Math.max(300, s.pausedMs);
    s.paused = false;
    s.pausedMs = 0;
    this.setTimer(left);
    if (this.stageDone) this.schedule(STAGE_TIMER, left, () => this.finishStage());
    return true;
  }

  /** Host skip hook: default finishes the stage. Override to refuse or customise. */
  protected onHostSkip(): void {
    if (this.state.paused) this.resumeStage();
    this.finishStage();
  }

  private hostControl(player: PlayerRecord, action: PartyHostAction, stageSeq?: number): void {
    const label = player.state.name;
    if (action === 'pause') {
      if (this.pauseStage()) this.systemChat(`${label} paused the game.`);
      return;
    }
    if (action === 'resume') {
      if (this.resumeStage()) this.systemChat(`${label} resumed the game.`);
      return;
    }
    // A skip aimed at a stage that already ended (double tap, resent message) is ignored — it must
    // never skip the stage that followed (e.g. the answer reveal).
    if (stageSeq !== undefined && stageSeq !== this.state.stageSeq) return;
    if (!this.stageDone) return this.reject(player, PARTY_MSG.host, 'wrong_phase', 'Nothing to skip right now.');
    if (this.skippableStages && !this.skippableStages.includes(this.stage)) {
      return this.reject(player, PARTY_MSG.host, 'not_allowed', 'This part can’t be skipped.');
    }
    this.onHostSkip();
  }

  // ===========================================================================
  // Answer / vote collection + public "who has answered"
  // ===========================================================================

  /** Connected, seated, non-away players (who we actually wait for). */
  protected presentIds(): string[] {
    return this.activePlayers()
      .filter((p) => !p.away)
      .map((p) => p.id);
  }

  /** Get (or create) a player's public seat. */
  protected seat(id: string): PartySeatState {
    let seat = this.state.seats.get(id);
    if (!seat) {
      seat = new PartySeatState();
      seat.teamId = this.teamOfPlayer.get(id) ?? '';
      this.state.seats.set(id, seat);
    }
    return seat;
  }

  /**
   * Open a new answer box for the current prompt. Eligible = present seated players unless given.
   * Resets every seat's `answered`/`eligible` flags.
   */
  protected openAnswers<T>(opts: Omit<AnswerBoxOptions, 'eligible'> & { eligible?: readonly string[] } = {}): AnswerBox<T> {
    const eligible = opts.eligible ?? this.presentIds();
    const box = new AnswerBox<T>({ ...opts, eligible });
    this.track(box, eligible);
    this.collectorAdmitsNewcomers = opts.eligible === undefined;
    return box;
  }

  /** Open a private-until-reveal vote. Voters = present seated players unless given. */
  protected openVote(opts: Omit<VoteBoxOptions, 'voters'> & { voters?: readonly string[] }): VoteBox {
    const voters = opts.voters ?? this.presentIds();
    const box = new VoteBox({ ...opts, voters });
    this.track(box, voters);
    this.collectorAdmitsNewcomers = opts.voters === undefined;
    return box;
  }

  /** Track any collector for "who has answered" (use for custom collectors). */
  protected track(collector: PartyCollector, eligible: readonly string[]): void {
    this.collector = collector;
    this.collectorAdmitsNewcomers = typeof collector.addEligible === 'function';
    const set = new Set(eligible);
    for (const [id, seat] of this.state.seats) {
      seat.answered = false;
      seat.eligible = set.has(id);
    }
    for (const id of set) {
      const seat = this.seat(id);
      seat.eligible = true;
      seat.answered = false;
    }
    this.refreshAnswerCounts();
  }

  /** Stop tracking (after closing the box). Seats keep their flags for the reveal. */
  protected untrack(): void {
    this.collector = null;
    this.collectorAdmitsNewcomers = false;
  }

  /**
   * Let a late joiner or a returning seated player act on the open prompt (when the game allows
   * late answers and the collector takes newcomers). Returns true when they were admitted.
   */
  private admitToOpenPrompt(player: PlayerRecord): boolean {
    const c = this.collector;
    if (player.state.spectator || !this.lateJoinersCanAnswer || !this.collectorAdmitsNewcomers) return false;
    if (!c || !c.isOpen || !c.addEligible) return false;
    c.addEligible(player.id);
    this.seat(player.id).eligible = true;
    return true;
  }

  protected markAnswered(id: string, answered = true): void {
    const seat = this.state.seats.get(id);
    if (!seat || seat.answered === answered) return;
    seat.answered = answered;
    this.refreshAnswerCounts();
  }

  protected refreshAnswerCounts(): void {
    const present = new Set(this.presentIds());
    let eligible = 0;
    let answered = 0;
    for (const [id, seat] of this.state.seats) {
      if (!seat.eligible) continue;
      if (present.has(id) || seat.answered) eligible++;
      if (seat.answered) answered++;
    }
    this.state.eligibleCount = eligible;
    this.state.answeredCount = answered;
  }

  /**
   * Submit to an AnswerBox with kit rules. Returns true when accepted. Rejections reply with a
   * friendly sys:error on `type`. Flips `seats[id].answered` and ends the stage early when complete.
   */
  protected submitAnswer<T>(player: PlayerRecord, box: AnswerBox<T>, value: T, type: string): boolean {
    if (player.state.spectator) {
      this.reject(player, type, 'not_allowed', 'Spectators can’t answer.');
      return false;
    }
    const result = box.submit(player.id, value);
    if (!result.ok) {
      this.rejectReason(player, type, result.reason);
      return false;
    }
    this.markAnswered(player.id);
    if (result.locked) this.checkAllAnswered();
    return true;
  }

  /** Explicit lock-in for change-until-lock boxes. */
  protected lockAnswer<T>(player: PlayerRecord, box: AnswerBox<T>, type: string): boolean {
    if (!box.lock(player.id)) {
      this.rejectReason(player, type, box.isOpen ? (box.has(player.id) ? 'already_locked' : 'invalid') : 'closed');
      return false;
    }
    this.checkAllAnswered();
    return true;
  }

  /** Cast a vote with kit rules (see submitAnswer). */
  protected submitVote(
    player: PlayerRecord,
    box: VoteBox,
    choice: string | readonly string[] | null,
    type: string,
    opts: { allowSpectator?: boolean } = {},
  ): boolean {
    if (player.state.spectator && !opts.allowSpectator) {
      this.reject(player, type, 'not_allowed', 'Spectators can’t vote.');
      return false;
    }
    const result = box.cast(player.id, choice);
    if (!result.ok) {
      this.rejectReason(player, type, result.reason);
      return false;
    }
    if (!player.state.spectator) this.markAnswered(player.id);
    this.checkAllAnswered();
    return true;
  }

  protected lockVote(player: PlayerRecord, box: VoteBox, type: string): boolean {
    if (!box.lock(player.id)) {
      this.rejectReason(player, type, box.isOpen ? 'already_locked' : 'closed');
      return false;
    }
    this.checkAllAnswered();
    return true;
  }

  protected rejectReason(player: PlayerRecord, type: string, reason: PartyVoteReason): void {
    const code =
      reason === 'closed' || reason === 'stale'
        ? 'wrong_phase'
        : reason === 'invalid' || reason === 'unknown_option'
          ? 'invalid_payload'
          : 'not_allowed';
    this.reject(player, type, code, PARTY_REASON_TEXT[reason]);
  }

  /** Ends the stage early when every present eligible player has locked in. */
  protected checkAllAnswered(): void {
    const c = this.collector;
    if (!c || !c.isOpen) return;
    if (c.isComplete(this.presentIds())) this.onAllAnswered();
  }

  /** Called when the tracked collector is complete. Default: endStageSoon(). */
  protected onAllAnswered(): void {
    this.endStageSoon();
  }

  // ===========================================================================
  // Private mailbox (reconnect-safe)
  // ===========================================================================

  /**
   * Send a private payload and remember it as the latest for (player, type); syncPrivate re-sends it
   * after reconnects. Spectators are skipped unless `spectators: true`.
   */
  protected sendPrivate(player: PlayerRecord | string, type: string, payload: unknown, opts: { spectators?: boolean } = {}): void {
    const record = typeof player === 'string' ? this.players.get(player) : player;
    if (!record) return;
    if (record.state.spectator && !opts.spectators) return;
    let box = this.mailbox.get(record.id);
    if (!box) {
      box = new Map();
      this.mailbox.set(record.id, box);
    }
    box.set(type, { payload, spectators: Boolean(opts.spectators) });
    this.sendTo(record, type, payload);
  }

  /** Forget stored private payloads (all, one type, and/or one player). Does not message clients. */
  protected clearPrivate(type?: string, playerId?: string): void {
    const targets = playerId ? [playerId] : [...this.mailbox.keys()];
    for (const id of targets) {
      if (!type) this.mailbox.delete(id);
      else this.mailbox.get(id)?.delete(type);
    }
  }

  protected override syncPrivate(player: PlayerRecord): void {
    const box = this.mailbox.get(player.id);
    if (!box) return;
    for (const [type, item] of box) {
      if (player.state.spectator && !item.spectators) continue;
      this.sendTo(player, type, item.payload);
    }
  }

  // ===========================================================================
  // Teams
  // ===========================================================================

  /** Random balanced split of the seated players into `count` teams. */
  protected setupTeams(count: number, scoring: PartyTeamScoring): void {
    const defs = partyTeamsFor(count);
    this.teamIds = defs.map((d) => d.id);
    const s = this.state;
    s.teamMode = true;
    s.teamScoring = scoring;
    s.teams.clear();
    for (const d of defs) {
      const team = new PartyTeamState();
      team.id = d.id;
      team.name = d.name;
      team.color = d.color;
      team.icon = d.icon;
      s.teams.set(d.id, team);
    }
    this.teamOfPlayer.clear();
    const assignment = assignTeams(
      this.seatedPlayers().map((p) => p.id),
      this.teamIds,
      this.rng,
    );
    for (const [pid, tid] of assignment) this.setTeam(pid, tid);
    this.refreshTeamSizes();
  }

  protected clearTeams(): void {
    this.teamIds = [];
    this.teamOfPlayer.clear();
    this.state.teamMode = false;
    this.state.teams.clear();
    for (const seat of this.state.seats.values()) seat.teamId = '';
  }

  protected teamOf(playerId: string): string | undefined {
    return this.teamOfPlayer.get(playerId);
  }

  /** Put a (late-joining) player in the smallest team. */
  protected placeInTeam(player: PlayerRecord): string | undefined {
    if (!this.state.teamMode || this.teamIds.length === 0) return undefined;
    const existing = this.teamOfPlayer.get(player.id);
    if (existing) return existing;
    const seated = this.seatedPlayers()
      .map((p) => p.id)
      .filter((id) => this.teamOfPlayer.has(id));
    const tid = smallestTeam(this.teamOfPlayer, this.teamIds, seated);
    this.setTeam(player.id, tid);
    this.refreshTeamSizes();
    return tid;
  }

  private setTeam(playerId: string, teamId: string): void {
    this.teamOfPlayer.set(playerId, teamId);
    this.seat(playerId).teamId = teamId;
  }

  protected refreshTeamSizes(): void {
    const seated = new Set(this.seatedPlayers().map((p) => p.id));
    for (const team of this.state.teams.values()) team.size = 0;
    for (const [pid, tid] of this.teamOfPlayer) {
      if (!seated.has(pid)) continue;
      const team = this.state.teams.get(tid);
      if (team) team.size += 1;
    }
  }

  // ===========================================================================
  // Scores
  // ===========================================================================

  /** Queue points for a player (applied by commitScores()). Negative values allowed. */
  protected addPoints(playerId: string, points: number): void {
    if (!Number.isFinite(points) || points === 0) {
      if (!this.pendingDeltas.has(playerId)) this.pendingDeltas.set(playerId, 0);
      return;
    }
    this.pendingDeltas.set(playerId, (this.pendingDeltas.get(playerId) ?? 0) + Math.round(points));
  }

  /** Points queued for a player since the last commit. */
  protected pendingPoints(playerId: string): number {
    return this.pendingDeltas.get(playerId) ?? 0;
  }

  protected setStreak(playerId: string, streak: number): void {
    this.seat(playerId).streak = Math.max(0, Math.min(65535, Math.round(streak)));
  }

  /**
   * Apply queued points: updates PlayerState.score, seats' delta/prevRank/rank, team totals and
   * ranks, and bumps `scoreSeq` so clients animate the score reveal.
   */
  protected commitScores(): void {
    for (const seat of this.state.seats.values()) seat.delta = 0;
    for (const [pid, delta] of this.pendingDeltas) {
      const p = this.players.get(pid);
      if (!p) continue;
      p.state.score += delta;
      this.seat(pid).delta = delta;
    }
    this.pendingDeltas.clear();
    this.recomputeRanks(true);
    this.state.scoreSeq = (this.state.scoreSeq + 1) >>> 0;
  }

  /** Player standings (seated players incl. disconnected; spectators excluded). */
  protected standings(): Standing<PlayerRecord>[] {
    return rankStandings(this.seatedPlayers().map((p) => ({ id: p.id, score: p.state.score, order: p.state.joinOrder, item: p })));
  }

  /** Team standings (team mode only). */
  protected teamStandings(): Standing<PartyTeamState>[] {
    const teams = [...this.state.teams.values()];
    return rankStandings(teams.map((t, i) => ({ id: t.id, score: t.score, order: i, item: t })));
  }

  private recomputeRanks(shiftPrev: boolean): void {
    const standings = this.standings();
    const placeOf = new Map(standings.map((s) => [s.id, s.place]));
    for (const [id, seat] of this.state.seats) {
      if (shiftPrev) seat.prevRank = seat.rank;
      seat.rank = placeOf.get(id) ?? 0;
      if (!shiftPrev) seat.prevRank = seat.rank;
    }
    if (!this.state.teamMode) return;
    const scores: Record<string, number> = {};
    for (const p of this.seatedPlayers()) scores[p.id] = p.state.score;
    const seatedAssignment = new Map([...this.teamOfPlayer].filter(([pid]) => scores[pid] !== undefined));
    const totals = teamTotals(scores, seatedAssignment, this.teamIds, this.state.teamScoring === 'average' ? 'average' : 'sum');
    for (const team of this.state.teams.values()) {
      const next = totals[team.id] ?? 0;
      team.delta = shiftPrev ? next - team.score : 0;
      team.score = next;
    }
    const teamPlaces = new Map(this.teamStandings().map((s) => [s.id, s.place]));
    for (const team of this.state.teams.values()) {
      if (shiftPrev) team.prevRank = team.rank;
      team.rank = teamPlaces.get(team.id) ?? 0;
      if (!shiftPrev) team.prevRank = team.rank;
    }
    this.refreshTeamSizes();
  }

  // ===========================================================================
  // Finish
  // ===========================================================================

  /** Build the podium, publish it, end the match (RESULTS) and report the outcome. */
  protected finishParty(opts: FinishPartyOptions = {}): PartyPodium {
    this.cancelStage();
    this.untrack();
    if (this.pendingDeltas.size) this.commitScores();
    else this.recomputeRanks(false);
    const standings = this.standings();
    const players: PartyPodiumEntry[] = standings.map((s) => ({
      id: s.id,
      name: s.item!.state.name,
      avatar: s.item!.state.avatar,
      color: s.item!.state.color,
      score: s.score,
      place: s.place,
      teamId: this.teamOfPlayer.get(s.id) ?? '',
    }));
    let teams: PartyPodiumTeam[] | null = null;
    let winningTeamIds: string[] = [];
    let placements: string[][];
    if (this.state.teamMode) {
      const teamStandings = this.teamStandings();
      teams = teamStandings.map((t) => ({
        id: t.id,
        name: t.item!.name,
        color: t.item!.color,
        icon: t.item!.icon,
        score: t.score,
        place: t.place,
        size: t.item!.size,
      }));
      winningTeamIds = teamStandings.filter((t) => t.place === 1 && (t.item?.size ?? 0) > 0).map((t) => t.id);
      // Players share their team's placement.
      const byTeamPlace = new Map<number, string[]>();
      for (const t of teamStandings) {
        const members = standings.filter((s) => this.teamOfPlayer.get(s.id) === t.id).map((s) => s.id);
        if (members.length === 0) continue;
        byTeamPlace.set(t.place, [...(byTeamPlace.get(t.place) ?? []), ...members]);
      }
      const teamless = standings.filter((s) => !this.teamOfPlayer.has(s.id)).map((s) => s.id);
      placements = [...byTeamPlace.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
      if (teamless.length) placements.push(teamless);
    } else {
      placements = placementGroups(standings);
    }
    let winnerIds = this.state.teamMode
      ? players.filter((p) => winningTeamIds.includes(p.teamId)).map((p) => p.id)
      : players.filter((p) => p.place === 1).map((p) => p.id);
    /** Explicit placements (hidden-team games…): competition places from the groups. */
    let explicitPlace: Map<string, number> | null = null;
    if (opts.placements) {
      const seatedIds = new Set(standings.map((s) => s.id));
      const seen = new Set<string>();
      const groups = opts.placements
        .map((g) => g.filter((id) => seatedIds.has(id) && !seen.has(id) && (seen.add(id), true)))
        .filter((g) => g.length > 0);
      const rest = standings.map((s) => s.id).filter((id) => !seen.has(id));
      if (rest.length) groups.push(rest);
      explicitPlace = new Map();
      let place = 1;
      for (const g of groups) {
        for (const id of g) explicitPlace.set(id, place);
        place += g.length;
      }
      placements = groups;
      winnerIds = groups[0] ?? [];
      for (const p of players) p.place = explicitPlace.get(p.id) ?? p.place;
      players.sort((a, b) => a.place - b.place || b.score - a.score);
    }
    const podiumData: PartyPodium = { players, teams, winnerIds, winningTeamIds, ...(opts.extras ? { extras: opts.extras } : {}) };
    this.state.podiumJson = JSON.stringify(podiumData);
    this.state.stage = 'final';
    this.state.stageSeq = (this.state.stageSeq + 1) >>> 0;
    this.state.stageMs = 0;

    const scores: Record<string, number> = {};
    for (const s of standings) scores[s.id] = s.score;
    const teamPlace = new Map((teams ?? []).map((t) => [t.id, t.place]));
    this.reportOutcome({
      placements,
      scores,
      reason: opts.reason ?? 'completed',
      details: {
        ...(opts.details ?? {}),
        teamMode: this.state.teamMode,
        ...(teams ? { teams: teams.map((t) => ({ id: t.id, score: t.score, place: t.place })) } : {}),
      },
    });
    this.endMatch({
      players: standings.map((s) => ({
        playerId: s.id,
        name: s.item!.state.name,
        guestId: s.item!.guestId,
        userId: s.item!.userId,
        score: s.score,
        placement:
          explicitPlace?.get(s.id) ?? (this.state.teamMode ? (teamPlace.get(this.teamOfPlayer.get(s.id) ?? '') ?? s.place) : s.place),
      })),
      details: { ...(opts.details ?? {}), teamMode: this.state.teamMode },
    });
    return podiumData;
  }

  // ===========================================================================
  // Lifecycle (subclasses: call super first)
  // ===========================================================================

  protected override onPlayerJoined(player: PlayerRecord, info: { lateJoin: boolean }): void {
    if (player.state.spectator) return;
    if (!info.lateJoin || this.phase === 'LOBBY') return;
    if (this.phase !== 'PLAYING' && this.phase !== 'COUNTDOWN' && this.phase !== 'INTERMISSION') return;
    this.seat(player.id);
    if (this.state.teamMode) this.placeInTeam(player);
    this.admitToOpenPrompt(player);
    this.recomputeRanks(false);
    this.refreshAnswerCounts();
  }

  protected override onPlayerDisconnected(_player: PlayerRecord): void {
    this.refreshAnswerCounts();
    this.checkAllAnswered();
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    // Offline when the prompt opened (so not waited for): the same seat may still answer it.
    if (this.phase === 'PLAYING') this.admitToOpenPrompt(player);
    this.refreshAnswerCounts();
  }

  protected override onPlayerAway(_player: PlayerRecord): void {
    this.refreshAnswerCounts();
    this.checkAllAnswered();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.mailbox.delete(player.id);
    this.pendingDeltas.delete(player.id);
    this.state.seats.delete(player.id);
    if (this.teamOfPlayer.delete(player.id)) this.refreshTeamSizes();
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION' && this.phase !== 'COUNTDOWN') return;
    this.collector?.removeEligible?.(player.id);
    this.refreshAnswerCounts();
    this.checkAllAnswered();
  }

  protected override onReturnToLobby(): void {
    this.cancelStage();
    this.untrack();
    this.mailbox.clear();
    this.pendingDeltas.clear();
    const s = this.state;
    s.stage = 'idle';
    s.stageSeq = (s.stageSeq + 1) >>> 0;
    s.stageMs = 0;
    s.totalRounds = 0;
    s.podiumJson = '';
    s.answeredCount = 0;
    s.eligibleCount = 0;
    s.scoreSeq = 0;
    s.seats.clear();
    this.clearTeams();
  }
}
