/**
 * DAS Survey — "how well do you know this room?" Built on the DAStravaganza party kit.
 *
 * Question flow (phase stays PLAYING; `stage` drives the UI):
 *   answer  → every player privately answers (or skips). A player who has answered may already
 *             lock in their prediction. Ends when every present player has answered (and the
 *             anonymity floor is met, or nobody else could still answer) or on the timer.
 *   (seal)  → answering closes: the book tallies and FORGETS individual answers immediately.
 *             Fewer than SURVEY_LIMITS.minRespondents answers ⇒ the question is voided.
 *   predict → everyone who hasn't predicted yet does so (late joiners too). Ends when every
 *             present player has predicted or on the timer.
 *   reveal  → public aggregate result + points (party kit score reveal). Auto-advances; the host
 *             can skip ahead, pause or resume with the kit's `party:host` message.
 *   final   → podium, awards (prediction accuracy only), "your room in numbers" recap,
 *             reportOutcome() via the kit's finishParty().
 *
 * Secrets: individual answers live only inside the SurveyBook until answering closes and in the
 * answering player's own private payload. They never enter synchronized state or a broadcast,
 * and spectators receive no private payloads at all.
 */
import type { CreateOptions } from '@dascade/shared';
import {
  DEFAULT_SURVEY_SETTINGS,
  SURVEY_LIMITS,
  SURVEY_MSG,
  SurveyAnswerSchema,
  SurveyCustomSchema,
  SurveyPredictSchema,
  SurveySettingsSchema,
  validateCustomSurvey,
  type SurveyAnswerPayload,
  type SurveyCustomIssue,
  type SurveyCustomPrivate,
  type SurveyCustomQuestionInput,
  type SurveyEvent,
  type SurveyHistoryEntry,
  type SurveyPodiumExtras,
  type SurveyPredictPayload,
  type SurveyPrediction,
  type SurveyPrivate,
  type SurveyQuestion,
  type SurveySettings,
} from '@dascade/shared/games/survey';
import { PARTY_REASON_TEXT } from '@dascade/shared/party';
import { QuestionDeck, SurveyBook, SurveyStats, buildRecap, historyEntry, type BookRejectReason } from '@dascade/game-core/survey';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { PartyRoom, type PartyCollector } from '../party/index.ts';
import { SurveyProgressState, SurveyState } from './schema.ts';

const REJECT_TEXT: Record<BookRejectReason, string> = {
  closed: 'Time is up for that — it’s closed.',
  duplicate: 'You already locked that in.',
  invalid: 'That choice doesn’t fit this question.',
  answer_first: 'Answer the question (or skip it) before predicting.',
};

/** Voided questions don't need the full reveal time. */
const VOIDED_REVEAL_MS = 5_000;

export class SurveyRoom extends PartyRoom<SurveyState, SurveySettings> {
  readonly gameId = 'survey' as const;
  protected readonly settingsSchema = SurveySettingsSchema;

  // Tunables (integration tests shorten these; null = use the host's settings).
  protected answerMsOverride: number | null = null;
  protected predictMsOverride: number | null = null;
  protected revealMsOverride: number | null = null;

  private readonly deck = new QuestionDeck();
  private readonly stats = new SurveyStats();
  private plan: SurveyQuestion[] = [];
  private book: SurveyBook | null = null;
  private serial = 0;
  private history: SurveyHistoryEntry[] = [];
  private voided = 0;
  /** The host's custom survey — private to the host until each question is asked. */
  private custom: SurveyQuestion[] = [];
  private customIssues: SurveyCustomIssue[] = [];
  private customDropped = 0;

  protected defaultSettings(): SurveySettings {
    return structuredClone(DEFAULT_SURVEY_SETTINGS);
  }

  protected createState(): SurveyState {
    return new SurveyState();
  }

  private answerMs(): number {
    return this.answerMsOverride ?? this.getSettings().answerSeconds * 1000;
  }

  private predictMs(): number {
    return this.predictMsOverride ?? this.getSettings().predictSeconds * 1000;
  }

