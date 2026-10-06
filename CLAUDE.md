# DASCADE — repository guide

DASCADE (Delta Alpha Sierra Arcade) is a multiplayer browser arcade: 11 cabinets, 25 games, a Tournament Center, 12 themes and a global jukebox (with optional Room DJ). This repo is a pnpm monorepo: React/Vite client, Colyseus authoritative server, pure game engines and a design system.

## Commands
- `pnpm install` — install (Node ≥ 22.12, pnpm via corepack)
- `pnpm dev` — game server (:2567) + Vite (:5173)
- `pnpm build` — web build + bundled server (`apps/game-server/dist`, incl. `dist/words-data/`)
- `pnpm start` — production server (sets NODE_ENV=production and serves the built client on the same port)
- `pnpm lint` · `pnpm typecheck` · `pnpm test` (Vitest: unit + server integration) · `pnpm test:e2e` (Playwright: chromium, firefox, webkit, mobile, mobile-safari)
- `pnpm load` — 30-client load simulation against a running server (`LOAD_URL=http://localhost:2567`, server started with `DASCADE_RELAXED_LIMITS=1`). Party games aren't in the default set: `LOAD_SCENARIOS=trivia,deception,masterpiece,words,words-chain,survey`.
- Focused: `pnpm vitest run packages/game-core/src/<id> apps/game-server/test/<id>.test.ts` · `DASCADE_ONLY_GAMES=<id> pnpm --filter @dascade/game-server dev` · `E2E_BASE_URL=http://localhost:<web> pnpm exec playwright test e2e/<id>.spec.ts --project=chromium`

## Layout and boundaries
- `packages/shared` — isomorphic protocol, `catalog.ts` (games), `cabinets.ts` (floor lineup), tournament/stats/party contracts, Zod schemas, sanitation, RNG, rate limits. No Node/DOM-only APIs.
- `packages/game-core` — pure deterministic engines; take an injected `Rng`; never `Math.random()`; no Colyseus/DOM. Also party and classics helpers, the tournament engine and Elo rating.
- `packages/ui` — design system and theme tokens/API (`src/styles/tokens.css`, `src/theme/`): 12 theme definitions (tokens + materials + effects + copy). No app/network code.
- `apps/game-server` — every game room extends `rooms/BaseGameRoom.ts` directly or through a kit room; register client messages only via `this.handle()` (validated + rate limited). Server decides every outcome with `this.rng` (crypto). Platform services (ratings, stats, tournaments) live in `src/platform/`.
- `apps/web` — `net/session.ts` is the single Colyseus client; UIs use `net/hooks.ts`. Games live in `src/games/<id>/` (lazy loaded; DASphalt GP `kart` is a three.js game whose renderer and art are in `src/games/kart/render|art/` — three.js must stay inside that folder — see `docs/KART.md`); shared shell in `src/shell/`; arcade floor in `src/arcade/` (incl. the playable claw machine: `clawPile.ts` + `clawPhysics.ts` pure model, `ClawCloseup.tsx` lazy close-up, `clawInventory.ts` shared pile); Tournament Center in `src/tournament/`; theme skins + engine in `src/themes/`; audio mixer + jukebox engine in `src/audio/`; jukebox UI (the floor machine, the quick control, the player) in `src/jukebox/`; music manifest Vite plugin in `vite/`.

## Kits (build on them; extend additively, don't copy)
- Party (DAStravaganza): `rooms/party/PartyRoom.ts`, `games/_party/`, `@dascade/shared/party`, `@dascade/game-core/party`.
- Boardroom (chess, checkers): `rooms/boardroom/BoardGameRoom.ts`, `games/_boardroom/`, `@dascade/shared/games/boardroom`.
- Classics: `rooms/classics/{ClassicsRoom,VerifiedClassicsRoom}.ts`, `games/_classics/`, `@dascade/shared/games/classics`, `@dascade/game-core/classics/shared`.
- If you override a lifecycle hook a kit room implements, call `super` first.

