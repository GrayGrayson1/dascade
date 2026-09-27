# DASCADE — Delta Alpha Sierra Arcade

A work-friendly multiplayer browser arcade. Walk a pixel-art arcade floor of **11 cabinets** holding **24 games**, plus a **Tournament Center** for brackets and Swiss events, **eleven themes** and a global **jukebox** with an optional synchronized Room DJ. No account needed: create a room and share its 5-letter code.

> All casino-style games use meaningless **virtual chips**. There is no real-money wagering, purchasing, deposits or cash-out of any kind.

## The floor

| Cabinet | Games (`gameId`) | Players | What it is |
|---|---|---|---|
| **DASketch** | DASketch (`dasketch`) | 2–30 | Draw-and-guess party game |
| **DAS Bingo** | DAS Bingo (`bingo`) | 1–60 | 75-ball or custom-text bingo, visual pattern editor, server-verified claims |
| **Wheel of DAStiny** | Wheel of DAStiny (`wheel`) | 1–60 | Shared, fully customizable weighted prize wheel |
| **DASino** | Texas Hold'em (`holdem`) | 2–10 | No-limit hold'em with side pots, timers and spectators |
| | Blackjack (`blackjack`) | 1–7 | Simultaneous decisions, splits, doubles, insurance, surrender |
| | Roulette · Slots · High/Low (`dasino`) | 1–30 | One casino-floor room with three tables: European roulette, an original slot machine and high/low dice |
| **DAS Boardroom** | DAS Chess (`chess`) | 2 | Full rules via chess.js, server clocks, premoves, PGN, DASCADE rating |
| | DAS Checkers (`checkers`) | 2 | American checkers: forced captures, multi-jumps, kings, clocks, rating |
| | DAS Ships (`ships`) | 2 | Original hidden-fleet duel (classic, hot-streak and salvo modes) |
| **DAStravaganza** | DAStravaganza Trivia (`trivia`) | 1–30 | Game-show trivia: five question types, teams, custom packs, final wager |
| | DASception (`deception`) | 4–20 | Social deduction: loyal Sysops against hidden Glitches, with special roles |
| | DASterpiece (`masterpiece`) | 3–30 | Comedy writing contest with anonymous voting and head-to-head showdowns |
| | DASwords (`words`) | 1–30 | Letter Grid, Anagram Sprint, Word Chain and Forbidden Letter against a local dictionary |
| | DAS Survey (`survey`) | 3–30 | Answer anonymously, then predict how your own group answered |
| **DAS Putt** | DAS Putt (`putt`) | 1–12 | Neon mini golf on an original nine-hole course, server-simulated strokes |
| **DAS Tanks** | DAS Tanks (`tanks`) | 1–8 | Turn-based artillery with destructible terrain, six weapons, teams and CPU gunners |
| **DAScade Classics** | Pixel Paddle (`paddle`) | 1–2 | Paddle duel against the house AI or a coworker |
| | Neon Snake (`snake`) | 1–12 | Solo score attack, or multiplayer survival and frenzy arenas |
| | Brick Blitz (`bricks`) | 1–8 | Brick breaker with power-ups; solo or a race on the same levels |
| | Asteroid Run (`asteroids`) | 1–4 | Top-down space survival, solo or co-op |
| | Memory Matrix (`memory`) | 1–30 | Visual memory and reaction rounds, synchronized for everyone |
| | Block Drop (`blocks`) | 1–16 | Falling-block puzzle (marathon or timed blitz), solo or a score race |
| **DASh Circuit** | DASh Circuit (`circuit`) | 1–20 | Top-down neon racer with a car customizer and time trials |
| **DASQuest** | DASQuest (`quest`) | 1–12 | Co-op branching adventure: *The Glitch Beneath Delta Alpha* |

Every game supports spectators. Classics games keep verified high-score boards.

### Single- and multi-game cabinets

A cabinet is navigation, not a game. `packages/shared/src/cabinets.ts` lists the 11 cabinets and the games each one holds. Game rules, capacity and rooms come from `packages/shared/src/catalog.ts`.