  private revealMs(voided: boolean): number {
    const ms = this.revealMsOverride ?? this.getSettings().revealSeconds * 1000;
    return voided ? Math.min(ms, VOIDED_REVEAL_MS) : ms;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.handle(SURVEY_MSG.answer, SurveyAnswerSchema, (p, payload) => this.onAnswer(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(SURVEY_MSG.predict, SurveyPredictSchema, (p, payload) => this.onPredict(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(SURVEY_MSG.custom, SurveyCustomSchema, (p, { questions }) => this.setCustom(p, questions), {
      hostOnly: true,
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 6, perSecond: 1 },
      maxBytes: 48 * 1024,
    });
  }

  private onAnswer(player: PlayerRecord, payload: SurveyAnswerPayload): void {
    const book = this.book;
    if (!book || this.stage !== 'answer')
      return this.reject(player, SURVEY_MSG.answer, 'wrong_phase', 'Answers are closed for this question.');
    if (payload.q !== book.serial) return this.reject(player, SURVEY_MSG.answer, 'wrong_phase', PARTY_REASON_TEXT.stale);
    if (this.refuseWhilePaused(player, SURVEY_MSG.answer)) return;
    const result = book.answer(player.id, 'skip' in payload ? null : payload.option);
    if (!result.ok) return this.rejectBook(player, SURVEY_MSG.answer, result.reason);
    this.progressOf(player.id).answered = true;
    this.state.answersIn = book.answeredCount;
    this.markAnswered(player.id);
    this.sendSurveyPrivate(player);
    this.checkAllAnswered();
  }

  private onPredict(player: PlayerRecord, payload: SurveyPredictPayload): void {
    const book = this.book;
    if (!book || (this.stage !== 'answer' && this.stage !== 'predict')) {
      return this.reject(player, SURVEY_MSG.predict, 'wrong_phase', 'Predictions are closed for this question.');
    }
    if (payload.q !== book.serial) return this.reject(player, SURVEY_MSG.predict, 'wrong_phase', PARTY_REASON_TEXT.stale);
    if (this.refuseWhilePaused(player, SURVEY_MSG.predict)) return;
    const result = book.predict(player.id, toPrediction(payload));
    if (!result.ok) return this.rejectBook(player, SURVEY_MSG.predict, result.reason);
    this.progressOf(player.id).predicted = true;
    this.state.predictionsIn = book.predictedCount;
    if (this.stage === 'predict') this.markAnswered(player.id);
    this.sendSurveyPrivate(player);
    this.checkAllAnswered();
  }

  private rejectBook(player: PlayerRecord, type: string, reason: BookRejectReason): void {
    const code = reason === 'closed' ? 'wrong_phase' : reason === 'invalid' ? 'invalid_payload' : 'not_allowed';
    this.reject(player, type, code, REJECT_TEXT[reason]);
  }

  // ===========================================================================
  // Custom survey (host-only, private until asked)
  // ===========================================================================

  private setCustom(host: PlayerRecord, raw: readonly SurveyCustomQuestionInput[]): void {
    const report = validateCustomSurvey(raw);
    this.custom = report.questions;
    this.customIssues = report.issues;
    this.customDropped = report.dropped;
    this.state.customCount = this.custom.length;
    this.sendCustom(host);
  }

  /** Only the host sees the stored survey, and only while it can be edited (not mid-game). */
  private sendCustom(player: PlayerRecord): void {
    if (player.id !== this.state.hostId) return;
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return;
    const payload: SurveyCustomPrivate = {
      questions: this.custom.map((q) => ({ ...q, options: [...q.options] })),
      issues: this.customIssues.map((i) => ({ ...i })),
      dropped: this.customDropped,
    };
    this.sendTo(player, SURVEY_MSG.custom, payload);
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next) this.sendCustom(next);
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  protected override validateStart(): string | null {
    const s = this.getSettings();
    if (s.mode === 'custom') {
      if (this.custom.length === 0) return 'Write at least one question in the Custom Survey editor first.';
    } else if (s.packs.length === 0) {
      return 'Pick at least one question pack.';
    }
    return null;
  }

  protected onGameStart(): void {
    const s = this.getSettings();
    this.plan = this.deck.plan({ mode: s.mode, count: s.questions, packs: s.packs, custom: this.custom }, this.rng);
    this.startParty({ totalRounds: this.plan.length });
    this.stats.reset();
    this.history = [];
    this.voided = 0;
    this.book = null;
    const st = this.state;
    st.historyJson = '[]';
    st.resultJson = '';
    st.questionJson = '';
    st.progress.clear();
    this.nextQuestion();
  }

  private nextQuestion(): void {
    this.book = null;
    const st = this.state;
    if (st.round >= this.plan.length) return this.finish('completed');
    const remaining = this.seatedPlayers().filter((p) => !p.away).length;
    if (remaining < SURVEY_LIMITS.minRespondents) {
      this.systemChat(
        `Fewer than ${SURVEY_LIMITS.minRespondents} players left — answers can’t stay anonymous, so here are the final results.`,
      );
      return this.finish('not_enough_players');
    }
    const question = this.plan[st.round] as SurveyQuestion;
    st.round += 1;
    this.serial += 1;
    const book = new SurveyBook(question, this.serial);
    this.book = book;
    st.q = this.serial;
    st.questionJson = JSON.stringify(question);
    st.resultJson = '';
    st.answersIn = 0;
    st.predictionsIn = 0;
    st.progress.clear();
    const seated = this.seatedPlayers();
    for (const p of seated) st.progress.set(p.id, new SurveyProgressState());
    this.clearPrivate(SURVEY_MSG.private);
    this.track(
      this.answerCollector(book),
      seated.filter((p) => !p.away).map((p) => p.id),
    );
    for (const p of seated) this.sendSurveyPrivate(p);
    this.emit({ type: 'question', q: book.serial, index: st.round, total: st.totalRounds, mode: question.mode });
    this.runStage('answer', this.answerMs(), () => this.closeAnswers());
  }

  /**
   * Answering is complete when every present player has answered — but a question below the
   * anonymity floor keeps waiting (until its timer) while a briefly disconnected player could
   * still come back and answer.
   */
  private answerCollector(book: SurveyBook): PartyCollector {
    const everyoneSeatedAnswered = () =>
      this.seatedPlayers()
        .filter((p) => !p.away)
        .every((p) => book.hasAnswered(p.id));
    return {
      get isOpen() {
        return book.isAnswering;
      },
      pending: (present) => [...(present ?? [])].filter((id) => !book.hasAnswered(id)),
      isComplete: (present) => {
        const ids = [...(present ?? [])];
        if (ids.length === 0 || !ids.every((id) => book.hasAnswered(id))) return false;
        return book.meetsAnonymityFloor || everyoneSeatedAnswered();
      },
    };
  }

  private predictCollector(book: SurveyBook): PartyCollector {
    return {
      get isOpen() {
        return book.isPredicting;
      },
      pending: (present) => [...(present ?? [])].filter((id) => !book.hasPredicted(id)),
      isComplete(present) {
        const ids = [...(present ?? [])];
        return ids.length > 0 && ids.every((id) => book.hasPredicted(id));
      },
    };
  }

  /** Seal the question: stop answers, forget who answered what, then predict (or reveal). */
  private closeAnswers(): void {
    const book = this.book;
    if (!book || !book.isAnswering) return;
    book.closeAnswers();
    book.discardAnswers();
    this.emit({ type: 'answers-closed', q: book.serial, respondents: book.respondents });
    for (const p of this.seatedPlayers()) this.sendSurveyPrivate(p);
    if (!book.meetsAnonymityFloor) return this.reveal();
    const present = this.presentIds();
    if (present.length > 0 && present.every((id) => book.hasPredicted(id))) return this.reveal();
    const eligible = this.seatedPlayers()
      .filter((p) => !p.away)
      .map((p) => p.id);
    this.track(this.predictCollector(book), eligible);
    for (const id of eligible) if (book.hasPredicted(id)) this.markAnswered(id);
    this.runStage('predict', this.predictMs(), () => this.reveal());
    this.checkAllAnswered();
  }

  private reveal(): void {
    const book = this.book;
    if (!book || this.stage === 'reveal' || this.stage === 'final') return;
    this.untrack();
    const seated = this.seatedPlayers();
    const result = book.tally({ index: this.state.round, seated: seated.length, order: seated.map((p) => p.id) });
    for (const p of seated) this.addPoints(p.id, 0);
    for (const s of result.scores) this.addPoints(s.playerId, s.points);
    this.commitScores();
    if (result.voided) this.voided++;
    this.stats.record(result);
    this.history.push(historyEntry(result));
    const st = this.state;
    st.resultJson = JSON.stringify(result);
    st.historyJson = JSON.stringify(this.history);
    for (const p of seated) this.sendSurveyPrivate(p);
    this.emit({ type: 'reveal', q: book.serial, voided: result.voided });
    this.runStage('reveal', this.revealMs(result.voided), () => this.nextQuestion());
  }

  private finish(reason: string): void {
    this.book = null;
    this.clearPrivate(SURVEY_MSG.private);
    const st = this.state;
    st.questionJson = '';
    st.resultJson = '';
    st.progress.clear();
    const extras: SurveyPodiumExtras = {
      awards: this.stats.awards((id) => {
        const p = this.players.get(id);
        return p && !p.state.spectator ? p.state.name : undefined;
      }),
      recap: buildRecap(this.history),
      questions: this.history.length,
      voided: this.voided,
    };
    this.finishParty({
      reason,
      details: { mode: this.getSettings().mode, questions: this.history.length, voided: this.voided },
      extras: extras as unknown as Record<string, unknown>,
    });
    this.emit({ type: 'final' });
    const host = this.hostRecord;
    if (host) this.sendCustom(host);
  }

  // ===========================================================================
  // Private views
  // ===========================================================================

  private sendSurveyPrivate(player: PlayerRecord): void {
    const book = this.book;
    if (!book || player.state.spectator) return;
    const answer = book.answerOf(player.id);
    const payload: SurveyPrivate = {
      q: book.serial,
      answered: book.hasAnswered(player.id),
      skipped: answer === null,
      answer: typeof answer === 'number' ? answer : null,
      prediction: book.predictionOf(player.id) ?? null,
      sealed: !book.isAnswering,
    };
    this.sendPrivate(player, SURVEY_MSG.private, payload);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    super.syncPrivate(player);
    this.sendCustom(player);
  }

  private emit(event: SurveyEvent): void {
    this.broadcast(SURVEY_MSG.event, event);
  }

  private progressOf(id: string): SurveyProgressState {
    let prog = this.state.progress.get(id);
    if (!prog) {
      prog = new SurveyProgressState();
      this.state.progress.set(id, prog);
    }
    return prog;
  }

  // ===========================================================================
  // Player lifecycle (kit hooks first)
  // ===========================================================================

  protected override onPlayerJoined(player: PlayerRecord, info: { lateJoin: boolean }): void {
    super.onPlayerJoined(player, info);
    if (!info.lateJoin || player.state.spectator || !this.book) return;
    if (this.stage !== 'answer' && this.stage !== 'predict') return;
    // Late joiners can answer the open question (or predict once answering has closed).
    this.progressOf(player.id);
    this.seat(player.id).eligible = true;
    this.refreshAnswerCounts();
    this.sendSurveyPrivate(player);
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    super.onPlayerReconnected(player);
    if (!player.state.spectator && this.book && (this.stage === 'answer' || this.stage === 'predict')) {
      this.seat(player.id).eligible = true;
      this.refreshAnswerCounts();
    }
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    // A leaver's answer leaves with them: rejoining creates a new seat that may answer again, and
    // the anonymous tally must count each person once (no ballot stuffing, no inflated anonymity floor).
    const book = this.book;
    if (book?.withdraw(player.id)) {
      this.state.answersIn = book.answeredCount;
      this.state.predictionsIn = book.predictedCount;
    }
    super.onPlayerRemoved(player, reason);
    this.state.progress.delete(player.id);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.book = null;
    this.plan = [];
    this.history = [];
    this.voided = 0;
    this.stats.reset();
    const st = this.state;
    st.questionJson = '';
    st.resultJson = '';
    st.historyJson = '[]';
    st.answersIn = 0;
    st.predictionsIn = 0;
    st.progress.clear();
    const host = this.hostRecord;
    if (host) this.sendCustom(host);
  }
}

function toPrediction(payload: SurveyPredictPayload): SurveyPrediction {
  switch (payload.kind) {
    case 'majority':
      return { kind: 'majority', option: payload.option };
    case 'rank':
      return { kind: 'rank', order: [...payload.order] };
    case 'percent':
      return { kind: 'percent', percent: payload.percent };
  }
}
