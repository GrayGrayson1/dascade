-- DAScade Classics verified high scores (optional persistence).
--
-- Written ONLY by the game server with its secret key (service role) and only for results the
-- server verified itself (replayed input logs, server-simulated or server-judged games).
-- Browsers read boards through GET /api/classics/scores/:gameId — never from this table — so the
-- identity column (a DASCADE identity 'u:<auth id>' / 'g:<guest id>' / 'p:<room player>') is never
-- exposed. One row per identity per board: the server upserts when a player beats their best.

create table if not exists public.classics_high_scores (
  game_id text not null check (char_length(game_id) between 1 and 20),
  board text not null check (board ~ '^[a-z0-9-]{1,24}$'),
  identity text not null check (char_length(identity) between 3 and 80),
  entry_id text not null check (char_length(entry_id) between 1 and 32),
  name text not null check (char_length(name) between 1 and 40),
  score bigint not null check (score >= 0),
  level integer not null default 0 check (level >= 0),
  stat integer not null default 0 check (stat >= 0),
  achieved_at timestamptz not null default now(),
  primary key (game_id, board, identity)
);

create index if not exists classics_high_scores_board_idx
  on public.classics_high_scores (game_id, board, score desc, achieved_at asc);

alter table public.classics_high_scores enable row level security;
-- No policies: only the service role (game server) reads and writes this table.
