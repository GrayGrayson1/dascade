/**
 * DASketch — authoritative drawing + guessing room.
 *
 * Turn flow (phase / stage):
 *   PLAYING/choosing  → the artist privately gets word choices (auto-pick on timeout)
 *   PLAYING/drawing   → artist streams draw events; guesses arrive through chat
 *   INTERMISSION/reveal → the word is revealed to everyone with the points gained
 *   … next artist / next round …  → RESULTS/final
 *
 * Secrets: the word lives only in `this.secret` and in private messages to the artist and
 * to players who guessed it. Public state carries only the masked hint until the reveal.
 */
import { CHAT, RATE, TokenBucket, containsProfanity, maskProfanity, randomId, type ChatKind, type ChatMessage } from '@dascade/shared';
import {
  DASKETCH_MSG,
  DEFAULT_DASKETCH_SETTINGS,
  DasketchSettingsSchema,
  SKETCH_LIMITS,
  SketchChooseSchema,
  SketchDrawSchema,
  SketchSyncSchema,
  SketchWordsSchema,
  cleanCustomWords,
  type DasketchSettings,
  type SketchAward,
  type SketchCanvasSnapshot,
  type SketchChoice,
  type SketchDrawPayload,
  type SketchGameEvent,
  type SketchPrivate,
  type SketchRevealReason,
  type SketchStage,
  type SketchStrokeRelay,
  type SketchTurnRecord,
  type SketchWordsPrivate,
} from '@dascade/shared/games/dasketch';
import {
  ARTIST_ALL_GUESSED_BONUS,
  SketchBoard,
  TurnOrder,
  WordPicker,
  artistShare,
  buildWordPool,
  classifyGuess,
  guessPoints,
  hintSchedule,
  letterIndices,
  maskWord,
  pickRevealIndex,
  rankStandings,
} from '@dascade/game-core/dasketch';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { groupSorted, withLeaversLast } from '../outcomePlacements.ts';
import { DasketchState, SketchPlayerState } from './schema.ts';

interface PlayerStats {
  name: string;
  correct: number;
  fastestMs: number;
  drawings: number;
  guessersOnDrawings: number;
}

/** Guesses on top of the shared chat limit: a steady one per second with a small burst. */
const GUESS_RATE = { burst: 5, perSecond: 1 } as const;

export class DasketchRoom extends BaseGameRoom<DasketchState, DasketchSettings> {
  readonly gameId = 'dasketch' as const;
  protected readonly settingsSchema = DasketchSettingsSchema;

  // Tunables (integration tests shorten these).
  protected choiceMs = 15_000;
  protected intermissionMs = 7_000;
  protected artistGraceMs = 5_000;
  protected allGuessedDelayMs = 900;

  private picker = new WordPicker([]);
  private readonly order = new TurnOrder();
  private board = new SketchBoard();
  private relaySeq = 0;
  private secret: string | null = null;
  private choices: SketchChoice[] = [];
  private readonly revealed = new Set<number>();
  private hintKeys: string[] = [];
  private readonly stats = new Map<string, PlayerStats>();
  private history: SketchTurnRecord[] = [];
  private readonly guessBuckets = new Map<string, TokenBucket>();
  /** Players already told (this turn) that only the artist may draw. */
  private readonly drawRejected = new Set<string>();
  /** The host's custom words — private: only the host ever receives them. */
  private customWords: string[] = [];
  private customReport: SketchWordsPrivate['report'] = { invalid: 0, duplicates: 0, filtered: 0, overflow: 0 };

  protected defaultSettings(): DasketchSettings {
    return structuredClone(DEFAULT_DASKETCH_SETTINGS);
  }

  protected createState(): DasketchState {
    return new DasketchState();
  }

  /** Drawing time for a turn (overridable in tests). */
  protected drawMsFor(): number {
    return this.getSettings().drawSeconds * 1000;
  }

