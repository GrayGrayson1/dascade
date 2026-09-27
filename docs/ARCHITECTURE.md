# DASCADE architecture

DASCADE is a TypeScript pnpm monorepo. It builds into one Node service: a Colyseus game server that also serves the built React client. The frontend and server remain separable, so the client can move to a CDN later.

```
apps/
  web/            React 19 + Vite client: arcade floor, cabinet pickers, shell & lobby, Tournament Center, game UIs
  game-server/    Colyseus 0.18 authoritative server + Express (API, static hosting) + platform services
packages/
  shared/         Protocol, catalog, cabinets, tournament/stats/party contracts, Zod schemas, sanitation, RNG, rate limits (isomorphic)
  game-core/      Pure deterministic engines for every game, kit helpers (party, classics/shared), tournament engine, Elo rating
  ui/             Design system: layered theme tokens + theme API, CSS, React components, pixel icons, cards/chips
e2e/              Playwright specs (chromium, firefox, webkit, mobile = Pixel 7, mobile-safari = iPhone 14)
scripts/          Load simulation (load-test.ts, load-scenarios.ts, load/<party game>.ts, load-circuit.ts), dictionary build
supabase/         Optional Postgres migrations 0001–0004 + RLS policies
```

## Runtime topology

```
Browser ──HTTP──▶ Node (Express)   /api/health, /api/rooms/:code, /api/tournaments, /api/stats/me,
        │                          /api/classics/scores/:gameId, static client (prod)
        ──WS────▶ Colyseus rooms   one room per match (roomId = 5-char code), incl. Tournament Center kiosks
                     │
                     ├── platform services (in process): outcome hub → ratings, stats, tournament advancement;
                     │   Classics high scores
                     └── (optional) Supabase, written in the background with the server's secret key:
                         match summaries, ratings/stats, tournament history, high scores
Browser ──HTTPS─▶ Supabase (optional): anonymous auth, profile, presets, docs, protected by RLS
```

- **Authoritative server.** Every outcome that matters is decided in `BaseGameRoom` subclasses using a crypto RNG and the pure engines in `game-core`: shuffles, spins, rolls, legal moves, hits, strokes, shells, word validity, vote tallies, settlement, standings. Clients only send intents. The Classics games that simulate locally (Brick Blitz, Block Drop) stream their input log, and the server replays it through the same engine with a server-issued seed. The server's replay is the result.
- **State sync.** Public state uses Colyseus Schema (binary delta patches, 20 Hz by default). Hidden information never enters state. It's sent point-to-point with `sendTo`, and `syncPrivate()` re-sends it after any reconnect. Spectators never receive private payloads.
- **Identity.** A logical `playerId` is independent of the WebSocket `sessionId`. Joining returns a secret `seatToken`, which the client stores (sessionStorage and localStorage). Recovery happens in three layers:
  1. The Colyseus auto-reconnect, which keeps the same session during the room's grace period. The default is 45s, and the catalog's `reconnectGraceSeconds` raises it per game (90s for poker, ships, putt, tanks and DASception; 120s for chess, checkers and quest; 300s for the tournament kiosk). The client keeps retrying for the same duration.
  2. Reloading the page: `client.reconnect(token)`, falling back to `joinById(code, { seatToken })`, which rebinds the same seat.
  3. After the grace period expires mid-match, the seat is kept as *away* and can still be reclaimed with the token.

  A second tab with the same token replaces the first, so a player is never duplicated.
