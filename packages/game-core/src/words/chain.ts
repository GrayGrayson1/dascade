/**
 * Word Chain — simultaneous links, so nobody waits for their turn.
 *
 * A chain starts from an everyday starter word. Each LINK, every player still holding hearts answers
 * at the same time with one word that starts with the link letters:
 *   rule 'last'  → the last letter of the current word      (LEMON → N…)
 *   rule 'last2' → the last two letters of the current word (LEMON → ON…)
 * Answers must be dictionary words of at least `minLength` letters and not burned (every word
 * accepted in this chain so far — including the starter — is burned). The first accepted answer is
 * final (one answer per player per link).
 *
 * When the link closes:
 *  - everyone alive who didn't answer loses a heart; 0 hearts = out for the rest of this chain;
 *  - every accepted answer scores length points; all of them are burned;
 *  - the LONGEST answer becomes the next link (ties: earliest, then A–Z) and its author gets the
 *    Link bonus — unless it would leave almost no everyday follow-ups (e.g. ends in X), in which case
 *    the next-best viable answer is used;
 *  - if nobody linked, DASwords picks an everyday word with the right start (or a fresh starter).
 * The chain ends after `maxLinks` links, or when at most one player is left standing (zero in solo).
 * Survivors earn the Survivor bonus.
 */
import type { Rng } from '@dascade/shared';
import { CHAIN_BONUS, chainPrefixOf, lengthPoints, type ChainLinkReveal, type ChainRule, type ChainTrailItem, type WordsRejectReason } from '@dascade/shared/games/words';
import { MAX_WORD_LENGTH, normalizeWord, type WordDictionary } from './dictionary.ts';
import { isBlockedWord } from './blocklist.ts';

/** Everyday follow-ups a link needs to count as "viable". */
export const VIABLE_FOLLOWUPS = 8;

export interface ChainOptions {
  rule: ChainRule;
  minLength: number;
  lives: number;
  maxLinks: number;
}

export interface ChainAnswer {
  playerId: string;
  word: string;
  at: number;
}

export type ChainSubmitResult = { ok: true; word: string; points: number } | { ok: false; reason: WordsRejectReason; word: string };

export interface ChainLinkResult extends ChainLinkReveal {
  /** Points per player for this link (answers + link bonus). */
  points: Map<string, number>;
}

/** Everyday, unburned words starting with `prefix` (≥ minLength letters). */
export function followUps(prefix: string, dict: WordDictionary, burned: ReadonlySet<string>, minLength: number, limit = Infinity): string[] {
  const out: string[] = [];
  const [a, b] = dict.prefixRange(prefix);
  const all = dict.all();
  for (let i = a; i < b && out.length < limit; i++) {
    const w = all[i] as string;
    if (w.length >= minLength && dict.isCommon(w) && !burned.has(w)) out.push(w);
  }
  return out;
}

/** Whether linking from `word` leaves enough everyday follow-ups. */
export function isViableLink(word: string, rule: ChainRule, dict: WordDictionary, burned: ReadonlySet<string>, minLength: number): boolean {
  return followUps(chainPrefixOf(word, rule), dict, burned, minLength, VIABLE_FOLLOWUPS).length >= VIABLE_FOLLOWUPS;
}

/** A random everyday starter word (5–7 letters) that links well. */
export function pickStarter(dict: WordDictionary, rule: ChainRule, rng: Rng, burned: ReadonlySet<string>, minLength: number): string {
  const pool: string[] = [];
  for (const len of [5, 6, 7]) for (const w of dict.ofLength(len)) if (dict.isCommon(w) && !burned.has(w)) pool.push(w);
  for (let attempt = 0; attempt < 200 && pool.length > 0; attempt++) {
    const w = pool[rng.int(pool.length)] as string;
    if (isViableLink(w, rule, dict, burned, minLength)) return w;
  }
  return pool[0] ?? 'start';
}

/** Duration of a link: starts at `baseSeconds`, one second faster every two links, floored at half (min 6 s). */
export function linkSeconds(baseSeconds: number, link: number): number {
  const floor = Math.max(6, Math.ceil(baseSeconds / 2));
  return Math.max(floor, baseSeconds - Math.floor((Math.max(1, link) - 1) / 2));
}

export class ChainGame {
  readonly opts: ChainOptions;
  private readonly dict: WordDictionary;
  private readonly rng: Rng;
  readonly burned = new Set<string>();
  readonly lives = new Map<string, number>();
  readonly trail: ChainTrailItem[] = [];
  private answers = new Map<string, ChainAnswer>();
  private open = false;
  private multiplayer = false;
  link = 0;
  current = '';

  constructor(opts: ChainOptions, dict: WordDictionary, rng: Rng) {
    this.opts = opts;
    this.dict = dict;
    this.rng = rng;
  }

