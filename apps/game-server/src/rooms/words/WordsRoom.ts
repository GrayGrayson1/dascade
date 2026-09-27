/**
 * DASwords — authoritative word-game room (Letter Grid, Anagram Sprint, Word Chain, Forbidden Letter).
 * Built on the DAStravaganza party kit (PartyRoom: stages, seats, teams, scores, podium, mailbox).
 *
 * Match flow (phase PLAYING throughout, RESULTS at the end):
 *   intro → play → [review] → reveal → … next round … → final           (grid / anagram / forbidden)
 *   intro → link → linkReveal → link → … → reveal → … next chain … → final (chain)
 *
 * Authority: the server owns the dictionary, the puzzle (board, rack, category + letter, chain),
 * validates every word (path adjacency, rack letters, link letters, forbidden letter, dictionary,
 * blocklist, duplicates, limits, timing) and computes every score. Clients only send words.
 *
 * Secrets: board solutions, the anagram seed, everyone's words and chain answers stay in memory;
 * each player gets only their own list (words:private, re-sent on reconnect via the kit mailbox).
 * Pending Forbidden Letter answers are shown to the room anonymously during the host review.
 */
import { cleanText, type CreateOptions } from '@dascade/shared';
import {
  DEFAULT_WORDS_SETTINGS,
  WORDS_LIMITS,
  WORDS_MODE_INFO,
  WORDS_MSG,
  WordsReviewAllSchema,
  WordsReviewSchema,
  WordsSettingsSchema,
  WordsSubmitSchema,
  lengthPoints,
  type ChainLinkReveal,
  type ReviewVerdict,
  type WordsEntry,
  type WordsEvent,
  type WordsMode,
  type WordsPrivate,
  type WordsRejectReason,
  type WordsRevealPlayer,
  type WordsRevealWord,
  type WordsReviewItem,
  type WordsRoundReveal,
  type WordsRoundSummary,
  type WordsSettings,
  type WordsSubmitPayload,
} from '@dascade/shared/games/words';
import {
  ChainGame,
  HuntRound,
  checkAnagramWord,
  checkForbiddenAnswer,
  checkGridWord,
  containsBlockedWord,
  forbiddenFinalPoints,
  isBlockedWord,
  linkSeconds,
  markHunt,
  maskBlocked,
  normalizePhrase,
  normalizeWord,
  phraseKey,
  pickForbiddenRound,
  pickRack,
  rollPlayableGrid,
  type ForbiddenRoundSpec,
  type HuntRecord,
  type HuntVerdict,
  type MarkedWord,
  type Rack,
  type RolledGrid,
  type WordDictionary,
} from '@dascade/game-core/words';
import type { PlayerRecord, RemovalReason } from '../BaseGameRoom.ts';
import { PartyRoom, type PartyCollector } from '../party/index.ts';
import { WordsSeatState, WordsState } from './schema.ts';
import { wordsDictionary } from './dictionary.ts';

/** Generous for fast typists and tracing bursts; still stops floods. */
const SUBMIT_RATE = { burst: 10, perSecond: 5 } as const;
const REVIEW_RATE = { burst: 20, perSecond: 8 } as const;
/** Rejected attempts kept per player per chain. */
const CHAIN_REJECTS = 12;

interface PlayerStats {
  name: string;
  words: number;
  unique: number;
  longest: string;
  links: number;
}

export class WordsRoom extends PartyRoom<WordsState, WordsSettings> {
  readonly gameId = 'words' as const;
  protected readonly settingsSchema = WordsSettingsSchema;
  /** The round intro card is the countdown. */
  protected override countdownMs = 0;
  protected override skippableStages: readonly string[] = ['intro', 'play', 'review', 'linkReveal', 'reveal'];

  // Tunables (integration tests shorten these).
  protected firstIntroMs = 6000;
  protected introMs = 4000;
  protected revealMs = 15_000;
  protected linkRevealMs = 3800;
  /** Test overrides for the answer windows (ms); null = use settings. */
  protected playMsOverride: number | null = null;
  protected linkMsOverride: number | null = null;
  protected reviewMsOverride: number | null = null;
  /** Test hook: fixed chain starter word. */
  protected chainStarterOverride: string | null = null;