## Non-negotiables
- Hidden information (hole cards, decks, dealer hole card, secret words, fleets, roles, answers/votes/authors before reveal, other players' cards) never goes in synchronized state — use `sendTo` + `syncPrivate`. Spectators get nothing private.
- Never trust client-provided outcomes, scores, hits, ids or indices; validate every payload with Zod and check turn/role/phase/spectator. Duplicate messages must never score or advance twice.
- Every game ending calls `reportOutcome()` (ratings, stats, tournament brackets) alongside `endMatch()`. In tournament matches (`this.tournamentMatch`) use `participants[].side` and disable casual-only features.
- Disconnects never stall a room: keep turn/stage timers and forfeit/skip rules.
- Shared client/server simulations use only `+ - * /`, `Math.sqrt`, `floor/round/abs/min/max` (no `sin/cos/atan2/pow/exp`).
- No `dangerouslySetInnerHTML`; user text is sanitized server-side (`cleanText`) and rendered as React text.
- Virtual chips only — no real-money, purchase, or cash-out features.
- Style with theme tokens; honor `reducedMotion` and `fx` settings in all animation; numbers use `--font-num`.
- Themes are presentation only and local (never sent to the server). Playfield colours come from materials with the EXACT original colour as fallback: `var(--mat-<key>, #orig)` / `tokens.materials.<key> ?? ORIG` (Delta Neon defines none, so it must stay pixel-identical). Canvas/Phaser games re-colour in place on theme change (`subscribeThemeTokens`/`watchThemeTokens`) — never restart a scene or reset state. Meaningful colours (players, teams, suits, legal moves, hits) stay fixed. Skin CSS is scoped under `:root[data-theme='<id>']` (tested); decorative CSS `content` must be silent (`content: 'x' / ''`).
- One audio pipeline: play sounds only via `sfx()`/`synth` (`src/audio/audio.ts`); never create another AudioContext or `<audio>` element. Continuous sounds use `synth.hold()` so the mixer can duck the jukebox. Room DJ must never affect game state; local mute/volume/opt-out always win.
- Jukebox music = MP3s in `apps/web/public/audio/jukebox/` (manifest generated at dev/build; never commit a manifest or import audio into JS).
- Don't persist live match state to Postgres; Supabase is optional (migrations 0001–0004) and only mirrors profiles/presets, stats/ratings, tournament history and high scores.

## Tests
- Engines: exhaustive Vitest unit tests next to the code.
- Rooms: integration tests in `apps/game-server/test/` via `bootTestServer([...games])` (tournaments: `test/tournament-helpers.ts`).
- E2E: `e2e/<id>.spec.ts` smoke path per game using `e2e/helpers.ts`; must pass on chromium, mobile and mobile-safari. Themes/audio: `theme.spec.ts`, `theme-state.spec.ts`, `theme-a11y.spec.ts`, `jukebox.spec.ts`. The shared Vite dev server reloads on edits — for trustworthy full runs, test a production build (`pnpm build`, then `NODE_ENV=production PORT=<p> DASCADE_RELAXED_LIMITS=1 node apps/game-server/dist/index.js`, `E2E_BASE_URL=http://127.0.0.1:<p>`). `e2e/kart.spec.ts` drives races through the server's `kart:test` hook, which exists only without `NODE_ENV=production`: run the built server as `SERVE_WEB=1 DASCADE_RELAXED_LIMITS=1 PORT=<p> node apps/game-server/dist/index.js` for it.
- Party games: a 30-client scenario in `scripts/load/<id>.ts`.
- Seasonal invite: every Playwright context starts with `localStorage['dascade:qa:season']='off'` (config `use.storageState`), so no spec meets October's Halloween invite by accident; opt in with `?season=YYYY-MM-DD[THH:MM]` (see `e2e/seasonal.spec.ts`). A spec passing its own `storageState` must re-add it.

See `README.md`, `docs/ARCHITECTURE.md`, `docs/GAME_GUIDE.md` (per-game contract + kit reference) and `docs/THEMING.md`.