  get prefix(): string {
    return chainPrefixOf(this.current, this.opts.rule);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Begin a chain with these players (full hearts). `starter` overrides the random starter word (tests). */
  start(playerIds: readonly string[], starter?: string): void {
    this.burned.clear();
    this.lives.clear();
    this.trail.length = 0;
    for (const id of playerIds) this.lives.set(id, this.opts.lives);
    this.multiplayer = playerIds.length >= 2;
    this.current = starter ?? pickStarter(this.dict, this.opts.rule, this.rng, this.burned, this.opts.minLength);
    this.burned.add(this.current);
    this.trail.push({ link: 0, word: this.current, playerId: '', name: '' });
    this.link = 1;
    this.answers = new Map();
    this.open = true;
  }

  /** Late joiner: full hearts from the next link on (they may also answer the open link). */
  addPlayer(id: string): void {
    if (!this.lives.has(id)) this.lives.set(id, this.opts.lives);
    if (this.lives.size >= 2) this.multiplayer = true;
  }

  removePlayer(id: string): void {
    this.lives.delete(id);
    this.answers.delete(id);
  }

  isAlive(id: string): boolean {
    return (this.lives.get(id) ?? 0) > 0;
  }

  alive(): string[] {
    return [...this.lives.entries()].filter(([, n]) => n > 0).map(([id]) => id);
  }

  hasAnswered(id: string): boolean {
    return this.answers.has(id);
  }

  answerOf(id: string): string | null {
    return this.answers.get(id)?.word ?? null;
  }

  answeredCount(): number {
    return this.answers.size;
  }

  /** Every alive player among `present` has answered. */
  allAnswered(present: Iterable<string>): boolean {
    let any = false;
    for (const id of present) {
      if (!this.isAlive(id)) continue;
      any = true;
      if (!this.answers.has(id)) return false;
    }
    return any;
  }

  submit(playerId: string, raw: string, at: number): ChainSubmitResult {
    const word = normalizeWord(raw);
    if (!this.open) return { ok: false, reason: 'answered', word };
    if (!this.lives.has(playerId) || !this.isAlive(playerId)) return { ok: false, reason: 'eliminated', word };
    if (this.answers.has(playerId)) return { ok: false, reason: 'answered', word };
    if (word.length < this.opts.minLength) return { ok: false, reason: 'too_short', word };
    if (word.length > MAX_WORD_LENGTH) return { ok: false, reason: 'too_long', word };
    if (!word.startsWith(this.prefix)) return { ok: false, reason: 'wrong_start', word };
    if (isBlockedWord(word)) return { ok: false, reason: 'blocked', word };
    if (!this.dict.has(word)) return { ok: false, reason: 'not_word', word };
    if (this.burned.has(word)) return { ok: false, reason: 'used', word };
    this.answers.set(playerId, { playerId, word, at });
    return { ok: true, word, points: lengthPoints(word.length) };
  }

  /** Close the current link, apply hearts/points/burns and choose the next word. */
  closeLink(names: (id: string) => string = () => ''): ChainLinkResult {
    this.open = false;
    const from = this.current;
    const prefix = this.prefix;
    const answers = [...this.answers.values()];
    const points = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const a of answers) counts.set(a.word, (counts.get(a.word) ?? 0) + 1);

    const missed: string[] = [];
    const eliminated: string[] = [];
    for (const [id, n] of this.lives) {
      if (n <= 0 || this.answers.has(id)) continue;
      const left = n - 1;
      this.lives.set(id, left);
      missed.push(id);
      if (left <= 0) eliminated.push(id);
    }
    for (const a of answers) {
      this.burned.add(a.word);
      points.set(a.playerId, lengthPoints(a.word.length));
    }

    // Next link: longest answer (ties: earliest, then A–Z) that still links well.
    const ranked = [...answers].sort((x, y) => y.word.length - x.word.length || x.at - y.at || (x.word < y.word ? -1 : x.word > y.word ? 1 : 0));
    let maker: ChainAnswer | undefined = ranked.find((a) => isViableLink(a.word, this.opts.rule, this.dict, this.burned, this.opts.minLength));
    if (!maker) maker = ranked[0];
    const fallback = !maker;
    let next: string;
    if (maker) {
      next = maker.word;
      points.set(maker.playerId, (points.get(maker.playerId) ?? 0) + CHAIN_BONUS.link);
    } else {
      const options = followUps(prefix, this.dict, this.burned, Math.max(this.opts.minLength, 4)).filter((w) => isViableLink(w, this.opts.rule, this.dict, this.burned, this.opts.minLength));
      next = options.length > 0 ? (options[this.rng.int(options.length)] as string) : pickStarter(this.dict, this.opts.rule, this.rng, this.burned, this.opts.minLength);
    }

    const result: ChainLinkResult = {
      link: this.link,
      from,
      prefix,
      answers: answers
        .sort((x, y) => x.at - y.at)
        .map((a) => ({ playerId: a.playerId, word: a.word, points: points.get(a.playerId) ?? 0, maker: a === maker, shared: (counts.get(a.word) ?? 0) > 1 })),
      missed,
      eliminated,
      next: '',
      fallback,
      points,
    };

    const over = this.shouldEnd();
    if (!over) {
      this.current = next;
      this.burned.add(next);
      this.trail.push({ link: this.link, word: next, playerId: maker?.playerId ?? '', name: maker ? names(maker.playerId) : '' });
      result.next = next;
    } else if (maker) {
      this.trail.push({ link: this.link, word: next, playerId: maker.playerId, name: names(maker.playerId) });
    }
    return result;
  }

  /** Whether the chain is finished (checked after closeLink). */
  shouldEnd(): boolean {
    if (this.link >= this.opts.maxLinks) return true;
    const alive = this.alive().length;
    return this.multiplayer ? alive <= 1 : alive === 0;
  }

  /** Open the next link (after closeLink when the chain continues). */
  nextLink(): void {
    this.link += 1;
    this.answers = new Map();
    this.open = true;
  }

  /** Survivor bonus per player at the end of the chain. */
  survivorPoints(): Map<string, number> {
    const out = new Map<string, number>();
    for (const id of this.alive()) out.set(id, CHAIN_BONUS.survivor);
    return out;
  }
}
