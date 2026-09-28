# DASphalt GP — kart engine

The engine is `packages/game-core/src/kart/` (`@dascade/game-core/kart`): pure, deterministic TypeScript shared by
the server room (authoritative sim), the web client (prediction, `groundAt`, hazard poses) and the renderer (track
geometry). It follows DASh Circuit's proven model (credit-bank inputs, float32-exact state, binary snapshots, client
replay), extended to 3D, items and 30 karts. The full API is in `.scratch/kart/API.md` and the `index.ts` TSDoc.

## Engine overview

| file                        | what                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `trackdef.ts`               | the authoring format (`KartTrackDef`) — pure data                                                           |
| `track.ts`                  | `buildTrack` (validation + sampled geometry), `locate`/`groundAt` projection, `hazardPose`, racing line     |
| `spec.ts`                   | racer stats → physics (`racerSpec`, `BALANCE`)                                                              |
| `kart.ts`                   | `stepKart` physics (drive, drift, boosts, air, walls, falls, hazards, self-affecting item uses), `applyHit` |
| `itemcodes.ts` / `items.ts` | item wire codes; distribution + rolls; live entities (pucks, seekers, mines, puddles)                       |
| `progress.ts`               | gates, laps, wrong-way, rank distance (anti-cheat)                                                          |
| `collide.ts`                | kart–kart bumps (weight-scaled)                                                                             |
| `sim.ts`                    | `KartSim`: the 60 Hz race (credit bank, bots, items, boxes, bumps, standings, finish/DNF)                   |
| `snapshot.ts`               | `kart:snap` (display, broadcast) and `kart:own` (exact state, per racer) codecs                             |
| `predictor.ts`              | `KartPredictor`: local-kart prediction + replay                                                             |
| `ghost.ts`                  | time-trial ghost traces (10 Hz, quantized, validated)                                                       |
| `bot.ts`                    | `KartBot`: computer racers through the normal input path                                                    |
| `tracks/`                   | the eight `KartTrackDef`s + `KART_TRACK_DEFS`                                                               |
| `lab/`                      | headless tools: feel lab, balance, bot survey, track probe (not shipped code paths)                         |

**Determinism.** Everything the client also runs uses only `+ − × ÷`, `Math.sqrt` and exact rounding; trig comes
from `../detmath`. State is quantized every tick to its wire form (x/y float32, z 1/128, velocities 1/256, yaw rate
1/1024, heading 1/65536 turn), so a client replaying from `kart:own` reproduces the server bit for bit.
`determinism.test.ts` forbids `Math.sin/cos/atan2/hypot/pow/exp…` in the shared sources and replays seeded races
under perturbed `Math.*`.

**Feel.** Written down in `kart.ts` (header) and pinned by `kart.test.ts`. In short: velocity turns ~75 % with the
nose and realigns at the grip rate (planted, 1–3° of slip); steering authority peaks at mid speed and eases off at
top speed (handling), capped by a grip-stat lateral limit; hop-drift is kinematic (steer picks the arc: inside ≈ 11 u,
neutral ≈ 15 u, outside ≈ 60 u; the body holds 12–25° inside the arc) and charges by how much the kart actually turns
(~47° of path rotation for stage 1, ~100° stage 2, ~170° stage 3 — 0.6/1.3/2.2 s on a neutral arc), so snaking down
a straight earns nothing and a drift never exceeds grip top speed; mini-turbos kick +6/+8/+9 u/s; walls bounce at
35 %, keep ≥ 40 % of the speed along the wall on a non-head-on hit, swing the nose along it over a few ticks
(≤ 6 rad/s) and ignore steering back into it for 0.25 s; falls respawn in 1.2 s with immunity; item hits are a 1 s
spin that exits at ~30 % speed (~1.05–1.35 s lost, by Accel), hazard hits a 0.5 s stumble (~0.45–0.6 s lost), each
followed by immunity. Start: throttle held for 3–60 of your own applied frames before GO → boost (~+0.4 s; more for
slow-accelerating racers), longer → a short wheelspin (~−0.15 s).