- **Single-game cabinets** open their game's title screen directly: `/play/<gameId>`.
- **Multi-game cabinets** (DASino, DAS Boardroom, DAStravaganza, DAScade Classics) open an in-world game picker at `/cabinet/<cabinetId>`. Each cabinet has its own setting: a casino floor, an executive lounge, a game-show stage, a retro select screen. Every entry is a real link to `/play/<gameId>`, so deep links, refresh and the back button all work. Results screens offer **Back to cabinet**.
- A cabinet entry can be a **variant** of one game. The three DASino tables share the `dasino` room and differ only by `variant` (`/play/dasino?table=roulette|slots|dice`). Aliases such as `/play/poker`, `/play/roulette` and `/play/slots` redirect to the right place.

Other routes: `/room/:code` and `/r/:code` join a room, and `/tournaments` opens the Tournament Center.

## Themes

DASCADE ships **eleven themes**. Pick one from the palette button on the floor or in a room's top bar, or from **Settings → Display**. A theme restyles the whole arcade: floor, cabinets, pickers, title screens, lobbies, dialogs, the Tournament Center, results, the jukebox and every game's playfield. It never changes rules, timing, networking or scores. The choice is local to each player (people in one room can use different themes) and is remembered per browser (and on the Supabase profile when signed in).

| Theme | id | The idea |
|---|---|---|
| **Delta Neon** (default) | `delta-neon` | The house style: violet-black glass, neon marquees, pixel bevels, restrained CRT texture |
| **Shareware Casino '97** | `shareware-97` | "DASCADE FUN PACK v3.7 — Registered Version": a bargain-bin casino CD-ROM on a late-90s desktop |
| **Corporate Desktop '98** | `corporate-98` | An unauthorized arcade suite on every office PC: grey bevels, navy title bars, taskbars (the only light theme) |
| **Cyber Café 2001** | `cyber-cafe-01` | Y2K broadband optimism: translucent blue plastic, chrome, gel buttons, a live LAN diagram |
| **Mall Arcade '92** | `mall-arcade-92` | The physical arcade row: geometric carpet, fluorescent ceiling, wood-grain cabinets, LED high-score boards |
| **VHS After Dark** | `vhs-after-dark` | A late-night video store: rental shelves, tape labels, VCR on-screen display, tracking noise only on transitions |
| **Space Casino 2088** | `space-casino-2088` | 2088 as imagined in 1996: chrome, starfields, an orbital porthole, holographic consoles |
| **Basement LAN Party** | `lan-party` | Beige PCs, CRTs, folding tables and cables; the switch lights a port for every player in the room |
| **Saturday Morning** | `saturday-morning` | A loud 90s game-show set: sunbursts, bulbs, buzzers, confetti (competitive boards stay calm) |
| **Executive Edition** | `executive` | Mahogany, brass and banker lamps; "Match Performance Review" and the "Strategic Putting Division" |
| **Neon Noir** | `neon-noir` | The serious one: a rainy pixel city, wet reflections, glass HUDs |

Switching plays a short transition in the new theme's style (a quick fade with reduced motion) without reloading, so rooms, games, tournaments and music carry on untouched. **Visual effects: Full / Reduced / Minimal** and **Reduce motion** scale every theme's particles, backgrounds, blur and animation.

**How it works.** Each theme has two halves:

- **Data** (`packages/ui/src/theme/themes/<id>.ts`, a `ThemeDefinition`): ~170 CSS tokens (colours, fonts, panel/button/HUD chrome, glow, motion), about 50 **materials** for playfields (felt, board squares, water, grass, asphalt, card stock, screens, etc., emitted as `--mat-*`), optional per-game material tweaks, effect hints (visualizer and transition style) and a few themed headings. The definitions are small and always loaded.
- **Skin** (`apps/web/src/themes/<id>/`): scoped structural CSS plus optional background, floor and jukebox decoration components. Skins and their fonts are lazy chunks, and only the active theme's skin loads.

Games read materials with an exact fallback (`var(--mat-board-light, <original colour>)`, or `tokens.materials.boardLight ?? ORIGINAL` in canvas/Phaser code). Delta Neon defines no materials, so every game keeps its hand-tuned look there. See [`docs/THEMING.md`](docs/THEMING.md) for the full architecture.

## Tournament Center

