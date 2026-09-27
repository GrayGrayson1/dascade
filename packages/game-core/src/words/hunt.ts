/**
 * Word hunts — the shared submission + scoring machinery for Letter Grid, Anagram Sprint and
 * Forbidden Letter (every player submits many words during one timed window).
 *
 * HuntRound (one round):
 *  - submit(): a mode-specific validator decides validity; the round adds the bookkeeping rules —
 *    closed rounds refuse everything (late submissions), a word the same player already banked is a
 *    `duplicate` (idempotent: re-sending the same word never double-counts), at most `maxWords`
 *    accepted words and `maxRejects` remembered rejections per player.
 *  - Forbidden Letter answers may be `pending` (category ambiguity); setVerdict() applies the host's
 *    decision to every player who gave that answer.
 *
 * markHunt() (at the reveal) groups the accepted words by comparison key:
 *  - group = team id in team mode, player id otherwise;
 *  - inside a group a word counts once — the earliest submitter is credited, later teammates get
 *    `teammate` (0 points);
 *  - `unique` = only one group found it (only meaningful with 2+ groups); `shared` = 2+ groups did.
 */
import type { WordsEntry, WordsEntryStatus, WordsRejectReason } from '@dascade/shared/games/words';

export type HuntVerdict =
  | {
      ok: true;
      /** Comparison key (duplicates / uniqueness). */
      key: string;
      /** Display text. */
      word: string;
      /** Provisional points. */
      points: number;
      pending?: boolean;
      path?: number[];
      rare?: boolean;
      full?: boolean;
      known?: boolean;
    }
  | { ok: false; reason: WordsRejectReason; word?: string };

export interface HuntRecord {
  id: string;
  playerId: string;
  key: string;
  word: string;
  status: WordsEntryStatus;
  reason?: WordsRejectReason;
  points: number;
  /** ms since the round opened. */
  at: number;
  path?: number[];
  rare?: boolean;
  full?: boolean;
  known?: boolean;
  /** Forbidden Letter: decided by the host (not a known category member). */
  hostDecided?: boolean;
}

export type HuntSubmitResult = { ok: true; record: HuntRecord } | { ok: false; reason: WordsRejectReason | 'closed'; word: string };

export interface HuntRoundOptions {
  maxWords: number;
  maxRejects: number;
  openedAt?: number;
}

export class HuntRound {
  private readonly accepted = new Map<string, Map<string, HuntRecord>>();
  private readonly rejected = new Map<string, HuntRecord[]>();
  private readonly order = new Map<string, HuntRecord[]>();
  private open = true;
  private counter = 0;
  readonly openedAt: number;
  readonly maxWords: number;
  readonly maxRejects: number;

  constructor(opts: HuntRoundOptions) {
    this.maxWords = opts.maxWords;
    this.maxRejects = opts.maxRejects;
    this.openedAt = opts.openedAt ?? Date.now();
  }

