# DASCADE — repository guide

DASCADE (Delta Alpha Sierra Arcade) is a multiplayer browser arcade. This repo is a pnpm monorepo: React/Vite client, Colyseus authoritative server, pure game engines and a design system.

## Commands
- `pnpm install` — install (Node ≥ 22.12, pnpm via corepack)
- `pnpm dev` — game server (:2567) + Vite (:5173)
- `pnpm build` — web build + bundled server (`apps/game-server/dist`)
- `pnpm start` — production server (serves the built client when NODE_ENV=production)
- `pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest: unit + server integration) · `pnpm test:e2e` (Playwright: chromium, firefox, webkit, mobile)
- `pnpm load` — 30-client load simulation against a running server (`LOAD_URL=http://localhost:2567`)
- Focused: `pnpm vitest run packages/game-core/src/<id>` · `DASCADE_ONLY_GAMES=<id> pnpm --filter @dascade/game-server dev`

## Architecture boundaries
- `packages/shared` — isomorphic protocol, catalog, Zod schemas, sanitation, RNG, rate limits. No Node/DOM-only APIs.
- `packages/game-core` — pure deterministic engines; take an injected `Rng`; never `Math.random()`; no Colyseus/DOM.
- `packages/ui` — design system (tokens, components, pixel icons, cards/chips). No app/network code.
- `apps/game-server` — all game rooms extend `rooms/BaseGameRoom.ts`; register client messages only via `this.handle()` (validated + rate limited). Server decides every outcome with `this.rng` (crypto).
- `apps/web` — `net/session.ts` is the single Colyseus client; UIs use `net/hooks.ts`. Games live in `src/games/<id>/` (lazy loaded); shared shell in `src/shell/`; arcade floor in `src/arcade/`.

## Non-negotiables
- Hidden information (hole cards, decks, dealer hole card, secret words, other players' cards) never goes in synchronized state — use `sendTo` + `syncPrivate`.
- Never trust client-provided outcomes, ids or indices; validate every payload with Zod and check turn/role/phase.
- No `dangerouslySetInnerHTML`; user text is sanitized server-side (`cleanText`) and rendered as React text.
- Virtual chips only — no real-money, purchase, or cash-out features.
- Honor `reducedMotion` and `fx` settings in all animation.
- Don't persist live match state to Postgres; Supabase is optional and only for profiles/presets/stats.

## Tests
- Engines: exhaustive Vitest unit tests next to the code.
- Rooms: integration tests in `apps/game-server/test/` via `bootTestServer([...games])`.
- E2E: `e2e/<id>.spec.ts` smoke path per cabinet using `e2e/helpers.ts`.

See `docs/ARCHITECTURE.md` and `docs/GAME_GUIDE.md` for details.