`/tournaments` (also reachable from the floor's kiosk, from the **Tournament** buttons in the cabinet picker and on title screens, and from "Run a tournament" in a lobby) runs events for the head-to-head games:

| Game | Formats | Series (best of) | Field |
|---|---|---|---|
| Chess, Checkers | single elim, double elim, round robin, Swiss | 1, 2, 3, 5 | up to 64 |
| Ships, Pixel Paddle, Neon Snake, Memory Matrix | same | 1, 3, 5 | up to 64 |
| DAS Putt | same | 1, 3 | up to 32 |

- **Lifecycle:** draft, registration, optional check-in, seeding (random, manual or by DASCADE rating), live rounds, then champion. Double elimination has an optional grand-final reset. Swiss pairs players on the same score and avoids rematches. Round robin uses Berger tables. Byes are handled automatically.
- **Matches run themselves.** When a match is ready, the server creates the game room and gives each participant a private ticket. **Play match** seats you, and anyone can **Spectate**. Games start automatically once both players are present. Series continue with sides swapped after a short intermission. No-shows forfeit after the configured time.
- **Organizer console:** open or close registration and check-in, seed, begin, pause or resume, forfeit, disqualify, override a result, relaunch a match room, end or cancel. Every action is written to a public audit log with its reason.
- Brackets render as a tree on desktop and as a round strip on phones. Round robin shows a crosstable and Swiss shows standings with explained tiebreaks.
- Public tournaments are listed at `GET /api/tournaments`. Unlisted ones are joined by code.

Chess and checkers keep an internal **DASCADE rating** (Elo-style, provisional for the first 10 games). It is not a FIDE or any other federation's rating. Tournament games of rated games are always rated. Casual rooms can opt in with the lobby's **Rated** toggle. Ratings and per-game stats appear under **Profile → Stats**.

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
| `pnpm build` | Production build: `apps/web/dist` and the bundled server `apps/game-server/dist` (including `dist/words-data/`, the DASwords dictionary) |
| `pnpm start` | Runs the built server. With `NODE_ENV=production` it also serves the built client on one port. |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest: engine unit tests, kit and platform tests, server integration tests |
| `pnpm test:e2e` | Playwright projects `chromium`, `firefox`, `webkit`, `mobile` (Pixel 7) and `mobile-safari` (iPhone 14). Builds and boots the production server automatically. |
| `pnpm load` | Protocol-level load simulation against a running server (see below) |
| `pnpm test:e2e` themes/audio | `e2e/theme.spec.ts` (all 11 themes, switching, persistence), `e2e/theme-state.spec.ts` (switching themes mid-game never changes room state), `e2e/theme-a11y.spec.ts` (reduced motion, phone layout, focus), `e2e/jukebox.spec.ts` (playback, route persistence, reload restore, two-client Room DJ) |
| `pnpm music:index` | Report what the jukebox sees in `apps/web/public/audio/jukebox/` (tracks, durations, duplicates, rejects, total size). Read-only; `--json` prints the manifest. |

Focused work:

```bash
pnpm vitest run packages/game-core/src/<id> apps/game-server/test/<id>.test.ts   # one game's unit + integration tests
DASCADE_ONLY_GAMES=<id>[,<id2>] pnpm --filter @dascade/game-server dev            # load only some rooms
E2E_BASE_URL=http://localhost:5173 pnpm exec playwright test e2e/<id>.spec.ts --project=chromium   # reuse a running server
```

`E2E_OUTPUT=test-results/<name>` gives parallel Playwright runs separate output folders. `WEB_PORT`, `VITE_SERVER_PORT` and `VITE_CACHE_DIR` let several dev servers run side by side.

### Load scenarios

Start a server with relaxed per-IP throttles, then point the load runner at it:

```bash
DASCADE_RELAXED_LIMITS=1 pnpm --filter @dascade/game-server dev
LOAD_URL=http://localhost:2567 CLIENTS=30 pnpm load
```

`LOAD_SCENARIOS` picks the scenarios (comma-separated). The default set is `join,chat,reconnect,sketch,wheel,bingo,cleanup`:

| Scenario | Exercises |
|---|---|
| `join`, `chat`, `reconnect`, `cleanup` | 30 clients joining one room, a chat burst, reconnect and seat-token rejoin, room disposal |
| `sketch`, `wheel`, `bingo` | Game traffic for DASketch, the wheel and bingo |

The party games have their own 30-client scenarios in `scripts/load/<id>.ts`. They aren't in the default set, so name them explicitly:

```bash
LOAD_URL=http://localhost:2567 LOAD_SCENARIOS=trivia,deception,masterpiece,words,words-chain,survey pnpm load
```

| Scenario | Exercises |
|---|---|
| `trivia` | A short match: simultaneous lock-ins per question, early reveal, no answer key before the reveal, identical reveals everywhere |
| `deception` | 20 players + 10 spectators: private roles, Glitch channel isolation, simultaneous night actions and votes |
| `masterpiece` | Writing and voting bursts with duplicate submissions and votes that must not double-count; authors stay anonymous until scoring |
| `words`, `words-chain` | Letter Grid word bursts (invalid and duplicate words included, no double scoring, no early reveal); one Word Chain link answered by everyone at once |
| `survey` | Answer and prediction bursts including duplicates; nobody ever receives another player's answer |
| `dj` | Room DJ with 30 clients in one room: host scrubs/pauses while everyone queues, a skip vote at the exact strict majority (with duplicate votes), 8 leave and 8 join, then the host leaves; every client must end on the identical DJ state |

`pnpm load` exits non-zero when any scenario fails its thresholds. Racing has a separate scripted-input bot runner, which prints a `RESULT:` health line: `LOAD_URL=http://localhost:2567 pnpm exec tsx scripts/load-circuit.ts --bots 20` (see its header for `--laps`, `--track`, `--spectators` and more).

## Architecture

```
apps/web          React 19 + Vite client: arcade floor, cabinet pickers, shell & lobby, Tournament Center, game UIs,
                  theme skins (src/themes), audio engine (src/audio), jukebox UI (src/jukebox), music indexer (vite/)
apps/game-server  Colyseus 0.18 authoritative rooms + Express (/api/*, static client) + platform services
packages/shared   Protocol, catalog, cabinets, tournament contract, Zod schemas, sanitation, RNG, rate limits
packages/game-core Pure deterministic engines (every game), party/classics helpers, tournament engine, Elo
packages/ui       Design system: theme tokens, materials + theme API (11 theme definitions), components, pixel icons, playing cards and chips
e2e/              Playwright specs     scripts/  load simulation, dictionary build     supabase/  optional schema + RLS
```

- **Server authoritative.** Every shuffle, spin, roll, deal, legal move, hit, stroke, word check, vote tally, score and standing is decided on the server with a crypto RNG. Clients only send validated intents (Zod + per-player token-bucket rate limits). Classics games that simulate locally for feel are replayed and verified by the server.
- **Hidden info stays hidden.** Hole cards, the dealer's hole card, secret words, bingo cards, fleets, roles, answers, votes before reveal and authors before reveal are never in synchronized state. They're sent privately and re-sent on reconnect. Spectators get nothing private.
- **Resilient sessions.** Stable player IDs, auto-reconnect with a per-game grace period (45s by default, 90–120s for long games, 300s for tournament kiosks), seat-token rejoin after a refresh, host migration, spectators, room lock and kick.
- **Shared lifecycle.** Every game extends `BaseGameRoom` (`LOBBY → COUNTDOWN → PLAYING ↔ INTERMISSION → RESULTS`). Finished games call `reportOutcome()`, which feeds ratings, stats and tournament brackets.
- **Presentation is separate from play.** Themes (tokens, materials, lazy skins) and the jukebox are purely client-side. Themes are never sent to the server, and Room DJ is an isolated, fault-tolerant add-on that can't affect game state.
- **Kits.** Game families share tested toolkits: the **party kit** (DAStravaganza), the **boardroom kit** (two-player board games) and the **classics kit** (arcade quick-plays).

For details see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The game contract and kit reference are in [`docs/GAME_GUIDE.md`](docs/GAME_GUIDE.md), and theming is in [`docs/THEMING.md`](docs/THEMING.md).

## Dependencies worth knowing

- **chess.js 1.4.0** (BSD-2-Clause), used only by `packages/game-core/src/chess` for move generation and draw rules. The room keeps its own clocks and outcomes.
- **DASwords dictionary:** `apps/game-server/src/rooms/words/data/dascade-words.txt` (about 169,000 words). It's loaded only by the server and never sent to browsers, and gameplay makes no external dictionary calls. It is built by `scripts/words/build-dictionary.ts` from:
  - **ENABLE2K**, which is public domain.
  - **SCOWL** levels 10–50 (Kevin Atkinson), via the `wordlist-english` package. Its permissive licence requires the copyright notice to travel with the data, so `SCOWL-Copyright.txt` ships next to the list.
  - A small hand-written supplement of everyday words.

  Office-unsafe words are filtered out at build time and checked again at runtime. The sources, tiers and regeneration steps are in [`data/LICENSE.md`](apps/game-server/src/rooms/words/data/LICENSE.md). `pnpm build` copies the folder to `apps/game-server/dist/words-data/`, and `DASCADE_WORDS_DICT` can point to another copy.
- **Supabase JS** (optional persistence) and **Phaser 4** (the games that use it, lazy loaded) were already part of the stack.

## Environment variables

Everything is optional. Copy `.env.example` to `.env` at the repo root (both apps read it).

| Variable | Where | Purpose |
|---|---|---|
| `PORT`, `HOST` | server | Listen address (default `0.0.0.0:2567`) |
| `NODE_ENV=production` | server | Serve the built client from the game server |
| `LOG_LEVEL` | server | `debug`, `info`, `warn` or `error` |
| `TRUST_PROXY` | server | How per-IP throttles read the client address: `auto` (default), `0` (TCP peer) or the number of trusted proxy hops |
| `DASCADE_SAVE_SECRET` | server | HMAC key (32+ chars) for DASQuest save files. Production disables saves when it is unset. |
| `DASCADE_WORDS_DICT` | server | Absolute path to an alternative DASwords dictionary file |
| `DASCADE_LATENCY_MS` | server | Simulated round-trip latency for netcode testing |
| `DASCADE_ONLY_GAMES` | server | Comma-separated game ids to load (focused development) |
| `DASCADE_RELAXED_LIMITS=1` | server | Relax per-IP matchmaking and API throttles (tests / load simulation) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | server | Optional: persist match summaries, ratings, stats, tournaments and high scores. The secret key stays on the server. |
| `VITE_SERVER_URL` | web (build) | Game server origin when the client is hosted separately (CDN) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | web (build) | Optional: cloud profiles and presets via anonymous auth |

## Persistence

**By default everything lives in memory and in the browser.** Live matches, tournaments, ratings, stats and Classics high scores are held by the server process and reset when it restarts. The browser keeps a local guest identity and stores your nickname, settings, theme, wheel presets, bingo patterns, sketch word packs, trivia/survey/DASterpiece custom packs, car designs, putt bests, quest saves and tournament tokens in `localStorage`. Live match state is never written to a database.

Supabase is optional. When the server has `SUPABASE_URL` + `SUPABASE_SECRET_KEY`, it mirrors finished results in the background. Gameplay never waits on the database, and a failed write is only logged. With the `VITE_SUPABASE_*` keys, the client also stores profiles and presets in the cloud.

| Migration | Stores | Access |
|---|---|---|
| `0001_dascade_init.sql` | `profiles`, `presets`, `user_docs` (client data per anonymous/permanent user); `player_stats` and `match_results` (legacy aggregate stats and finished-match summaries written by `endMatch`) | Users read and write only their own profile, presets and docs. Stats and results are written only by the server. |
| `0002_tournaments.sql` | `tournaments`, `tournament_entrants`, `tournament_matches`, `tournament_audit`: definitions, entrants, results and audit history. No player identities are stored. | Anyone may read **public** tournaments. Only the server writes. Live tournaments are not restored from here after a restart. |
| `0003_ratings_stats.sql` | `player_ratings` (DASCADE rating per identity per rated game) and `player_game_stats` (per-game wins, draws, losses, podiums, best score, extras), keyed `u:<account>` or `g:<guest>` | Server writes only. Account owners can read their own rows. Guests read through `GET /api/stats/me`. Stored numbers are loaded back the first time an identity is seen. |
| `0004_classics_high_scores.sql` | `classics_high_scores`: one best verified entry per identity per Classics board | Server only (no RLS policies). Browsers read boards through `GET /api/classics/scores/:gameId`. |

To enable it:

1. Create a Supabase project and enable **Anonymous sign-ins** (Authentication → Providers).
2. Apply the migrations in order (`supabase/migrations/0001…0004`, via the SQL editor or `supabase db push`). If one is missing, that feature's database reads and writes fail and are logged as warnings. Gameplay and the in-memory numbers are unaffected.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the client, and `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the server.

Players can upgrade their anonymous account to a permanent one from **Settings → Account**.

## Jukebox and audio

The **jukebox** is a global feature that lives in its own corner of the arcade, not a cabinet. Collapsed, it is a small button (in a room it sits in the top bar; in full-screen games it moves into the menu; on the floor it finds a free corner). Expanded, it is a player with transport controls, seek, volume and mute, shuffle, repeat off/all/one, a searchable and sortable library, a reorderable queue ("play next" / "add to queue"), a visualizer and the Room DJ tab. Music keeps playing through every route change (floor, cabinet, lobby, match, results, tournament) and through theme switches. After a reload it restores the track and position, and resumes on your next click. Every theme dresses the same player differently (a CD utility, a mixtape deck, a brass executive stereo…).

- **One engine** (`apps/web/src/audio/`): a single `AudioContext` created on the first user gesture, and a mixer with separate buses for **sound effects**, **game music** (the procedural soundtrack) and the **jukebox** (one `<audio>` element → one shared analyser). Settings → Sound has master, effects, game-music and jukebox volumes.
- **Mixing policy** (`mixPolicy.ts`): the jukebox never turns effects down. Audible effects briefly dip the music, and sustained sounds (the DASh Circuit engine) hold it lower. While the jukebox plays, game music is muted by default (Settings: *duck*, *mute* or *keep*). All gain changes are smooth ramps.
- **Autoplay:** nothing plays before a click or keypress. If the browser still blocks playback, the jukebox shows a gentle "Click to enable audio" prompt instead of an error.
- **Personal by default:** each player controls their own music. Room DJ (below) is opt-in, and local mute, volume and opt-out always win.
- State is stored in `localStorage['dascade:v1:jukebox']`. QA hook: `window.__DASCADE_AUDIO__`.

## Jukebox music

The jukebox plays the MP3s in **`apps/web/public/audio/jukebox/`**. That folder is the whole library, and it takes no code or manifest edits:

1. Drop an `.mp3` into the folder. Only the top level is scanned; sub-folders are ignored, apart from sidecar covers.
2. Run `pnpm dev` (a running dev server re-indexes within a second and tells open pages to refresh the library) or `pnpm build`.
3. It appears in the jukebox. Run `pnpm music:index` to see exactly what was picked up and why anything wasn't.

The Vite plugin (`apps/web/vite/jukebox-plugin.ts`, indexer in `apps/web/vite/jukebox/`) reads each file's ID3v2.2/2.3/2.4 and ID3v1 tags: title, artist, album, track number and embedded cover art. It also works out the duration from the Xing/Info/VBRI header, or estimates it from the bitrate. In dev it serves the generated `/audio/jukebox/manifest.json` and `/audio/jukebox/art/<id>.<ext>` from memory. A build writes them into `apps/web/dist/`. Generated files never go into `public/` or the source tree, and MP3s are never bundled into JavaScript.

- **Missing tags** are fine. The title comes from the file name: `this_is_my_song_v4_final.mp3` becomes "This Is My Song". Underscores, copy suffixes like `(1)` and version words like `v4` and `final` are stripped, and punctuation is kept.
- **Bad files never break the build.** A file that isn't really an MP3 (the audio frames are checked, not just the extension) is listed as *rejected*, with the reason. Non-MP3 files are ignored.
- **Duplicates:** byte-identical files are detected by content hash and only one is published. The copy without a `(1)`/`copy` suffix wins, otherwise the first by name. The rest are reported and left out of `dist/`. The indexer never deletes your files. (Right now `Hope's Turnaround (1).mp3` is a duplicate of `Hope's Turnaround.mp3`.)
- **Track ids** are slugs of the file name (`Neon Cruising.mp3` → `neon-cruising`). They stay the same when you re-tag a file, and renaming a file changes its id. If two names give the same slug, the first by name keeps it and the others get a short hash suffix.
- **Order:** sidecar `order`, then ID3 track number, then title.
- A build prints one line, e.g. `jukebox: 7 tracks indexed, 1 duplicate skipped, 0 rejected (17.1 MB, 12:42 of music)`, and copies only the files the manifest references into `dist/audio/jukebox/`.

**Optional sidecar** `apps/web/public/audio/jukebox/jukebox.json` (every field optional; keys are file names). If it is invalid, you get a warning and it is ignored; it never stops the build.

```json
{
  "defaults": { "artist": "beanalicious", "album": "Cyber Nightpulse" },
  "tracks": {
    "Neon Cruising.mp3": { "title": "Neon Cruising", "order": 1, "cover": "covers/neon.jpg" },
    "Cyberbro.mp3": { "artist": "Someone Else" },
    "Work In Progress.mp3": { "hidden": true }
  }
}
```

Sidecar values beat tags, and tags beat `defaults`. `cover` is a JPEG, PNG, GIF or WebP inside the folder, and it replaces the embedded art. `hidden` keeps a file out of the manifest and out of `dist/`.

**Deploy size:** the repo carries the audio itself, about 19 MB today (8 files, of which 17.1 MB is published after dedupe), and every build ships it in `apps/web/dist/audio/jukebox/`. The production server serves these files as static files with `Accept-Ranges`/`206` range responses, a 1-hour `Cache-Control` plus ETag revalidation, and `no-cache` on the manifest. The CSP allows `media-src 'self'`. Keep an eye on the folder size: each ~3-minute song at 128 kbps adds about 3 MB to every clone and deploy.

### Room DJ

The host can turn on **Room DJ** from the jukebox. Everyone in the room then hears the same song at the same moment. The server synchronizes only playback *state*: track id, playing or paused, a position anchored to the server clock, and a shared queue (`packages/shared/src/jukebox.ts`, `apps/game-server/src/platform/dj.ts`). Each client streams the MP3 itself. Local mute, volume and "opt out of room music" always win on each device.

- The host controls everything and DJ authority follows host migration without interrupting the music. Optionally, the host can let everyone add songs (up to 5 each, with a queue of 50) and vote to skip. A skip needs a strict majority of connected, seated players, and a host skip is immediate.
- Late joiners and reconnecting players get the current track and position straight away. The server advances the queue when a track ends.
- Opting out is per room: it survives a reconnect or reload, and resets when you join a different room.
- It is purely cosmetic and fully isolated in `BaseGameRoom`. Messages are validated and rate limited, it never touches game state, timers, outcomes or tournaments, and any DJ error is logged and swallowed. It is off in Tournament Center matches, and no DJ traffic flows until a host turns it on.

## Extending the arcade

The full per-game contract is [`docs/GAME_GUIDE.md`](docs/GAME_GUIDE.md). In short:

### Adding a game (a "subgame" in an existing cabinet)

1. Add the id to `GAME_IDS` and an entry to `GAME_CATALOG` in `packages/shared/src/catalog.ts`, with `cabinet: '<cabinetId>'`, capacity, controls and how-to-play text.
2. Add the contract `packages/shared/src/games/<id>.ts` (settings schema, message names, payload schemas, public view types).
3. Add the engine `packages/game-core/src/<id>/`: pure, `Rng`-injected and unit tested.
4. Add the room `apps/game-server/src/rooms/<id>/<Name>Room.ts`, extending `BaseGameRoom` or a kit room (`PartyRoom`, `BoardGameRoom`, `ClassicsRoom` / `VerifiedClassicsRoom`). Register it in `rooms/registry.ts`, and call `reportOutcome()` at every ending.
5. Add the client `apps/web/src/games/<id>/index.tsx` exporting a `GameClientModule`, and register it in `games/registry.ts`.
6. List it in its cabinet's `games[]` in `packages/shared/src/cabinets.ts`. Give it an attract scene in `apps/web/src/arcade/scenes/`, registered in `SCENES` in `arcade/attract.ts`, and add it to that cabinet's `CABINET_PLAYLISTS`. A cabinet with more than one game automatically gets the picker.
7. Add tests: engine unit tests, `apps/game-server/test/<id>.test.ts`, `e2e/<id>.spec.ts` and, for party games, `scripts/load/<id>.ts`.

A **variant** (like the DASino tables) is just another `games[]` entry with the same `gameId` and a `variant` string. The title screen carries it as `?table=<variant>`, and the game module reads it with `takeVariantRequest()` from `apps/web/src/arcade/variantRequest.ts`.

### Adding a cabinet

1. Add the id to `CABINET_IDS` and a `CabinetDef` (title, marquee, family, tagline, description, accent, `games[]`) to `CABINETS` in `packages/shared/src/cabinets.ts`. Point each game's catalog `cabinet` at it.
2. Art and attract mode, where TypeScript forces the entries: the side-panel motif in `MotifPattern` (`apps/web/src/arcade/cabinetArt.tsx`, plus optional `MATERIALS`), and the cabinet's screen playlist in `CABINET_PLAYLISTS` (`apps/web/src/arcade/attract.ts`).
3. Optional polish: a marquee style (`.af-mq[data-mq='<id>']` in `arcade.css`) and, for a multi-game cabinet, a picker setting in `apps/web/src/shell/cabinet/PickerBackdrop.tsx` + `picker.css` (`[data-flavour='<id>']`). Without one, it falls back to the retro select screen.
4. Extend `e2e/arcade.spec.ts` if the lineup assertions need it.

### Making a game tournament-capable

1. Add `tournament: { formats, bestOf, maxField, draws, sides }` to its catalog entry. The wizard, config validation (`TournamentConfigSchema`) and the kiosk derive the game list from the catalog.
2. In the room, read `this.tournamentMatch`. When it is set, give seats and first move by `participants[].side` in **every** game of the series (sides swap between games), and use fixed tournament rules and no casual-only features such as take-backs or rematch votes. The base room already locks the room to the two ticket holders, refuses lobby controls, starts games automatically and drives the series.
3. Call `this.reportOutcome({ placements, … })` at **every** ending: win, draw, resign, timeout, forfeit and abandonment. The bracket advances only on reported outcomes, and duplicates are ignored.
4. Optionally expose organizer choices in `TOURNAMENT_GAME_SETTINGS` (`packages/shared/src/tournamentGames.ts`), as chess and checkers do for time controls.
5. Test it with a real kiosk (`apps/game-server/test/tournament-helpers.ts`; see `tournament-chess.test.ts`).

To make a head-to-head game **rated**, also set `rated: true` in the catalog. Tournament games are then always rated, and casual rooms can opt in by overriding `ratedOptIn()` (the boardroom kit does this with a lobby toggle).

### Adding a visual theme

1. Create `packages/ui/src/theme/themes/<id>.ts` exporting a `ThemeDefinition` (start from an existing theme: every token, `meta`, all materials, `effects`, optional `copy`), and add it to `BUILT_IN_THEMES` in `registry.ts`.
2. Create `apps/web/src/themes/<id>/` with `index.ts` (default-export a `ThemeSkin`, import `./skin.css`) and register its loader in `apps/web/src/themes/registry.ts`. Scope every selector under `:root[data-theme='<id>']`; a test enforces it.
3. Run `pnpm vitest run packages/ui/src/theme apps/web/src/themes` and `pnpm exec playwright test e2e/theme.spec.ts e2e/theme-a11y.spec.ts`, then look at it on the floor, pickers, lobbies, the jukebox and a range of games at desktop and phone sizes.

The step-by-step guide, token and material reference and rules for game art are in [`docs/THEMING.md`](docs/THEMING.md).

### Adding a DASQuest adventure

Adventures are typed, schema-validated data packs in `packages/game-core/src/quest/packs/`. Create a pack file (nodes, choices, checks, effects, items, endings) and add it to the pack registry in that folder. The engine and room pick it up with no code changes, and the host can choose it in the lobby. The pack validator test walks every pack and fails if a node, item or ending reference is broken, or if any path dead-ends.

## Deploy to Render (one click)

`render.yaml` is a Render Blueprint: one Node web service that builds the client + server and serves both
(plus WebSockets) on one URL. In Render: **New → Blueprint → pick this repo → Apply**. It starts on the free
plan (sleeps after ~15 idle minutes; the first visit then takes ~30–60 s and live rooms end); change `plan`
to `starter` for an always-on server. `DASCADE_SAVE_SECRET` is generated automatically; Supabase variables are
optional. Every push to `main` redeploys.

## Deployment recommendations

- Run the game server as a **long-lived, WebSocket-capable Node service** (Fly.io, Render, Railway, ECS/Cloud Run with session affinity, or a VM). Don't use serverless functions (e.g. Vercel functions) for gameplay WebSockets.
- Start with a single instance serving both the API/WebSockets and the static client. Tournament kiosks, their match rooms, ratings, stats and high scores live in that process. For more capacity, add `@colyseus/redis-presence` + `@colyseus/redis-driver`, run several instances with sticky sessions, and move the static client to a CDN (`VITE_SERVER_URL`). A kiosk always creates its match rooms on its own process, but `GET /api/tournaments` lists only the tournaments on the instance that answers.
- Ship `apps/game-server/dist/words-data/` with the server bundle, or set `DASCADE_WORDS_DICT`.
- Terminate TLS at the load balancer and make sure it allows WebSocket upgrades and long idle timeouts (≥ 60s).
- Set `DASCADE_SAVE_SECRET`, and keep `SUPABASE_SECRET_KEY` server-side only.
