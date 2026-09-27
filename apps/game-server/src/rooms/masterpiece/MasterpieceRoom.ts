/**
 * DASterpiece — authoritative comedy-writing room (DAStravaganza, built on the party kit).
 *
 * Round ("exhibition") flow, all inside PLAYING (kit stage machine):
 *   intro → write → [ vote → reveal ] × showdowns → scores → next round … → final (RESULTS)
 *
 * Server authority + anonymity:
 *  - Prompts are dealt privately (masterpiece:private). Answers live in the WriteDesk (server
 *    memory) until writing closes; then each showdown's answers are shuffled with the crypto rng
 *    and published under opaque random ids — never in submission order, never with authors.
 *  - Ballots live in ShowdownBallots (kit VoteBoxes). While voting only aggregate counts are public
 *    (no per-player "has voted" flags: in head-to-head that would reveal the sitting-out authors).
 *  - Authors, tallies and points are published only after the showdown's voting has closed.
 *  - Nobody can vote for themselves; head-to-head authors cannot vote in their own matchup; votes
 *    lock on cast unless the host allows changes (then until "lock in" or time).
 *  - Audience ballots: one per device/account, and never from a device that also holds a seat
 *    (a writer can't open a spectator tab to hand their own answer the audience bonus).
 *  - Timers end every stage, so missing writers or voters never stall the room.
 */
import { randomId, shuffleInPlace, type CreateOptions } from '@dascade/shared';
import {
  DEFAULT_MASTERPIECE_SETTINGS,
  MASTERPIECE_MSG,
  MP_PROMPT_TYPE_INFO,
  MP_SKIPPABLE_STAGES,
  MasterpieceSettingsSchema,
  MpLockSchema,
  MpPromptsSchema,
  MpSubmitSchema,
  MpVoteSchema,
  cleanCustomPrompts,
  sanitizeAnswer,
  type CustomPromptReport,
  type MasterpieceSettings,
  type MpAssignment,
  type MpGameEvent,
  type MpHallEntry,
  type MpPodiumExtras,
  type MpPrivate,
  type MpPromptType,
  type MpPromptsPrivate,
  type MpStage,
  type MpVoteKind,
} from '@dascade/shared/games/masterpiece';
import { anonymize } from '@dascade/game-core/party';
import {
  PromptDeck,
  ShowdownBallots,
  WriteDesk,
  computeAwards,
  emptyStats,
  fillPlayerToken,
  planRound,
  resolveShowdown,
  roundKind,
  tallyShowdown,
  walkoverPoints,
  type BallotError,
  type ShowdownFormat,
  type WriterStats,
} from '@dascade/game-core/masterpiece';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { PartyRoom } from '../party/index.ts';
import { MasterpieceState, MpAnswerState } from './schema.ts';

/** A prompt dealt to one group of writers this round. */
interface Draft {
  id: string;
  type: MpPromptType;
  prompt: string;
  authors: string[];
}

interface ShowdownEntry {
  answerId: string;
  authorId: string;
  authorName: string;
  text: string | null;
}

/** A draft after writing: resolved format + shuffled, anonymized entries. */
interface Showdown {
  id: string;
  type: MpPromptType;
  prompt: string;
  format: Exclude<ShowdownFormat, 'empty'>;
  entries: ShowdownEntry[];
}

/** Writers needed to start a new round (head-to-head needs someone left to vote). */
const MIN_WRITERS = 3;

export class MasterpieceRoom extends PartyRoom<MasterpieceState, MasterpieceSettings> {
  readonly gameId = 'masterpiece' as const;
  protected readonly settingsSchema = MasterpieceSettingsSchema;
  protected override skippableStages: readonly string[] = MP_SKIPPABLE_STAGES;

  // Tunables (integration tests shorten these).
  protected introMs = 4_500;
  protected revealBaseMs = 5_500;
  protected revealPerAnswerMs = 900;
  protected revealMaxMs = 14_000;
  protected walkoverMs = 5_000;
  protected scoresMs = 7_500;
  /** Voting stage when nobody present can vote (e.g. the only voter dropped): just show it briefly. */
  protected noVotersMs = 2_500;
  /** Ranked ballots need a little longer. */
  protected rankedExtraMs = 10_000;
  /** Host skips this soon after a stage began are ignored (double-tap guard). */
  protected minSkipGapMs = 400;
  /** Overrides settings.writeSeconds / voteSeconds (tests). */
  protected writeMsOverride: number | null = null;
  protected voteMsOverride: number | null = null;

