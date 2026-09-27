/**
 * Optional database persistence for DASCADE ratings and player stats
 * (tables from supabase/migrations/0003_ratings_stats.sql).
 *
 * - The in-memory stores (ratings.ts, stats.ts) are always the source of truth for this process;
 *   this adapter only hydrates an identity the first time it is seen and writes rows back.
 * - Writes are coalesced per row and flushed in the background — gameplay never waits on them. A
 *   failed flush puts its rows back (unless a newer row for the same key is already queued) and
 *   retries with back-off, so a database hiccup never loses an update.
 * - A failed identity load REJECTS (statsLoader retries and holds that identity's updates): an
 *   update applied to default numbers would overwrite the stored ratings/stats.
 * - With Supabase unconfigured (local dev, tests) every call is a cheap no-op.
 * - Identity keys: `u:<auth user id>` for verified accounts, `g:<guest id>` for guests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isGameId, type GameId } from '@dascade/shared';
import type { GameStatLine } from '@dascade/shared/stats';
import type { Rating } from '@dascade/game-core/rating';
import { config, supabaseEnabled } from '../config.ts';
import { log } from '../lib/log.ts';

export interface IdentitySnapshot {
  ratings: Array<{ gameId: GameId; rating: Rating }>;
  stats: GameStatLine[];
}

export interface StatsPersistence {
  readonly enabled: boolean;
  /** Everything stored for one identity (empty when disabled or nothing is stored). Rejects when the database can't be read. */
  loadIdentity(identity: string): Promise<IdentitySnapshot>;
  /** Recently active ratings (startup warm-up so rating-based seeding works after a restart). */
  loadRecentRatings(limit: number): Promise<Array<{ identity: string; gameId: GameId; rating: Rating }>>;
  saveRating(identity: string, gameId: GameId, rating: Rating): void;
  saveStats(identity: string, line: GameStatLine): void;
  /** Flush pending writes now (shutdown/tests). */
  flush(): Promise<void>;
}

const FLUSH_DELAY_MS = 1500;
/** Longest wait between flush retries while the database keeps failing. */
const MAX_FLUSH_DELAY_MS = 60_000;