- **Rating identity.** Ratings and stats are keyed by a DASCADE identity: `u:<account id>` for a verified Supabase account, otherwise `g:<guest id>` (the browser's local guest id, best effort). A room player id is never used across rooms.
- **Host.** The host is a playerId. It migrates immediately on leave, or after 10s if the host is disconnected. Candidates are ordered by connected players first (spectators last), then join order. Mid-match only seated players can become host (`canBecomeHost`).
- **Lifecycle.** `LOBBY → COUNTDOWN → PLAYING ↔ INTERMISSION → RESULTS → LOBBY`. `ENDED` means the host closed the room.
- **Validation.** Every client message goes through `BaseGameRoom.handle()`: per-player token bucket, Zod parse, phase, host and spectator guards, and exception isolation. Frames are capped at 256 KB. Matchmaking is rate-limited per IP in `static onAuth`, and the HTTP APIs have their own per-IP limiters.
- **Room codes.** 5 characters from a 31-symbol unambiguous alphabet, unique via Colyseus presence (Redis-ready).

## Platform services (`apps/game-server/src/platform/`)

Games report results, and the platform does the rest:

- **Outcomes.** A room calls `this.reportOutcome({ placements, scores?, lowerIsBetter?, reason?, details? })` once per finished game, alongside `this.endMatch(...)`. `placements` holds room player ids grouped by place, best first, and a draw is one group. The base room filters it to the match roster (everyone seated at the start, plus mid-match seats), accepts **one outcome per match** (duplicates are logged and ignored) and emits it on the outcome hub (`hub.ts`) with context: game, room, rated flag, roster with identities, and tournament match info. Every game reports outcomes except Wheel of DAStiny, which is a shared decision tool rather than a competition. Players who left mid-match are listed last (`matchLeaverIds()`), and a match that ends before anything was played (e.g. the host closes a table before the first hand) reports nothing.
- **Ratings** (`ratings.ts`, Elo in `@dascade/game-core/rating`): an internal DASCADE rating (default 1200, provisional for 10 games, faster K while provisional), not a federation rating. An outcome is rated when the catalog entry has `rated: true` (chess, checkers), the room isn't solo, and it is a tournament match or the room opts in (`ratedOptIn()`, the boardroom kit's lobby toggle). `this.isRatedMatch()` and `this.ratingOf(player)` expose it to rooms.
- **Stats** (`stats.ts`, contract in `packages/shared/src/stats.ts`): per identity and game it keeps games, wins, draws, losses, podiums (fields of 3 or more), best score (honours `lowerIsBetter`) and tournament games, plus game-specific extras from `details.playerStats[playerId]`. The key prefix decides aggregation: `max…`/`best…` keep the highest, `min…`/`fewest…` the lowest, and anything else is summed. It's served by `GET /api/stats/me` (bearer token for accounts, `?guestId=` for guests).
- **Persistence adapters** (`statsPersistence.ts`, `statsLoader.ts`, `tournamentStore.ts`, `rooms/classics/highScorePersistence.ts`, `persistence/index.ts`): no-ops unless `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set. The in-memory stores are always the source of truth. Writes are coalesced and fire-and-forget. An identity's stored ratings and stats are hydrated the first time the process sees it, and recent ratings are warmed at startup so rating-based seeding survives restarts.

## Tournament Center

- **Engine** (`packages/game-core/src/tournament/`): pure and seeded. It handles single elimination (standard seeding, byes to top seeds), double elimination (a losers bracket with anti-rematch drop-ins and an optional grand-final reset), round robin (Berger tables, balanced sides) and Swiss (score groups, maximum-weight matching in `matching.ts`, no avoidable rematches, side balance, byes to the lowest-ranked player). It also covers series rules (`series.ts`: best-of, draws ½, deciders) and standings with tiebreaks. It's tested with seeded random playouts (`chaos.test.ts`).
- **Kiosk room** (`apps/game-server/src/rooms/tournament/TournamentRoom.ts`, game id `tournament`, not a cabinet game): one room per tournament. Its phase stays `LOBBY`, and the tournament has its own status (DRAFT → REGISTRATION → CHECK_IN → READY → IN_PROGRESS → COMPLETE / CANCELLED). Participants and matches are Schema maps; `tournamentViewFromState()` turns them into one typed view on the client. Private `tournament:me` carries participant and organizer tokens and the active match ticket. Every request gets a `tournament:ack`, and organizer actions go into a public audit log.
- **Match binding** (`platform/tournaments.ts` + the "Tournament Center binding" section of `BaseGameRoom.ts`): for a ready match, the kiosk registers a one-time, server-only binding key and creates the game room on its own process. The room consumes the key in `onCreate`, because client create options can't forge a binding. A bound room:
  - is locked to two seats; a valid `ticket` join option seats its participant, and everyone else spectates;
  - refuses lobby controls (start, kick, settings, spectate, rename, close);
  - auto-starts when both participants are present;
  - publishes `tournamentJson` (`TournamentMatchInfo`: round, series score, sides, status) and exposes `this.tournamentMatch` to game code.

  Each `reportOutcome()` is delivered to the kiosk, which records it idempotently by (match, game number) and answers "next game" (an intermission, then sides swap), "decided", or "closed" (resolved by the organizer). Dead match rooms are relaunched with the same tickets.
- **Client** (`apps/web/src/tournament/` for the landing page, create wizard, brackets and `TournamentBanner`; `apps/web/src/games/tournament/` for the kiosk room's client module; `arcade/TournamentKiosk.tsx` for the floor kiosk). `GET /api/tournaments` lists public, non-draft, non-cancelled tournaments of **this process**. Live tournaments are in memory. The optional `0002` tables mirror their history but are not used to restore them.

## Kits

Game families share server and client toolkits. Build on them, and extend a kit additively rather than copying it. The API reference is in [`GAME_GUIDE.md` §6](GAME_GUIDE.md#6-kits).

| Kit | Server | Client | Pure / shared | Used by |
|---|---|---|---|---|
| **Party** | `rooms/party/PartyRoom.ts`: stage machine with host pause/skip, answer and vote boxes, "who answered" seats, private mailbox, teams, score reveal, `finishParty()` | `games/_party/`: stage layout, timers, answer grids, vote grid, leaderboards, podium, rules drawer | `@dascade/shared/party`, `@dascade/game-core/party` | trivia, deception, masterpiece, words, survey |
| **Boardroom** | `rooms/boardroom/BoardGameRoom.ts`: sides, server clock (`clock.ts`), resign, draw offers, take-backs, rematch, untimed idle rule, abandonment, `finish()` | `games/_boardroom/`: `SquareBoard`, player cards, clocks, move list, action bar, result banner, settings | `@dascade/shared/games/boardroom` | chess, checkers |
| **Classics** | `rooms/classics/ClassicsRoom.ts` (standings, instant solo, match flow, outcomes, high scores) + `VerifiedClassicsRoom.ts` (input-log replay) | `games/_classics/`: `ClassicsShell`, cards, HUD, input and touch controls, fixed loop, canvas helpers, `useVerifiedFlow` | `@dascade/shared/games/classics`, `@dascade/game-core/classics/shared` | paddle, snake, bricks, asteroids, memory, blocks |

DAS Ships uses its own room (`ShipsRoom` extends `BaseGameRoom`).

## Client

- `net/session.ts` owns the only Colyseus `Client` and `Room`. It exposes a message bus with a last-value cache, a lazily computed `toJSON()` snapshot per patch, clock sync (`serverNow()`), chat, and connection status. React reads it through `net/hooks.ts` (`useGame`, `useRoomSelector`, `useLatestMessage`, `useCountdown`). `joinRoom(code, { ticket })` joins a tournament match.
- Games are code-split. `games/registry.ts` lazy-imports `games/<id>/index.tsx` (a `GameClientModule`). Phaser is imported only by the games that use it. Kit folders start with `_` (`_party`, `_boardroom`, `_classics`) and are imported only by their games.
- `shell/` holds:
  - the shared lobby, top bar, modals and error states;
  - cabinet title screens (`CabinetEntry`, `/play/:gameId`) and the multi-game cabinet picker (`CabinetPicker` + `shell/cabinet/`, `/cabinet/:cabinetId`);
  - `Reconnect.tsx`, which shows the RECONNECTING overlay, a RECONNECTED flash, and a "Rejoin my seat" screen for every game;
  - `profile/`, the Profile and Stats tabs.
- `arcade/` is the pixel-art arcade floor: a cover-flow lineup of the cabinets in `packages/shared/src/cabinets.ts` (spring-animated DOM transforms, math in `carousel.ts`), per-cabinet SVG art, the floor's tournament kiosk, and procedural attract-mode scenes (`attract.ts` + `scenes/`) that only animate for the centred cabinet and its neighbours. The floor never imports game modules. Cabinet variants (DASino tables) travel from the title screen into the room through `variantRequest.ts`.
- `tournament/` is the Tournament Center (see above). Its dev-only bracket gallery (`/tournaments?gallery=…`) is tree-shaken from production.
- `audio/` is procedural WebAudio SFX and music, unlocked on the first gesture.
- `persistence/` is an adapter interface. `LocalPersistence` (localStorage) is the default. `SupabasePersistence` (anonymous auth, RLS tables) is used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set.
- **Theme.** `packages/ui/src/styles/tokens.css` defines layered tokens: foundation, palette, semantic and derived. Its `:root` values are the built-in **Delta Neon** theme. `@dascade/ui`'s theme API (`applyTheme`, `registerTheme`, `readThemeTokens`, `useThemeTokens`) applies a `ThemeDefinition` at boot from `settings.theme` and gives canvas/Phaser renderers the resolved palette. Games get their accent from the catalog through `<GameStage gameId>`. Game art may keep its own palette, declared once in the game's folder. See [`THEMING.md`](THEMING.md).

## Performance rules

- Keep high-frequency data (racing, drawing, real-time classics, putt and tank animation) out of React. Phaser and canvas read from the room or the message bus directly, and HUD values go through small external stores.
- Batch drawing points (about 50 ms). Real-time inputs are small, sent at a fixed rate and credit-limited on the server. Remote entities are interpolated from binary snapshots.
- Simulations that run on both client and server use only `+ - * /`, `Math.sqrt`, `floor`, `round`, `abs`, `min` and `max` (direction tables or polynomial trig instead of `Math.sin`/`cos`/`atan2`), so every JS engine gets identical results. The server's result is always authoritative.
- Dispose Phaser games, rAF loops, intervals, audio nodes and listeners when a view unmounts.

## Deployment

The simplest production setup is a single WebSocket-capable Node service (Fly.io, Render, Railway, a container on ECS or Cloud Run with session affinity):

```
pnpm install --frozen-lockfile && pnpm build && NODE_ENV=production node apps/game-server/dist/index.js
```

The build copies the DASwords dictionary to `apps/game-server/dist/words-data/` (or set `DASCADE_WORDS_DICT`). Scale out with `@colyseus/redis-presence` and `@colyseus/redis-driver` and sticky sessions. Tournament kiosks keep their match rooms on their own process, while ratings, stats, high scores and the `/api/tournaments` listing are per process. Don't host the game server on serverless functions: rooms are long-lived, stateful WebSockets. The static client can move to a CDN by setting `VITE_SERVER_URL` at build time.
