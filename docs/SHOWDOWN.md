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

> Status: **live** on <https://dascade.onrender.com> since 2026-10-15 (PR #4); the Presenter Showcase
> format and the DAS-O-Ween presets since 2026-10-19 (PR #9). It is still built to be easy to drop:
> the removal checklist is at the end.

## How a show runs

| Who                                | Where                                                                                                                                                                           | What they see                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Presenter** (the room's creator) | Presenter console (laptop/tablet)                                                                                                                                               | Everything: the answer sheet, the controls, a live preview of the stage, the audience's guesses |
| **Stage**                          | The **stage window** (a second window from the console; drag it to the projector and go fullscreen) or any device opened with the **big-screen link** (`/room/<code>?screen=1`) | The public show: marquee, board, scores, strikes, host, reactions                               |
| **Audience / contestants**         | Phones (`/r/<code>`)                                                                                                                                                            | Team badge, a live mini board, private guesses, the cheer pad                                   |

1. **Lobby.** The presenter picks the look, the questions (built-in packs or their own rounds), the
   scoring and the team names. Everyone else is balanced into Team Delta or Team Sierra and can switch.
   The presenter opens the stage window, or puts the big-screen link on the TV. Nobody readies up: the
   presenter presses _Start game_ when they like (ready-up starts off in Showdown rooms; the Room
   panel's _Players ready up before the start_ switch turns it on).
2. **Start.** The stage opens on the marquee (intro sting, host welcome, both teams, join code).
3. **Each round:** a title card, then _Show the question_. The face-off reveals don't count for anyone
   yet. _Team X play_ hands over control. Reveals bank `points × multiplier`. A miss is ✕, and three
   ✕ open a **steal**: one guess for the other team. A reveal steals the bank, and _Steal missed_
   leaves it with the team in control. Revealing the whole board is a **clean sweep** (applause and
   confetti). After a round is decided, _Reveal the rest_ flips the remaining tiles for show.
4. **Finale.** _Next round_ after the last round, or _End show_, ends the show. The winner is revealed,
   with a round recap and the top "Survey Sayers" from the audience. _Play again_ returns to the lobby.

The console guides each step ("Next step") and has keyboard shortcuts: `1`–`0` reveal, `Q` question,
`←`/`→` team in control, `X` strike, `N` next, `U` undo. Digits go by key position, so AZERTY works
too, and a shortcut only sends what its button would allow (no refusal beep). Every action can be
undone, including scores and audience points.

### Audience game

While a question is up, every audience member can lock in up to 3 **private** guesses (the `guesses`
setting, 1–10; the DAS-O-Ween presets set 10). A guess is
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
- **Rounds** are usually _ranked lists_: every answer at 0 points means "keep my order, no points"
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
  demand. The special _position_ is public (the crowd hunts for it); its text is not.
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
  the results); starting a show takes it down. Putting any card (or a scene) up while the round clock
  runs **pauses the clock** where it is; `P` starts it again.
- **Stage scenes** (Production Desk, Scenes A + Video A): the console's scene strip switches the stage
  window between **Show** (`B`: no card, the board exactly as it was), **Cinema** (`V`) and **Cards**
  (opens the Cards tab), so the presenter never re-shares in Teams. Each switch opens a curtain in the
  show's look (`.sd-wipe`), instantly with reduced motion or effects off. Scenes are cards
  (`SHOWDOWN_SCENE_CARDS`, accepted by `ShowdownCardSchema`, kept out of `SHOWDOWN_CARDS` like the
  Standings card); the server refuses them in Team Showdown.
  - **The join QR** (Production Desk, QR A; `qr.tsx`): the join link in capitals
    (`HTTPS://DASCADE.ONRENDER.COM/R/CODE`: alphanumeric mode fits version 2, 25×25, at error
    correction M, against version 3 in lowercase; `/R/` reaches the join screen because routes ignore
    case). Drawn in the browser by `lean-qr` (MIT, no dependencies), loaded on its own the first time a
    QR is drawn: only on the stage window, the console and big screens, never on phones (the stage's
    display context; `useDisplayInfo`). Black on white, a 4-module quiet zone, no logo, the same in
    every look, with the readable link and the room code under it. A big ticket (about 40 % of the
    stage's height) on the lobby and the Welcome card; a medium one on Be right back and the Standings;
    text only during rounds. The **Join pop-up** (`J`, or the Cards tab; `showdown:joinpop {on}`,
    presenter only) sets `joinAt`: every stage window and big screen shows the ticket over the board for
    `SHOWDOWN_JOIN_POP_MS` (20 s, by the server's clock), then it slides away. **Copy QR image** (the
    Cards tab and the lobby's Join QR) puts a PNG on the clipboard for the Teams chat (saved as a file
    where the browser can't copy images).
  - **Awards** (Production Desk, Awards A; `awards.ts`, `panels/AwardsPanel.tsx`, `fireworks.tsx`): the
    console's Awards tab and the presenter's results screen keep award categories (Best Costume, Best
    Background, Trivia Champions filled from the finale's podium; up to six), each with a 1st, 2nd and
    3rd: a name (trimmed, capped) and an optional photo (pasted, dropped or picked; shrunk to at most
    640 px and re-encoded as JPEG in the browser, which drops EXIF and location). Everything stays in
    the presenter's IndexedDB: never the server, the black box, the exports, the tests or a log. The
    ceremony (`awards` scene card) steps through the title, each award, its places 3rd → 2nd → 1st on
    the podium (2nd–1st–3rd layout), each place after the recorded drumroll cue, landing with the
    applause cue; fireworks over the last winner (a client-only canvas, still with reduced motion, none
    with effects off); then the Thanks card. Edits stay off the share until Start; phones and big
    screens show "Awards on stage: watch the Teams share".
  - **Cinema** (`cinema.ts`): the presenter loads video files in the drawer's **Cinema** tab. Each
    becomes an object URL in this browser: nothing uploads, and no file, name or frame reaches the
    server, the black box, an export or a log (only the frame choice is remembered on the device).
    The chosen clip plays in a frame (Retro TV, Haunted cinema, Gilded portrait) in the stage window,
    as **plain DOM** layered over the stage (`.sd-cinema`), not React: it keeps playing when the
    console loses its room for a moment (the portal unmounts then; `holdStageWindow` leaves a playing
    video uncovered), and the frame never re-renders while it plays. Nothing clips the video (no
    rounded overflow, clip-path or mask on it or its parents: a rounded clip made the Retro TV stutter
    on a presenter's laptop); the TV's rounded glass is a still overlay (`.sd-cinema__bezel`) over the
    picture's corners, and the stage under the opaque layer stops rendering (`content-visibility`)
    while Cinema is up. The tab drives it: Play/Pause, back and forward 10 s, Restart, and a seek bar
    (drag or click it; arrows ±5 s, Page Up/Down ±10 s, Home/End). Its sound joins the one mixer
    (`mixer.routeMedia` → the master bus; `element.volume` follows the master level where the browser
    refuses). A browser that won't start sound in a window nobody has clicked says so in the console,
    and the next click in the stage window starts it. Every other screen shows the "Cartoon break:
    watch the Teams share" card; the console's preview shows the frame and what's playing. The
    jukebox pauses during Cinema (`musicSegment` → `cinema`) with no theme bed under it.
- **Event presets** (`showdown:preset {id}`, lobby or results). Each preset's settings are public
  metadata (`SHOWDOWN_EVENT_INFO`). **`dasoween-2026` is settings only** (`settingsOnly`, ADM-01): the
  real boards are never in the repo — the presenter loads them from a show file (the content editor's
  _Load show file_ / _Load from this device_) before doors, in either order (a settings-only preset
  keeps the rounds already loaded; `validateStart` refuses a custom show with no rounds).
  `dasoween-rehearsal` loads practice boards (server-only, `packages/game-core/src/showdown/events.ts`),
  and every screen says "Rehearsal" (`state.rehearsal`) until the presenter saves rounds of their own.
  Both presets make the room an **event room** (below).
- **Outcome:** no winner is ever invented. The finale has `mode: 'showcase'` and per-round
  `found`/`total`, and the reported outcome places the whole audience together.
- **Theme music:** a looping procedural bed under the opening, the category cards and the holding
  cards, on devices that play show sounds (a per-device toggle).

## Two-tier scoring (Presenter Showcase)

Brian's picks from the Scoring Studio (see "Scoring decisions" below). **The two tiers never touch:**
the hot seat earns **medals**, the crowd earns **points**; no medal turns into points and no points buy
medals. Everything is **derived** from the board, the guess book, the hot-seat credits and the
finished turns (`packages/game-core/src/showdown/scoring.ts`, `scoreShow`), never accumulated: an
Undo, a restart or a restored black box recomputes exactly, and a repeated message can't score twice.

**Settings** (lobby → Scoring; all with defaults so older black boxes still parse):

| Setting                       | Values                                                              | DAS-O-Ween  | Ordinary rooms                |
| ----------------------------- | ------------------------------------------------------------------- | ----------- | ----------------------------- |
| `points` — Score the crowd    | on / off                                                            | on          | off (the show runs as before) |
| `guesses` — Guesses per board | 1–10                                                                | 10          | 3                             |
| `medals` — Medal ceremony     | `never` / `round` (after each round) / `end`                        | `round`     | `never`                       |
| `reveal` — Showtime           | `standings` (Standings + paced finale) / `finale` (just the finale) | `standings` | `standings`                   |
| `gems` — Hidden gems          | on / off                                                            | on          | on                            |
| `pops` — Called-it pops       | on / off                                                            | on          | on                            |

The DAS-O-Ween presets also switch phone guesses on (`audience: true`).

**The crowd — Called it.** Phones (and desktop tabs: one responsive component) get a **Top 10
scorecard**: numbered rows #1–#N, each taking one guess (`showdown:guess {round, text, pos}`), up to
the `guesses` setting. A guess locked in before its answer flips scores the tile's value — #1 = 10 …
#10 = 1 (`answerValue`) — however it flipped (the hot seat, the chat, out loud, the sweep). **+1** when
the answer lands in the spot you put it; **+20** for a perfect list (every answer on the board, each in
its exact spot). **Hidden gems:** a tile only Reveal remaining found (`late`) pays double (the spot
bonus stays +1). Matching is unchanged (server-side, typo-tolerant, aliases, secret until the flip);
another spelling of an answer you already locked never scores; a used spot, or a spot whose answer is
already showing, is refused. Phones show your points, rank ("27 pts · 4th of 38", ties share a place)
and medals privately (`ShowdownMe.score`), and flash "Called it! +9, +1 spot on".

**The hot seat — medals.** A tile flipped while someone is in the hot seat is credited to them
(`credits`, `${round}:${slot}` → who and which draw): 🎃 the special answer, 🥇 #1–#3, 🥈 #4–#7, 🥉
#8–#10; a turn marked done with nothing credited to its draw is a 🎗️ Brave ribbon. An Undo that hides
a tile takes its credit (and medal) back; the presenter can take a wrong credit off a tile
(`showdown:credit {round, slot}`, `scores.fix`, audited as `credit.remove`). **Spotlight Stars** is the
medal wall, Olympic order (pumpkins, golds, silvers, bronzes, ribbons). With medals **Never** nothing
shows on screen; the export still lists who found what.

**Public and private.** `scoreJson` (public) is the top five Guessers plus the medal wall, built only
from revealed answers, without people a moderator hid, and empty with scoring off — so public scores
move only when a tile flips. The presenter (and the producer, `scores.export`) get the full live list
privately (`showdown:scores`): the console's **Scores** tab with Download CSV / JSON
(`showdown:scores-export`; the JSON never contains an unrevealed answer) and Remove a wrong credit.
Spectators and big screens get nothing private.

**Showtime.** With Standings on, the console offers **Show standings** once a round's board is complete:
a stage card (`card: 'standings'`) with the top five and, with medals After each round, the Spotlight
Stars. The results screen's **paced finale**: the presenter steps it on (`showdown:finale {step}`,
public `finaleStep`, a `finale` event per step so every screen plays the cue once) through
`finaleSteps(finale)`: the wrap-up → the medal ceremony (unless Never) → 3rd → 2nd → 1st (the podium
is the top three Guessers; ties share a place). Prize time lists the podium and the medal winners.
Called-it pops put "+9 · 6 called it" over a flipped tile on the stage and the console preview
(counts only, never names).

**Outcome and stats.** A showcase player's score is their points; `playerStats` add `medals` and
`positionHits`; placements stay one group. **Black box:** the guess book (with spots and matches),
the finished turns and the finale step are in the snapshot; older boxes restore without them.

## The Presenter Tour

An animated, self-paced walk through running a Presenter Showcase show (about 3½ minutes, ten
chapters): `/tutorial/showdown`, or **Watch the presenter tour** on the presenter's setup card and
**Tour** in the showcase console's top bar (a large dialog). The film cut, _Boo's Backstage Tour_, is
the same timeline at `/tutorial/showdown?film=1`, made to be recorded at 1920×1080.

- **The real stage, a demo show.** The stage hooks (`useBoard`, `useClock`, `useCard`, `useSweep`,
  `useShowPhase`…, and `useShowFeed`) read the room through `useShowSelector` (`source.ts`). Inside a
  `<ShowSourceProvider>` they read a demo source instead (`tour/demoSource.ts`): a pretend room with its
  own state, clock and show feed. Without a provider nothing changes. The tour opens no connection and
  sends nothing, and a tour opened mid-show never touches that show's board, feed or sounds (the
  console's shortcut keys rest while its dialog is open).
- **A timeline of pure beats** (`tour/timeline.ts`, `tour/script.ts`): each beat says what changes on
  the stage, which board events play (so the host says his real lines), where the cursor goes on the
  mock console, a meeting-chat line and a caption. `[[Name]]` in a caption is a control's exact name
  (a test checks it against the console), `{{X}}` a key. **Practice content only**: the boards are the
  rehearsal preset's candy and costume lists, never the real show's answers (`secrecy.test.ts`).
- **The player** (`tour/TourPlayer.tsx`): a picture of the console (`tour/MockConsole.tsx`, inert,
  drawn with the console's own classes) with a cursor, a spotlight and a zooming camera, the stage
  window, the meeting chat, captions with Boo, and a chapter rail. Sound is off until the viewer turns
  it on (this device only). Space plays and pauses, ←/→ change chapters. Under reduced motion or
  effects off nothing plays by itself: each beat is a still to step through.
- **The film** (`tour/TourFilm.tsx`, `film.css`, `narration.ts`): the same chapters with Boo narrating
  in speech bubbles and doing his bits, big captions, chapter cards, a DASbot cameo and an end card.
  `?voice=1` plays a voice-over clip per line through the one audio pipeline; the clips (and the video
  files) are made outside the repo.

## Event rooms (the DAS-O-Ween decisions)

Loading either DAS-O-Ween preset makes the room an event room for the rest of its life
(`state.event` = the preset id; also in the room metadata, so `/api/rooms/:code` returns `event` and
`/r/<code>` can show the event join screen). Ordinary Showdown rooms keep today's behaviour, except
the hardening that only makes the server safer (screens and spectators can never take over) and the
picker, which works in every Presenter Showcase room.

**Crew and permissions** (ADM-04 B, JOI-02 C; the smallest slice of ADM-02/03). Roles are data
(`SHOWDOWN_ROLE_PERMISSIONS`): `producer`, `presenter` (whoever presents now), `backup`, `moderator`,
each a set of permission names (`presenter.assign`, `crew.issue`, `crew.revoke`, `people.rename`,
`people.hide`, `picker.run`, `picker.reroll`, `audio.station`, `audit.read`, `audit.export`,
`preflight.read`). The room checks `can(player, permission)` and denies by default.

- **Crew links**: `/room/<code>#crew=<id>.<secret>` — 190 random bits, the secret in the fragment (read
  once and stripped from the address bar, `access.ts`), only its SHA-256 kept in room memory, compared
  in constant time, expiring after 24 h, revocable, rate-limited, never logged or synced
  (`apps/game-server/src/rooms/showdown/crew.ts`). Claiming binds the role to that seat; a second
  device moves it. The server sends a secret once (`ShowdownCrewPrivate.fresh`); the minting device
  keeps it to copy again.
- **The producer** is whoever made the room an event room; they get the producer link privately. They
  make someone presenter (`showdown:assign`), issue named backup-presenter and moderator links, revoke
  links, and moderate.
- **Succession**: in an event room every change of presenter **rotates the presenter pass** (the new
  presenter receives it privately; nobody reloads; the old pass stops working). `showdown:claim` with
  the pass is refused while the presenter is online ("ask the producer") and allowed while they're
  offline (audited). A backup presenter can make themselves presenter only while the presenter is
  offline — the fallback when the producer is offline too. Takeover needs `presenter.assign`.
- **Moderation**: `rename` (any phase, the same cleaning as a lobby rename; the guest is told) and
  `hide` (off the stage grid and out of the pool; they stay in the room). Moderators see who is hidden
  and who is crew in their private crew view.
- **Audit** (`apps/game-server/src/rooms/showdown/audit.ts`): append-only, in memory, capped at 1,000,
  never synced; each entry `{at, actor, role, action, target, before, after, reason}`. Crew with
  `audit.read` get the latest 60; the producer downloads the whole log as JSON. Server logs get one
  line per entry with ids only. It leaves with the room.

**The picker** (PCK-01…05, VIS-02, DSP-03; modes and controls from the Scoring Studio, PR A). The
server draws with its crypto RNG (`drawPick`/`pickPool`, `packages/game-core/src/showdown/picker.ts`)
from the people **in the draw**: connected guests — never the presenter, big screens or spectators;
crew only with the `crewDraw` setting — who aren't hidden, on Skip me, **excluded** or in the hot seat.
The `pickMode` setting narrows that down:

- `fair` (default; DAS-O-Ween's): only those with the fewest **turns this show** (Mark done counts one;
  No answer, reroll and a cleared seat don't). When everyone is level the next lap opens by itself, so
  the pool never runs dry; a late joiner (no turns) goes first.
- `random`: everyone in the draw every time (a finished turn doesn't take you out), except whoever the
  last draw picked (`lastPicked`) — unless they're the only one left.

`showdown:pick` acts: `pick`, `done`, `noAnswer`, `reroll` (with a reason), **`choose`** (Spotlight a
name, `picker.choose`: presenter and producer), **`exclude` / `include` / `includeAll`**
(`picker.manage`: presenter, producer, backup, moderator; any phase). The draw acts carry the draw
number, so a stale or repeated one is ignored; Pick or choose while someone is in the hot seat is
refused with a nudge. `choose` puts anyone seated in the hot seat whatever the draw says — done, on
Skip me, excluded, crew — and refuses the presenter, big screens, spectators, hidden and offline seats
(**Skip me only stops random draws**, Brian 2026-10-27, so choosing a skipper never reveals who
skipped). Every screen gets the `pick` event (`winnerId`, `name`, `poolSize`, `landAt`, `chosen`): the
console names the person at once, the stage's spotlight lands at `landAt` (3.5 s), and the picked phone
shows "You're up!". `done` lists this round's finished turns and clears when the next round starts;
turns last the show. Public: `drawNo`, `hotSeat`, `pickAt`, `landAt`, `poolSize`, `done`, and `seats`
(the stage grid: guests who aren't hidden, crew too while `crewDraw` is on, and whoever is in the hot
seat — skippers and excluded people stay on it, so nobody can tell). Private: `ShowdownMe.pool {in,
skip, done, turns, excluded, crewOut, mode}` and `picked` (guests and crew), and for `picker.manage`
holders `ShowdownCrewPrivate.picker {turns, excluded, crew, hidden}` — never who chose Skip me. A tile
revealed while someone is in the hot seat is credited to them (`calledBy` on the slot, only once
revealed; undo takes it back). Draws, spotlights, rerolls, done, no answer, exclusions and inclusions
are audited, and turns, exclusions and `lastPicked` are in the black box (older boxes restore with
everyone level and included).

The console: the rail's **Pick someone (K)** and **Spotlight… (F)** side by side (Spotlight opens a
searchable dialog: type, Enter); an empty draw says why and offers **Include everyone**. The **Picker**
tab (console drawer, crew screen, and the lobby's Crew & checks) lists everyone with their turns,
Include/Exclude and Spotlight, the mode in words and this round's done list. Phones and crew screens
show the pool card (`poolStatus.ts`).

**Sound station** (AUD-02 C): consoles and big screens report `showdown:audio {ready, muted, sounds}`
every 2 s; exactly one device plays show sound — `soundStation` ('' = the presenter's console), which
crew (`audio.station`) can move to a connected big screen. A screen station that disconnects hands it
back at once; one that misses heartbeats for 5 s, too (a `station` event with `lost: true`). Phones
never play show sound in an event room. Outside event rooms every device behaves as before.

**Clock cues** (AUD-01): `clockWarn` at 1:00 left (once per round, for clocks longer than a minute) and
`tick` n = 10 … 1. **Room DJ** (AUD-04): refused and switched off while an event room is PLAYING
(`djLockReason`, an additive `BaseGameRoom` hook).

**Join** (JOI-01 B, JOI-03 B): `/r/<code>` for an event room shows the one-field join screen; a join
with `strictName` is refused with `JoinErrorCode.NAME_TAKEN` (message = the name the room would give
instead) so the screen can ask for an initial first, with "Keep Sam 2" as the fallback.

**Continuity** (OPS-01 C):

- _Keep-alive_: the presenter's and the crew's seats are held for 30 minutes (`reconnectGraceFor`, an
  additive `BaseGameRoom` hook), a presenter away mid-show ends it only after 30 minutes, and a live
  event room doesn't auto-dispose (back on at the results; a safety timer closes it after 30 minutes
  with nobody connected). The console pings `/api/health` every 4 minutes (keep-warm).
- _The black box_: after each change (at most once a second, and every 15 s while the clock runs) the
  server seals a snapshot of the room — engine state, rounds, settings, seats with hashed seat tokens,
  crew link hashes, the picker, the audit tail, the clock — with AES-256-GCM under a key derived from
  `DASCADE_SAVE_SECRET` (HKDF, its own label; `apps/game-server/src/rooms/showdown/blackbox.ts`) and
  sends it to the presenter's console only (`showdown:blackbox`). On a graceful stop (a deploy) a last
  one goes out first (`onServerShutdown`). The console keeps it (`apps/web/src/net/recovery.ts`); after
  a restart it hands it back (`CreateOptions.restore` → `prepareRestore`/`applyRestore`) and the room
  comes back **under the same code**, silently: no events are broadcast, the clock comes back paused,
  the pass rotates, and every seat waits for its owner's old seat token (phones in an event room keep
  looking for the room and rejoin by themselves — `apps/web/src/shell/ShowRecovery.tsx`). Snapshots
  expire after 24 h; a forged one, or one whose code is live again, is refused (`RESTORE_FAILED`). In
  production without `DASCADE_SAVE_SECRET` black boxes are off and keep-alive still works. The limit:
  if the presenter's laptop is lost at the same moment as the server, there's nothing to restore.

**Preflight** (OPS-03 B): crew with `preflight.read` ask `showdown:preflight` for the server's facts
(uptime, start time, `RENDER_GIT_COMMIT`, the loaded show, backups online, the station's heartbeat,
whether black boxes are on). `/api/health` stays as it is (it's Render's health check).

**Freeze** (OPS-04 B): `scripts/freeze.sh on|off|status` adds or removes a GitHub ruleset that blocks
merges and pushes to `main` (no bypass), and switches Render's auto-deploy (through the Render API
when `RENDER_API_KEY`/`RENDER_SERVICE_ID` are set, otherwise it prints the dashboard steps).

**Display profiles** (DSP-02 C): the `display` setting (`auto` default, `stream`, `projector`). `auto`
lets each screen pick: the stage window and the console preview are Stream-safe, a big-screen link is
Projector (unless `&display=stream`), anything else by size. The stage's fonts are pinned to the show,
not the presenter's theme.

## Roles and secrecy

- **Presenter = host, and never migrates.** `ShowdownRoom.canBecomeHost` only allows the presenter.
  The role moves only through:
  - the secret **presenter pass**, which the server sends to the presenter only. The console's
    _Copy presenter link_ gives `/room/<code>#presenter=<pass>`; the pass is in the fragment, so it
    never reaches server logs. A browser that held the pass also reclaims an empty presenter seat by
    itself.
  - an explicit **hand-over**.
  - **Become the presenter**, between shows only, if the presenter left for good. The previous
    presenter's custom rounds are discarded and the pass changes. Never from a big screen or a
    spectator.
  - In an event room: the producer's **Make … presenter** (`showdown:assign`), and the rules in "Event
    rooms" above (the pass rotates on every change; a link can't take the show from an online presenter).
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
  fast presenter can flip several before the board catches up), so a late one, e.g. _Reveal the rest_
  racing _Next round_, never flips a tile of the next board. Held keys don't auto-repeat commands.
  Score adjustments queue on the console (one in flight per revision), so quick +5 clicks all count.
  Undo restores the previous engine state, and the revision keeps rising.
- **Room size:** up to 100 seats, and the default is the limit, so everyone who joins plays. The
  presenter and each big screen take a seat too; anyone past the limit watches as a spectator. The
  load scenario passes with 61 and 100 clients.
- **Disconnects:** the seat is held for 180 s (`reconnectGraceSeconds`; 30 minutes for the presenter
  and the crew in an event room). If the presenter is gone for 10 minutes mid-show (30 in an event room), the show ends with the scores as they stand and the role is freed, so the room
  never stalls: anyone can _Become the presenter_ from the results screen or the lobby (the old pass
  still works until then).
- **Big screens never present:** a hand-over to a stage display is refused. A big-screen link opened in
  the presenter's own browser takes the presenter's seat (seats are per browser), so that tab shows a
  notice (use the stage window instead) rather than the console with the answers.
- Outcomes: `reportOutcome` places the winning team's members first and the other team second (one
  group for a tie, and always one group in a Presenter Showcase). The presenter and big screens aren't
  placed. A show ended before round 1 reports nothing. Stats extras: `calls` (answers called) and
  `bestCallPoints`.
- Guard tests (`apps/web/src/games/showdown/secrecy.test.ts`, `packages/game-core/src/showdown/content.test.ts`)
  fail if a web module imports the engine package, or if any event preset other than the practice
  boards carries rounds (ADM-01: no real show content in the repo).

## Architecture (where it lives)

Everything is new files, plus a few one-line registrations.

| Layer          | Files                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract       | `packages/shared/src/games/showdown.ts`: settings, messages, Zod payloads, views, `validateShowContent`, looks, pack metadata                                                                                                                                                                                                                                                              |
| Engine (pure)  | `packages/game-core/src/showdown/`: `engine.ts` (show state machine for both formats, `boardView`, `sheetView`), `guesses.ts` (audience guess book), `packs.ts` (44 built-in questions, server-only), `events.ts` (event preset rounds, server-only), tests                                                                                                                                |
| Server         | `apps/game-server/src/rooms/showdown/`: `ShowdownRoom.ts` (extends `BaseGameRoom`; also wrong answers, the clock, the sweep, cards and presets), `schema.ts`; tests in `apps/game-server/test/showdown.test.ts` and `showdown-showcase.test.ts`                                                                                                                                            |
| Client         | `apps/web/src/games/showdown/`: `ShowdownView.tsx` (routing by role, show feed, sounds, stage window portal), `Console.tsx`, `Audience.tsx`, `Stage.tsx`, `Board.tsx`, `Host.tsx`, `Decor.tsx`, `Lobby.tsx`, `ContentEditor.tsx`, `look.ts`, `sounds.ts`, `fx.ts`, `stageWindow.ts`, `access.ts`, `state.ts`, `showdown.css`                                                               |
| Floor          | `apps/web/src/arcade/scenes/showdown.ts` (attract scene)                                                                                                                                                                                                                                                                                                                                   |
| Presenter Tour | `apps/web/src/games/showdown/source.ts` (the show source the stage hooks read), `apps/web/src/games/showdown/tour/` (demo source, timeline, script, player, mock console, film), the `/tutorial/showdown` route in `apps/web/src/app/App.tsx`                                                                                                                                              |
| Tests          | `e2e/showdown.spec.ts`, `e2e/showdown-showcase.spec.ts`, `e2e/showdown-tour.spec.ts`, `e2e/showdown-cinema.spec.ts` (a video made in the browser at run time, never a file in the repo), `e2e/showdown-qr.spec.ts` (the QR checked module by module), `e2e/showdown-awards.spec.ts` (a photo drawn at run time), `scripts/load/showdown.ts` (scenarios `showdown` and `showdown-showcase`) |

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

Every sound is a procedural voice on the shared synth (`sounds.ts`); a few play Brian's recordings
instead (see _Recorded sounds_ below). They use the one AudioContext and the SFX bus, so mute, volume and
the jukebox dip all apply. Sounds include the clang (a struck plate;
a haunted bell in Halloween), the top-answer sparkle, the strike buzzer (ghostly in Halloween), steal
stings, the award, applause, the intro fanfare (an organ toccata with thunder in Halloween), drumroll,
aww, ding, suspense and the finale. The presenter can fire cues from the console.

Presenter Showcase adds a crescendo, all original:

- **A found answer:** the `correct` ding (Brian's `ding.mp3`) at 0 ms, then the `clang`, which lands at 320 ms
  (`FLIP_LAND_MS`) as the tile's 3D flip turns face up.
- **A sweep tile:** a lighter `clangLate`.
- **Board complete:** a `complete` flourish, then applause.
- **The special answer:** the `special` sting (about 3 s: a hit, a fanfare and a bell cascade), with
  Brian's applause coming in 250 ms later (`SPECIAL_CROWD_MS`). The presenter's **Celebrate!** cue plays
  the same pair (`cueSounds`). A special answer that also completes the board adds the flourish but no
  second applause.
- **Wrong:** a single 0.5 s `miss` buzzer. It stays clean when pressed several times.
- **Other cues:**
  - `opening`, about 6 s, for the start of the show;
  - `category`, the round's transition sting;
  - `sweepStart`, when Reveal remaining begins;
  - `rollIn`, the sweep's drumroll into the special tile: Brian's `drumroll.mp3`, whose cymbal lands
    as the server flips the tile 2.6 s after `suspense` (the 2.95 s procedural roll is the fallback);
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
back to the procedural voice. Only use audio you have the rights to (this repo is public). Mapped now
(sources and licences in that folder's README): `applause.mp3` (also the special answer's crowd and the
finale), `aww.mp3` (also Team Showdown's missed steal), `ding.mp3` (also `correct`), `drumroll.mp3`
(also `rollIn`), `suspense.mp3` and `pick-the-answer.mp3`.

## Testing

```bash
pnpm vitest run packages/game-core/src/showdown apps/game-server/test/showdown.test.ts
DASCADE_ONLY_GAMES=showdown PORT=2610 DASCADE_RELAXED_LIMITS=1 pnpm --filter @dascade/game-server dev
WEB_PORT=5190 VITE_SERVER_PORT=2610 pnpm --filter @dascade/web dev
E2E_BASE_URL=http://localhost:5190 pnpm exec playwright test e2e/showdown.spec.ts --project=chromium
LOAD_URL=http://localhost:2610 LOAD_SCENARIOS=showdown,showdown-showcase pnpm load
```

Manual walkthrough:

1. Open `/play/showdown` and _Create game_. You're the presenter. In _Your setup_, press
   **Open stage window** (allow pop-ups) and move the window to a second screen.
2. Join from a phone or a private window with the room code; you land on a team. Optionally open
   `/room/<code>?screen=1` on a third device for a big screen.
3. _Start game_. In the console, press _Start round 1_, then _Show the question_, then _Team Delta
   play_. Reveal answers by clicking the sheet or pressing `1`–`0`, and use `X` for strikes.
4. **Privacy check:** on the audience device, the board shows only numbers for hidden tiles. Searching
   the page or DevTools for an unrevealed answer finds nothing. Only the presenter's tab has the sheet.
5. **Sync check:** every reveal, strike and score change appears on all screens at once. Refresh any
   screen and it comes back to the same board.
6. To force a look, set it in the lobby settings, or use `?season=2026-10-15` / `?season=2026-11-15`
   with _Seasonal_.

## Scoring decisions (Brian, 2026-10-27)

From the Showdown Scoring Studio (<https://claude.ai/artifact/QtmwM4qoUUKqvQNDAT3eih>), for the
DAS-O-Ween show on 2026-10-29. Brian's picks, verbatim:

> 1. We like the Medal Ceremony idea, but it should be a toggle between Never, after each round, and at the end of the whole game
>    2 - called it - if they get position right (guess number 2 answer in the number 2 spot, etc) they get a bonus point as well. Anyone that guesses all of them in a row gets 20 bonus points
>
> 3 - how many in the list - first option is best, but it should be easy to make this a selection rather than just all or nothing. Make it a part of the setup process
> not on here - add the ability to choose a name to spotlight, whether they have gone already or not. Also, crew/producers should be able to be selected for spotlight as well, and it should be a choice if they are also in the running for random spotlight
>
> 4 - scorekeeper credits is the best answer presented here, however I don't really care if it's implemented right now. Make note that as far as formats go, phone and browser should always have function parity
> 5 - fair lap is the best choice, we would still like to have a toggle for it, something like "fair mode" vs "true random". Also want to be able to have presenter and crew to be able to manually re-include or exclude at will
>
> 6 - standings and a paced finale is the best option, however we would like "just the finale" to be a toggle as well
> 7 - hidden gems is a good idea, call-it pops is a good idea

His answers to the four open questions (one question round, 2026-10-27), each the recommended option:

1. **Perfect list (+20):** "Every answer, exact spot" — every answer on the board guessed, each in its
   exact numbered spot (possible only with 10 guesses per board).
2. **True random:** "Anyone, never twice in a row" — uniform over everyone in the draw; a finished turn
   doesn't take you out; never the same person twice in a row.
3. **Spotlight a name vs Skip me:** "Yes, Skip me = random only" — choosing by name works on anyone
   seated; Skip me only keeps you out of random draws (and stays private).
4. **DAS-O-Ween defaults:** "Recommended set" — Score the crowd on, 10 guesses, medals After each round,
   Standings + paced finale, Fair mode, crew not in the random draw, Hidden gems on, Called-it pops on.

**Standing rule — phone and browser parity (Brian):** every audience and crew feature works the same
on a phone and in a desktop browser tab: one component with a responsive layout, never a phone-only
path, and e2e covers both (chromium and mobile).

**Later (noted, not built):** _Scorekeeper credits_ — a crew member credits answers given in the
meeting chat or out loud to the person who gave them (studio decision 4, Brian's preferred approach,
deferred). Also not chosen: Pumpkin patch, Double final round, First-caller star, the Awards show.

## Known limitations / next steps

- Most stingers are still procedural (the clang, the buzzers, the fanfares); the crowd, the ding, the
  drumroll, suspense and Pick the Answer are recordings, and the hook takes more (above).
- No Fast Money / bonus round, and no buzzer race for the face-off (the presenter judges it).
- The join hint shows the short URL and code. A QR code would need an encoder (not added: no new
  dependency).
- Audience guesses are text-matched. The packs carry common spellings, and custom rounds can add
  their own.
- The stage window needs pop-ups allowed. Without them, use the big-screen link.
- Not tournament-capable (team format) and not rated.

### To revisit: leaving a show

For the DAS-O-Ween show (Brian, 2026-10-27), Survey Showdown's main screens hide every way back to
the arcade: the top bar's Leave, the lobby bar's Leave (bottom left), the results' _Back to cabinet_
and _Leave_, and the Leave in the big screen's and the crew screen's corners. The invite's join card
(`/room/<code>` without a saved name) drops its _Arcade_ button and centres _Join game_. One list
switches all of it: `NO_ARCADE_EXIT` in `apps/web/src/shell/arcadeExit.ts`.

Still there on purpose, so nobody is stuck on a room that's gone: the reconnecting card's Leave, the
connection-lost and error screens' _Back to arcade_, the join card for a dead code, the event join
link's "This show isn't open right now" card, and the browser's Back. The cabinet page
(`/play/showdown`), where the presenter creates the room, isn't inside a show and keeps its way back.

To decide later: how guests, crew and big screens should leave a show (an end-of-show "You can close
this tab" card, a Leave only after the finale, a presenter-only exit, or Leave back for everyone), and
whether the error screens should send guests to the event's join link instead of the arcade.

## Removing the feature

1. Delete `apps/web/src/games/showdown/`, `apps/game-server/src/rooms/showdown/`,
   `packages/game-core/src/showdown/`, `packages/shared/src/games/showdown.ts`,
   `apps/game-server/test/showdown.test.ts`, `apps/game-server/test/showdown-showcase.test.ts`,
   `e2e/showdown.spec.ts`, `e2e/showdown-showcase.spec.ts`, `e2e/showdown-tour.spec.ts`, `scripts/load/showdown.ts`,
   `apps/web/src/arcade/scenes/showdown.ts`, `docs/DAS-O-WEEN-RUNBOOK.md` and this file.
2. Remove the one-line registrations: `'showdown'` in `GAME_IDS` and its `GAME_CATALOG` entry
   (`packages/shared/src/catalog.ts`); `g('showdown')` and the tagline/description wording in the
   DAStravaganza cabinet (`cabinets.ts`); `ROOM_LOADERS` (`apps/game-server/src/rooms/registry.ts`);
   `GAME_MODULES` (`apps/web/src/games/registry.ts`); the `/tutorial/showdown` route
   (`apps/web/src/app/App.tsx`); the scene in `apps/web/src/arcade/attract.ts`;
   `showdown` in `scripts/load/index.ts`; the two stat labels and `STAT_GAME_DISPLAY.showdown`
   (`packages/shared/src/stats.ts`); and the README/CLAUDE.md lines (game count 26 → 25).

If the branch is never merged, deleting the branch is enough.