function userIdOf(identity: string): string | null {
  return identity.startsWith('u:') ? identity.slice(2) : null;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

class NoopStatsPersistence implements StatsPersistence {
  readonly enabled = false;
  async loadIdentity(): Promise<IdentitySnapshot> {
    return { ratings: [], stats: [] };
  }
  async loadRecentRatings(): Promise<Array<{ identity: string; gameId: GameId; rating: Rating }>> {
    return [];
  }
  saveRating(): void {}
  saveStats(): void {}
  async flush(): Promise<void> {}
}

interface RatingRow {
  identity: string;
  game_id: string;
  user_id: string | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updated_at: string;
}

interface StatsRow {
  identity: string;
  game_id: string;
  user_id: string | null;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  podiums: number;
  best_score: number | null;
  lower_is_better: boolean;
  total_score: number;
  scored_games: number;
  tournament_games: number;
  extras: Record<string, number>;
  last_played_at: string;
  updated_at: string;
}

export class SupabaseStatsPersistence implements StatsPersistence {
  readonly enabled = true;
  private clientPromise: Promise<SupabaseClient> | null = null;
  private pendingRatings = new Map<string, RatingRow>();
  private pendingStats = new Map<string, StatsRow>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  /** Consecutive failed flushes (back-off). */
  private failures = 0;

  /** `connect` supplies the client (tests pass a fake). */
  constructor(private readonly connect?: () => Promise<SupabaseClient>) {}

  private client(): Promise<SupabaseClient> {
    this.clientPromise ??=
      this.connect?.() ??
      import('@supabase/supabase-js').then(({ createClient }) =>
        createClient(config.supabase.url, config.supabase.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }),
      );
    return this.clientPromise;
  }

  async loadIdentity(identity: string): Promise<IdentitySnapshot> {
    const sb = await this.client();
    const [ratings, stats] = await Promise.all([
      sb.from('player_ratings').select('*').eq('identity', identity).limit(100),
      sb.from('player_game_stats').select('*').eq('identity', identity).limit(100),
    ]);
    if (ratings.error) throw ratings.error;
    if (stats.error) throw stats.error;
    return {
      ratings: ((ratings.data ?? []) as RatingRow[])
        .filter((r) => isGameId(r.game_id))
        .map((r) => ({ gameId: r.game_id as GameId, rating: rowToRating(r) })),
      stats: ((stats.data ?? []) as StatsRow[]).filter((r) => isGameId(r.game_id)).map(rowToStats),
    };
  }

  async loadRecentRatings(limit: number): Promise<Array<{ identity: string; gameId: GameId; rating: Rating }>> {
    try {
      const sb = await this.client();
      const { data, error } = await sb.from('player_ratings').select('*').order('updated_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return ((data ?? []) as RatingRow[])
        .filter((r) => isGameId(r.game_id))
        .map((r) => ({ identity: r.identity, gameId: r.game_id as GameId, rating: rowToRating(r) }));
    } catch (err) {
      log.warn('ratings warm-up failed', { err: err as Error });
      return [];
    }
  }

  saveRating(identity: string, gameId: GameId, rating: Rating): void {
    this.pendingRatings.set(`${identity}|${gameId}`, {
      identity,
      game_id: gameId,
      user_id: userIdOf(identity),
      rating: Math.round(rating.rating),
      games: rating.games,
      wins: rating.wins,
      losses: rating.losses,
      draws: rating.draws,
      updated_at: new Date().toISOString(),
    });
    this.scheduleFlush();
  }

  saveStats(identity: string, line: GameStatLine): void {
    this.pendingStats.set(`${identity}|${line.gameId}`, {
      identity,
      game_id: line.gameId,
      user_id: userIdOf(identity),
      games: line.games,
      wins: line.wins,
      losses: line.losses,
      draws: line.draws,
      podiums: line.podiums,
      best_score: line.bestScore,
      lower_is_better: line.lowerIsBetter,
      total_score: line.totalScore,
      scored_games: line.scoredGames,
      tournament_games: line.tournamentGames,
      extras: line.extras,
      last_played_at: new Date(line.lastPlayedAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
    this.scheduleFlush();
  }

  private scheduleFlush(delayMs = FLUSH_DELAY_MS): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Rows waiting to be written (tests). */
  get pendingCount(): number {
    return this.pendingRatings.size + this.pendingStats.size;
  }

  async flush(): Promise<void> {
    if (this.flushing) await this.flushing;
    if (this.pendingRatings.size === 0 && this.pendingStats.size === 0) return;
    const ratingBatch = new Map(this.pendingRatings);
    const statsBatch = new Map(this.pendingStats);
    this.pendingRatings.clear();
    this.pendingStats.clear();
    const ratings = [...ratingBatch.values()];
    const stats = [...statsBatch.values()];
    this.flushing = (async () => {
      try {
        const sb = await this.client();
        if (ratings.length > 0) {
          const { error } = await sb.from('player_ratings').upsert(ratings, { onConflict: 'identity,game_id' });
          if (error) throw error;
        }
        if (stats.length > 0) {
          const { error } = await sb.from('player_game_stats').upsert(stats, { onConflict: 'identity,game_id' });
          if (error) throw error;
        }
        this.failures = 0;
      } catch (err) {
        // Rows are full snapshots: put the batch back unless a newer row for the same key arrived meanwhile.
        for (const [k, row] of ratingBatch) if (!this.pendingRatings.has(k)) this.pendingRatings.set(k, row);
        for (const [k, row] of statsBatch) if (!this.pendingStats.has(k)) this.pendingStats.set(k, row);
        this.failures++;
        log.warn('stats persistence failed — will retry', {
          err: err as Error,
          ratings: ratings.length,
          stats: stats.length,
          attempt: this.failures,
        });
        this.scheduleFlush(Math.min(MAX_FLUSH_DELAY_MS, FLUSH_DELAY_MS * 2 ** this.failures));
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
}

function rowToRating(r: RatingRow): Rating {
  return { rating: num(r.rating, 1200), games: num(r.games), wins: num(r.wins), losses: num(r.losses), draws: num(r.draws) };
}

function rowToStats(r: StatsRow): GameStatLine {
  const extras: Record<string, number> = {};
  if (r.extras && typeof r.extras === 'object') {
    for (const [k, v] of Object.entries(r.extras)) if (typeof v === 'number' && Number.isFinite(v)) extras[k] = v;
  }
  return {
    gameId: r.game_id as GameId,
    games: num(r.games),
    wins: num(r.wins),
    losses: num(r.losses),
    draws: num(r.draws),
    podiums: num(r.podiums),
    bestScore: r.best_score === null || r.best_score === undefined ? null : num(r.best_score),
    lowerIsBetter: Boolean(r.lower_is_better),
    totalScore: num(r.total_score),
    scoredGames: num(r.scored_games),
    tournamentGames: num(r.tournament_games),
    lastPlayedAt: Date.parse(r.last_played_at) || 0,
    extras,
  };
}

export let statsPersistence: StatsPersistence = supabaseEnabled ? new SupabaseStatsPersistence() : new NoopStatsPersistence();

/** Swap the adapter (tests). Returns the previous one. */
export function setStatsPersistence(next: StatsPersistence): StatsPersistence {
  const prev = statsPersistence;
  statsPersistence = next;
  return prev;
}
