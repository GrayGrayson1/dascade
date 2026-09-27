/**
 * Optional durable mirror for Classics high scores (table from
 * supabase/migrations/0004_classics_high_scores.sql). Installed only when Supabase is configured;
 * the in-memory HighScoreService stays the source of truth and never waits on it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameId } from '@dascade/shared';
import { config, supabaseEnabled } from '../../config.ts';
import type { HighScorePersistence } from './highScores.ts';

interface Row {
  identity: string;
  entry_id: string;
  name: string;
  score: number | string;
  level: number;
  stat: number;
  achieved_at: string;
}

class SupabaseHighScores implements HighScorePersistence {
  private clientPromise: Promise<SupabaseClient> | null = null;

  private client(): Promise<SupabaseClient> {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.supabase.url, config.supabase.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    return this.clientPromise;
  }

  async load(gameId: GameId, board: string) {
    const sb = await this.client();
    const { data, error } = await sb
      .from('classics_high_scores')
      .select('identity, entry_id, name, score, level, stat, achieved_at')
      .eq('game_id', gameId)
      .eq('board', board)
      .order('score', { ascending: false })
      .order('achieved_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.entry_id,
      identity: r.identity,
      name: r.name,
      score: Number(r.score) || 0,
      level: r.level ?? 0,
      stat: r.stat ?? 0,
      at: Date.parse(r.achieved_at) || Date.now(),
    }));
  }

  async save(gameId: GameId, board: string, entry: { id: string; identity: string; name: string; score: number; level: number; stat: number; at: number }) {
    const sb = await this.client();
    const { error } = await sb.from('classics_high_scores').upsert(
      {
        game_id: gameId,
        board,
        identity: entry.identity,
        entry_id: entry.id,
        name: entry.name,
        score: entry.score,
        level: entry.level,
        stat: entry.stat,
        achieved_at: new Date(entry.at).toISOString(),
      },
      { onConflict: 'game_id,board,identity' },
    );
    if (error) throw error;
  }
}

/** The durable mirror when Supabase is configured, else null (in-memory only). */
export function createHighScorePersistence(): HighScorePersistence | null {
  return supabaseEnabled ? new SupabaseHighScores() : null;
}