  private deck: PromptDeck | null = null;
  private customPrompts: string[] = [];
  private customReport: Omit<CustomPromptReport, 'prompts'> = { invalid: 0, duplicates: 0, filtered: 0, overflow: 0 };
  private drafts: Draft[] = [];
  private desk: WriteDesk | null = null;
  private showdowns: Showdown[] = [];
  private current = -1;
  private ballots: ShowdownBallots | null = null;
  private readonly stats = new Map<string, WriterStats>();
  private hall: MpHallEntry[] = [];
  private sweepCount = 0;
  private scoredShowdowns = 0;
  private stageStartedAt = 0;

  protected defaultSettings(): MasterpieceSettings {
    return structuredClone(DEFAULT_MASTERPIECE_SETTINGS);
  }

  protected createState(): MasterpieceState {
    return new MasterpieceState();
  }

  protected get mpStage(): MpStage {
    return this.state.stage as MpStage;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.handle(MASTERPIECE_MSG.submit, MpSubmitSchema, (p, { showdownId, text }) => this.onSubmit(p, showdownId, text), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(MASTERPIECE_MSG.vote, MpVoteSchema, (p, { showdownId, picks }) => this.onVote(p, showdownId, picks), {
      phases: ['PLAYING'],
    });
    this.handle(MASTERPIECE_MSG.lock, MpLockSchema, (p, { showdownId }) => this.onLock(p, showdownId), {
      phases: ['PLAYING'],
    });
    this.handle(MASTERPIECE_MSG.prompts, MpPromptsSchema, (p, { prompts }) => this.setCustomPrompts(p, prompts), {
      hostOnly: true,
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 10, perSecond: 3 },
      maxBytes: 64 * 1024,
    });
  }

  private setCustomPrompts(host: PlayerRecord, raw: readonly string[]): void {
    const cleaned = cleanCustomPrompts(raw);
    this.customPrompts = cleaned.prompts;
    this.customReport = { invalid: cleaned.invalid, duplicates: cleaned.duplicates, filtered: cleaned.filtered, overflow: cleaned.overflow };
    this.state.customCount = this.customPrompts.length;
    this.sendPromptList(host);
  }