  private dict!: WordDictionary;
  private hunt: HuntRound | null = null;
  private grid: RolledGrid | null = null;
  private rack: Rack | null = null;
  private spec: ForbiddenRoundSpec | null = null;
  private chain: ChainGame | null = null;
  private linkOpenedAt = 0;
  /** Word Chain: each player's entries (answers + recent rejections) for the current chain. */
  private readonly chainEntries = new Map<string, WordsEntry[]>();
  private readonly chainScore = new Map<string, number>();
  private readonly chainWords = new Map<string, WordsRevealWord[]>();
  private entryCounter = 0;
  private readonly reviewKeys = new Map<string, string>();
  private reviewItems: WordsReviewItem[] = [];
  private readonly seq = new Map<string, number>();
  private readonly last = new Map<string, WordsPrivate['last']>();
  private readonly usedSeeds = new Set<string>();
  private readonly usedCategories = new Set<string>();
  private history: WordsRoundSummary[] = [];
  private readonly stats = new Map<string, PlayerStats>();

  protected defaultSettings(): WordsSettings {
    return structuredClone(DEFAULT_WORDS_SETTINGS);
  }

  protected createState(): WordsState {
    return new WordsState();
  }

  private get mode(): WordsMode {
    return this.state.mode as WordsMode;
  }

