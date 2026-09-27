# DAS Putt — design notes

Multiplayer neon mini golf on an original nine-hole course ("Neon Nine"). 1–12 players, solo practice,
spectators, Tournament Center matches.

| Piece | Path |
|---|---|
| Contract (settings, messages, views, labels) | `packages/shared/src/games/putt.ts` |
| Engine: course data, validation, physics, match rules, wire path, solver | `packages/game-core/src/putt/` |
| Room | `apps/game-server/src/rooms/putt/` |
| Client (canvas renderer, controller, HUD) | `apps/web/src/games/putt/` |
| Tests | `packages/game-core/src/putt/*.test.ts`, `apps/game-server/test/putt.test.ts`, `e2e/putt.spec.ts` |

## Rules and decisions

- **Modes.** *Classic* (`turns`): stroke play, one stroke at a time, rotating through the golfers still
  on the hole. *Party* (`ghost`): everyone putts whenever their own ball is at rest. Balls never collide
  in either mode: a putt is always yours alone, and the result never depends on message order.
- **Holes.** Full course (1–9), front three (1–3), back three (7–9) or one practice hole.
- **Penalties.** Water or off the edge (the void) costs +1 stroke and the ball goes back to where it
  was struck from.
- **Stroke limit.** The limit is par + `maxOverPar` (default 4). When you reach it, your ball is picked up and
  the hole scores the limit. A penalty can't push a score past the limit. Players can also concede a hole
  ("Pick up").
- **No stalling.** Every turn has a shot clock (20–60 s, default 30). A timeout costs a stroke, and a
  second timeout in a row on the same hole picks the ball up. While a golfer is disconnected (still in
  their reconnect grace) their clock drops to 10 s. Once the grace expires they're "away" and picked up
  on each hole until they come back. Players who leave retire: they're skipped from then on and
  ranked last. Solo practice has no clock because nobody is waiting.
- **Honour.** The best score on a hole tees off first on the next one. Ties keep the previous order.
- **Standings.** The lowest total wins, and equal totals share a place. `reportOutcome` sends
  `lowerIsBetter: true`, `scores` = totals, and `details.playerStats` (`holesInOne`, `birdies`,
  `minCourseStrokes` for full rounds).
- **Tournament matches.** The format is fixed: turns, full course, 45 s clock, par + 4. Lobby settings
  are ignored. The `first` side tees off first. If the match is tied after nine holes, sudden-death
  playoff holes (9, then 6, then 1) are played between the tied leaders. If they're still tied after
  that, the match is reported as a draw (the catalog declares `draws: true`). If one side leaves, the
  other wins at once by forfeit.

## Server authority and networking

- The client sends only `putt:stroke {angle, power, at}`. `angle` is an integer in hundredths of a
  degree, `power` is per-mille (15–1000), and `at` is the release moment on the synced clock.
  Everything is Zod-bounded and rate-limited. Phase, turn, rolling ball, spectator and retired status
  are all checked.
- **Launch timing / lag compensation.** The ball starts rolling 150 ms after the release moment on the
  server clock (`PUTT_LAUNCH_DELAY_MS`). A reported `at` is honoured only if it falls within the last
  400 ms, and the start is clamped to `[now+20, now+300]`. Everyone's animation, and the moving
  obstacles, therefore run on one shared clock. A forged `at` gains nothing a well-timed click couldn't.
- The server simulates the whole roll and broadcasts `putt:shot`. The payload carries the path
  (0.1-unit, delta-encoded positions at 60 Hz), path events, the result, the lie and the strokes.
  The schema publishes the lie, strokes, holed status and penalties **when the ball comes to rest on
  screen**, so the scoreboard never spoils a roll. A client that joins or reconnects mid-roll gets the
  rolling shots through `putt:replay` (sent by `syncPrivate`). Golf has no hidden information, so there
  is no private channel.
- `putt:aim` relays the active golfer's live aim to everyone else (throttled), so spectators can watch
  a player line up a putt.

## Physics (deterministic, `physics.ts`)

- Fixed 120 Hz step. Constant rolling friction plus light linear drag. Swept (continuous) collisions
  against capsule cushions and round posts/bumpers, so the ball never tunnels. Depenetration pushes
  the ball out when moving blades sweep into it.
- Restitution: cushions 0.74, bank cushions 0.82, kickers 1.22, posts 0.55. Pop bumpers return the
  ball with extra speed (`−vn·1.05 + 250`, capped).
- Slopes apply constant acceleration. A slope steeper than friction rolls a resting ball; a gentler one
  only curls rolling balls, which is how hole 3's green "breaks". Sand has about 4.6× the friction and
  heavy drag.
- **Cup.** A ball rolling over the cup is pulled toward its centre. It drops in only if it's slow
  enough, and the threshold shrinks toward the lip. Fast or off-centre balls lip out; a `lip` event
  tells the client to show "Lip out!".
- **Portals** are one-way. The ball keeps 88 % of its speed and leaves at a minimum exit speed along the
  exit direction.
- **Moving obstacles** (windmill arms, a sliding sweeper) are pure functions of the hole clock. A ball
  can never come to rest inside their sweep. The simulation is capped at 25 s.
- **Determinism.** Only `+ − × ÷`, `Math.sqrt/floor/round/abs/min/max` are used; `dsin`/`dcos` are a
  fixed Taylor polynomial. The client runs the same code for the trajectory preview. The preview is
  deliberately limited: it stops at the first bounce (plus a short stub), is capped at 330 units, and
  never shows the ball entering the cup.

## Course

Holes are plain data (`course.ts`), validated by `HoleDefSchema` plus `validateHole()`. The validator
checks that the tee, cup and portal exits sit on clear turf, that polygons are simple, and that nothing
sits inside a wall or a moving obstacle's sweep. The mechanics escalate across the course:

1 straight runway · 2 dog-leg with a 45° bank · 3 uphill ramp and a breaking green · 4 sand traps ·
5 rail-less bridge over a canal · 6 windmill turnstile · 7 pop bumpers and kickers · 8 two sealed rooms
joined by wormholes (A, B and a trap C) · 9 finale: sliding gate, ramp, pond edge, wormhole shortcut and bumpers.

Tests prove every hole can be solved within par (`solver.ts`: a flow field plus beam search) and that a
max-power smash straight at the cup is never a hole in one. To add a hole, append a definition and run
`pnpm vitest run packages/game-core/src/putt`.

## Client

- `game/controller.ts` animates the server paths on the shared clock and fires sounds, particles and
  callouts as the ball reaches each event. It turns input into intents: drag back anywhere (slingshot;
  drag back to the start to cancel), `← →`/`↑ ↓`/`Space` (Shift for fine steps), or the dock buttons
  and slider. Per-frame data stays out of React.
- `game/renderer.ts` is a Canvas 2D renderer with a cached static layer and a live layer. The 2.5D
  extrusion is projected by hand, so it always points down the screen. On portrait phones a landscape
  hole rotates 90° when that draws it at least 15 % larger. The camera fits the hole into the space left
  by the HUD, choosing the best of several inset layouts.
- It honours `fx` (glow, dither, particles, trails, DPR cap) and `reducedMotion` (no waving flag, no
  sliding chevrons, no pulses, fade-only callouts).