  /** The host's own copy of the custom list — only while it can be edited (never mid-match). */
  private sendPromptList(player: PlayerRecord): void {
    if (player.id !== this.state.hostId) return;
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return;
    const payload: MpPromptsPrivate = { prompts: [...this.customPrompts], report: { ...this.customReport } };
    this.sendTo(player, MASTERPIECE_MSG.prompts, payload);
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next) this.sendPromptList(next);
  }

  protected override validateStart(): string | null {
    const s = this.getSettings();
    if (s.customOnly && this.customPrompts.length === 0) return 'Add at least one custom prompt, or turn off “Only my prompts”.';
    if (!s.customOnly && s.promptTypes.length === 0 && this.customPrompts.length === 0) return 'Pick at least one round type.';
    return null;
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  protected onGameStart(): void {
    const s = this.getSettings();
    this.startParty({ totalRounds: s.rounds });
    this.deck = new PromptDeck({ types: s.promptTypes, custom: this.customPrompts, customOnly: s.customOnly }, this.rng);
    this.stats.clear();
    this.hall = [];
    this.sweepCount = 0;
    this.scoredShowdowns = 0;
    this.state.hallJson = '[]';
    this.state.audienceOpen = s.audienceVote;
    for (const p of this.seatedPlayers()) this.statsOf(p);
    this.nextRound();
  }

  private enterStage(stage: MpStage, ms: number, onEnd: () => void): void {
    this.stageStartedAt = Date.now();
    this.runStage(stage, ms, onEnd);
  }

  protected override onHostSkip(): void {
    if (Date.now() - this.stageStartedAt < this.minSkipGapMs) return;
    super.onHostSkip();
  }

  private nextRound(): void {
    const s = this.getSettings();
    this.clearRoundState();
    if (this.state.round >= s.rounds) return this.finish('completed');
    for (const p of this.promoteQueued()) {
      this.seat(p.id);
      this.statsOf(p);
      this.systemChat(`${p.state.name} takes a seat for the next exhibition.`);
    }
    const writers = this.seatedPlayers().filter((p) => !p.away);
    if (writers.length < MIN_WRITERS) {
      this.systemChat('Not enough artists left to keep going — here are the final standings!');
      return this.finish('not_enough_players');
    }
    const deck = this.deck!;
    this.state.round += 1;
    const round = this.state.round;
    const multiplier = s.doubleFinal && s.rounds > 1 && round === s.rounds ? 2 : 1;
    const kind = roundKind(s.votingMode, round, writers.length);
    const theme = deck.nextTheme();
    const plan = planRound(
      writers.map((p) => p.id),
      kind,
      this.rng,
    );
    const prompts = deck.draw(theme, plan.groups.length);
    const names = new Map(writers.map((p) => [p.id, p.state.name]));
    this.drafts = plan.groups.map((authors, i) => {
      const others = [...names].filter(([id]) => !authors.includes(id)).map(([, name]) => name);
      const text = prompts[i % Math.max(1, prompts.length)]?.text ?? MP_PROMPT_TYPE_INFO[theme].lead;
      return { id: randomId(10, this.rng), type: theme, authors, prompt: fillPlayerToken(text, others.length > 0 ? others : [...names.values()], this.rng) };
    });
    const st = this.state;
    st.roundType = theme;
    st.roundKind = kind;
    st.multiplier = multiplier;
    st.perWriter = plan.perWriter;
    st.written.clear();
    for (const p of writers) st.written.set(p.id, 0);
    this.emit({ type: 'round', round, totalRounds: s.rounds, roundType: theme, kind, multiplier });
    this.systemChat(`Exhibition ${round} of ${s.rounds}: ${MP_PROMPT_TYPE_INFO[theme].label}${multiplier > 1 ? ' — double points!' : ''}`);
    this.sendViewAll();
    this.enterStage('intro', this.introMs, () => this.startWriting());
  }

  private writeMs(): number {
    return this.writeMsOverride ?? this.getSettings().writeSeconds * 1000 * Math.max(1, this.state.perWriter);
  }

  private voteMs(kind: MpVoteKind): number {
    const base = this.voteMsOverride ?? this.getSettings().voteSeconds * 1000;
    return base + (kind === 'ranked' ? this.rankedExtraMs : 0);
  }

  private startWriting(): void {
    this.desk = new WriteDesk(
      this.drafts.map((d) => ({ showdownId: d.id, authors: d.authors })),
      Date.now(),
    );
    this.track(this.desk, this.desk.writers());
    this.emit({ type: 'write', round: this.state.round });
    this.enterStage('write', this.writeMs(), () => this.endWriting());
    this.sendViewAll();
  }

  private onSubmit(player: PlayerRecord, showdownId: string, text: string): void {
    const type = MASTERPIECE_MSG.submit;
    const desk = this.desk;
    if (this.mpStage !== 'write' || !desk || !desk.isOpen) return this.rejectReason(player, type, 'closed');
    const draft = this.drafts.find((d) => d.id === showdownId);
    if (!draft) return this.rejectReason(player, type, 'stale');
    if (!draft.authors.includes(player.id)) return this.rejectReason(player, type, 'not_eligible');
    if (this.refuseWhilePaused(player, type)) return;
    const clean = sanitizeAnswer(text, draft.type);
    if (!clean) return this.reject(player, type, 'invalid_payload', 'Write something first!');
    const result = desk.submit(player.id, showdownId, clean, Date.now());
    if (!result.ok) {
      if (result.reason === 'already_locked') return this.reject(player, type, 'not_allowed', 'You already turned that one in.');
      return this.rejectReason(player, type, result.reason);
    }
    this.state.written.set(player.id, desk.submittedCount(player.id));
    if (result.done) this.markAnswered(player.id);
    this.sendView(player);
    this.emit({ type: 'submitted', playerId: player.id, done: result.done });
    this.checkAllAnswered();
  }

  private endWriting(): void {
    const desk = this.desk;
    if (!desk) return;
    desk.close();
    this.untrack();
    for (const id of desk.writers()) {
      const st = this.stats.get(id);
      if (!st) continue;
      st.required += desk.promptsOf(id).length;
      st.submitted += desk.submittedCount(id);
      st.submitMs += desk.submitMs(id);
    }
    const kind = this.state.roundKind as MpVoteKind;
    const showdowns: Showdown[] = [];
    for (const draft of this.drafts) {
      const resolved = resolveShowdown(kind, desk.entries(draft.id));
      if (resolved.format === 'empty') continue;
      const entries = anonymize(resolved.entries, this.rng).map(({ key, item }) => ({
        answerId: key,
        authorId: item.authorId,
        authorName: this.nameOf(item.authorId),
        text: item.text,
      }));
      showdowns.push({ id: draft.id, type: draft.type, prompt: draft.prompt, format: resolved.format, entries });
    }
    this.showdowns = shuffleInPlace(showdowns, this.rng);
    this.state.showdownCount = this.showdowns.length;
    // Seats stop meaning anything during voting (no per-player vote flags — see the file header).
    for (const seat of this.state.seats.values()) {
      seat.answered = false;
      seat.eligible = false;
    }
    this.refreshAnswerCounts();
    if (this.showdowns.length === 0) {
      this.systemChat('Nobody handed anything in this exhibition… tough crowd!');
      this.roundScores();
      return;
    }
    this.beginShowdown(0);
  }

  private beginShowdown(index: number): void {
    const sd = this.showdowns[index];
    if (!sd) return this.roundScores();
    this.current = index;
    const st = this.state;
    st.showdownIndex = index;
    st.showdownId = sd.id;
    st.prompt = sd.prompt;
    st.promptType = sd.type;
    st.walkover = sd.format === 'walkover';
    st.voteKind = sd.format === 'walkover' ? '' : sd.format;
    st.votesIn = 0;
    st.audienceIn = 0;
    st.votersExpected = 0;
    st.answers.clear();
    for (const e of sd.entries) {
      const a = new MpAnswerState();
      a.id = e.answerId;
      a.text = e.text ?? '';
      a.blank = e.text === null;
      st.answers.push(a);
    }
    this.ballots = null;
    if (sd.format === 'walkover') {
      this.revealShowdown();
      return;
    }
    const voters = this.seatedPlayers()
      .filter((p) => !p.away)
      .map((p) => p.id);
    const ballots = new ShowdownBallots(
      sd.format,
      sd.entries.map((e) => ({ id: e.answerId, authorId: e.authorId })),
      voters,
      this.getSettings().allowVoteChange,
    );
    this.ballots = ballots;
    // Structural count only: "who is connected" must never hint at who sits out a head-to-head.
    st.votersExpected = Math.max(0, voters.length - (sd.format === 'matchup' ? sd.entries.length : 0));
    this.emit({ type: 'vote', round: st.round, index });
    const audienceCanVote = this.getSettings().audienceVote && this.connectedSpectators() > 0;
    const presentVoters = ballots.eligibleAmong(this.presentIds()).length;
    const ms = presentVoters === 0 && !audienceCanVote ? this.noVotersMs : this.voteMs(sd.format);
    this.enterStage('vote', ms, () => this.revealShowdown());
    this.sendViewAll();
  }

  private connectedSpectators(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.state.spectator && p.client) n++;
    return n;
  }

  private onVote(player: PlayerRecord, showdownId: string, picks: string[]): void {
    const type = MASTERPIECE_MSG.vote;
    const ballots = this.ballots;
    if (this.mpStage !== 'vote' || !ballots || !ballots.isOpen) return this.rejectReason(player, type, 'closed');
    if (showdownId !== this.state.showdownId) return this.rejectReason(player, type, 'stale');
    if (this.refuseWhilePaused(player, type)) return;
    const audience = player.state.spectator;
    if (audience && !this.getSettings().audienceVote) return this.reject(player, type, 'not_allowed', 'Audience voting is off in this room.');
    if (audience && this.audienceDeviceTaken(player, ballots)) {
      return this.reject(player, type, 'not_allowed', 'This device is already playing or voting in this match — one audience vote per device.');
    }
    const result = ballots.cast(player.id, picks, audience);
    if (!result.ok) return this.rejectBallot(player, type, result.error, ballots.picksRequired(player.id));
    if (result.changed) {
      this.state.votesIn = ballots.playerCount;
      this.state.audienceIn = ballots.audienceCount;
    }
    this.sendView(player);
    this.checkVotesDone();
  }

  private onLock(player: PlayerRecord, showdownId: string): void {
    const type = MASTERPIECE_MSG.lock;
    const ballots = this.ballots;
    if (this.mpStage !== 'vote' || !ballots || !ballots.isOpen) return this.rejectReason(player, type, 'closed');
    if (showdownId !== this.state.showdownId) return this.rejectReason(player, type, 'stale');
    if (this.refuseWhilePaused(player, type)) return;
    const result = ballots.lock(player.id, player.state.spectator);
    if (!result.ok) return this.rejectBallot(player, type, result.error, 1);
    this.sendView(player);
    this.checkVotesDone();
  }

  /**
   * Whether a spectator shares a device/account with a seated player (a writer's second tab) or with
   * another spectator who already cast an audience ballot this showdown.
   */
  private audienceDeviceTaken(player: PlayerRecord, ballots: ShowdownBallots): boolean {
    const key = deviceKey(player);
    if (!key) return false;
    for (const other of this.players.values()) {
      if (other === player || deviceKey(other) !== key) continue;
      if (!other.state.spectator) return true;
      if (ballots.ballotOf(other.id, true)) return true;
    }
    return false;
  }

  private rejectBallot(player: PlayerRecord, type: string, error: BallotError, need: number): void {
    if (error === 'wrong_count') return this.reject(player, type, 'invalid_payload', need === 1 ? 'Pick one answer.' : `Pick your top ${need}, best first.`);
    if (error === 'no_ballot') return this.reject(player, type, 'not_allowed', 'Cast your vote first, then lock it in.');
    if (error === 'not_eligible') return this.reject(player, type, 'not_allowed', 'Your answer is on stage — this vote is for everyone else.');
    if (error === 'already_locked') return this.reject(player, type, 'not_allowed', 'Your vote is already locked in.');
    return this.rejectReason(player, type, error);
  }

  /** Ends voting early once every present eligible player has locked a ballot. */
  /** Ballots aren't a kit collector: a vote completed during a pause (by leavers) ends on resume. */
  protected override resumeStage(): boolean {
    const resumed = super.resumeStage();
    if (resumed) this.checkVotesDone();
    return resumed;
  }

  private checkVotesDone(): void {
    const ballots = this.ballots;
    if (this.mpStage !== 'vote' || !ballots || !ballots.isOpen) return;
    const present = this.presentIds();
    const eligible = ballots.eligibleAmong(present);
    if (eligible.length === 0) {
      // Every possible voter left mid-vote: don't wait out the full timer.
      if (!(this.getSettings().audienceVote && this.connectedSpectators() > 0)) this.endStageSoon(this.noVotersMs);
      return;
    }
    if (ballots.isComplete(present)) this.endStageSoon();
  }

  private revealShowdown(): void {
    const sd = this.showdowns[this.current];
    if (!sd) return this.roundScores();
    const st = this.state;
    const multiplier = st.multiplier;
    const ballots = this.ballots;
    ballots?.close();
    const results = new Map<string, { votes: number; firsts: number; audienceVotes: number; points: number; winner: boolean; sweep: boolean; audiencePick: boolean }>();
    if (sd.format === 'walkover' || !ballots) {
      for (const e of sd.entries) {
        const lone = e.text !== null;
        results.set(e.answerId, { votes: 0, firsts: 0, audienceVotes: 0, points: lone ? walkoverPoints(multiplier) : 0, winner: lone, sweep: false, audiencePick: false });
      }
    } else {
      const tallies = tallyShowdown(
        sd.format,
        sd.entries.map((e) => ({ id: e.answerId, authorId: e.authorId })),
        ballots.all(),
        multiplier,
      );
      for (const t of tallies) results.set(t.id, t);
    }
    const winners: string[] = [];
    let sweep = false;
    for (const e of sd.entries) {
      const r = results.get(e.answerId);
      const view = st.answers.find((a) => a.id === e.answerId);
      if (!r || !view) continue;
      view.votes = r.votes;
      view.firsts = r.firsts;
      view.audienceVotes = r.audienceVotes;
      view.points = r.points;
      view.winner = r.winner;
      view.sweep = r.sweep;
      view.audiencePick = r.audiencePick;
      view.authorId = e.authorId;
      view.authorName = e.authorName;
      if (r.points > 0) this.addPoints(e.authorId, r.points);
      const stats = this.stats.get(e.authorId);
      if (stats) {
        stats.votes += r.votes;
        if (r.sweep) stats.sweeps++;
        if (r.audiencePick) stats.audiencePicks++;
        if (r.winner) stats.wins++;
      }
      if (r.sweep) sweep = true;
      if (r.winner && e.text !== null) {
        winners.push(e.answerId);
        this.hall.push({
          round: st.round,
          type: sd.type,
          prompt: sd.prompt,
          text: e.text,
          authorId: e.authorId,
          authorName: e.authorName,
          votes: r.votes,
          points: r.points,
          sweep: r.sweep,
        });
      }
    }
    if (sweep) this.sweepCount++;
    this.scoredShowdowns++;
    st.hallJson = JSON.stringify(this.hall);
    this.emit({ type: 'reveal', round: st.round, index: this.current, winners, sweep, walkover: sd.format === 'walkover' });
    const ms = sd.format === 'walkover' ? this.walkoverMs : Math.min(this.revealMaxMs, this.revealBaseMs + this.revealPerAnswerMs * sd.entries.length);
    this.enterStage('reveal', ms, () => this.beginShowdown(this.current + 1));
    this.sendViewAll();
  }

  private roundScores(): void {
    this.ballots = null;
    this.current = -1;
    const st = this.state;
    st.answers.clear();
    st.prompt = '';
    st.promptType = '';
    st.showdownId = '';
    st.voteKind = '';
    st.walkover = false;
    this.commitScores();
    this.emit({ type: 'scores', round: st.round });
    this.enterStage('scores', this.scoresMs, () => this.nextRound());
    this.sendViewAll();
  }

  private finish(reason: 'completed' | 'not_enough_players'): void {
    const present = new Set(this.seatedPlayers().map((p) => p.id));
    const awards = computeAwards([...this.stats.values()].filter((s) => present.has(s.id)));
    const extras: MpPodiumExtras = { awards, sweeps: this.sweepCount, showdowns: this.scoredShowdowns };
    this.clearRoundState();
    this.finishParty({
      reason,
      details: { rounds: this.state.round, showdowns: this.scoredShowdowns, sweeps: this.sweepCount },
      extras: extras as unknown as Record<string, unknown>,
    });
    this.sendViewAll();
    const host = this.hostRecord;
    if (host) this.sendPromptList(host);
  }

  private clearRoundState(): void {
    this.desk?.close();
    this.desk = null;
    this.drafts = [];
    this.showdowns = [];
    this.current = -1;
    this.ballots = null;
    const st = this.state;
    st.answers.clear();
    st.written.clear();
    st.prompt = '';
    st.promptType = '';
    st.showdownId = '';
    st.showdownCount = 0;
    st.showdownIndex = 0;
    st.voteKind = '';
    st.walkover = false;
    st.votesIn = 0;
    st.votersExpected = 0;
    st.audienceIn = 0;
  }

  // ===========================================================================
  // Private views
  // ===========================================================================

  private viewFor(p: PlayerRecord): MpPrivate {
    const st = this.state;
    const inMatch = this.phase === 'PLAYING' || this.phase === 'INTERMISSION' || this.phase === 'COUNTDOWN';
    const audience = p.state.spectator;
    const role = audience ? (this.getSettings().audienceVote && inMatch ? 'audience' : 'spectator') : 'writer';
    const assignments: MpAssignment[] = audience
      ? []
      : this.drafts
          .filter((d) => d.authors.includes(p.id))
          .map((d) => ({ showdownId: d.id, type: d.type, prompt: d.prompt, answer: this.desk?.answerOf(p.id, d.id) ?? null }));
    const sd = this.showdowns[this.current];
    const showing = sd && (this.mpStage === 'vote' || this.mpStage === 'reveal') ? sd : null;
    const ownAnswerIds = showing && !audience ? showing.entries.filter((e) => e.authorId === p.id).map((e) => e.answerId) : [];
    const ballots = showing ? this.ballots : null;
    let canVote = false;
    let voteBlock: MpPrivate['voteBlock'] = '';
    if (ballots && this.mpStage === 'vote') {
      if (audience && !this.getSettings().audienceVote) voteBlock = 'spectator';
      else if (!ballots.mayVote(p.id, audience)) voteBlock = ballots.isAuthor(p.id) ? 'author' : 'late';
      else if (audience && !ballots.ballotOf(p.id, true) && this.audienceDeviceTaken(p, ballots)) voteBlock = 'device';
      else canVote = true;
    }
    const ballot = ballots?.ballotOf(p.id, audience) ?? null;
    return {
      round: st.round,
      role,
      assignments,
      showdownId: showing?.id ?? '',
      ownAnswerIds,
      canVote,
      voteBlock,
      ballot: ballot && showing ? { showdownId: showing.id, picks: ballot.picks, locked: ballot.locked } : null,
    };
  }

  /** Sends (and remembers for reconnects) a player's private view. Spectators only ever get audience info. */
  private sendView(p: PlayerRecord): void {
    this.sendPrivate(p, MASTERPIECE_MSG.private, this.viewFor(p), { spectators: true });
  }

  private sendViewAll(): void {
    for (const p of this.players.values()) this.sendView(p);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    super.syncPrivate(player);
    if (this.phase !== 'LOBBY') this.sendView(player);
    this.sendPromptList(player);
  }

  private emit(event: MpGameEvent): void {
    this.broadcast(MASTERPIECE_MSG.event, event);
  }

  // ===========================================================================
  // Player lifecycle (kit hooks first)
  // ===========================================================================

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    super.onPlayerDisconnected(player);
    this.checkVotesDone();
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    super.onPlayerAway(player);
    this.checkVotesDone();
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    super.onPlayerReconnected(player);
    // A seated player who was away when voting opened gets their vote back (authors stay out).
    if (!player.state.spectator && this.ballots?.isOpen) this.ballots.addVoter(player.id);
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    super.onPlayerRemoved(player, reason);
    this.state.written.delete(player.id);
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    if (this.ballots?.isOpen) {
      this.ballots.removeVoter(player.id);
      this.checkVotesDone();
    }
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.clearRoundState();
    this.deck = null;
    this.stats.clear();
    this.hall = [];
    this.sweepCount = 0;
    this.scoredShowdowns = 0;
    const st = this.state;
    st.roundType = '';
    st.roundKind = '';
    st.multiplier = 1;
    st.perWriter = 0;
    st.hallJson = '[]';
    st.audienceOpen = false;
    const host = this.hostRecord;
    if (host) this.sendPromptList(host);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private nameOf(id: string): string {
    return this.players.get(id)?.state.name ?? this.stats.get(id)?.name ?? 'A mystery artist';
  }

  private statsOf(p: PlayerRecord): WriterStats {
    let st = this.stats.get(p.id);
    if (!st) {
      st = emptyStats(p.id, p.state.name, p.state.joinOrder);
      this.stats.set(p.id, st);
    }
    st.name = p.state.name;
    return st;
  }
}

/** Device/account identity for audience-vote dedupe (signed-in account, else the browser's guest id). */
function deviceKey(p: PlayerRecord): string | null {
  if (p.userId) return `u:${p.userId}`;
  if (p.guestId) return `g:${p.guestId}`;
  return null;
}
