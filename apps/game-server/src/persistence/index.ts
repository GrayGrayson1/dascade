/**
 * Server-side persistence is intentionally tiny: live match state never touches
 * Postgres. Only finished-match summaries (aggregate stats) are written, and only
 * when Supabase is configured. Everything else runs fine without it.
 */
import { config, supabaseEnabled } from '../config.ts';
import { log } from '../lib/log.ts';
import { trackWrite } from '../lib/pendingWrites.ts';

export interface MatchPlayerSummary {
  playerId: string;
  name: string;
  guestId?: string;
  userId?: string;
  score: number;
  placement: number;
}

export interface MatchSummary {
  gameId: string;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  players: MatchPlayerSummary[];
  /** Small game-specific summary (winner, pot, track, etc). Keep it compact. */
  details?: Record<string, unknown>;
}

export interface MatchResultSink {
  record(summary: MatchSummary): Promise<void>;
  /** Verifies a Supabase access token; returns the user id or null. */
  verifyUser(accessToken: string): Promise<string | null>;
}

class NoopSink implements MatchResultSink {
  async record(): Promise<void> {}
  async verifyUser(): Promise<string | null> {
    return null;
  }
}

class SupabaseSink implements MatchResultSink {
  private clientPromise: Promise<import('@supabase/supabase-js').SupabaseClient> | null = null;

  private client() {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.supabase.url, config.supabase.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
    return this.clientPromise;
  }

  /** Tracked so a clean shutdown waits for it (pendingWrites.ts). */
  record(summary: MatchSummary): Promise<void> {
    return trackWrite(this.write(summary));
  }

  private async write(summary: MatchSummary): Promise<void> {
    try {
      const sb = await this.client();
      const { error } = await sb.from('match_results').insert({
        game_id: summary.gameId,
        room_code: summary.roomCode,
        started_at: new Date(summary.startedAt).toISOString(),
        ended_at: new Date(summary.endedAt).toISOString(),
        players: summary.players,
        details: summary.details ?? {},
      });
      if (error) throw error;
      const rows = summary.players
        .filter((p) => p.userId)
        .map((p) => ({ user_id: p.userId, game_id: summary.gameId, won: p.placement === 1, score: p.score }));
      if (rows.length > 0) {
        const { error: statsError } = await sb.rpc('record_player_results', { results: rows });
        if (statsError) throw statsError;
      }
    } catch (err) {
      log.warn('match result persistence failed', { err: err as Error });
    }
  }

  async verifyUser(accessToken: string): Promise<string | null> {
    try {
      const sb = await this.client();
      const { data, error } = await sb.auth.getUser(accessToken);
      if (error || !data.user) return null;
      return data.user.id;
    } catch {
      return null;
    }
  }
}

export const matchSink: MatchResultSink = supabaseEnabled ? new SupabaseSink() : new NoopSink();