  get isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.open = false;
  }

  /**
   * Submit one word. `display` is what the player typed (normalized) — used for rejection lines.
   * The validator runs only for new words (duplicates never re-validate).
   */
  submit(playerId: string, display: string, key: string, now: number, validate: () => HuntVerdict): HuntSubmitResult {
    if (!this.open) return { ok: false, reason: 'closed', word: display };
    const mine = this.accepted.get(playerId);
    if (key && mine?.has(key)) {
      return this.rejectWith(playerId, 'duplicate', display, now, false);
    }
    if ((mine?.size ?? 0) >= this.maxWords) return this.rejectWith(playerId, 'too_many', display, now, false);
    const verdict = validate();
    if (!verdict.ok) return this.rejectWith(playerId, verdict.reason, verdict.word ?? display, now, true);
    if (mine?.has(verdict.key)) return this.rejectWith(playerId, 'duplicate', verdict.word, now, false);
    const record: HuntRecord = {
      id: `e${++this.counter}`,
      playerId,
      key: verdict.key,
      word: verdict.word,
      status: verdict.pending ? 'pending' : 'ok',
      points: verdict.points,
      at: Math.max(0, now - this.openedAt),
      ...(verdict.path ? { path: verdict.path } : {}),
      ...(verdict.rare ? { rare: true } : {}),
      ...(verdict.full ? { full: true } : {}),
      ...(verdict.known ? { known: true } : {}),
    };
    let map = mine;
    if (!map) {
      map = new Map();
      this.accepted.set(playerId, map);
    }
    map.set(record.key, record);
    this.push(playerId, record);
    return { ok: true, record };
  }

  private rejectWith(playerId: string, reason: WordsRejectReason, word: string, now: number, remember: boolean): HuntSubmitResult {
    if (remember || reason === 'duplicate') {
      const list = this.rejected.get(playerId) ?? [];
      const record: HuntRecord = { id: `e${++this.counter}`, playerId, key: '', word, status: 'rejected', reason, points: 0, at: Math.max(0, now - this.openedAt) };
      list.push(record);
      if (list.length > this.maxRejects) list.splice(0, list.length - this.maxRejects);
      this.rejected.set(playerId, list);
      this.push(playerId, record);
    }
    return { ok: false, reason, word };
  }

  private push(playerId: string, record: HuntRecord): void {
    const list = this.order.get(playerId) ?? [];
    list.push(record);
    // Keep the private list bounded: drop the oldest rejections first.
    const cap = this.maxWords + this.maxRejects;
    if (list.length > cap) {
      const idx = list.findIndex((r) => r.status === 'rejected');
      list.splice(idx >= 0 ? idx : 0, 1);
    }
    this.order.set(playerId, list);
  }

  /** The player's accepted words (ok + pending), in submission order. */
  wordsOf(playerId: string): HuntRecord[] {
    return [...(this.accepted.get(playerId)?.values() ?? [])];
  }

  /** Accepted count (ok + pending) for the public progress counter. */
  countOf(playerId: string): number {
    return this.accepted.get(playerId)?.size ?? 0;
  }

  /** Private list entries (accepted and rejected, newest last). */
  entriesOf(playerId: string): WordsEntry[] {
    return (this.order.get(playerId) ?? []).map(toEntry);
  }

  /** Every non-rejected record, all players. */
  all(): HuntRecord[] {
    const out: HuntRecord[] = [];
    for (const map of this.accepted.values()) for (const r of map.values()) if (r.status !== 'rejected') out.push(r);
    return out;
  }

  players(): string[] {
    return [...new Set([...this.accepted.keys(), ...this.rejected.keys()])];
  }

  /** Distinct pending keys with how many players gave each (for the host review). */
  pendingKeys(): Array<{ key: string; word: string; count: number; firstAt: number }> {
    const map = new Map<string, { key: string; word: string; count: number; firstAt: number }>();
    for (const r of this.all()) {
      if (r.status !== 'pending') continue;
      const item = map.get(r.key);
      if (item) {
        item.count++;
        item.firstAt = Math.min(item.firstAt, r.at);
      } else map.set(r.key, { key: r.key, word: r.word, count: 1, firstAt: r.at });
    }
    return [...map.values()].sort((a, b) => a.firstAt - b.firstAt || (a.key < b.key ? -1 : 1));
  }

  /** Host decision for every player who gave `key`. Returns the affected player ids. */
  setVerdict(key: string, accept: boolean): string[] {
    const affected: string[] = [];
    for (const [pid, map] of this.accepted) {
      const r = map.get(key);
      if (!r || r.status !== 'pending') continue;
      r.hostDecided = true;
      if (accept) r.status = 'ok';
      else {
        r.status = 'rejected';
        r.reason = 'category';
        r.points = 0;
      }
      affected.push(pid);
    }
    return affected;
  }

  /** Resolve every remaining pending answer (review timeout / host "accept all"). */
  resolvePending(accept: boolean): string[] {
    const keys = this.pendingKeys().map((p) => p.key);
    const affected = new Set<string>();
    for (const k of keys) for (const pid of this.setVerdict(k, accept)) affected.add(pid);
    return [...affected];
  }
}

function toEntry(r: HuntRecord): WordsEntry {
  return {
    id: r.id,
    word: r.word,
    status: r.status,
    points: r.points,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.path ? { path: r.path } : {}),
    ...(r.rare ? { rare: true } : {}),
    ...(r.full ? { full: true } : {}),
    ...(r.known ? { known: true } : {}),
  };
}

export interface MarkedWord {
  record: HuntRecord;
  group: string;
  /** Earliest in its group: this entry carries the group's points. */
  credited: boolean;
  /** A teammate found it first. */
  teammate: boolean;
  /** Only this group found it (2+ groups competing). */
  unique: boolean;
  /** Found by 2+ groups. */
  shared: boolean;
}

/**
 * Groups accepted (status 'ok') records for scoring. `groupOf` maps a player to their team (or
 * themselves); `groupCount` is how many groups competed this round (uniqueness needs 2+).
 */
export function markHunt(records: readonly HuntRecord[], groupOf: (playerId: string) => string, groupCount: number): MarkedWord[] {
  const ok = records.filter((r) => r.status === 'ok');
  const groupsByKey = new Map<string, Set<string>>();
  for (const r of ok) {
    const g = groupOf(r.playerId);
    let set = groupsByKey.get(r.key);
    if (!set) {
      set = new Set();
      groupsByKey.set(r.key, set);
    }
    set.add(g);
  }
  const sorted = [...ok].sort((a, b) => a.at - b.at || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  const creditedKeys = new Set<string>();
  const out: MarkedWord[] = [];
  for (const r of sorted) {
    const g = groupOf(r.playerId);
    const groupKey = `${g}\u0000${r.key}`;
    const credited = !creditedKeys.has(groupKey);
    if (credited) creditedKeys.add(groupKey);
    const groups = groupsByKey.get(r.key)?.size ?? 1;
    out.push({ record: r, group: g, credited, teammate: !credited, unique: groupCount >= 2 && groups === 1, shared: groups >= 2 });
  }
  return out;
}
