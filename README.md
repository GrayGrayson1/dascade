# DASCADE — Delta Alpha Sierra Arcade

A work-friendly multiplayer browser arcade: a pixel-art arcade floor with eight modern cabinets you can jump into with coworkers. No account needed, just create a room and share a 5-letter code.

| Cabinet | What it is |
|---|---|
| **DASketch** | Draw-and-guess party game (up to 30 players) |
| **DAS Hold'em** | Full no-limit Texas Hold'em: side pots, timers, spectators |
| **DASjack 21** | Multiplayer blackjack: simultaneous decisions, splits, doubles, insurance, surrender |
| **DAS Bingo** | 75-ball or custom-text bingo, visual pattern editor, server-verified claims |
| **Wheel of DAStiny** | Shared, fully customizable weighted prize wheel |
| **DASino** | European roulette, an original slot machine, and dice high/low |
| **DASh Circuit** | Top-down neon racer for up to 20 drivers, with a car customizer and time trials |
| **DASQuest** | Co-op branching adventure: *The Glitch Beneath Delta Alpha* |

> All casino-style games use meaningless **virtual chips**. There is no real-money wagering, purchasing, deposits or cash-out of any kind.

## Quick start

Prerequisites: **Node ≥ 22.12** and **pnpm** (via corepack: `corepack enable`).

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173. `pnpm dev` runs the Colyseus game server on :2567 and the Vite client on :5173 (the client connects to the server's port automatically). No Supabase or other services are required.

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Game server + web client with hot reload |
| `pnpm build` | Production build: `apps/web/dist` and the bundled server `apps/game-server/dist` |
| `pnpm start` | Runs the built server. With `NODE_ENV=production` it also serves the built client on one port. |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest: engine unit tests and server integration tests |
| `pnpm test:e2e` | Playwright on Chromium, Firefox, WebKit and a mobile viewport. Builds and boots the production server automatically. |
| `pnpm load` | 30-client load simulation against a running server (`LOAD_URL`, `CLIENTS`). Start the server with `DASCADE_RELAXED_LIMITS=1`. |
| `pnpm exec tsx scripts/load-circuit.ts` | 20 scripted-input racing bots against a running server |

Production in one line:

```bash
pnpm install --frozen-lockfile && pnpm build && NODE_ENV=production PORT=8080 pnpm start
```

## Architecture

```
apps/web          React 19 + Vite client: arcade floor, shared shell & lobby, game UIs (Phaser 4 where it helps)
apps/game-server  Colyseus 0.18 authoritative rooms + Express (/api/health, /api/rooms/:code, static client)
packages/shared   Protocol, game catalog, Zod schemas, sanitation, crypto/seeded RNG, rate limiting
packages/game-core Pure deterministic engines (poker, blackjack, bingo, wheel, casino, quest, racing…)
packages/ui       Design system: tokens, components, pixel icons, playing cards and chips
e2e/              Playwright specs     scripts/  load simulation     supabase/  optional schema + RLS
```

- **Server authoritative.** Every shuffle, spin, roll, deal, legal action, settlement, bingo claim, race position, checkpoint and quest check is decided on the server with a crypto RNG. Clients only send validated intents (Zod + per-player token-bucket rate limits).
- **Hidden info stays hidden.** Hole cards, the dealer's hole card, secret words and bingo cards are never in synchronized state. They're sent privately and re-sent on reconnect.
- **Resilient sessions.** Stable player IDs, auto-reconnect with a 45s grace period, seat-token rejoin after a refresh, host migration, spectators, room lock and kick.
- **Shared lifecycle.** Every game extends `BaseGameRoom` (`LOBBY → COUNTDOWN → PLAYING ↔ INTERMISSION → RESULTS`), and every client uses the same lobby, top bar and error states.

For details see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The game contract is in [`docs/GAME_GUIDE.md`](docs/GAME_GUIDE.md).

## Environment variables

Everything is optional. Copy `.env.example` to `.env` at the repo root (both apps read it).

| Variable | Where | Purpose |
|---|---|---|
| `PORT`, `HOST` | server | Listen address (default `0.0.0.0:2567`) |
| `NODE_ENV=production` | server | Serve the built client from the game server |
| `DASCADE_SAVE_SECRET` | server | HMAC key for DASQuest save files (**set this in production**) |
| `DASCADE_LATENCY_MS` | server | Simulated round-trip latency for netcode testing |
| `DASCADE_ONLY_GAMES` | server | Comma-separated game ids to load (focused development) |
| `DASCADE_RELAXED_LIMITS=1` | server | Relax per-IP matchmaking throttles (tests / load simulation) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | server | Optional: record finished-match stats. The secret key stays on the server. |
| `VITE_SERVER_URL` | web (build) | Game server origin when the client is hosted separately (CDN) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | web (build) | Optional: cloud profiles and presets via anonymous auth |

## Optional Supabase persistence

Without Supabase, DASCADE keeps a local guest identity and stores your nickname, settings, wheel presets, bingo patterns, sketch word packs, car designs and quest saves in `localStorage`.

To enable cloud persistence:

1. Create a Supabase project and enable **Anonymous sign-ins** (Authentication → Providers).
2. Apply `supabase/migrations/0001_dascade_init.sql` (SQL editor or `supabase db push`). It creates `profiles`, `presets`, `user_docs`, `player_stats` and `match_results` with row-level security. Users can read and write only their own rows. Stats and match results are writable only by the server's secret key.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the client, and optionally `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the server.

Players can upgrade their anonymous account to a permanent one from **Settings → Account**. Live match state is never written to Postgres.

## Adding a new game

1. Add an entry to `packages/shared/src/catalog.ts` (`GAME_IDS` and `GAME_CATALOG`).
2. Add the contract: `packages/shared/src/games/<id>.ts` (settings schema, message names, payload schemas).
3. Add the engine: `packages/game-core/src/<id>/` (pure, `Rng`-injected, unit tested).
4. Add the room: `apps/game-server/src/rooms/<id>/<Name>Room.ts` extending `BaseGameRoom`, and register it in `rooms/registry.ts`.
5. Add the client: `apps/web/src/games/<id>/index.tsx` exporting a `GameClientModule`, and register it in `games/registry.ts`.
6. Add tests: `apps/game-server/test/<id>.test.ts` and `e2e/<id>.spec.ts`. Give the arcade floor a cabinet (`apps/web/src/arcade`).

## Adding a DASQuest adventure

Adventures are typed, schema-validated data packs in `packages/game-core/src/quest/packs/`. Create a pack file (nodes, choices, checks, effects, items, endings) and add it to the pack registry in that folder. The engine and room pick it up with no code changes, and the host can choose it in the lobby. The pack validator test walks every pack and fails if a node, item or ending reference is broken, or if any path dead-ends.

## Deployment recommendations

- Run the game server as a **long-lived, WebSocket-capable Node service** (Fly.io, Render, Railway, ECS/Cloud Run with session affinity, or a VM). Don't use serverless functions (e.g. Vercel functions) for gameplay WebSockets.
- Start with a single instance serving both the API/WebSockets and the static client. For more capacity, add `@colyseus/redis-presence` + `@colyseus/redis-driver`, run several instances with sticky sessions, and move the static client to a CDN (`VITE_SERVER_URL`).
- Terminate TLS at the load balancer and make sure it allows WebSocket upgrades and long idle timeouts (≥ 60s).
- Set `DASCADE_SAVE_SECRET`, and keep `SUPABASE_SECRET_KEY` server-side only.
