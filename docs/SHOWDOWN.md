# DAS Survey Showdown (`showdown`)

A presenter-run survey game show for the big screen, in the style of a TV family game show: a board
of up to ten hidden answers that flip over with a metallic **clang**, applause, an animated host and a
live audience on their phones. It has two looks: **Halloween Night** (October) and **DAS Showtime** (the
rest of the year), and two formats (the `mode` setting):

- **Team Showdown** (`classic`): two teams, strikes, steals, a bank and scores.
- **Presenter Showcase** (`showcase`): one presenter runs a big Top-10 board for a crowd that guesses
  out loud or in a video-call chat (see [Presenter Showcase](#presenter-showcase) below). There are no
  teams and no scores. Wrong answers are a buzzer and a big ✕, never strikes, and a special answer
  (e.g. #5) sets off the show's biggest celebration. There's a round clock, the rest of the board is
  revealed from #10 up, and stage cards cover the rest of an event. The **DAS-O-Ween 2026** preset is
  a ready-made show of this kind (presenter guide: [DAS-O-WEEN-RUNBOOK.md](DAS-O-WEEN-RUNBOOK.md)).

It lives in the DAStravaganza cabinet (`/cabinet/stravaganza`, or straight to `/play/showdown`).

> Status: **experimental spike** on branch `feature/das-survey-showdown-spike`. It is built to be easy
> to keep or drop. The removal checklist is at the end.

## How a show runs

| Who | Where | What they see |
|---|---|---|
| **Presenter** (the room's creator) | Presenter console (laptop/tablet) | Everything: the answer sheet, the controls, a live preview of the stage, the audience's guesses |
| **Stage** | The **stage window** (a second window from the console; drag it to the projector and go fullscreen) or any device opened with the **big-screen link** (`/room/<code>?screen=1`) | The public show: marquee, board, scores, strikes, host, reactions |
| **Audience / contestants** | Phones (`/r/<code>`) | Team badge, a live mini board, private guesses, the cheer pad |

1. **Lobby.** The presenter picks the look, the questions (built-in packs or their own rounds), the
   scoring and the team names. Everyone else is balanced into Team Delta or Team Sierra and can switch.
   The presenter opens the stage window, or puts the big-screen link on the TV.
2. **Start.** The stage opens on the marquee (intro sting, host welcome, both teams, join code).
3. **Each round:** a title card, then *Show the question*. The face-off reveals don't count for anyone
   yet. *Team X play* hands over control. Reveals bank `points × multiplier`. A miss is ✕, and three
   ✕ open a **steal**: one guess for the other team. A reveal steals the bank, and *Steal missed*
   leaves it with the team in control. Revealing the whole board is a **clean sweep** (applause and
   confetti). After a round is decided, *Reveal the rest* flips the remaining tiles for show.
4. **Finale.** *Next round* after the last round, or *End show*, ends the show. The winner is revealed,
   with a round recap and the top "Survey Sayers" from the audience. *Play again* returns to the lobby.

The console guides each step ("Next step") and has keyboard shortcuts: `1`–`0` reveal, `Q` question,
`←`/`→` team in control, `X` strike, `N` next, `U` undo. Digits go by key position, so AZERTY works
too, and a shortcut only sends what its button would allow (no refusal beep). Every action can be
undone, including scores and audience points.

### Audience game

While a question is up, every audience member can lock in up to 3 **private** guesses. A guess is
matched on the server (typo-tolerant, plus hidden alternative spellings), but the match stays secret.
The guesser only learns they "called it" when that answer flips for everyone, and then scores its
survey points. Another spelling of an answer you already guessed is locked in like any guess (refusing
it would tell you the first one is on the board), but it never scores or counts twice. Taps on the cheer pad float emoji over the stage and fill the team's **hype** meter.
The presenter sees the audience's most popular guesses live.

## Presenter Showcase

A format for events, where the presenter reads the guesses (a Teams chat, a room shouting) and flips
what people name. The same room, roles, secrecy, stage window, big screens, looks and sounds as Team
Showdown. What differs:

- **No teams.** Nobody is put on a team (the server refuses team picks and moves). Switching the
  format in the lobby clears the teams, and switching back deals them out again. Cheers still float up
  on the stage.
- **Rounds** are usually *ranked lists*: every answer at 0 points means "keep my order, no points"
  (`ranked`). Rounds with points work too, but the showcase never shows points. A round can also have:
  - a category (`title`), shown on its title card;
  - an attribution (`source`), shown as "According to …" with the question. Never name a poll that
    didn't happen.
  - a **special** answer (`special`, a board position);
  - a small `note` per answer (artist, year), shown once the answer is revealed.
- **Stages:** `intro` (the opening) → `title` (the category card) → `live` (the question is up, and
  the clock starts) → `done` (every answer is showing). Then the next round, or the finale.
- **Wrong answers** (`act {a:'miss', round}`) are broadcast as a `miss` event and never stored, so
  they can't pile up as strikes and never make the presenter's next command stale. A second press
  within 450 ms is the same miss.
- **The special answer**: the reveal event says `special: true`. Every screen plays the celebration
  (banner, confetti, lights, the host, the `special` sting). The `celebrate` cue plays it again on
  demand. The special *position* is public (the crowd hunts for it); its text is not.
- **Round clock** (`minutes`, default 10; `stageClock` shows it on the stage too). The server keeps
  it: `clockEndsAt` (server epoch ms while running) or `clockLeft` (paused, negative = overtime), and
  `clockMax`. Clients count down against `serverNow()`. It starts when the question goes up. The
  presenter can pause it, add or take a minute, reset it, or hide it. At 0 a `timeup` event goes out
  once; the console says "wrap up" and the stage says "Final guesses!". **It never reveals anything by
  itself.**
- **Reveal remaining** (`act {a:'sweep', round}`, `{a:'halt'}`): the **server** flips the hidden
  answers from the bottom up (#10, #9 … #1), skipping the ones already showing. Before the special
  answer there's a `suspense` beat with a drumroll, and a longer pause after it. Running it on the
  server means a backgrounded console tab (browsers throttle timers) can't stall it. Each tile is a
  normal, undoable reveal flagged `late` ("nobody found it"). Any other command (Next, Undo, Restart…)
  stops it, a sweep for a round the show has left is ignored, and pressing Reveal remaining again
  carries on.
- **Restart this round** (`restart`) and **Restart the whole show** (`reset`) are undoable engine
  steps.
- **Stage cards** (`showdown:card`): Welcome (the `eventName` headline), Be right back, Prize time and
  Thanks for playing. The presenter can put one up on every stage in any phase (the lobby, the show,
  the results); starting a show takes it down.
- **Event presets** (`showdown:preset {id}`, lobby or results). Each preset's settings are public
  metadata (`SHOWDOWN_EVENT_INFO`); its rounds are server-only
  (`packages/game-core/src/showdown/events.ts`) and become the room's custom rounds, which only the
  presenter receives. `dasoween-rehearsal` loads practice boards, and every screen says "Rehearsal"
  (`state.rehearsal`) until the presenter saves rounds of their own.
- **Outcome:** no winner is ever invented. The finale has `mode: 'showcase'` and per-round
  `found`/`total`, and the reported outcome places the whole audience together.
- **Theme music:** a looping procedural bed under the opening, the category cards and the holding
  cards, on devices that play show sounds (a per-device toggle).

## Roles and secrecy

- **Presenter = host, and never migrates.** `ShowdownRoom.canBecomeHost` only allows the presenter.
  The role moves only through:
  - the secret **presenter pass**, which the server sends to the presenter only. The console's
    *Copy presenter link* gives `/room/<code>#presenter=<pass>`; the pass is in the fragment, so it
    never reaches server logs. A browser that held the pass also reclaims an empty presenter seat by
    itself.
  - an explicit **hand-over**.
  - **Become the presenter**, between shows only, if the presenter left for good. The previous
    presenter's custom rounds are discarded and the pass changes.
- **Hidden answers never leave the server** except in the presenter's sheet (`showdown:sheet`,
  `sendTo` the presenter). The public board (`boardJson`, built by the pure `boardView()`) carries
  hidden slots as bare positions: no text and no points. The built-in packs are only in
  `@dascade/game-core/showdown`, which the web client never imports, so they aren't in the JS bundle.
  Custom rounds travel presenter → server → presenter only. Settings (which are public) hold no
  answers.
- Guesses are private (`showdown:me` goes to the guesser only). Before a reveal, the public state has
  only the aggregate `guessesIn` count; after it, `callers` per revealed slot.
- Every presenter command carries the board revision it was made against. A stale or double-clicked
  command is ignored. Reveals are idempotent by slot and carry the round instead of the revision (a
  fast presenter can flip several before the board catches up), so a late one, e.g. *Reveal the rest*
  racing *Next round*, never flips a tile of the next board. Held keys don't auto-repeat commands.
  Score adjustments queue on the console (one in flight per revision), so quick +5 clicks all count.
  Undo restores the previous engine state, and the revision keeps rising.
- **Room size:** up to 100 seats, and the default is the limit, so everyone who joins plays. The
  presenter and each big screen take a seat too; anyone past the limit watches as a spectator. The
  load scenario passes with 61 and 100 clients.
- **Disconnects:** the seat is held for 180 s (`reconnectGraceSeconds`). If the presenter is gone for
  10 minutes mid-show, the show ends with the scores as they stand and the role is freed, so the room
  never stalls: anyone can *Become the presenter* from the results screen or the lobby (the old pass
  still works until then).
- **Big screens never present:** a hand-over to a stage display is refused. A big-screen link opened in
  the presenter's own browser takes the presenter's seat (seats are per browser), so that tab shows a
  notice (use the stage window instead) rather than the console with the answers.
- Outcomes: `reportOutcome` places the winning team's members first and the other team second (one
  group for a tie, and always one group in a Presenter Showcase). The presenter and big screens aren't
  placed. A show ended before round 1 reports nothing. Stats extras: `calls` (answers called) and
  `bestCallPoints`.
- A guard test (`apps/web/src/games/showdown/secrecy.test.ts`) fails if a web module imports the
  engine package or contains a DAS-O-Ween answer.

## Architecture (where it lives)

Everything is new files, plus a few one-line registrations.

| Layer | Files |
|---|---|
| Contract | `packages/shared/src/games/showdown.ts`: settings, messages, Zod payloads, views, `validateShowContent`, looks, pack metadata |
| Engine (pure) | `packages/game-core/src/showdown/`: `engine.ts` (show state machine for both formats, `boardView`, `sheetView`), `guesses.ts` (audience guess book), `packs.ts` (44 built-in questions, server-only), `events.ts` (event preset rounds, server-only), tests |
| Server | `apps/game-server/src/rooms/showdown/`: `ShowdownRoom.ts` (extends `BaseGameRoom`; also wrong answers, the clock, the sweep, cards and presets), `schema.ts`; tests in `apps/game-server/test/showdown.test.ts` and `showdown-showcase.test.ts` |
| Client | `apps/web/src/games/showdown/`: `ShowdownView.tsx` (routing by role, show feed, sounds, stage window portal), `Console.tsx`, `Audience.tsx`, `Stage.tsx`, `Board.tsx`, `Host.tsx`, `Decor.tsx`, `Lobby.tsx`, `ContentEditor.tsx`, `look.ts`, `sounds.ts`, `fx.ts`, `stageWindow.ts`, `access.ts`, `state.ts`, `showdown.css` |
| Floor | `apps/web/src/arcade/scenes/showdown.ts` (attract scene) |
| Tests | `e2e/showdown.spec.ts`, `e2e/showdown-showcase.spec.ts`, `scripts/load/showdown.ts` (scenarios `showdown` and `showdown-showcase`) |

Notes:

- The client module sets `lobbyPhases: []` so it renders in every phase. Presenter and audience still
  get the shared DASCADE `Lobby`, with the show's `SettingsPanel` and `PlayerSetup`. A big-screen
  device gets the waiting marquee instead.
- **Stage window:** in the presenter's own browser, a second tab would reclaim the presenter's seat,
  because seat tokens are per browser. So the stage window is a same-origin `window.open` that the
  console renders into with a React portal (`stageWindow.ts`). The app's stylesheets and `<html>`
  attributes (theme, motion, effects) are mirrored into it node by node (an edited sheet is re-copied
  alone, so theme previews don't flash the projector), a reload of the window rebuilds the stage, and
  it plays no sound of its own. Other devices use the big-screen link, which joins as a normal
  connection marked `screen`; until the browser lets it play audio (a first click or tap) it shows
  "Click or tap here for the show's sound".
- **Show feed** (`fx.ts`): one per-device store of the latest event, host line, cue and reactions.
  Every stage on the device animates from it, and sounds play once per device.
- **Crowd load:** reactions go out in 250 ms batches, and while guesses pour in the presenter's sheet
  (cloud, matches, rundown) follows at most once per batch, not once per guess. Profiled with 100
  clients (3 cheers a second each, 3 guesses each per round): the server's time goes to fanning state
  patches and reaction batches out to 100 sockets; the show's own logic is a few per cent of it.

## Looks and themes

- The look is a **show setting** (`look: auto | halloween | showtime`), because the show's set
  dressing is part of the show and every screen in the room should match. `auto` means Halloween in
  October and Showtime the rest of the year. It uses the viewer's local date and honours the
  `?season=` QA override (`seasonClock()`). This is separate from DASCADE's 12 personal themes, which
  stay local and are never sent to the server.
- The stage is game art. Each look declares its palette once, as `--sd-*` variables on `[data-look]`
  at the top of `showdown.css`. Team colours are fixed in both looks (Delta `#22d3ee`, Sierra
  `#ff4fd8`) and always paired with the team name.
- The console, audience and lobby chrome use the theme tokens (panels, text, buttons), so they follow
  the viewer's DASCADE theme.
- Fonts come from existing dependencies: Audiowide and Orbitron (Showtime), Creepster (Halloween
  titles), and `--font-num` for every number.
- Copy and host lines are in `look.ts`. The host is DASbot, a chrome CRT robot, for Showtime, and Boo,
  a top-hatted ghost, for Halloween (`Host.tsx`). Decor is in `Decor.tsx`: spotlights and sparkles
  for Showtime; moon, fog, bats, cobwebs, jack-o'-lanterns and a graveyard skyline for Halloween.
- Motion: everything decorative stops under reduced motion or effects off, and particles and bats
  scale with the effects level.

## Sound

All sounds are procedural voices on the shared synth (`sounds.ts`). They use the one AudioContext and
the SFX bus, so mute, volume and the jukebox dip all apply. Sounds include the clang (a struck plate;
a haunted bell in Halloween), the top-answer sparkle, the strike buzzer (ghostly in Halloween), steal
stings, the award, applause, the intro fanfare (an organ toccata with thunder in Halloween), drumroll,
aww, ding, suspense and the finale. The presenter can fire cues from the console.

Presenter Showcase adds a crescendo, all original:

- **A found answer:** a bright `correct` ding at 0 ms, then the `clang`, which lands at 320 ms
  (`FLIP_LAND_MS`) as the tile's 3D flip turns face up.
- **A sweep tile:** a lighter `clangLate`.
- **Board complete:** a `complete` flourish, then applause.
- **The special answer:** the `special` sting (about 3 s: a hit, a fanfare, a bell cascade and a
  crowd roar).
- **Wrong:** a single 0.5 s `miss` buzzer. It stays clean when pressed several times.
- **Other cues:**
  - `opening`, about 6 s, for the start of the show;
  - `category`, the round's transition sting;
  - `sweepStart`, when Reveal remaining begins;
  - `rollIn`, the sweep's 2.95 s drumroll, which ends exactly as the server flips the special tile
    2.6 s after `suspense`;
  - `timeup`, when the round clock runs out;
  - `cardIn`, when a stage card goes up.
- **Theme music** (`themeMusic.ts`): two original 16-bar beds, written to sit under a presenter
  talking:
  - "Haunted Swing" for Halloween: D minor, swung;
  - "Bright Lights" for Showtime: C major.

  They play through one gain node on the SFX bus, with a lookahead scheduler. They fade in over 1.5 s
  and out over 1.2 s, and dip under any show sound. While a bed plays it holds the jukebox dip, and a
  new look takes over at the next bar line. Nothing is scheduled while audio is locked, and a stalled
  (background-tab) timer skips its backlog instead of playing it. The bed plays under the opening,
  the category cards and the holding cards; a question going up stops it. Each device has its own
  toggle.

The presenter console and big screens play show sounds by default. Audience phones default to off,
so a room full of phones doesn't echo the stage; the audience's own taps still click. Each device has
a toggle.

**Recorded sounds:** put files in `apps/web/public/audio/showdown/` and map them in
`SHOWDOWN_SOUND_FILES` (`sounds.ts`), e.g. `clang: '/audio/showdown/clang.mp3'` or, for one look only,
`'halloween:strike': …`. They're decoded into the shared context, and a missing or broken file falls
back to the procedural voice. Only use audio you have the rights to (this repo is public).

## Testing

```bash
pnpm vitest run packages/game-core/src/showdown apps/game-server/test/showdown.test.ts
DASCADE_ONLY_GAMES=showdown PORT=2610 DASCADE_RELAXED_LIMITS=1 pnpm --filter @dascade/game-server dev
WEB_PORT=5190 VITE_SERVER_PORT=2610 pnpm --filter @dascade/web dev
E2E_BASE_URL=http://localhost:5190 pnpm exec playwright test e2e/showdown.spec.ts --project=chromium
LOAD_URL=http://localhost:2610 LOAD_SCENARIOS=showdown,showdown-showcase pnpm load
```

Manual walkthrough:

1. Open `/play/showdown` and *Create game*. You're the presenter. In *Your setup*, press
   **Open stage window** (allow pop-ups) and move the window to a second screen.
2. Join from a phone or a private window with the room code; you land on a team. Optionally open
   `/room/<code>?screen=1` on a third device for a big screen.
3. *Start game*. In the console, press *Start round 1*, then *Show the question*, then *Team Delta
   play*. Reveal answers by clicking the sheet or pressing `1`–`0`, and use `X` for strikes.
4. **Privacy check:** on the audience device, the board shows only numbers for hidden tiles. Searching
   the page or DevTools for an unrevealed answer finds nothing. Only the presenter's tab has the sheet.
5. **Sync check:** every reveal, strike and score change appears on all screens at once. Refresh any
   screen and it comes back to the same board.
6. To force a look, set it in the lobby settings, or use `?season=2026-10-15` / `?season=2026-11-15`
   with *Seasonal*.

## Known limitations / next steps

- Placeholder-quality audio. The procedural voices are good, but recorded stingers would be better;
  the hook is ready (above).
- No Fast Money / bonus round, and no buzzer race for the face-off (the presenter judges it).
- The join hint shows the short URL and code. A QR code would need an encoder (not added: no new
  dependency).
- Audience guesses are text-matched. The packs carry common spellings, and custom rounds can add
  their own.
- The stage window needs pop-ups allowed. Without them, use the big-screen link.
- Not tournament-capable (team format) and not rated.

## Removing the feature

1. Delete `apps/web/src/games/showdown/`, `apps/game-server/src/rooms/showdown/`,
   `packages/game-core/src/showdown/`, `packages/shared/src/games/showdown.ts`,
   `apps/game-server/test/showdown.test.ts`, `apps/game-server/test/showdown-showcase.test.ts`,
   `e2e/showdown.spec.ts`, `e2e/showdown-showcase.spec.ts`, `scripts/load/showdown.ts`,
   `apps/web/src/arcade/scenes/showdown.ts`, `docs/DAS-O-WEEN-RUNBOOK.md` and this file.
2. Remove the one-line registrations: `'showdown'` in `GAME_IDS` and its `GAME_CATALOG` entry
   (`packages/shared/src/catalog.ts`); `g('showdown')` and the tagline/description wording in the
   DAStravaganza cabinet (`cabinets.ts`); `ROOM_LOADERS` (`apps/game-server/src/rooms/registry.ts`);
   `GAME_MODULES` (`apps/web/src/games/registry.ts`); the scene in `apps/web/src/arcade/attract.ts`;
   `showdown` in `scripts/load/index.ts`; the two stat labels and `STAT_GAME_DISPLAY.showdown`
   (`packages/shared/src/stats.ts`); and the README/CLAUDE.md lines (game count 26 → 25).

If the branch is never merged, deleting the branch is enough.
