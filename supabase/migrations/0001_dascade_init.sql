-- DASCADE optional persistence schema (Supabase / Postgres).
-- Live gameplay never touches these tables — only profiles, presets, small
-- per-user documents and aggregate stats written by the game server.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user, including anonymous users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player' check (char_length(display_name) between 1 and 20),
  avatar text not null default 'rocket' check (char_length(avatar) <= 20),
  preferences jsonb not null default '{}'::jsonb check (pg_column_size(preferences) < 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Presets: wheel segments, bingo patterns/setups, sketch word packs, quest saves…
-- ---------------------------------------------------------------------------
create table if not exists public.presets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 40),
  name text not null check (char_length(name) between 1 and 60),
  data jsonb not null check (pg_column_size(data) < 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists presets_owner_kind_idx on public.presets (owner, kind, updated_at desc);

alter table public.presets enable row level security;

create policy "presets: read own" on public.presets
  for select to authenticated using (owner = (select auth.uid()));
create policy "presets: insert own" on public.presets
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "presets: update own" on public.presets
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "presets: delete own" on public.presets
  for delete to authenticated using (owner = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Small per-user documents (car customization, last settings, best laps…)
-- ---------------------------------------------------------------------------
create table if not exists public.user_docs (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 80),
  data jsonb not null check (pg_column_size(data) < 65536),
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

alter table public.user_docs enable row level security;

create policy "user_docs: read own" on public.user_docs
  for select to authenticated using (owner = (select auth.uid()));
create policy "user_docs: insert own" on public.user_docs
  for insert to authenticated with check (owner = (select auth.uid()));
create policy "user_docs: update own" on public.user_docs
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "user_docs: delete own" on public.user_docs
  for delete to authenticated using (owner = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Aggregate player statistics (written ONLY by the game server's secret key)
-- ---------------------------------------------------------------------------
create table if not exists public.player_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id text not null check (char_length(game_id) <= 20),
  matches integer not null default 0,
  wins integer not null default 0,
  total_score bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.player_stats enable row level security;

create policy "player_stats: read own" on public.player_stats
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: clients cannot write stats.

-- ---------------------------------------------------------------------------
-- Finished-match summaries (server only; never exposed to browsers)
-- ---------------------------------------------------------------------------
create table if not exists public.match_results (
  id bigint generated always as identity primary key,
  game_id text not null,
  room_code text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  players jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb
);

alter table public.match_results enable row level security;
revoke all on public.match_results from anon, authenticated;

-- Atomic stat increments, callable only by the service role (game server).
create or replace function public.record_player_results(results jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
begin
  for r in select * from jsonb_array_elements(results)
  loop
    insert into public.player_stats (user_id, game_id, matches, wins, total_score, updated_at)
    values ((r->>'user_id')::uuid, r->>'game_id', 1, case when (r->>'won')::boolean then 1 else 0 end, coalesce((r->>'score')::bigint, 0), now())
    on conflict (user_id, game_id) do update
      set matches = player_stats.matches + 1,
          wins = player_stats.wins + excluded.wins,
          total_score = player_stats.total_score + excluded.total_score,
          updated_at = now();
  end loop;
end;
$$;

revoke execute on function public.record_player_results(jsonb) from public, anon, authenticated;
grant execute on function public.record_player_results(jsonb) to service_role;
