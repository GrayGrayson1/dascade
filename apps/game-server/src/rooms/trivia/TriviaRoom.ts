/**
 * DAStravaganza Trivia — authoritative trivia show built on the party kit (PartyRoom).
 *
 * Stage machine (phase PLAYING):
 *   intro → question ─(timer | everyone locked in | host skip)→ reveal → scores → question … →
 *   [final wager on: wager → question(final) → reveal] → RESULTS (podium)
 *
 * Secrets: the answer key lives only in `this.current.key` (server memory) until the reveal.
 * Public state carries the question view (no answer), who has answered (never what), and after
 * the reveal the correct answer, the distribution and per-player results. Each player's own
 * locked answer / result / wager is private (kit mailbox → re-sent on reconnect). Custom packs are
 * only ever sent to the host who uploaded them (not to a later host), and only in the lobby / results.
 */
import { t, type SchemaType } from '@colyseus/schema';
import { cleanText, type CreateOptions } from '@dascade/shared';
import {
  DEFAULT_TRIVIA_SETTINGS,
  TRIVIA_CATEGORY_IDS,
  TRIVIA_LIMITS,
  TRIVIA_MSG,
  TRIVIA_TYPES,
  TriviaAnswerSchema,
  TriviaPackUploadSchema,
  TriviaSettingsSchema,
  TriviaWagerSchema,
  countMatrix,
  type TriviaAnswerInput,
  type TriviaEvent,
  type TriviaPack,
  type TriviaPackEcho,
  type TriviaPackInfo,
  type TriviaPlayerResult,
  type TriviaPrivate,
  type TriviaSettings,
} from '@dascade/shared/games/trivia';
import type { AnswerBox } from '@dascade/game-core/party';
import {
  arrangeFinal,
  buildPool,
  isValidAnswer,
  maxWager,
  pickQuestions,
  presentQuestion,
  questionPoints,
  scoreQuestion,
  validatePack,
  type PoolQuestion,
  type PresentedQuestion,
} from '@dascade/game-core/trivia';
import { STARTER_QUESTIONS } from '@dascade/game-core/trivia/content';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { PartyRoom, PartyRoomState } from '../party/index.ts';

export const TriviaState = PartyRoomState.extend(
  {
    questionJson: t.string().default(''),
    revealJson: t.string().default(''),
    packInfoJson: t.string().default(''),
    finalCategory: t.string().default(''),
    correctJson: t.string().default(''),
  },
  'TriviaState',
);
export type TriviaState = SchemaType<typeof TriviaState>;

interface LiveQuestion extends PresentedQuestion {
  box: AnswerBox<TriviaAnswerInput>;
  windowMs: number;
}

/** Minimum questions a pool must offer before a match may start. */
const MIN_POOL = 3;

export class TriviaRoom extends PartyRoom<TriviaState, TriviaSettings> {
  readonly gameId = 'trivia' as const;
  protected readonly settingsSchema = TriviaSettingsSchema;

  // Stage timings (integration tests shrink these).
  protected introMs = 3200;
  protected revealMs = 6500;
  protected scoresMs = 5200;
  protected soloScoresMs = 2200;
  protected wagerMs = 20_000;
  /** Answer window override for tests (ms); null = settings.answerSeconds. */
  protected answerMsOverride: number | null = null;

  private custom: TriviaPack | null = null;
  /** Who uploaded the custom pack: only they ever see its questions/answers again (host changes don't). */
  private customOwner: string | null = null;
  private customErrors: string[] = [];
  /** Starter/custom keys played recently in this room (avoid repeats across matches). */
  private readonly recent = new Set<string>();
  private questions: PoolQuestion[] = [];
  private qIndex = 0;
  private seq = 0;
  private current: LiveQuestion | null = null;
  private wagerBox: AnswerBox<number> | null = null;
  private finalSeq = 0;
  private readonly streaks = new Map<string, number>();
  private readonly correct = new Map<string, number>();
  /** Best streak per player this match (profile stats: bestStreak). */
  private readonly bestStreak = new Map<string, number>();
  private readonly wagers = new Map<string, number>();

  protected defaultSettings(): TriviaSettings {
    return structuredClone(DEFAULT_TRIVIA_SETTINGS);
  }

