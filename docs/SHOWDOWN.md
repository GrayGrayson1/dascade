# DAS Survey Showdown (`showdown`)

A presenter-run survey game show for the big screen, in the style of a TV family game show: two teams,
a board of up to ten hidden survey answers that flip over with a metallic **clang**, strikes, steals,
a bank, applause, an animated host and a live audience on their phones. It has two looks: **Halloween
Night** (October) and **DAS Showtime** (the rest of the year).

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
`←`/`→` team in control, `X` strike, `N` next, `U` undo. Every action can be undone, including
scores and audience points.

### Audience game

While a question is up, every audience member can lock in up to 3 **private** guesses. A guess is
matched on the server (typo-tolerant, plus hidden alternative spellings), but the match stays secret.
The guesser only learns they "called it" when that answer flips for everyone, and then scores its
survey points. Taps on the cheer pad float emoji over the stage and fill the team's **hype** meter.
The presenter sees the audience's most popular guesses live.

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
  command is ignored, and reveals are idempotent by slot. Undo restores the previous engine state, and
  the revision keeps rising.
- **Room size:** up to 100 seats, and the default is the limit, so everyone who joins plays. The
  presenter and each big screen take a seat too; anyone past the limit watches as a spectator. The
  load scenario passes with 61 and 100 clients.
- **Disconnects:** the seat is held for 180 s (`reconnectGraceSeconds`). If the presenter is gone for
  10 minutes mid-show, the show ends with the scores as they stand, so the room never stalls.
- Outcomes: `reportOutcome` places the winning team's members first and the other team second (one
  group for a tie). The presenter and big screens aren't placed. A show ended before round 1 reports
  nothing. Stats extras: `calls` (answers called) and `bestCallPoints`.

## Architecture (where it lives)

Everything is new files, plus a few one-line registrations.

| Layer | Files |
|---|---|
| Contract | `packages/shared/src/games/showdown.ts`: settings, messages, Zod payloads, views, `validateShowContent`, looks, pack metadata |
| Engine (pure) | `packages/game-core/src/showdown/`: `engine.ts` (show state machine, `boardView`, `sheetView`), `guesses.ts` (audience guess book), `packs.ts` (44 built-in questions, server-only), tests |
| Server | `apps/game-server/src/rooms/showdown/`: `ShowdownRoom.ts` (extends `BaseGameRoom`), `schema.ts`; tests in `apps/game-server/test/showdown.test.ts` |
| Client | `apps/web/src/games/showdown/`: `ShowdownView.tsx` (routing by role, show feed, sounds, stage window portal), `Console.tsx`, `Audience.tsx`, `Stage.tsx`, `Board.tsx`, `Host.tsx`, `Decor.tsx`, `Lobby.tsx`, `ContentEditor.tsx`, `look.ts`, `sounds.ts`, `fx.ts`, `stageWindow.ts`, `access.ts`, `state.ts`, `showdown.css` |
| Floor | `apps/web/src/arcade/scenes/showdown.ts` (attract scene) |
| Tests | `e2e/showdown.spec.ts`, `scripts/load/showdown.ts` |

Notes:

- The client module sets `lobbyPhases: []` so it renders in every phase. Presenter and audience still
  get the shared DASCADE `Lobby`, with the show's `SettingsPanel` and `PlayerSetup`. A big-screen
  device gets the waiting marquee instead.
- **Stage window:** in the presenter's own browser, a second tab would reclaim the presenter's seat,
  because seat tokens are per browser. So the stage window is a same-origin `window.open` that the
  console renders into with a React portal (`stageWindow.ts`). The app's stylesheets and `<html>`
  attributes (theme, motion, effects) are mirrored into it, and it plays no sound of its own. Other
  devices use the big-screen link, which joins as a normal connection marked `screen`.
- **Show feed** (`fx.ts`): one per-device store of the latest event, host line, cue and reactions.
  Every stage on the device animates from it, and sounds play once per device.

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
LOAD_URL=http://localhost:2610 LOAD_SCENARIOS=showdown pnpm load
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
   `apps/game-server/test/showdown.test.ts`, `e2e/showdown.spec.ts`, `scripts/load/showdown.ts`,
   `apps/web/src/arcade/scenes/showdown.ts` and this file.
2. Remove the one-line registrations: `'showdown'` in `GAME_IDS` and its `GAME_CATALOG` entry
   (`packages/shared/src/catalog.ts`); `g('showdown')` and the tagline/description wording in the
   DAStravaganza cabinet (`cabinets.ts`); `ROOM_LOADERS` (`apps/game-server/src/rooms/registry.ts`);
   `GAME_MODULES` (`apps/web/src/games/registry.ts`); the scene in `apps/web/src/arcade/attract.ts`;
   `showdown` in `scripts/load/index.ts`; the two stat labels and `STAT_GAME_DISPLAY.showdown`
   (`packages/shared/src/stats.ts`); and the README/CLAUDE.md lines (game count 26 → 25).

If the branch is never merged, deleting the branch is enough.
