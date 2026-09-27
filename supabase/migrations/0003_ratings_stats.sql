-- DASCADE ratings & per-game player stats (optional persistence).
--
-- Written ONLY by the game server with its secret key (service role); browsers never write here.
-- The server keeps the live numbers in memory and upserts whole rows in the background, so the
-- game never waits on the database. Rows are keyed by a DASCADE identity:
--   'u:<auth user id>'  verified account (user_id is set; the owner can read their own rows)
--   'g:<guest id>'      browser guest id (best effort; readable only through the server API)
--
-- The DASCADE rating is an internal Elo-style rating. It is NOT a FIDE (or other federation) rating.

-- ---------------------------------------------------------------------------
-- Ratings: one row per identity per rated game
-- ---------------------------------------------------------------------------
create table if not exists public.player_ratings (
  identity text not null check (char_length(identity) between 3 and 80),
  game_id text not null check (char_length(game_id) between 1 and 20),
  user_id uuid references auth.users (id) on delete cascade,
  rating integer not null check (rating between 0 and 4000),
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  updated_at timestamptz not null default now(),
  primary key (identity, game_id),
  constraint player_ratings_identity_user check (user_id is null or identity = 'u:' || user_id::text)
);
create index if not exists player_ratings_user_idx on public.player_ratings (user_id) where user_id is not null;
create index if not exists player_ratings_game_rating_idx on public.player_ratings (game_id, rating desc);
create index if not exists player_ratings_updated_idx on public.player_ratings (updated_at desc);

alter table public.player_ratings enable row level security;

create policy "player_ratings: read own" on public.player_ratings
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: only the service role (game server) writes.

-- ---------------------------------------------------------------------------
-- Extended per-game stats: one row per identity per game
-- (supersedes the account-only aggregate in public.player_stats, which is kept for compatibility)
-- ---------------------------------------------------------------------------
create table if not exists public.player_game_stats (
  identity text not null check (char_length(identity) between 3 and 80),
  game_id text not null check (char_length(game_id) between 1 and 20),
  user_id uuid references auth.users (id) on delete cascade,
  games integer not null default 0 check (games >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  podiums integer not null default 0 check (podiums >= 0),
  best_score double precision,
  lower_is_better boolean not null default false,
  total_score double precision not null default 0,
  scored_games integer not null default 0 check (scored_games >= 0),
  tournament_games integer not null default 0 check (tournament_games >= 0),
  -- Game-specific numeric extras (correct answers, eliminations, best hole...). Small by design.
  extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras) = 'object' and pg_column_size(extras) < 4096),
  last_played_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (identity, game_id),
  constraint player_game_stats_identity_user check (user_id is null or identity = 'u:' || user_id::text)
);
create index if not exists player_game_stats_user_idx on public.player_game_stats (user_id) where user_id is not null;

alter table public.player_game_stats enable row level security;

create policy "player_game_stats: read own" on public.player_game_stats
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: only the service role (game server) writes.

revoke insert, update, delete on public.player_ratings from anon, authenticated;
revoke insert, update, delete on public.player_game_stats from anon, authenticated;
revoke all on public.player_ratings from anon;
revoke all on public.player_game_stats from anon;