  protected createState(): TriviaState {
    return new TriviaState();
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.publishPackInfo();
    this.handle(TRIVIA_MSG.answer, TriviaAnswerSchema, (p, { seq, answer }) => this.onAnswer(p, seq, answer), {
      phases: ['PLAYING'],
      rate: { burst: 4, perSecond: 2 },
    });
    this.handle(TRIVIA_MSG.wager, TriviaWagerSchema, (p, { seq, amount }) => this.onWager(p, seq, amount), {
      phases: ['PLAYING'],
      rate: { burst: 4, perSecond: 2 },
    });
    this.handle(TRIVIA_MSG.pack, TriviaPackUploadSchema, (p, { pack }) => this.onPack(p, pack), {
      hostOnly: true,
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 4, perSecond: 0.5 },
      maxBytes: TRIVIA_LIMITS.packBytes,
    });
  }

  private onAnswer(player: PlayerRecord, seq: number, raw: TriviaAnswerInput): void {
    const live = this.current;
    if (this.stage !== 'question' || !live) return this.rejectReason(player, TRIVIA_MSG.answer, 'closed');
    if (seq !== live.view.seq) return this.rejectReason(player, TRIVIA_MSG.answer, 'stale');
    let answer = raw;
    if (answer.kind === 'text') {
      const text = cleanText(answer.text, TRIVIA_LIMITS.typed);
      if (!text) return this.rejectReason(player, TRIVIA_MSG.answer, 'invalid');
      answer = { kind: 'text', text };
    }
    if (!isValidAnswer(live.view, answer)) return this.rejectReason(player, TRIVIA_MSG.answer, 'invalid');
    if (this.submitAnswer(player, live.box, answer, TRIVIA_MSG.answer)) this.sendOwnPrivate(player);
  }

  private onWager(player: PlayerRecord, seq: number, amount: number): void {
    const box = this.wagerBox;
    if (this.stage !== 'wager' || !box) return this.rejectReason(player, TRIVIA_MSG.wager, 'closed');
    if (seq !== this.finalSeq) return this.rejectReason(player, TRIVIA_MSG.wager, 'stale');
    const max = this.maxWagerFor(player.id);
    if (amount < 0 || amount > max)
      return this.reject(player, TRIVIA_MSG.wager, 'invalid_payload', `Wager between 0 and ${max.toLocaleString('en-US')} points.`);
    if (this.submitAnswer(player, box, Math.round(amount), TRIVIA_MSG.wager)) this.sendOwnPrivate(player);
  }

  private onPack(host: PlayerRecord, raw: unknown): void {
    if (raw === null) {
      this.custom = null;
      this.customOwner = null;
      this.customErrors = [];
    } else {
      const result = validatePack(raw);
      if (!result.pack) {
        this.customErrors = result.errors;
        this.sendPackEcho(host);
        this.reject(host, TRIVIA_MSG.pack, 'invalid_payload', `That pack has problems: ${result.errors[0] ?? 'invalid'}`);
        return;
      }
      this.custom = result.pack;
      this.customOwner = host.id;
      this.customErrors = [];
      // New custom questions: forget recent custom keys (indices changed).
      for (const k of [...this.recent]) if (k.startsWith('custom-')) this.recent.delete(k);
    }
    this.publishPackInfo();
    this.sendPackEcho(host);
  }

  /**
   * The host's pack editor gets the full pack — only between matches, and only when this host wrote
   * it (it contains every answer). A host who inherited the role (migration, transfer) sees that a
   * pack exists and may replace or clear it, but never its questions.
   */
  private sendPackEcho(player: PlayerRecord): void {
    if (player.id !== this.state.hostId) return;
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return;
    const custom = this.custom;
    const echo: TriviaPackEcho =
      custom && this.customOwner !== player.id
        ? { pack: null, errors: this.customErrors, hidden: { title: custom.title ?? 'Custom pack', total: custom.questions.length } }
        : { pack: custom, errors: this.customErrors };
    this.sendTo(player, TRIVIA_MSG.packEcho, echo);
  }

  private publishPackInfo(): void {
    const byCategory: Record<string, number> = Object.fromEntries(TRIVIA_CATEGORY_IDS.map((c) => [c, 0]));
    const byType: Record<string, number> = Object.fromEntries(TRIVIA_TYPES.map((c) => [c, 0]));
    for (const q of STARTER_QUESTIONS) {
      byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
      byType[q.type] = (byType[q.type] ?? 0) + 1;
    }
    const info: TriviaPackInfo = {
      starter: { total: STARTER_QUESTIONS.length, byCategory, byType, matrix: countMatrix(STARTER_QUESTIONS) },
      custom: this.custom
        ? { title: this.custom.title ?? 'Custom pack', total: this.custom.questions.length, matrix: countMatrix(this.custom.questions) }
        : null,
    };
    this.state.packInfoJson = JSON.stringify(info);
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  private pool(): PoolQuestion[] {
    return buildPool(STARTER_QUESTIONS, this.custom?.questions ?? [], this.getSettings());
  }

  protected override validateStart(): string | null {
    const s = this.getSettings();
    if (s.pack === 'custom' && !this.custom)
      return 'Add a custom question pack first (Settings → Custom pack), or switch to the starter pack.';
    const size = this.pool().length;
    if (size < MIN_POOL)
      return `Only ${size} question${size === 1 ? '' : 's'} match these settings — pick more categories, question types or difficulties.`;
    if (s.mode === 'teams') {
      const seated = this.activePlayers().length;
      if (seated < s.teamCount) return `Team mode with ${s.teamCount} teams needs at least ${s.teamCount} players.`;
    }
    return null;
  }

  protected onGameStart(): void {
    const s = this.getSettings();
    const pool = this.pool();
    let picked = pickQuestions(pool, s.questionCount, this.rng, this.recent);
    if (s.finalWager && picked.length >= 2) picked = arrangeFinal(picked, this.rng);
    for (const p of picked) this.recent.add(p.key);
    // Cycle through the pool: once most of it has been played, allow repeats again.
    if (this.recent.size >= Math.max(1, Math.floor(pool.length * 0.8))) {
      this.recent.clear();
      for (const p of picked) this.recent.add(p.key);
    }
    this.questions = picked;
    this.qIndex = 0;
    this.current = null;
    this.wagerBox = null;
    this.streaks.clear();
    this.correct.clear();
    this.bestStreak.clear();
    this.wagers.clear();
    const s2 = this.state;
    s2.questionJson = '';
    s2.revealJson = '';
    s2.finalCategory = '';
    s2.correctJson = '';
    this.startParty({ totalRounds: picked.length, teams: s.mode === 'teams' ? { count: s.teamCount, scoring: s.teamScoring } : null });
    for (const p of this.seatedPlayers()) this.correct.set(p.id, 0);
    this.runStage('intro', this.introMs, () => this.nextQuestion());
  }

  private get hasFinal(): boolean {
    return this.getSettings().finalWager && this.questions.length >= 2;
  }

  private isFinalIndex(i: number): boolean {
    return this.hasFinal && i === this.questions.length - 1;
  }

  private nextQuestion(): void {
    if (this.qIndex >= this.questions.length) {
      this.finish();
      return;
    }
    if (this.isFinalIndex(this.qIndex) && this.stage !== 'wager') {
      this.startWager();
      return;
    }
    this.askQuestion();
  }

  private startWager(): void {
    const next = this.questions[this.qIndex];
    if (!next) return this.finish();
    this.finalSeq = ++this.seq;
    this.current = null;
    this.wagers.clear();
    this.state.round = this.qIndex + 1;
    this.state.questionJson = '';
    this.state.revealJson = '';
    this.state.finalCategory = next.q.category;
    this.wagerBox = this.openAnswers<number>();
    for (const p of this.seatedPlayers()) this.sendOwnPrivate(p);
    this.emit({ type: 'final' });
    this.runStage('wager', this.wagerMs, () => {
      const box = this.wagerBox;
      if (box) {
        box.close();
        for (const r of box.entries()) this.wagers.set(r.playerId, r.value);
      }
      this.untrack();
      this.askQuestion();
    });
  }

  private askQuestion(): void {
    const entry = this.questions[this.qIndex];
    if (!entry) return this.finish();
    const s = this.getSettings();
    const isFinal = this.isFinalIndex(this.qIndex);
    const seq = isFinal && this.finalSeq ? this.finalSeq : ++this.seq;
    const presented = presentQuestion(
      entry.q,
      {
        seq,
        index: this.qIndex + 1,
        total: this.questions.length,
        isFinal,
        points: questionPoints(entry.q, s.basePoints, s.difficultyBonus),
      },
      this.rng,
    );
    const windowMs = this.answerMsOverride ?? s.answerSeconds * 1000;
    const box = this.openAnswers<TriviaAnswerInput>();
    this.current = { ...presented, box, windowMs };
    this.state.round = this.qIndex + 1;
    this.state.revealJson = '';
    this.state.questionJson = JSON.stringify(presented.view);
    this.emit({ type: 'question', seq });
    this.runStage('question', windowMs, () => this.reveal());
  }

  private reveal(): void {
    const live = this.current;
    if (!live) return;
    live.box.close();
    this.untrack();
    const s = this.getSettings();
    const answers = live.box
      .entries()
      .map((r) => ({ playerId: r.playerId, input: r.value, elapsedMs: Math.max(0, r.at - live.box.openedAt) }));
    const scores = new Map(this.seatedPlayers().map((p) => [p.id, p.state.score]));
    const scored = scoreQuestion({
      view: live.view,
      key: live.key,
      playerIds: live.box.eligibleIds().filter((id) => this.players.has(id) && !this.players.get(id)!.state.spectator),
      answers: answers.filter((a) => this.players.has(a.playerId)),
      windowMs: live.windowMs,
      speedBonus: s.speedBonus,
      streakBonus: s.streakBonus,
      streaks: this.streaks,
      wagers: live.view.isFinal ? this.wagers : undefined,
      scores,
    });
    for (const [id, res] of Object.entries(scored.results)) {
      this.addPoints(id, res.points);
      if (res.correct) this.correct.set(id, (this.correct.get(id) ?? 0) + 1);
    }
    for (const [id, streak] of scored.streaks) {
      this.streaks.set(id, streak);
      this.setStreak(id, streak);
      if (streak > (this.bestStreak.get(id) ?? 0)) this.bestStreak.set(id, streak);
    }
    this.commitScores();
    this.state.revealJson = JSON.stringify(scored.reveal);
    for (const id of Object.keys(scored.results)) {
      const p = this.players.get(id);
      if (p) this.sendOwnPrivate(p, scored.results[id]);
    }
    this.emit({ type: 'reveal', seq: live.view.seq });
    const last = this.qIndex >= this.questions.length - 1;
    this.runStage('reveal', this.revealMs, () => {
      if (last) return this.finish();
      const solo = this.seatedPlayers().length <= 1;
      this.runStage('scores', solo ? this.soloScoresMs : this.scoresMs, () => {
        this.qIndex += 1;
        this.nextQuestion();
      });
    });
  }

  private finish(): void {
    const correctByPlayer: Record<string, number> = {};
    // Profile stats (packages/shared/src/stats.ts): correctAnswers sums, bestStreak keeps the max.
    const playerStats: Record<string, Record<string, number>> = {};
    for (const p of this.seatedPlayers()) {
      correctByPlayer[p.id] = this.correct.get(p.id) ?? 0;
      playerStats[p.id] = { correctAnswers: correctByPlayer[p.id]!, bestStreak: this.bestStreak.get(p.id) ?? 0 };
    }
    this.state.correctJson = JSON.stringify(correctByPlayer);
    this.current = null;
    this.wagerBox = null;
    const s = this.getSettings();
    this.finishParty({
      reason: 'completed',
      details: { questions: this.questions.length, correctByPlayer, playerStats, finalWager: this.hasFinal, mode: s.mode },
      extras: { correctByPlayer, questions: this.questions.length },
    });
    const host = this.hostRecord;
    if (host) this.sendPackEcho(host);
  }

  // ===========================================================================
  // Private views
  // ===========================================================================

  private maxWagerFor(playerId: string): number {
    const p = this.players.get(playerId);
    return maxWager(p?.state.score ?? 0, this.getSettings().basePoints);
  }

  /** (Re)build and send this player's private view for the current question / wager. */
  private sendOwnPrivate(player: PlayerRecord, result?: TriviaPlayerResult): void {
    if (player.state.spectator) return;
    const inWager = this.stage === 'wager' && this.wagerBox !== null;
    const live = this.current;
    const seq = inWager ? this.finalSeq : (live?.view.seq ?? this.seq);
    const wagerRecord = this.wagerBox?.get(player.id);
    const isFinalSeq = seq === this.finalSeq && this.finalSeq > 0;
    const payload: TriviaPrivate = {
      seq,
      answer: live && !inWager ? (live.box.get(player.id)?.value ?? null) : null,
      result: result ?? null,
      wager: isFinalSeq
        ? {
            amount: wagerRecord?.value ?? this.wagers.get(player.id) ?? 0,
            max: this.maxWagerFor(player.id),
            locked: Boolean(wagerRecord?.locked) || this.wagers.has(player.id),
          }
        : null,
    };
    // Keep a revealed result when re-sending (e.g. a late wager/answer echo never overwrites it).
    this.sendPrivate(player, TRIVIA_MSG.private, payload);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    super.syncPrivate(player);
    this.sendPackEcho(player);
  }

  private emit(event: TriviaEvent): void {
    this.broadcast(TRIVIA_MSG.event, event);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected override onPlayerJoined(player: PlayerRecord, info: { lateJoin: boolean }): void {
    super.onPlayerJoined(player, info);
    if (player.state.spectator || !info.lateJoin) return;
    if (!this.correct.has(player.id)) this.correct.set(player.id, 0);
    if (this.stage === 'wager') this.sendOwnPrivate(player);
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next) this.sendPackEcho(next);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.questions = [];
    this.qIndex = 0;
    this.current = null;
    this.wagerBox = null;
    this.finalSeq = 0;
    this.streaks.clear();
    this.correct.clear();
    this.bestStreak.clear();
    this.wagers.clear();
    const s = this.state;
    s.questionJson = '';
    s.revealJson = '';
    s.finalCategory = '';
    s.correctJson = '';
    const host = this.hostRecord;
    if (host) this.sendPackEcho(host);
  }
}