**Stats** (`spec.ts`, `BALANCE`; stat 3 = nova everywhere): Speed → top speed (4 % spread Speed 2 → 5); Accel →
thrust (0 → 95 % in ~2.1 s … ~4.1 s) and so recovery from every hit, bump and wall; Handling → yaw rate, drift
tightness and charge speed; Grip → the lateral limit and steering authority at speed, off-road, ice; Weight → bump
mass. Tuned against 8-kart hard-bot pack races over every track (`lab/pack.ts`): 512 races with and without items
give mean places 4.14–4.89 and win rates 9–16 % per racer; `balance.test.ts` pins a seeded 64-race subset and the
per-stat lap value (`lab/statvalue.ts`: speed ~4.3 %, handling ~2.6 %, grip ~1.9 %, accel ~0.9 % solo, stat 1 → 5).

Feel lab: `pnpm exec tsx packages/game-core/src/kart/lab/run.ts` prints the handling numbers (speed curves, yaw,
slip, turn/drift radius per steer, stage timing, mini-turbo gains, wall hits, hop).

## Track format and adding a track

A track is a `KartTrackDef` (see `trackdef.ts` for every field): a closed ring of control points `[x, y, z?, halfWidth?]`
(travel direction = point order, `points[0]` on the start line), road half-width, shoulder, off-road material, edge
kind (wall/drop) with per-span overrides, and features placed at lap fractions `at`/`from`/`to` ∈ [0, 1) with lateral
offsets `d` (+ = left): surface zones (ice/mud/conveyor), boost pads, ramps (+ gaps to jump), item rows, hazards
(bumper/stomper/sweeper/roller/laser, motion = pure function of the tick), branches (road or dirt shortcuts that
leave at `from` and rejoin at `to`; progress maps linearly onto the span), landmarks (render-only), `decorSeed`,
`parLapMs`.

