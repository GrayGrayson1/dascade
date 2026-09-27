-- DASCADE Tournament Center persistence (optional).
-- The game server keeps live tournaments in memory; when Supabase is configured it mirrors
-- definitions, entrants, matches/results and the audit history here using the SERVER secret key.
-- RLS: anyone may read PUBLIC tournaments; nobody but the server (service role, which bypasses
-- RLS) may write. No player identities (guest or account ids) are stored.

create table if not exists public.tournaments (
  id text primary key check (char_length(id) between 8 and 40),
  code text not null check (char_length(code) between 3 and 12),
  name text not null check (char_length(name) between 1 and 120),
  game_id text not null check (char_length(game_id) between 1 and 24),
  format text not null check (format in ('single_elimination', 'double_elimination', 'round_robin', 'swiss')),
  status text not null check (status in ('DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED')),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  best_of smallint not null check (best_of between 1 and 9),
  config jsonb not null check (pg_column_size(config) < 16384),
  seeding_method text check (seeding_method is null or seeding_method in ('random', 'manual', 'rating')),
  champion_participant_id text check (champion_participant_id is null or char_length(champion_participant_id) <= 40),
  champion_name text check (champion_name is null or char_length(champion_name) <= 40),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists tournaments_public_recent_idx on public.tournaments (visibility, status, created_at desc);
create index if not exists tournaments_game_idx on public.tournaments (game_id, completed_at desc);

create table if not exists public.tournament_entrants (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  participant_id text not null check (char_length(participant_id) between 1 and 40),
  name text not null check (char_length(name) between 1 and 40),
  seed smallint not null default 0 check (seed between 0 and 256),
  status text not null check (status in ('registered', 'checked_in', 'active', 'eliminated', 'champion', 'withdrawn', 'disqualified', 'no_show')),
  entry smallint not null default 0,
  rating integer not null default 1200,
  primary key (tournament_id, participant_id)
);

create table if not exists public.tournament_matches (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  match_id text not null check (char_length(match_id) between 1 and 40),
  bracket text not null check (bracket in ('winners', 'losers', 'grand_final', 'grand_final_reset', 'main')),
  round smallint not null,
  match_order smallint not null,
  label text not null check (char_length(label) <= 80),
  status text not null check (status in ('WAITING', 'READY', 'IN_PROGRESS', 'COMPLETE', 'FORFEIT', 'VOID')),
  participant_a text,
  participant_b text,
  winner_id text,
  draw boolean not null default false,
  result_kind text check (result_kind is null or result_kind in ('played', 'bye', 'forfeit', 'dq', 'double_forfeit', 'override', 'lots', 'void')),
  result_note text check (result_note is null or char_length(result_note) <= 260),
  games jsonb not null default '[]'::jsonb check (pg_column_size(games) < 16384),
  completed_at timestamptz,
  primary key (tournament_id, match_id)
);

create table if not exists public.tournament_audit (
  tournament_id text not null references public.tournaments (id) on delete cascade,
  entry_id integer not null,
  at timestamptz not null,
  actor text not null check (actor in ('organizer', 'system', 'participant')),
  action text not null check (char_length(action) <= 40),
  text text not null check (char_length(text) <= 600),
  reason text check (reason is null or char_length(reason) <= 400),
  match_id text,
  participant_id text,
  primary key (tournament_id, entry_id)
);

alter table public.tournaments enable row level security;
alter table public.tournament_entrants enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_audit enable row level security;

-- Public read of public tournaments (and their children). No insert/update/delete policies:
-- only the game server's secret key (service role) writes.
create policy "tournaments: public read" on public.tournaments
  for select to anon, authenticated using (visibility = 'public');

create policy "tournament_entrants: public read" on public.tournament_entrants
  for select to anon, authenticated using (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.visibility = 'public')
  );

create policy "tournament_matches: public read" on public.tournament_matches
  for select to anon, authenticated using (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.visibility = 'public')
  );

create policy "tournament_audit: public read" on public.tournament_audit
  for select to anon, authenticated using (
    exists (select 1 from public.tournaments t where t.id = tournament_id and t.visibility = 'public')
  );

revoke insert, update, delete on public.tournaments, public.tournament_entrants, public.tournament_matches, public.tournament_audit from anon, authenticated;