  protected get stage(): SketchStage {
    return this.state.stage as SketchStage;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(): void {
    this.handle(DASKETCH_MSG.choose, SketchChooseSchema, (p, { index }) => this.onChoose(p, index), {
      phases: ['PLAYING'],
      playersOnly: true,
    });
    this.handle(DASKETCH_MSG.draw, SketchDrawSchema, (p, payload) => this.onDraw(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.stream,
      silent: true,
      // The draw budget's maximum: 3 + 6 per event (24) + the points of the whole message (2 × 600) = 1,347.
      maxNodes: SKETCH_LIMITS.pointsPerMessage * 2 + SKETCH_LIMITS.eventsPerMessage * 8,
    });
    this.handle(DASKETCH_MSG.sync, SketchSyncSchema, (p) => this.sendCanvas(p), {
      rate: { burst: 4, perSecond: 0.5 },
      silent: true,
      maxNodes: 4,
    });
    this.handle(DASKETCH_MSG.words, SketchWordsSchema, (p, { words }) => this.setCustomWords(p, words), {
      hostOnly: true,
      phases: ['LOBBY', 'RESULTS'],
      rate: { burst: 10, perSecond: 3 },
    });
  }

  private setCustomWords(host: PlayerRecord, raw: readonly string[]): void {
    const cleaned = cleanCustomWords(raw, false);
    this.customWords = cleaned.words;
    this.customReport = { invalid: cleaned.invalid, duplicates: cleaned.duplicates, filtered: 0, overflow: cleaned.overflow };
    this.refreshCustomCounts();
    this.sendWords(host);
  }

  /** Publishes how many custom words are usable (never the words themselves). */
  private refreshCustomCounts(): void {
    const filtered = this.getSettings().filterProfanity ? this.customWords.filter((w) => containsProfanity(w)).length : 0;
    this.customReport = { ...this.customReport, filtered };
    this.state.customCount = this.customWords.length - filtered;
    this.state.customFiltered = filtered;
  }

  /**
   * Sends the custom list to the host. Only while it can be edited (LOBBY/RESULTS): mid-match
   * the host may have changed (migration, transfer) to someone who is guessing, and the list
   * would reveal the candidate words.
   */
  private sendWords(player: PlayerRecord): void {
    if (player.id !== this.state.hostId) return;
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return;
    const payload: SketchWordsPrivate = { words: [...this.customWords], report: { ...this.customReport } };
    this.sendTo(player, DASKETCH_MSG.words, payload);
  }

  private poolInput() {
    return { ...this.getSettings(), customWords: this.customWords };
  }

  protected override onSettingsChanged(prev: DasketchSettings, next: DasketchSettings): void {
    if (prev.filterProfanity !== next.filterProfanity) {
      this.refreshCustomCounts();
      const host = this.hostRecord;
      if (host) this.sendWords(host);
    }
  }

  protected override onHostChanged(next: PlayerRecord | null): void {
    if (next) this.sendWords(next);
  }

  private onChoose(player: PlayerRecord, index: number): void {
    if (this.stage !== 'choosing') return this.reject(player, DASKETCH_MSG.choose, 'wrong_phase', 'The word has already been picked.');
    if (player.id !== this.state.artistId) return this.reject(player, DASKETCH_MSG.choose, 'not_your_turn', 'Only the artist picks the word.');
    const choice = this.choices[index];
    if (!choice) return this.reject(player, DASKETCH_MSG.choose, 'invalid_payload', 'That word is not one of your choices.');
    this.beginDrawing(choice);
  }

  private onDraw(player: PlayerRecord, { turn, events }: SketchDrawPayload): void {
    if (turn !== this.state.turn) return; // late packet from an earlier turn: drop silently
    if (player.id !== this.state.artistId) {
      if (!this.drawRejected.has(player.id)) {
        this.drawRejected.add(player.id);
        this.reject(player, DASKETCH_MSG.draw, 'not_your_turn', 'Only the artist can draw right now.');
      }
      return;
    }
    if (this.stage !== 'drawing') return; // the artist's in-flight strokes after time ran out
    const { applied } = this.board.applyAll(events);
    if (applied === 0) return;
    this.relaySeq++;
    const relay: SketchStrokeRelay = { turn, seq: this.relaySeq, events: applied === events.length ? events : events.slice(0, applied) };
    this.sendWhere((r) => r.id !== player.id, DASKETCH_MSG.stroke, relay);
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  protected override validateStart(): string | null {
    if (buildWordPool(this.poolInput()).entries.length === 0) {
      return 'The word list is empty — pick at least one category or add custom words.';
    }
    return null;
  }

  protected onGameStart(): void {
    const settings = this.getSettings();
    this.picker = new WordPicker(buildWordPool(this.poolInput()).entries);
    this.order.reset();
    this.stats.clear();
    this.history = [];
    this.state.historyJson = '[]';
    this.state.awardsJson = '[]';
    this.state.totalRounds = settings.rounds;
    this.state.turn = 0;
    this.state.sketch.clear();
    for (const p of this.seatedPlayers()) this.sketchOf(p.id);
    this.advance();
  }

  /** Starts the next turn (and round), or finishes the match. */
  private advance(): void {
    this.cancelTurnTimers();
    const present = this.seatedPlayers().filter((p) => !p.away);
    if (present.length < 2) {
      this.systemChat('Not enough players to keep drawing — here are the final scores!');
      this.finishMatch('not_enough_players');
      return;
    }
    let artist = this.nextArtist();
    if (!artist) {
      if (this.order.round >= this.getSettings().rounds) {
        this.finishMatch();
        return;
      }
      this.beginRound();
      artist = this.nextArtist();
      if (!artist) {
        this.finishMatch();
        return;
      }
    }
    this.startChoosing(artist);
  }

  private canDraw(id: string): boolean {
    const p = this.players.get(id);
    return Boolean(p && !p.state.spectator && p.client && !p.away);
  }

  private nextArtist(): PlayerRecord | null {
    const id = this.order.next((pid) => this.canDraw(pid));
    return id ? (this.players.get(id) ?? null) : null;
  }

  private beginRound(): void {
    const round = this.order.startRound(this.seatedPlayers().map((p) => p.id));
    this.state.round = round;
    this.state.totalRounds = this.getSettings().rounds;
    this.emit({ type: 'round', round, totalRounds: this.state.totalRounds });
    this.systemChat(`Round ${round} of ${this.state.totalRounds}`);
  }

  private startChoosing(artist: PlayerRecord): void {
    const s = this.state;
    s.turn += 1;
    s.stage = 'choosing';
    s.artistId = artist.id;
    s.turnInRound = this.order.done.length;
    s.turnsInRound = this.order.turnsThisRound;
    s.hint = '';
    s.word = '';
    s.revealReason = '';
    s.turnStartedAt = 0;
    s.drawMs = 0;
    s.artistPoints = 0;
    s.guessedCount = 0;
    s.eligibleCount = 0;
    for (const id of [...s.sketch.keys()]) if (!this.players.has(id)) s.sketch.delete(id);
    for (const p of this.seatedPlayers()) {
      const sk = this.sketchOf(p.id);
      sk.guessed = false;
      sk.rank = 0;
      sk.turnPoints = 0;
      sk.guessMs = 0;
    }
    this.secret = null;
    this.revealed.clear();
    this.drawRejected.clear();
    this.board = new SketchBoard();
    this.relaySeq = 0;
    this.choices = this.picker.pick(this.getSettings().choiceCount, this.rng);
    if (this.choices.length === 0) {
      this.finishMatch();
      return;
    }
    this.setPhase('PLAYING', this.choiceMs);
    this.broadcast(DASKETCH_MSG.canvas, this.canvasSnapshot());
    this.emit({ type: 'turn', turn: s.turn, artistId: artist.id });
    for (const p of this.players.values()) this.sendPrivate(p);
    this.schedule('choose', this.choiceMs, () => {
      if (this.stage !== 'choosing') return;
      const pick = this.choices[this.rng.int(this.choices.length)];
      if (pick) this.beginDrawing(pick);
    });
  }

  private beginDrawing(choice: SketchChoice): void {
    this.cancel('choose');
    const artist = this.players.get(this.state.artistId);
    if (!artist) {
      this.advance();
      return;
    }
    const drawMs = this.drawMsFor();
    this.secret = choice.word;
    this.picker.markUsed(choice.word);
    this.state.stage = 'drawing';
    this.state.drawMs = drawMs;
    this.state.turnStartedAt = Date.now();
    this.state.hint = maskWord(choice.word);
    this.state.eligibleCount = this.eligibleGuessers().length;
    this.setTimer(drawMs);
    this.hintKeys = hintSchedule(letterIndices(choice.word).length, this.getSettings().hints, drawMs).map((ms, i) => {
      const key = `hint:${i}`;
      this.schedule(key, ms, () => this.revealHint());
      return key;
    });
    this.schedule('turn-end', drawMs, () => this.endTurn('time'));
    this.statsOf(artist).drawings++;
    this.sendPrivate(artist);
    this.emit({ type: 'drawing', turn: this.state.turn, artistId: artist.id });
    this.systemChat(`${artist.state.name} is drawing now!`);
  }

  private revealHint(): void {
    if (this.stage !== 'drawing' || !this.secret) return;
    const idx = pickRevealIndex(this.secret, this.revealed, this.rng);
    if (idx === null) return;
    this.revealed.add(idx);
    this.state.hint = maskWord(this.secret, this.revealed);
    this.emit({ type: 'hint', turn: this.state.turn, hint: this.state.hint });
  }

  private endTurn(reason: SketchRevealReason): void {
    if (this.stage !== 'drawing') return;
    this.cancelTurnTimers();
    const word = this.secret ?? '';
    const s = this.state;
    const artist = this.players.get(s.artistId);
    if (reason === 'all' && artist && s.guessedCount > 0) {
      artist.state.score += ARTIST_ALL_GUESSED_BONUS;
      this.sketchOf(artist.id).turnPoints += ARTIST_ALL_GUESSED_BONUS;
      s.artistPoints += ARTIST_ALL_GUESSED_BONUS;
    }
    s.stage = 'reveal';
    s.word = word;
    s.hint = word;
    s.revealReason = reason;
    this.history.push({
      turn: s.turn,
      round: s.round,
      artistId: s.artistId,
      artistName: artist?.state.name ?? this.stats.get(s.artistId)?.name ?? 'Artist',
      word,
      guessers: s.guessedCount,
      eligible: s.eligibleCount,
      reason,
    });
    s.historyJson = JSON.stringify(this.history);
    this.setPhase('INTERMISSION', this.intermissionMs);
    this.emit({ type: 'reveal', turn: s.turn, word, reason });
    this.systemChat(`The word was “${word}”.`);
    this.schedule('next', this.intermissionMs, () => {
      this.setPhase('PLAYING');
      this.advance();
    });
  }

  private finishMatch(reason: 'completed' | 'not_enough_players' = 'completed'): void {
    this.cancelTurnTimers();
    this.secret = null;
    this.choices = [];
    this.state.stage = 'final';
    this.state.artistId = '';
    this.state.hint = '';
    this.state.awardsJson = JSON.stringify(this.computeAwards());
    const standings = rankStandings(
      this.seatedPlayers().map((p) => ({ id: p.id, score: p.state.score, joinOrder: p.state.joinOrder, record: p })),
    );
    this.reportSketchOutcome(standings, reason);
    this.endMatch({
      players: standings.map((s) => ({
        playerId: s.id,
        name: s.record.state.name,
        guestId: s.record.guestId,
        userId: s.record.userId,
        score: s.score,
        placement: s.placement,
      })),
      details: { rounds: this.state.round, turns: this.history.length },
    });
    const host = this.hostRecord;
    if (host) this.sendWords(host);
  }

  /**
   * DASCADE stats: places by final score (ties share a place), players who left mid-match last.
   * A match that ends before any drawing was revealed (everyone else left at once) is no contest.
   */
  private reportSketchOutcome(standings: ReadonlyArray<{ id: string; score: number }>, reason: string): void {
    if (this.history.length === 0) return;
    const placements = withLeaversLast(
      groupSorted(standings, (s) => s.id, (a, b) => a.score === b.score),
      this.matchLeaverIds(),
    );
    const scores: Record<string, number> = {};
    for (const s of standings) scores[s.id] = s.score;
    const playerStats: Record<string, Record<string, number>> = {};
    for (const id of placements.flat()) {
      const st = this.stats.get(id);
      playerStats[id] = {
        correctGuesses: st?.correct ?? 0,
        drawingsGuessed: this.history.filter((h) => h.artistId === id && h.guessers > 0).length,
        ...(st && st.fastestMs > 0 ? { minGuessMs: st.fastestMs } : {}),
      };
    }
    this.reportOutcome({ placements, scores, reason, details: { rounds: this.state.round, turns: this.history.length, playerStats } });
  }

  private computeAwards(): SketchAward[] {
    const present = [...this.stats.entries()].filter(([id]) => this.players.has(id));
    const awards: SketchAward[] = [];
    const best = (score: (s: PlayerStats) => number, lowest = false) =>
      present
        .filter(([, s]) => score(s) > 0 && Number.isFinite(score(s)))
        .sort((a, b) => (lowest ? score(a[1]) - score(b[1]) : score(b[1]) - score(a[1])))[0];
    const fastest = best((s) => s.fastestMs, true);
    if (fastest) awards.push({ id: 'fastest', playerId: fastest[0], name: fastest[1].name, value: `${(fastest[1].fastestMs / 1000).toFixed(1)}s` });
    const artist = best((s) => s.guessersOnDrawings);
    if (artist) {
      const n = artist[1].guessersOnDrawings;
      awards.push({ id: 'artist', playerId: artist[0], name: artist[1].name, value: `${n} correct guess${n === 1 ? '' : 'es'}` });
    }
    const sharp = best((s) => s.correct);
    if (sharp) awards.push({ id: 'sharp', playerId: sharp[0], name: sharp[1].name, value: `${sharp[1].correct} word${sharp[1].correct === 1 ? '' : 's'} guessed` });
    return awards;
  }

  private cancelTurnTimers(): void {
    for (const key of ['choose', 'turn-end', 'artist-grace', 'next', ...this.hintKeys]) this.cancel(key);
    this.hintKeys = [];
  }

  // ===========================================================================
  // Guessing (through the shared chat)
  // ===========================================================================

  protected override interceptChat(player: PlayerRecord, text: string): boolean {
    if (this.phase !== 'PLAYING') return false;

    if (this.stage === 'choosing') {
      // Keep the artist's word choices secret while they decide.
      if (player.id === this.state.artistId && this.choices.some((c) => classifyGuess(text, c.word) !== 'wrong')) {
        this.pushChat(this.chatLine(player, text, 'guess'), (r) => r.id === player.id);
        this.pushChat(this.noteLine('Shh — keep your word choices secret!', 'close'), (r) => r.id === player.id);
        return true;
      }
      return false;
    }

    if (this.stage !== 'drawing' || !this.secret) return false;

    if (player.state.spectator) {
      // Spectators can't score, and their chat must not leak guesses to players.
      this.pushChat(this.chatLine(player, text, 'chat'), (r) => r.state.spectator || this.knowsWord(r));
      return true;
    }

    if (this.knowsWord(player)) {
      // The artist and players who guessed talk among themselves.
      this.pushChat(this.chatLine(player, text, 'guess'), (r) => this.knowsWord(r));
      return true;
    }

    let bucket = this.guessBuckets.get(player.id);
    if (!bucket) {
      bucket = new TokenBucket(GUESS_RATE);
      this.guessBuckets.set(player.id, bucket);
    }
    if (!bucket.take()) {
      this.reject(player, CHAT.send, 'rate_limited', 'Easy there — one guess at a time!');
      return true;
    }

    const verdict = classifyGuess(text, this.secret);
    if (verdict === 'correct') {
      this.awardGuess(player);
      return true;
    }
    if (verdict === 'close') {
      // Never broadcast near-answers: only the guesser (and people who know the word) see it.
      this.pushChat(this.chatLine(player, text, 'chat'), (r) => r.id === player.id);
      this.pushChat(this.chatLine(player, text, 'guess'), (r) => r.id !== player.id && this.knowsWord(r));
      if (this.getSettings().closeGuesses) this.pushChat(this.noteLine(`“${text}” is so close!`, 'close'), (r) => r.id === player.id);
      return true;
    }
    return false; // wrong guess: an ordinary public chat line
  }

  private awardGuess(player: PlayerRecord): void {
    const s = this.state;
    const sk = this.sketchOf(player.id);
    if (sk.guessed) return;
    const elapsed = Math.max(0, Date.now() - s.turnStartedAt);
    const rank = s.guessedCount + 1;
    const points = guessPoints(elapsed, s.drawMs, rank);
    sk.guessed = true;
    sk.rank = rank;
    sk.turnPoints = points;
    sk.guessMs = elapsed;
    player.state.score += points;
    s.guessedCount = rank;

    const artist = this.players.get(s.artistId);
    const share = artist ? artistShare(points, s.eligibleCount) : 0;
    if (artist) {
      artist.state.score += share;
      this.sketchOf(artist.id).turnPoints += share;
      s.artistPoints += share;
      this.statsOf(artist).guessersOnDrawings++;
    }
    const st = this.statsOf(player);
    st.correct++;
    st.fastestMs = st.fastestMs > 0 ? Math.min(st.fastestMs, Math.max(1, elapsed)) : Math.max(1, elapsed);

    this.pushChat({
      id: randomId(10),
      playerId: player.id,
      name: player.state.name,
      color: player.state.color,
      text: `${player.state.name} guessed the word!`,
      ts: Date.now(),
      kind: 'correct',
    });
    this.pushChat(this.noteLine(`You got it! +${points} points. Only players who know the word can see your messages now.`, 'system'), (r) => r.id === player.id);
    this.sendPrivate(player);
    this.emit({ type: 'correct', turn: s.turn, playerId: player.id, points, rank, artistPoints: share });
    this.maybeEndEarly();
  }

  /** Ends the turn shortly after every connected guesser has the word. */
  private maybeEndEarly(): void {
    if (this.stage !== 'drawing') return;
    const guessers = this.eligibleGuessers();
    if (guessers.length > 0 && guessers.every((g) => this.sketchOf(g.id).guessed)) {
      for (const key of this.hintKeys) this.cancel(key);
      this.schedule('turn-end', this.allGuessedDelayMs, () => this.endTurn('all'));
    }
  }

  /** Connected, seated players other than the artist. */
  private eligibleGuessers(): PlayerRecord[] {
    return this.activePlayers().filter((p) => p.id !== this.state.artistId);
  }

  private knowsWord(p: PlayerRecord): boolean {
    if (this.stage !== 'drawing' && this.stage !== 'reveal') return false;
    if (p.id === this.state.artistId) return true;
    return Boolean(!p.state.spectator && this.state.sketch.get(p.id)?.guessed);
  }

  private chatLine(player: PlayerRecord, text: string, kind: ChatKind): ChatMessage {
    return { id: randomId(10), playerId: player.id, name: player.state.name, color: player.state.color, text: maskProfanity(text), ts: Date.now(), kind };
  }

  private noteLine(text: string, kind: ChatKind): ChatMessage {
    return { id: randomId(10), playerId: null, name: 'DASketch', text, ts: Date.now(), kind };
  }

  // ===========================================================================
  // Private info + canvas sync
  // ===========================================================================

  protected override syncPrivate(player: PlayerRecord): void {
    this.sendPrivate(player);
    this.sendWords(player);
    if (this.stage !== 'idle') this.sendCanvas(player);
  }

  private sendPrivate(player: PlayerRecord): void {
    const s = this.state;
    const live = this.stage === 'choosing' || this.stage === 'drawing' || this.stage === 'reveal';
    const isArtist = live && player.id === s.artistId && !player.state.spectator;
    const guessed = Boolean(!player.state.spectator && s.sketch.get(player.id)?.guessed);
    const knows = this.secret !== null && (isArtist ? this.stage !== 'choosing' : guessed);
    const payload: SketchPrivate = {
      turn: s.turn,
      role: player.state.spectator ? 'spectator' : isArtist ? 'artist' : 'guesser',
      choices: isArtist && this.stage === 'choosing' ? this.choices.map((c) => ({ ...c })) : null,
      word: knows ? this.secret : null,
      guessed,
    };
    this.sendTo(player, DASKETCH_MSG.private, payload);
  }

  private canvasSnapshot(): SketchCanvasSnapshot {
    return { turn: this.state.turn, seq: this.relaySeq, ...this.board.snapshot() };
  }

  private sendCanvas(player: PlayerRecord): void {
    this.sendTo(player, DASKETCH_MSG.canvas, this.canvasSnapshot());
  }

  private emit(event: SketchGameEvent): void {
    this.broadcast(DASKETCH_MSG.event, event);
  }

  // ===========================================================================
  // Player lifecycle
  // ===========================================================================

  protected override onPlayerJoined(player: PlayerRecord, { lateJoin }: { lateJoin: boolean }): void {
    if (!lateJoin || player.state.spectator) return;
    if (this.phase === 'PLAYING' || this.phase === 'INTERMISSION') {
      this.order.add(player.id);
      this.sketchOf(player.id);
      this.state.turnsInRound = this.order.turnsThisRound;
    }
  }

  protected override onPlayerDisconnected(player: PlayerRecord): void {
    if (player.id === this.state.artistId && (this.stage === 'choosing' || this.stage === 'drawing')) {
      this.schedule('artist-grace', this.artistGraceMs, () => this.artistGone(player, 'lost connection'));
      return;
    }
    this.maybeEndEarly();
  }

  protected override onPlayerReconnected(player: PlayerRecord): void {
    if (player.id === this.state.artistId) this.cancel('artist-grace');
  }

  protected override onPlayerAway(player: PlayerRecord): void {
    if (player.id === this.state.artistId) this.artistGone(player, 'lost connection');
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    this.order.remove(player.id);
    this.guessBuckets.delete(player.id);
    this.state.sketch.delete(player.id);
    // returnToLobby() switches to LOBBY before dropping away players, so this skips that sweep too.
    if (this.phase !== 'PLAYING' && this.phase !== 'INTERMISSION') return;
    if (player.id === this.state.artistId) {
      this.artistGone(player, 'left');
      return;
    }
    if (this.stage === 'choosing') {
      // Nobody left to guess: wrap up now instead of choosing + drawing for an empty room.
      if (this.seatedPlayers().filter((p) => !p.away).length < 2) this.advance();
    } else if (this.stage === 'drawing') {
      const others = this.seatedPlayers().filter((p) => p.id !== this.state.artistId);
      if (others.length === 0) this.endTurn('empty');
      else this.maybeEndEarly();
    }
  }

  /** The artist left or dropped for good: skip (choosing) or end the turn early (drawing). */
  private artistGone(player: PlayerRecord, why: 'left' | 'lost connection'): void {
    if (player.id !== this.state.artistId) return;
    this.cancel('artist-grace');
    if (this.stage === 'choosing') {
      this.systemChat(`${player.state.name} ${why} before picking a word.`);
      this.advance();
    } else if (this.stage === 'drawing') {
      this.systemChat(`${player.state.name} ${why} mid-drawing — revealing the word.`);
      this.endTurn('artist_left');
    }
  }

  protected override onReturnToLobby(): void {
    this.cancelTurnTimers();
    this.order.reset();
    this.board = new SketchBoard();
    this.relaySeq = 0;
    this.secret = null;
    this.choices = [];
    this.revealed.clear();
    this.stats.clear();
    this.history = [];
    this.drawRejected.clear();
    const s = this.state;
    s.stage = 'idle';
    s.artistId = '';
    s.turn = 0;
    s.turnInRound = 0;
    s.turnsInRound = 0;
    s.hint = '';
    s.word = '';
    s.revealReason = '';
    s.turnStartedAt = 0;
    s.drawMs = 0;
    s.artistPoints = 0;
    s.guessedCount = 0;
    s.eligibleCount = 0;
    s.sketch.clear();
    s.historyJson = '[]';
    s.awardsJson = '[]';
    const host = this.hostRecord;
    if (host) this.sendWords(host);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private sketchOf(id: string): SketchPlayerState {
    let sk = this.state.sketch.get(id);
    if (!sk) {
      sk = new SketchPlayerState();
      this.state.sketch.set(id, sk);
    }
    return sk;
  }

  private statsOf(player: PlayerRecord): PlayerStats {
    let st = this.stats.get(player.id);
    if (!st) {
      st = { name: player.state.name, correct: 0, fastestMs: 0, drawings: 0, guessersOnDrawings: 0 };
      this.stats.set(player.id, st);
    }
    st.name = player.state.name;
    return st;
  }
}
