/**
 * Tournament persistence adapter. The kiosk room is always the live source of truth (in memory);
 * when Supabase is configured, finished and running tournaments are mirrored — definition,
 * entrants, matches/results and the audit history — to the tables in
 * supabase/migrations/0002_tournaments.sql (server secret key only; RLS allows public reads of
 * public tournaments). Persistence is fire-and-forget: it never blocks or breaks a tournament.
 * Rating identities (guest/account ids) are never written.
 */
import type { TournamentData } from '@dascade/game-core/tournament';
import { config, supabaseEnabled } from '../config.ts';
import { log } from '../lib/log.ts';

export interface TournamentStore {
  /** Upsert the tournament snapshot. `id` is unique per tournament (room codes are reused). */
  save(id: string, code: string, data: TournamentData): Promise<void>;
}

class NoopTournamentStore implements TournamentStore {
  async save(): Promise<void> {}
}

const iso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null);

class SupabaseTournamentStore implements TournamentStore {
  private clientPromise: Promise<import('@supabase/supabase-js').SupabaseClient> | null = null;
  /** Highest audit entry id already written per tournament. */
  private readonly auditSaved = new Map<string, number>();

  private client() {
    this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.supabase.url, config.supabase.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    return this.clientPromise;
  }

  async save(id: string, code: string, data: TournamentData): Promise<void> {
    try {
      const sb = await this.client();
      const champion = data.championId ? data.participants.find((p) => p.id === data.championId) : undefined;
      const { error } = await sb.from('tournaments').upsert({
        id,
        code,
        name: data.config.name,
        game_id: data.config.gameId,
        format: data.config.format,
        status: data.status,
        visibility: data.config.visibility,
        best_of: data.config.bestOf,
        config: data.config,
        seeding_method: data.seedingMethod,
        champion_participant_id: data.championId,
        champion_name: champion?.name ?? null,
        created_at: iso(data.createdAt),
        started_at: iso(data.startedAt),
        completed_at: iso(data.completedAt),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      if (data.participants.length > 0) {
        const { error: e2 } = await sb.from('tournament_entrants').upsert(
          data.participants.map((p) => ({
            tournament_id: id,
            participant_id: p.id,
            name: p.name,
            seed: p.seed,
            status: p.status,
            entry: p.entry,
            rating: p.rating,
          })),
        );
        if (e2) throw e2;
      }
      if (data.matches.length > 0) {
        const { error: e3 } = await sb.from('tournament_matches').upsert(
          data.matches.map((m) => ({
            tournament_id: id,
            match_id: m.id,
            bracket: m.bracket,
            round: m.round,
            match_order: m.order,
            label: m.label,
            status: m.status,
            participant_a: m.a,
            participant_b: m.b,
            winner_id: m.winner,
            draw: m.draw,
            result_kind: m.resultKind,
            result_note: m.resultNote,
            games: m.games,
            completed_at: iso(m.completedAt),
          })),
        );
        if (e3) throw e3;
      }
      const since = this.auditSaved.get(id) ?? 0;
      const fresh = data.audit.filter((a) => a.id > since);
      if (fresh.length > 0) {
        const { error: e4 } = await sb.from('tournament_audit').upsert(
          fresh.map((a) => ({
            tournament_id: id,
            entry_id: a.id,
            at: iso(a.at),
            actor: a.actor,
            action: a.action,
            text: a.text,
            reason: a.reason ?? null,
            match_id: a.matchId ?? null,
            participant_id: a.participantId ?? null,
          })),
        );
        if (e4) throw e4;
        this.auditSaved.set(id, fresh[fresh.length - 1]!.id);
      }
    } catch (err) {
      log.warn('tournament persistence failed', { code, err: err as Error });
    }
  }
}

export const tournamentStore: TournamentStore = supabaseEnabled ? new SupabaseTournamentStore() : new NoopTournamentStore();
