/**
 * DAScade Classics high scores — in memory per server process, one board per (game, board key).
 *
 * Only server-verified results reach this service (verified replays, server-simulated
 * matches, server-judged Memory rounds). Each identity keeps its best entry per board so one
 * enthusiastic player can't fill the whole board. An optional persistence adapter can mirror
 * entries somewhere durable; gameplay never waits on it.
 */
import { randomId, type GameId } from '@dascade/shared';
import { CLASSICS, type HighScoreBoardView, type HighScoreEntry } from '@dascade/shared/games/classics';
import { log } from '../../lib/log.ts';
import { trackWrite } from '../../lib/pendingWrites.ts';

/** Kept per board (the API returns the top CLASSICS.boardSize). */
const KEEP = 100;

export interface StoredEntry extends HighScoreEntry {
  identity: string;
}

export interface HighScoreSubmission {
  identity: string;
  name: string;
  score: number;
  level: number;
  stat: number;
}

export interface RecordResult {
  /** 1-based rank on the board, or null when it didn't make the kept list / didn't beat the identity's best. */
  rank: number | null;
  entryId: string | null;
  /** Beat (or set) this identity's best on the board. */
  improved: boolean;
}

/** Optional durable mirror (e.g. Supabase). Failures are logged and ignored. */
export interface HighScorePersistence {
  load(gameId: GameId, board: string): Promise<Array<StoredEntry>>;
  save(gameId: GameId, board: string, entry: StoredEntry): Promise<void>;
}

export class HighScoreService {
  private readonly boards = new Map<string, StoredEntry[]>();
  private readonly labels = new Map<string, string>();
  private persistence: HighScorePersistence | null = null;
  private readonly loaded = new Set<string>();

  setPersistence(p: HighScorePersistence | null): void {
    this.persistence = p;
    this.loaded.clear();
  }

  private key(gameId: GameId, board: string): string {
    return `${gameId}|${board}`;
  }

  /** Label for the board's stat column ("Lines", "Rounds"…). */
  setStatLabel(gameId: GameId, board: string, label: string): void {
    this.labels.set(this.key(gameId, board), label);
  }

  private list(gameId: GameId, board: string): StoredEntry[] {
    const k = this.key(gameId, board);
    let entries = this.boards.get(k);
    if (!entries) {
      entries = [];
      this.boards.set(k, entries);
    }
    if (this.persistence && !this.loaded.has(k)) {
      this.loaded.add(k);
      const target = entries;
      void this.persistence
        .load(gameId, board)
        .then((rows) => {
          for (const row of rows) this.insert(target, row);
        })
        .catch((err: unknown) => log.warn('high score load failed', { gameId, board, err: err as Error }));
    }
    return entries;
  }

  private insert(entries: StoredEntry[], entry: StoredEntry): number | null {
    const existing = entries.findIndex((e) => e.identity === entry.identity);
    if (existing >= 0) {
      if (entries[existing]!.score >= entry.score) return null;
      entries.splice(existing, 1);
    }
    // Higher score first; ties go to whoever got there first.
    let i = 0;
    while (i < entries.length && (entries[i]!.score > entry.score || (entries[i]!.score === entry.score && entries[i]!.at <= entry.at))) i++;
    if (i >= KEEP) return null;
    entries.splice(i, 0, entry);
    if (entries.length > KEEP) entries.length = KEEP;
    return i;
  }

  record(gameId: GameId, board: string, sub: HighScoreSubmission): RecordResult {
    if (!board || !Number.isFinite(sub.score) || sub.score <= 0) return { rank: null, entryId: null, improved: false };
    const entries = this.list(gameId, board);
    const entry: StoredEntry = {
      id: randomId(10),
      identity: sub.identity,
      name: sub.name,
      score: Math.floor(sub.score),
      level: Math.floor(sub.level),
      stat: Math.floor(sub.stat),
      at: Date.now(),
    };
    const index = this.insert(entries, entry);
    if (index === null) return { rank: null, entryId: null, improved: false };
    if (this.persistence) {
      void trackWrite(this.persistence.save(gameId, board, entry)).catch((err: unknown) => log.warn('high score save failed', { gameId, board, err: err as Error }));
    }
    return { rank: index + 1, entryId: entry.id, improved: true };
  }

  /** Best score of one identity on a board (0 when none). */
  bestOf(gameId: GameId, board: string, identity: string): number {
    return this.list(gameId, board).find((e) => e.identity === identity)?.score ?? 0;
  }

  /**
   * A board in use on this process: a room has played or shown it (setStatLabel on create/settings
   * change) or a score was recorded. Public reads of any other key never allocate a board or query
   * the database (board keys come from the URL).
   */
  private known(gameId: GameId, board: string): boolean {
    const k = this.key(gameId, board);
    return this.boards.has(k) || this.labels.has(k);
  }

  top(gameId: GameId, board: string, n: number = CLASSICS.boardSize): HighScoreBoardView {
    const stored = this.known(gameId, board) ? this.list(gameId, board) : [];
    const entries = stored
      .slice(0, Math.max(0, Math.min(n, KEEP)))
      .map(({ identity: _identity, ...rest }) => rest);
    return { gameId, board, statLabel: this.labels.get(this.key(gameId, board)) ?? '', entries };
  }

  /** Boards held in memory (tests). */
  get boardCount(): number {
    return this.boards.size;
  }

  /** Tests only. */
  reset(): void {
    this.boards.clear();
    this.loaded.clear();
  }
}

/** Process-wide service used by every Classics room and the HTTP route. */
export const highScores = new HighScoreService();