To add one: add the id to `KART_TRACK_IDS`/`KART_TRACKS` in `packages/shared/src/games/kart.ts`, write
`packages/game-core/src/kart/tracks/<id>.ts` exporting the def (tip: `tracks/path.ts` `turtle([...])` lays out
straights and exact-radius arcs and closes the loop; `pieceFrac(path, piece, t)` places features — see
pixel-plaza.ts), register it in `tracks/index.ts`, then run
`pnpm exec tsx packages/game-core/src/kart/lab/probe.ts` (lengths, gates, the lap fraction of every control point)
and the tests. `buildTrack` throws a `KartTrackError` naming the problem: self-intersection or overlapping roads
(unless one passes ≥ 6 u above), curves too tight for the road width, slopes steeper than 0.4, features off the road,
branches that don't leave/rejoin cleanly, ramps whose flight leaves the road, gaps without a ramp or too long to
jump, grid overlapping a gap/branch. `bots.test.ts` checks that hard bots finish every track near `parLapMs`
(par = the hard bot's best clean solo lap — nova, no items, no hazard hit or fall in that lap:
`pnpm exec tsx packages/game-core/src/kart/lab/pars.ts [id…]`; a hard bot's median lap sits within ~1 % of it).
Landmarks must sit clear of the road unless floating (`blimp`, `hot-air-balloon`, `z ≥ 8`) or spanning (`arch`,
`mesa-arch` centred on it).

## Adding an item

1. Append the id to `KART_ITEM_IDS` + `KART_ITEMS` (shared contract; ids are wire codes, append only — the snapshot
   item nibble holds codes 0–15).
2. Give it weights in `ANCHORS` (`items.ts`) for the front/mid/back tables (tests check the sums and the fairness
   rules: no rare items for the front quarter, seeker/magnet never for the leader).
3. Its use: self-affecting effects (a boost, a state timer) go in `stepKart`'s item block (`kart.ts`) so the
   predictor sees them instantly; anything that touches others goes in `ItemWorld.use` (spawn an entity or apply
   hits) and, for entities, `ItemWorld.step` (movement + collision). Trailable items are listed in `TRAILABLE_ITEMS`.
4. Hits go through `applyHit` (spin/slick): shields, trailing blocks, immunity and the no-stun-lock rule for free.
5. Add the entity kind to `ENTITY_KINDS` (snapshot) if it spawns one, and tests in `items.test.ts`.

## Networking model

- **Inputs.** Clients send `kart:input` `{seq, inputs[1..8]}` (18-bit packed frames, `packKartInput`), 2 frames per
  packet. `KartSim.pushInputs` queues frames (duplicates/old/malformed ignored; a seq jump > 600 re-anchors).
- **Credit bank.** Every tick adds one credit (cap 10); a kart consumes one queued frame per credit, up to 2–3 per
  tick when the queue backs up (max 12, trimmed to 4 and acked). A client can never run faster than real time.
  No input for 12 ticks (or disconnected) → the kart coasts on a neutral input; disconnected for 2 s → a
  non-colliding ghost; if only long-gone racers remain the race ends.
- **Snapshots.** Every 3 ticks: `kart:snap` = `sim.encodeSnapshot()` broadcast (header with raceId/tick/goTick/status,
  item-box bitset, 20 B display record per kart, 15 B per entity ≈ 0.65 KB at 30 karts) and `kart:own` =
  `sim.encodeOwn(slot)` sent to each racer (60 B: exact `KartState` + last applied seq).
- **Prediction.** The client runs `KartPredictor.step()` at 60 Hz for its own kart (same `stepKart`, quantized
  inputs) and on each `kart:own` calls `reconcile(state, ack, tick, racing, goSeq)`: rewind to the server state, drop
  acked frames, replay the rest. Frames are locked on the grid by frame (`nextFrameLocked(goTick)`: the server applies
  frame f at ≈ f + input delay), and the lights are timed by `framesToGo`, so the start boost the player sees is the one
  the server gives at any latency (tested at 0/100/200 ms). Uninterrupted, corrections are exactly 0 (`netcode.test.ts`); items rolled on the server
  and hits from others arrive as small corrections the client smooths. Other karts are interpolated from `kart:snap`.
- **Authority.** Positions, gates, laps, finish order, race time, item rolls, item hits and box pickups are decided by
  the sim only; clients only ever send inputs.

## Testing

```sh
pnpm vitest run packages/game-core/src/kart          # all engine tests (~170, ~15 s)
pnpm vitest run packages/game-core/src/kart/kart.test.ts   # physics + feel targets
pnpm exec tsx packages/game-core/src/kart/lab/run.ts        # feel lab report
pnpm exec tsx packages/game-core/src/kart/lab/bots.ts hard  # every track: finishes, lap vs par, items, hazards
pnpm exec tsx packages/game-core/src/kart/lab/balance-report.ts   # per-racer lap spread
pnpm exec tsx packages/game-core/src/kart/lab/race.ts pixel-plaza normal 30   # one headless race + perf
pnpm exec tsx packages/game-core/src/kart/lab/tiers.ts        # solo lap per bot skill vs par
pnpm exec tsx packages/game-core/src/kart/lab/aborts.ts hard  # drift quality (aborted hops)
pnpm exec tsx packages/game-core/src/kart/lab/hazards.ts      # hazard hits/lap: line follower vs bots
pnpm exec tsx packages/game-core/src/kart/lab/pack.ts 16      # 8-kart pack balance (mean place, wins)
pnpm exec tsx packages/game-core/src/kart/lab/packsearch.ts '{"accelPerAccel":[3,3.5]}' 16 [firstSeed]  # BALANCE grid, pack races
pnpm exec tsx packages/game-core/src/kart/lab/solotune.ts --eval  # solo pace spread per racer (deterministic)
pnpm exec tsx packages/game-core/src/kart/lab/statvalue.ts --curve  # lap value of each stat point
pnpm exec tsx packages/game-core/src/kart/lab/pars.ts        # par = best clean hard-bot lap, hard mean/median vs par
pnpm exec tsx packages/game-core/src/kart/lab/shortcuts.ts    # shortcut value with / without a turbo
pnpm exec tsx packages/game-core/src/kart/lab/start.ts        # start boost / wheelspin cost
pnpm exec tsx packages/game-core/src/kart/lab/hits.ts         # spin / stumble cost per racer
pnpm --filter @dascade/game-core typecheck && pnpm lint
```

Suites: `track` (geometry, projection, branches, hazards, validation), `kart` (physics/feel), `items`
(distribution, every item, boxes, caps), `sim` (progress/anti-cheat, credit bank, races, bumps, shortcuts),
`netcode` (snapshot/own codecs, predictor exactness, ghosts), `determinism`, `bots` (all tracks), `balance`, `perf`.