  // ===========================================================================
  // Messages
  // ===========================================================================

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.dict = wordsDictionary();
    this.state.mode = this.getSettings().mode;
    this.handle(WORDS_MSG.submit, WordsSubmitSchema, (p, payload) => this.onSubmit(p, payload), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: SUBMIT_RATE,
      maxBytes: 400,
    });
    this.handle(WORDS_MSG.review, WordsReviewSchema, (p, { round, id, verdict }) => this.onReview(p, round, id, verdict), {
      phases: ['PLAYING'],
      hostOnly: true,
      rate: REVIEW_RATE,
    });
    this.handle(WORDS_MSG.reviewAll, WordsReviewAllSchema, (p, { round, verdict }) => this.onReviewAll(p, round, verdict), {
      phases: ['PLAYING'],
      hostOnly: true,
    });
  }

  protected override onSettingsChanged(): void {
    if (this.phase === 'LOBBY') this.state.mode = this.getSettings().mode;
  }

  protected override validateStart(): string | null {
    const teams = this.getSettings().teams;
    const seated = this.seatedPlayers().filter((p) => p.client).length;
    if (!this.isSolo && teams >= 2 && seated < teams) return `Team mode with ${teams} teams needs at least ${teams} players.`;
    return null;
  }

  private onSubmit(player: PlayerRecord, { round, word, path }: WordsSubmitPayload): void {
    const type = WORDS_MSG.submit;
    if (round !== this.state.round) return this.reject(player, type, 'wrong_phase', 'That word was for an earlier round.');
    if (this.state.paused) return this.reject(player, type, 'wrong_phase', 'The game is paused.');
    const raw = cleanText(word, WORDS_LIMITS.input);
    if (!raw) return this.reject(player, type, 'invalid_payload', 'Type a word first.');
    if (this.stage === 'link') return this.submitChain(player, raw);
    if (this.stage !== 'play' || !this.hunt?.isOpen) return this.reject(player, type, 'wrong_phase', 'Time’s up — words are closed.');
    this.submitHunt(player, raw, path);
  }

  // ===========================================================================
  // Match flow
  // ===========================================================================

  protected onGameStart(): void {
    const s = this.getSettings();
    this.startParty({ totalRounds: s.rounds, teams: s.teams >= 2 && !this.isSolo ? { count: s.teams, scoring: 'sum' } : null });
    this.resetMatch();
    this.state.mode = s.mode;
    for (const p of this.seatedPlayers()) this.progressOf(p.id);
    this.nextRound();
  }

  private resetMatch(): void {
    this.resetRound();
    this.usedSeeds.clear();
    this.usedCategories.clear();
    this.history = [];
    this.stats.clear();
    this.seq.clear();
    this.last.clear();
    const st = this.state;
    st.revealJson = '';
    st.historyJson = '[]';
    st.progress.clear();
  }

  private resetRound(): void {
    this.hunt?.close();
    this.hunt = null;
    this.grid = null;
    this.rack = null;
    this.spec = null;
    this.chain = null;
    this.chainEntries.clear();
    this.chainScore.clear();
    this.chainWords.clear();
    this.reviewKeys.clear();
    this.reviewItems = [];
    const st = this.state;
    st.grid.clear();
    st.rack = '';
    st.possible = 0;
    st.category = '';
    st.categoryHint = '';
    st.forbidden = '';
    st.chainWord = '';
    st.chainPrefix = '';
    st.chainLink = 0;
    st.chainLinks = 0;
    st.chainJson = '[]';
    st.linkJson = '';
    st.reviewJson = '[]';
    for (const prog of st.progress.values()) {
      prog.found = 0;
      prog.lives = 0;
      prog.out = false;
    }
  }

  private nextRound(): void {
    this.resetRound();
    this.untrack();
    const st = this.state;
    st.round += 1;
    this.preparePuzzle();
    for (const p of this.seatedPlayers()) this.pushPrivate(p.id);
    this.emit({ type: 'round', round: st.round, mode: this.mode });
    this.runStage('intro', st.round === 1 ? this.firstIntroMs : this.introMs, () => this.beginPlay());
  }

  /** Generates the round's puzzle server-side (published only when play begins). */
  private preparePuzzle(): void {
    const s = this.getSettings();
    const st = this.state;
    switch (this.mode) {
      case 'grid':
        this.grid = rollPlayableGrid(s.gridSize, s.gridMinLength, this.dict, this.rng);
        st.gridSize = s.gridSize;
        st.minLength = s.gridMinLength;
        break;
      case 'anagram':
        this.rack = pickRack(this.dict, s.rackSize, this.rng, this.usedSeeds);
        for (const seed of this.rack.seeds) this.usedSeeds.add(seed);
        st.minLength = 3;
        break;
      case 'forbidden':
        this.spec = pickForbiddenRound(this.rng, this.usedCategories);
        this.usedCategories.add(this.spec.category.id);
        st.minLength = 3;
        break;
      case 'chain':
        this.chain = new ChainGame({ rule: s.chainRule, minLength: s.chainMinLength, lives: s.chainLives, maxLinks: s.chainLinks }, this.dict, this.rng);
        st.chainRule = s.chainRule;
        st.chainLinks = s.chainLinks;
        st.minLength = s.chainMinLength;
        break;
    }
  }

  private beginPlay(): void {
    const s = this.getSettings();
    const st = this.state;
    if (this.mode === 'chain') {
      const chain = this.chain as ChainGame;
      chain.start(
        this.seatedPlayers().map((p) => p.id),
        this.chainStarterOverride ?? undefined,
      );
      st.chainJson = JSON.stringify(chain.trail);
      for (const p of this.seatedPlayers()) {
        const prog = this.progressOf(p.id);
        prog.lives = chain.lives.get(p.id) ?? 0;
        prog.out = false;
        prog.found = 0;
      }
      this.emit({ type: 'play', round: st.round });
      this.startLink();
      return;
    }
    this.hunt = new HuntRound({ maxWords: WORDS_LIMITS.maxWords, maxRejects: WORDS_LIMITS.maxRejects });
    let seconds = 60;
    if (this.mode === 'grid' && this.grid) {
      st.grid.clear();
      st.grid.push(...this.grid.tiles);
      st.possible = this.grid.solutions.size;
      seconds = s.gridSeconds;
    } else if (this.mode === 'anagram' && this.rack) {
      st.rack = this.rack.letters;
      st.possible = this.rack.solutions.length;
      seconds = s.anagramSeconds;
    } else if (this.mode === 'forbidden' && this.spec) {
      st.category = this.spec.category.label;
      st.categoryHint = this.spec.category.hint;
      st.forbidden = this.spec.letter;
      seconds = s.forbiddenSeconds;
    }
    for (const p of this.seatedPlayers()) this.pushPrivate(p.id);
    this.emit({ type: 'play', round: st.round });
    this.runStage('play', this.playMsOverride ?? seconds * 1000, () => this.endPlay());
  }

  private endPlay(): void {
    this.hunt?.close();
    this.emit({ type: 'timeUp', round: this.state.round });
    if (this.mode === 'forbidden' && this.getSettings().review === 'host' && this.hunt && this.hunt.pendingKeys().length > 0) {
      this.beginReview();
      return;
    }
    this.revealHunt();
  }

  // ===========================================================================
  // Hunts (Letter Grid, Anagram Sprint, Forbidden Letter)
  // ===========================================================================

  private submitHunt(player: PlayerRecord, raw: string, path?: number[]): void {
    const hunt = this.hunt as HuntRound;
    const forbidden = this.mode === 'forbidden';
    const display = forbidden ? normalizePhrase(raw) : normalizeWord(raw);
    if (!display) return this.reject(player, WORDS_MSG.submit, 'invalid_payload', 'Use letters only.');
    const safe = containsBlockedWord(display) ? display.split(' ').map((w) => (isBlockedWord(w) ? maskBlocked(w) : w)).join(' ') : display;
    const key = forbidden ? phraseKey(display, this.dict) : display;
    const result = hunt.submit(player.id, safe, key, Date.now(), () => this.validate(raw, path));
    if (result.ok) {
      const r = result.record;
      this.last.set(player.id, { word: r.word, ok: true, pending: r.status === 'pending', points: r.points });
      this.progressOf(player.id).found = hunt.countOf(player.id);
    } else {
      if (result.reason === 'closed') return this.reject(player, WORDS_MSG.submit, 'wrong_phase', 'Time’s up — words are closed.');
      this.last.set(player.id, { word: result.word, ok: false, pending: false, reason: result.reason, points: 0 });
    }
    this.pushPrivate(player.id);
  }

  private validate(raw: string, path?: number[]): HuntVerdict {
    const s = this.getSettings();
    if (this.mode === 'grid' && this.grid) {
      const r = checkGridWord(raw, this.grid.tiles, this.dict, s.gridMinLength, path);
      return r.ok ? { ok: true, key: r.word, word: r.word, points: r.points, path: r.path } : { ok: false, reason: r.reason, word: r.word };
    }
    if (this.mode === 'anagram' && this.rack) {
      const r = checkAnagramWord(raw, this.rack.letters, this.dict);
      return r.ok
        ? { ok: true, key: r.word, word: r.word, points: r.score.points, ...(r.score.rare ? { rare: true } : {}), ...(r.score.full ? { full: true } : {}) }
        : { ok: false, reason: r.reason, word: r.word };
    }
    if (this.mode === 'forbidden' && this.spec) {
      const r = checkForbiddenAnswer(raw, this.spec, this.dict);
      if (!r.ok) return { ok: false, reason: r.reason, word: r.display };
      const pending = !r.known && s.review === 'host';
      return { ok: true, key: r.key, word: r.display, points: r.points, ...(r.known ? { known: true } : {}), ...(pending ? { pending: true } : {}) };
    }
    return { ok: false, reason: 'not_word' };
  }

  private beginReview(): void {
    const hunt = this.hunt as HuntRound;
    this.reviewKeys.clear();
    this.reviewItems = hunt
      .pendingKeys()
      .slice(0, WORDS_LIMITS.reviewItems)
      .map((p, i) => {
        const id = `r${i + 1}`;
        this.reviewKeys.set(id, p.key);
        return { id, text: p.word, count: p.count, status: 'pending' as const };
      });
    // Anything past the review cap is accepted (benefit of the doubt).
    const capped = new Set(this.reviewKeys.values());
    for (const p of hunt.pendingKeys()) if (!capped.has(p.key)) hunt.setVerdict(p.key, true);
    this.publishReview();
    const ms = this.reviewMsOverride ?? this.getSettings().reviewSeconds * 1000;
    this.runStage('review', ms, () => this.endReview());
  }

  private publishReview(): void {
    this.state.reviewJson = JSON.stringify(this.reviewItems);
  }

  private onReview(player: PlayerRecord, round: number, id: string, verdict: ReviewVerdict): void {
    if (this.stage !== 'review' || round !== this.state.round || !this.hunt) {
      return this.reject(player, WORDS_MSG.review, 'wrong_phase', 'Nothing to review right now.');
    }
    const key = this.reviewKeys.get(id);
    const item = this.reviewItems.find((r) => r.id === id);
    if (!key || !item) return this.reject(player, WORDS_MSG.review, 'invalid_payload', 'That answer isn’t in the review list.');
    if (item.status !== 'pending') return; // idempotent: already decided
    item.status = verdict === 'accept' ? 'accepted' : 'rejected';
    for (const pid of this.hunt.setVerdict(key, verdict === 'accept')) this.pushPrivate(pid);
    this.publishReview();
    if (this.reviewItems.every((r) => r.status !== 'pending')) this.endStageSoon(900);
  }

  private onReviewAll(player: PlayerRecord, round: number, verdict: ReviewVerdict): void {
    if (this.stage !== 'review' || round !== this.state.round || !this.hunt) {
      return this.reject(player, WORDS_MSG.reviewAll, 'wrong_phase', 'Nothing to review right now.');
    }
    this.decideRemaining(verdict === 'accept');
    this.endStageSoon(600);
  }

  /** Accept (or reject) every answer still waiting for the host. */
  private decideRemaining(accept: boolean): void {
    if (!this.hunt) return;
    for (const item of this.reviewItems) {
      if (item.status !== 'pending') continue;
      item.status = accept ? 'accepted' : 'rejected';
      const key = this.reviewKeys.get(item.id);
      if (key) for (const pid of this.hunt.setVerdict(key, accept)) this.pushPrivate(pid);
    }
    for (const pid of this.hunt.resolvePending(accept)) this.pushPrivate(pid);
    this.publishReview();
  }

  private endReview(): void {
    // Review time ran out: unreviewed answers get the benefit of the doubt.
    this.decideRemaining(true);
    this.revealHunt();
  }

  private revealHunt(): void {
    const hunt = this.hunt;
    if (!hunt) return;
    hunt.close();
    const mode = this.mode;
    const s = this.getSettings();
    const teamMode = this.state.teamMode;
    const participants = this.seatedPlayers().map((p) => p.id);
    for (const pid of hunt.players()) if (!participants.includes(pid) && this.players.has(pid)) participants.push(pid);
    const groupOf = (pid: string) => (teamMode ? (this.teamOf(pid) ?? pid) : pid);
    const groupCount = new Set(participants.map(groupOf)).size;
    // Only players still in the room compete: someone who left must not turn a present player's
    // word into a "shared" one (and a leaver who rejoins as a new seat is counted once).
    const present = new Set(participants);
    const marks = markHunt(
      hunt.all().filter((r) => present.has(r.playerId)),
      groupOf,
      groupCount,
    );
    const markOf = new Map<HuntRecord, MarkedWord>(marks.map((m) => [m.record, m]));

    const pointsFor = (m: MarkedWord): number => {
      if (!m.credited) return 0;
      const len = m.record.key.replace(/ /g, '').length;
      if (mode === 'grid') return s.uniqueOnly && m.shared ? 0 : lengthPoints(len);
      if (mode === 'anagram') return m.record.points + (m.unique ? lengthPoints(len) : 0);
      return forbiddenFinalPoints(m.unique);
    };

    const players: WordsRevealPlayer[] = [];
    const found = new Set<string>();
    let longest: { word: string; playerIds: string[] } | null = null;
    for (const pid of participants) {
      const rec = this.players.get(pid);
      const words: WordsRevealWord[] = [];
      let total = 0;
      let best: { word: string; points: number } | null = null;
      for (const r of hunt.wordsOf(pid)) {
        if (r.status === 'rejected') {
          if (r.hostDecided) words.push({ w: r.word, p: 0, x: 1 });
          continue;
        }
        const m = markOf.get(r);
        if (!m) continue;
        const p = pointsFor(m);
        total += p;
        found.add(r.key);
        const item: WordsRevealWord = { w: r.word, p };
        if (m.unique) item.u = 1;
        if (m.shared) item.s = 1;
        if (m.teammate) item.t = 1;
        if (r.rare) item.r = 1;
        if (r.full) item.f = 1;
        if (r.hostDecided) item.h = 1;
        words.push(item);
        if (!best || p > best.points || (p === best.points && r.word.length > best.word.length)) best = { word: r.word, points: p };
        const letters = r.key.replace(/ /g, '').length;
        if (!longest || letters > longest.word.replace(/ /g, '').length) longest = { word: r.word, playerIds: [pid] };
        else if (longest.word === r.word && !longest.playerIds.includes(pid)) longest.playerIds.push(pid);
      }
      words.sort((a, b) => b.p - a.p || b.w.length - a.w.length || (a.w < b.w ? -1 : 1));
      this.addPoints(pid, total);
      const st = this.statsOf(pid);
      st.words += words.filter((w) => !w.x).length;
      st.unique += words.filter((w) => w.u).length;
      for (const w of words) if (!w.x && w.w.replace(/ /g, '').length > st.longest.replace(/ /g, '').length) st.longest = w.w;
      players.push({
        id: pid,
        name: rec?.state.name ?? st.name,
        teamId: this.teamOf(pid) ?? '',
        points: total,
        count: words.filter((w) => !w.x).length,
        best: best?.word ?? '',
        words: words.slice(0, WORDS_LIMITS.revealWords),
      });
    }
    players.sort((a, b) => b.points - a.points || b.count - a.count || (a.name < b.name ? -1 : 1));

    let missed: string[] = [];
    let possible = 0;
    let seeds: string[] = [];
    if (mode === 'grid' && this.grid) {
      possible = this.grid.solutions.size;
      missed = [...this.grid.solutions.keys()].filter((w) => !found.has(w) && this.dict.isCommon(w));
    } else if (mode === 'anagram' && this.rack) {
      possible = this.rack.solutions.length;
      seeds = [...this.rack.seeds];
      missed = this.rack.solutions.filter((w) => !found.has(w) && this.dict.isCommon(w));
    }
    missed.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

    const reveal: WordsRoundReveal = {
      round: this.state.round,
      mode,
      players,
      missed: missed.slice(0, WORDS_LIMITS.missed),
      possible,
      found: found.size,
      seeds,
      longest,
      ...(mode === 'forbidden' && this.spec ? { category: this.spec.category.label, forbidden: this.spec.letter } : {}),
    };
    this.finishRound(reveal);
  }

  // ===========================================================================
  // Word Chain
  // ===========================================================================

  private chainCollector(chain: ChainGame): PartyCollector {
    return {
      get isOpen() {
        return chain.isOpen;
      },
      isComplete: (present?: Iterable<string>) => chain.allAnswered(present ?? []),
      pending: (present?: Iterable<string>) => [...(present ?? [])].filter((id) => chain.isAlive(id) && !chain.hasAnswered(id)),
    };
  }

  private startLink(): void {
    const chain = this.chain as ChainGame;
    const st = this.state;
    st.chainWord = chain.current;
    st.chainPrefix = chain.prefix;
    st.chainLink = chain.link;
    st.linkJson = '';
    this.linkOpenedAt = Date.now();
    this.track(this.chainCollector(chain), chain.alive());
    for (const p of this.seatedPlayers()) this.pushPrivate(p.id);
    this.emit({ type: 'link', round: st.round, link: chain.link });
    const ms = this.linkMsOverride ?? linkSeconds(this.getSettings().chainSeconds, chain.link) * 1000;
    this.runStage('link', ms, () => this.closeLink());
  }

  private submitChain(player: PlayerRecord, raw: string): void {
    const chain = this.chain;
    if (!chain || !chain.isOpen) return this.reject(player, WORDS_MSG.submit, 'wrong_phase', 'Time’s up for this link.');
    const res = chain.submit(player.id, raw, Date.now() - this.linkOpenedAt);
    const list = this.chainEntries.get(player.id) ?? [];
    if (res.ok) {
      list.push({ id: `c${++this.entryCounter}`, word: res.word, status: 'ok', points: res.points });
      this.last.set(player.id, { word: res.word, ok: true, pending: false, points: res.points });
      this.progressOf(player.id).found += 1;
      this.markAnswered(player.id);
    } else {
      const shown = isBlockedWord(res.word) ? maskBlocked(res.word) : res.word;
      list.push({ id: `c${++this.entryCounter}`, word: shown, status: 'rejected', reason: res.reason, points: 0 });
      this.trimChainRejects(list);
      this.last.set(player.id, { word: shown, ok: false, pending: false, reason: res.reason as WordsRejectReason, points: 0 });
    }
    this.chainEntries.set(player.id, list);
    this.pushPrivate(player.id);
    if (res.ok) this.checkAllAnswered();
  }

  private trimChainRejects(list: WordsEntry[]): void {
    let rejects = list.filter((e) => e.status === 'rejected').length;
    while (rejects > CHAIN_REJECTS) {
      const idx = list.findIndex((e) => e.status === 'rejected');
      if (idx < 0) break;
      list.splice(idx, 1);
      rejects--;
    }
  }

  private closeLink(): void {
    const chain = this.chain;
    if (!chain) return;
    this.untrack();
    const result = chain.closeLink((id) => this.players.get(id)?.state.name ?? '');
    for (const [pid, pts] of result.points) {
      this.addPoints(pid, pts);
      this.chainScore.set(pid, (this.chainScore.get(pid) ?? 0) + pts);
      const answer = result.answers.find((a) => a.playerId === pid);
      if (answer) {
        const words = this.chainWords.get(pid) ?? [];
        words.push({ w: answer.word, p: pts, ...(answer.maker ? { u: 1 as const } : {}), ...(answer.shared ? { s: 1 as const } : {}) });
        this.chainWords.set(pid, words);
        if (answer.maker) this.statsOf(pid).links += 1;
      }
    }
    for (const p of this.seatedPlayers()) {
      const prog = this.progressOf(p.id);
      prog.lives = chain.lives.get(p.id) ?? 0;
      prog.out = chain.lives.has(p.id) && !chain.isAlive(p.id);
    }
    this.commitScores();
    const reveal: ChainLinkReveal = {
      link: result.link,
      from: result.from,
      prefix: result.prefix,
      answers: result.answers,
      missed: result.missed,
      eliminated: result.eliminated,
      next: result.next,
      fallback: result.fallback,
    };
    const st = this.state;
    st.linkJson = JSON.stringify(reveal);
    st.chainJson = JSON.stringify(chain.trail);
    if (result.next) {
      st.chainWord = result.next;
    }
    this.emit({ type: 'linkReveal', round: st.round, link: result.link, eliminated: result.eliminated });
    this.runStage('linkReveal', this.linkRevealMs, () => {
      if (chain.shouldEnd()) this.endChain();
      else {
        chain.nextLink();
        this.startLink();
      }
    });
  }

  private endChain(): void {
    const chain = this.chain as ChainGame;
    const survivors = chain.alive();
    for (const [pid, pts] of chain.survivorPoints()) {
      this.addPoints(pid, pts);
      this.chainScore.set(pid, (this.chainScore.get(pid) ?? 0) + pts);
    }
    const players: WordsRevealPlayer[] = [];
    let longest: { word: string; playerIds: string[] } | null = null;
    const participants = [...new Set([...this.seatedPlayers().map((p) => p.id), ...this.chainWords.keys()])].filter((id) => this.players.has(id));
    for (const pid of participants) {
      const words = [...(this.chainWords.get(pid) ?? [])].sort((a, b) => b.p - a.p || b.w.length - a.w.length);
      const st = this.statsOf(pid);
      st.words += words.length;
      for (const w of words) {
        if (w.w.length > st.longest.length) st.longest = w.w;
        if (!longest || w.w.length > longest.word.length) longest = { word: w.w, playerIds: [pid] };
        else if (w.w === longest.word && !longest.playerIds.includes(pid)) longest.playerIds.push(pid);
      }
      players.push({
        id: pid,
        name: this.players.get(pid)?.state.name ?? st.name,
        teamId: this.teamOf(pid) ?? '',
        points: this.chainScore.get(pid) ?? 0,
        count: words.length,
        best: words[0]?.w ?? '',
        words: words.slice(0, WORDS_LIMITS.revealWords),
      });
    }
    players.sort((a, b) => b.points - a.points || b.count - a.count || (a.name < b.name ? -1 : 1));
    this.finishRound({
      round: this.state.round,
      mode: 'chain',
      players,
      missed: [],
      possible: 0,
      found: chain.burned.size - 1,
      seeds: [],
      longest,
      links: chain.link,
      survivors,
    });
  }

  // ===========================================================================
  // Reveal + finish
  // ===========================================================================

  private finishRound(reveal: WordsRoundReveal): void {
    this.untrack();
    this.commitScores();
    const st = this.state;
    st.revealJson = JSON.stringify(reveal);
    const top = reveal.players.find((p) => p.best);
    const topWord = top?.words.find((w) => w.w === top.best);
    this.history.push({
      round: reveal.round,
      mode: reveal.mode,
      label: this.roundLabel(reveal),
      best: top && topWord ? { word: top.best, name: top.name, points: topWord.p } : null,
    });
    st.historyJson = JSON.stringify(this.history);
    for (const p of this.seatedPlayers()) this.pushPrivate(p.id);
    this.emit({ type: 'reveal', round: st.round });
    const last = st.round >= st.totalRounds;
    this.runStage('reveal', this.revealMs, () => (last ? this.finishMatch() : this.nextRound()));
  }

  private roundLabel(reveal: WordsRoundReveal): string {
    const info = WORDS_MODE_INFO[reveal.mode];
    if (reveal.mode === 'grid') return `${info.title} ${this.state.gridSize}×${this.state.gridSize}`;
    if (reveal.mode === 'anagram') return `${info.title} · ${(reveal.seeds[0] ?? '').toUpperCase()}`;
    if (reveal.mode === 'forbidden') return `${reveal.category ?? info.title} · no ${(reveal.forbidden ?? '').toUpperCase()}`;
    return `${info.title} · ${reveal.links ?? 0} links`;
  }

  private finishMatch(): void {
    const awards = this.computeAwards();
    this.finishParty({
      details: { mode: this.mode, rounds: this.state.round },
      extras: { awards },
    });
  }

  private computeAwards(): Array<{ id: string; label: string; playerId: string; name: string; value: string }> {
    const present = [...this.stats.entries()].filter(([id]) => this.players.has(id));
    const awards: Array<{ id: string; label: string; playerId: string; name: string; value: string }> = [];
    const pickMax = (score: (s: PlayerStats) => number) => present.filter(([, s]) => score(s) > 0).sort((a, b) => score(b[1]) - score(a[1]))[0];
    const longest = pickMax((s) => s.longest.replace(/ /g, '').length);
    if (longest) awards.push({ id: 'longest', label: 'Longest word', playerId: longest[0], name: longest[1].name, value: longest[1].longest });
    const most = pickMax((s) => s.words);
    if (most) awards.push({ id: 'most', label: 'Most words', playerId: most[0], name: most[1].name, value: `${most[1].words} word${most[1].words === 1 ? '' : 's'}` });
    if (this.mode === 'chain') {
      const links = pickMax((s) => s.links);
      if (links) awards.push({ id: 'links', label: 'Chain maker', playerId: links[0], name: links[1].name, value: `${links[1].links} link${links[1].links === 1 ? '' : 's'}` });
    } else if (present.length > 1) {
      const unique = pickMax((s) => s.unique);
      if (unique) awards.push({ id: 'unique', label: 'Only-one finds', playerId: unique[0], name: unique[1].name, value: `${unique[1].unique} unique` });
    }
    return awards;
  }

  // ===========================================================================
  // Private info
  // ===========================================================================

  private pushPrivate(pid: string): void {
    const player = this.players.get(pid);
    if (!player || player.state.spectator) return;
    const n = (this.seq.get(pid) ?? 0) + 1;
    this.seq.set(pid, n);
    const chain = this.chain;
    const payload: WordsPrivate = {
      round: this.state.round,
      link: this.state.chainLink,
      entries: this.mode === 'chain' ? [...(this.chainEntries.get(pid) ?? [])] : (this.hunt?.entriesOf(pid) ?? []),
      seq: n,
      last: this.last.get(pid) ?? null,
      chainAnswer: chain && chain.isOpen ? chain.answerOf(pid) : null,
    };
    this.sendPrivate(player, WORDS_MSG.private, payload);
  }

  private emit(event: WordsEvent): void {
    this.broadcast(WORDS_MSG.event, event);
  }

  // ===========================================================================
  // Player lifecycle (kit hooks first)
  // ===========================================================================

  protected override onPlayerJoined(player: PlayerRecord, info: { lateJoin: boolean }): void {
    super.onPlayerJoined(player, info);
    if (player.state.spectator || !info.lateJoin) return;
    if (this.phase !== 'PLAYING') return;
    const prog = this.progressOf(player.id);
    if (this.chain && this.state.stage !== 'intro' && this.state.stage !== 'reveal') {
      this.chain.addPlayer(player.id);
      prog.lives = this.chain.lives.get(player.id) ?? 0;
      prog.out = false;
      if (this.chain.isOpen) this.seat(player.id).eligible = true;
      this.refreshAnswerCounts();
    }
    this.pushPrivate(player.id);
  }

  protected override onPlayerRemoved(player: PlayerRecord, reason: RemovalReason): void {
    super.onPlayerRemoved(player, reason);
    this.state.progress.delete(player.id);
    this.chain?.removePlayer(player.id);
    this.seq.delete(player.id);
    this.last.delete(player.id);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.resetMatch();
    this.state.mode = this.getSettings().mode;
    this.state.round = 0;
  }

  private progressOf(id: string): WordsSeatState {
    let prog = this.state.progress.get(id);
    if (!prog) {
      prog = new WordsSeatState();
      this.state.progress.set(id, prog);
    }
    return prog;
  }

  private statsOf(id: string): PlayerStats {
    let st = this.stats.get(id);
    if (!st) {
      st = { name: this.players.get(id)?.state.name ?? 'Player', words: 0, unique: 0, longest: '', links: 0 };
      this.stats.set(id, st);
    }
    const name = this.players.get(id)?.state.name;
    if (name) st.name = name;
    return st;
  }
}
