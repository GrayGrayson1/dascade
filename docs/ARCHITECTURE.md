# DASCADE architecture

DASCADE is a TypeScript pnpm monorepo. It builds into one Node service: a Colyseus game server that also serves the built React client. The frontend and server remain separable, so the client can move to a CDN later.

```
apps/
  web/            React 19 + Vite client (arcade floor, shell, lobby, game UIs, Phaser scenes)
  game-server/    Colyseus 0.18 authoritative server + Express (API, static hosting)
packages/
  shared/         Protocol, catalog, validation schemas, text sanitation, RNG, rate limiting (isomorphic)
  game-core/      Pure deterministic game engines (cards, poker, blackjack, bingo, wheel, casino, quest, racing)
  ui/             DASCADE design system: tokens, CSS, React components, pixel icon set, cards/chips
e2e/              Playwright specs (Chromium, Firefox, WebKit, mobile)
scripts/          Load simulation and tooling
supabase/         Optional Postgres schema + RLS policies
```

## Runtime topology

```
Browser ──HTTP──▶ Node (Express)   /api/health, /api/rooms/:code, static client (prod)
        ──WS────▶ Colyseus rooms   one room per match (roomId = 5-char code)
                     │
                     └── (optional) Supabase: finished-match summaries only
Browser ──HTTPS─▶ Supabase (optional): anonymous auth, profile, presets, docs — protected by RLS
```

- **Authoritative server.** Every outcome that matters is decided in `BaseGameRoom` subclasses using a crypto RNG and the pure engines in `game-core`: shuffles, spins, rolls, legal actions, settlement, bingo validity, race positions, checkpoints and quest checks. Clients only send intents.
- **State sync.** Public state uses Colyseus Schema (binary delta patches, 20 Hz by default). Hidden information never enters state. It's sent point-to-point with `sendTo`, and `syncPrivate()` re-sends it after any reconnect.
- **Identity.** A logical `playerId` is independent of the WebSocket `sessionId`. Joining returns a secret `seatToken`, which the client stores (sessionStorage and localStorage). Recovery happens in three layers:
  1. The Colyseus auto-reconnect, which keeps the same session during the 45s grace period.
  2. Reloading the page: `client.reconnect(token)`, falling back to `joinById(code, { seatToken })`, which rebinds the same seat.
  3. After the grace period expires mid-match, the seat is kept as *away* and can still be reclaimed with the token.
  A second tab with the same token replaces the first, so a player is never duplicated.
- **Host.** The host is a playerId. It migrates immediately on leave, or after 10s if the host is disconnected. Candidates are ordered by connected players first (spectators last), then join order.
- **Lifecycle.** `LOBBY → COUNTDOWN → PLAYING ↔ INTERMISSION → RESULTS → LOBBY`. `ENDED` means the host closed the room.
- **Validation.** Every client message goes through `BaseGameRoom.handle()`: per-player token bucket, Zod parse, phase, host and spectator guards, and exception isolation. Frames are capped at 256 KB. Matchmaking is rate-limited per IP in `static onAuth`.
- **Room codes.** 5 characters from a 31-symbol unambiguous alphabet, unique via Colyseus presence (Redis-ready).

## Client

- `net/session.ts` owns the only Colyseus `Client` and `Room`. It exposes a message bus with a last-value cache, a lazily computed `toJSON()` snapshot per patch, clock sync (`serverNow()`), chat, and connection status. React reads it through `net/hooks.ts` (`useGame`, `useRoomSelector`, `useLatestMessage`, `useCountdown`).
- Games are code-split. `games/registry.ts` lazy-imports `games/<id>/index.tsx` (a `GameClientModule`). Phaser is imported only by the games that use it.
- `shell/` holds the shared lobby, top bar, cabinet entry, modals, error and reconnect states. `arcade/` is the pixel-art arcade floor.
- `audio/` is procedural WebAudio SFX and music, unlocked on the first gesture.
- `persistence/` is an adapter interface. `LocalPersistence` (localStorage) is the default. `SupabasePersistence` (anonymous auth, RLS tables) is used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set.

## Performance rules

- Keep high-frequency data (racing, drawing) out of React. Phaser and canvas read from the room or the message bus directly.
- Batch drawing points (about 50 ms). Racing inputs are small and sent at a fixed rate. Remote racers are interpolated.
- Dispose Phaser games, rAF loops and listeners when a view unmounts.

## Deployment

The simplest production setup is a single WebSocket-capable Node service (Fly.io, Render, Railway, a container on ECS or Cloud Run with session affinity):

```
pnpm install --frozen-lockfile && pnpm build && NODE_ENV=production node apps/game-server/dist/index.js
```

Scale out with `@colyseus/redis-presence` and `@colyseus/redis-driver` and sticky sessions. Don't host the game server on serverless functions: rooms are long-lived, stateful WebSockets. The static client can move to a CDN by setting `VITE_SERVER_URL` at build time.
