# DASphalt GP — engineer's guide

DASphalt GP (game id `kart`) is a 3D kart racer in the racing cabinet (`circuit`, "DAS Raceway", next to DASh Circuit):
1–30 racers (humans + bots; 40 clients with spectators), eight racers, eleven items, eight tracks in two cups, single
races, Grand Prix and solo time trial with a personal-best ghost. It follows DASh Circuit's proven model (credit-bank
inputs, float32-exact state, binary snapshots, client replay), extended to 3D, items and 30 karts. Read
[`GAME_GUIDE.md`](GAME_GUIDE.md) first; this guide covers what is specific to the kart racer. The engine API reference
is the TSDoc in `packages/game-core/src/kart/index.ts` and each file's header.

## 1. Where everything lives

| Area             | Path                                                                        | What                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract         | `packages/shared/src/games/kart.ts`                                         | Ids + metadata (tracks, cups, racers, bodies, paints, items), settings schema, `KART_SIM` timing, `KART_MSG`, 19-bit input packing, `KartEvent`, public state views, local doc keys |
| Engine           | `packages/game-core/src/kart/` (`@dascade/game-core/kart`)                  | Pure and deterministic; shared by the server (authoritative sim), the client (prediction, `groundAt`, hazard poses) and the renderer (track geometry)                               |
| Server           | `apps/game-server/src/rooms/kart/`                                          | `KartRoom.ts` (flow, 60 Hz loop, GP, pause, outcomes, test hooks), `KartState.ts` (schema), `diagnostics.ts` (`TickStats`, `kart:diag`), `testPlacement.ts`                         |
| Server tests     | `apps/game-server/test/kart*.test.ts`                                       | `kart.test.ts`, `kart-adversarial.test.ts`, `kart-prewarm.test.ts`; helpers in `kart-helpers.ts`                                                                                    |
| Client           | `apps/web/src/games/kart/`                                                  | Module `index.tsx` (immersive, own countdown, `lobbyStartTab: 'setup'`, music mood `race`)                                                                                          |
| Attract scene    | `apps/web/src/arcade/scenes/kart.ts`                                        | In the `circuit` cabinet's playlist                                                                                                                                                 |
| E2E, load, tools | `e2e/kart.spec.ts`, `scripts/load-kart.ts`, `scripts/kart-track-preview.ts` | See §5 and §10                                                                                                                                                                      |

Engine files:

| File                        | What                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `trackdef.ts`               | The authoring format (`KartTrackDef`): pure data                                                                          |
| `track.ts`                  | `buildTrack` (validation + sampled geometry), `locate`/`groundAt`, `pointAtS`, `hazardPose`, racing line, landmark rules  |
| `tracks/`                   | The eight defs, `KART_TRACK_DEFS` (`index.ts`), the `turtle`/`pieceFrac` authoring helper (`path.ts`)                     |
| `spec.ts`                   | Racer stats → physics (`racerSpec`, `BALANCE`)                                                                            |
| `kart.ts`                   | `stepKart` physics (drive, drift, boosts, air, walls, falls, hazards, self-affecting item uses), `applyHit`, `PHYS`       |
| `itemcodes.ts`, `items.ts`  | Item wire codes, `TRAILABLE_ITEMS`, aim rules; distribution, rolls, `ItemWorld` entities (pucks, seekers, mines, puddles) |
| `progress.ts`, `collide.ts` | Gates, laps, wrong-way, validated rank distance; kart–kart bumps (weight-scaled)                                          |
| `sim.ts`                    | `KartSim`: the 60 Hz race (credit bank, bots, items, boxes, bumps, standings, finish/DNF)                                 |
| `snapshot.ts`               | `kart:snap` and `kart:own` codecs (byte layout in its header)                                                             |
| `predictor.ts`              | `KartPredictor`: local-kart prediction + replay                                                                           |
| `ghost.ts`                  | Time-trial ghosts (10 Hz, quantized, bounded, strictly validated)                                                         |
| `bot.ts`                    | `KartBot`: computer racers through the normal input path                                                                  |
| `math.ts`                   | Quantization (`f32`, `qheading`…) and helpers; trig comes from `../detmath`                                               |
| `lab/`                      | Headless tuning tools (§9); never on a shipped code path                                                                  |

Client folders: `race/controller.ts` (the glue between session, netcode, input, HUD, audio and renderer) and
`race/flatView.ts` (the top-down fallback when WebGL or the renderer chunk is unavailable); `RaceStage.tsx` (renderer
lifecycle, loading card, overlays); `net/` (`netClient.ts` prediction and interpolation, `interp.ts` clock, buffers and
smoother, `outbox.ts` sequencing, `netSim.ts` debug conditioner); `input/input.ts` (keyboard, gamepad, touch →
`KartInput`); `hud/` (`Hud.tsx`, `bridge.ts` for DOM writes without React, `minimap.ts`, `TouchControls.tsx`,
`PauseMenu.tsx`, `NetDebug.tsx`); `lobby/` (`PlayerSetup`, `Showroom`, `SettingsPanel`, `Portrait`, `TrackThumb`);
`results/` (`Results`, `GpIntermission`, `order.ts`); `audio/` (`engine.ts`, `sounds.ts`); `render/` (the three.js
renderer); `art/` (models, palette, icons, portraits); `docs.ts` (look, personal bests and ghost documents, validated on
read); `prewarm.ts`; `trackInfo.ts`; `core.ts`.

**three.js** is imported only under `apps/web/src/games/kart/`, so it loads with the game's lazy chunk; the renderer is
a further lazy chunk that the lobby prewarms in idle time (`prewarm.ts`).

**Conventions.** World units `u` (≈ 1 m; a kart is about 2 × 1.4). Ground plane `(x, y)`, `z` up; three.js mapping
`three(x, y, z) = (x, z, -y)`. `heading` 0 = +x, positive = turning left (CCW from above). Lateral offset `d` > 0 = left
of travel. Positions in track defs are lap fractions in [0, 1) from `points[0]` (the start line). Fixed 60 Hz
(`KART_DT`); state timers count ticks.

## 2. Determinism and feel

Everything the client also runs (physics, `groundAt`, `hazardPose`, the track build) uses only `+ − × ÷`, `Math.sqrt`
and exact rounding; trig comes from `../detmath`. State is quantized every tick to its wire form (x/y float32, z 1/128,
velocities 1/256, yaw rate 1/1024, heading 1/65536 turn), so a client replaying from `kart:own` reproduces the server
bit for bit. `determinism.test.ts` forbids `Math.sin/cos/atan2/hypot/pow/exp…` in the shared sources and replays seeded
races under perturbed `Math.*`. Rendering code may use plain `Math`.

The handling model is written down in the `kart.ts` header and pinned by `kart.test.ts`; `lab/run.ts` prints the
numbers. In short: velocity turns ~75 % with the nose and realigns at the grip rate (planted, 1–3° of slip); steering
authority peaks at mid speed and eases off at top speed, capped by a grip-stat lateral limit. The hop-drift is
kinematic (steer picks the arc: inside ≈ 11 u, neutral ≈ 15 u, outside ≈ 60 u) and charges by how much the kart
actually turns (~47°/100°/170° for stages 1/2/3), so snaking down a straight earns nothing and a drift never exceeds
grip top speed; mini-turbos add +6/+8/+9 u/s. Boosts ignore off-road. Walls bounce at 35 %, keep ≥ 40 % of the speed
along the wall on a non-head-on hit, swing the nose along it (≤ 6 rad/s) and ignore steering back into it for 0.25 s.
Falls respawn in 1.2 s with immunity. Item hits are a 1 s spin exiting at ~30 % speed (~1.05–1.35 s lost, by Accel),
hazard hits a 0.5 s stumble (~0.45–0.6 s lost), each followed by immunity. Start: throttle held for 3–60 of your own
applied frames before GO → a boost (~+0.4 s); held longer → a short wheelspin (~−0.15 s).

## 3. Networking model

- **Inputs.** Clients send `kart:input` `{ seq, inputs[1..8] }` (packed frames, `packKartInput`; bit 18 `ahead` is
  optional, so 18-bit frames still decode), two frames per packet. The handler is silent, players only,
  COUNTDOWN/PLAYING, rate `KART_INPUT_RATE` (burst 45, 40/s) and `maxNodes: KART_SIM.maxInputsPerPacket + 8`.
  `KartSim.pushInputs` drops duplicate, stale and malformed frames; a seq jump more than 600 ahead re-anchors, and the
  room also re-anchors a packet more than 600 behind (a fresh predictor or a reload restarted at seq 1). Clients may
  restart `seq` at 1 every race.
- **Credit bank** (`KART_SIM_LIMITS`). Every tick adds one credit (cap 10); a kart consumes one queued frame per credit,
  2–3 per tick when the queue backs up (queue max 12, trimmed to 4). A client can never run faster than real time. No
  input for 12 ticks (or disconnected) → the kart coasts on a neutral input; disconnected for 2 s → a non-colliding
  ghost; if the only humans still racing have been gone for 5 s, the race ends.
- **`kart:snap`** (broadcast to everyone, spectators included): every 3 ticks = 20 Hz at every grid size, plus once when
  the grid is built and once when the race is decided. A 20 B header (raceId, tick, goTick, raceMs, status), the item-box
  bitset, a 20 B display record per kart (pose, velocity, yaw rate, 16 flag bits, drift, item nibble) and 15 B per
  entity: about 0.62 KB at 30 karts.
- **`kart:own`** (`sendTo` each connected human racer on the same tick): 64 B = raceId, tick, slot, ack (last applied
  seq), the exact 48 B `KartState` and `goSeq` (the first frame applied after GO). Bots and spectators get none.
- **Ordering.** At every race start (each GP round included) the room calls `broadcastPatch()` before the first snap,
  so `state.race.trackId` and `racers` are current when the first `kart:own` arrives. Key everything on the 16-bit
  `raceId`.
- **Schema and events.** Positions and laps sync at 5 Hz (immediately on lap/finish/DNF), `distance` at 2 Hz.
  `kart:event` (`KartEvent`) is broadcast, except `item` and `final-lap`, which go only to that racer. `go` is sent when
  the room's countdown ends; the sim's own GO tick is `goTick` in the snapshot (lights and start boost use that).
- **Prediction** (`KartNet` in `net/netClient.ts`). The local kart steps at 60 Hz with `KartPredictor.step()`
  (quantized input, the shared `stepKart`); `InputOutbox` batches the frames. Each `kart:own` calls
  `reconcile(state, ack, tick, racing, goSeq)`: adopt the server state, drop acked frames, replay the rest. The first own
  state of a race, or one more than 300 frames behind the prediction, is adopted outright. On the grid, frames are locked
  with `nextFrameLocked(goTick)` (exact once `goSeq` is known) and the lights are timed by `framesToGo` (`startToGoMs()`),
  so the start boost the player sees is the one the server gives at any latency (tested at 0/100/200 ms). Uninterrupted,
  corrections are exactly 0 (`netcode.test.ts`); server item rolls, other karts' hits and bumps arrive as small
  corrections. No snapshot for 500 ms → input packets are held.
- **Error smoother** (`ErrorSmoother`). The visual difference of a correction goes into an offset that decays at 12/s
  (~150 ms); errors over 12 u or 1.4 rad snap (respawns). A predicted tick that turns the nose more than 0.5 rad (a hard
  wall redirect) glides the visual heading instead (~80 ms).
- **Interpolation.** `SnapshotClock` tracks `arrival − tick·tickMs` (windowed minimum = fastest path, spread = jitter)
  and renders other karts `clamp(1.5·interval + jitter + 10, 60, 320)` ms in the past (~100 ms on a good link).
  `InterpBuffer` Hermite-interpolates poses, extrapolates at most 8 ticks then holds, snaps on jumps over 40 u, and takes
  discrete data (flags, item) from the nearer sample. Entities lerp between their last two samples.
- **Authority.** Positions, gates, laps, finish order, race time, item rolls, hits and box pickups are decided by the
  sim; clients only send inputs, looks and host commands.
- **Wire changes.** Changing a record means bumping `KART_SNAPSHOT_VERSION` / `KART_OWN_VERSION` and the byte counts
  (`SNAP_KART`, `STATE_BYTES`, `OWN_BYTES`). A client and a server on different formats reject each other's records and
  the client silently falls back to interpolation: the F3 overlay shows "Own states / predicting" with the rejection
  reason, and the E2E asserts `__KART__.controller.net.predicting`. All 16 `KartFlag` bits are in use.

## 4. Room flow

| Phase        | What happens                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LOBBY        | `kart:look` (racer, body, paint) and host settings; `race.status = 'idle'`, `race.*` previews the settings. Solo rooms open here too (no auto-start): every mode is available and Start is one click.                                |
| COUNTDOWN    | 4 s (`KART_SIM.countdownMs`). The grid is built at its start (`setupRace`): racers, `race.status = 'grid'`, `race.goAt` (server epoch ms), `sim.startCountdown(ticks)`. Snapshots flow and inputs are consumed (start-boost timing). |
| PLAYING      | The race (see the finish rules). When it is decided: `race.status = 'done'`, a final snapshot, a 3.5 s cool-down.                                                                                                                    |
| INTERMISSION | Grand Prix only, between races: `racers` = the race just run, `gp` = standings, a 15 s automatic advance; the host's `kart:next` starts the next race now. Queued spectators are seated for the next race.                           |
| RESULTS      | End of a race, a time trial or the whole cup. The host's `kart:next` is a rematch with the same settings (a new cup in GP); the shell's Play again works as usual.                                                                   |

- **Settings** are editable in LOBBY/RESULTS only and frozen for the match when the countdown starts; `kart:look` is
  accepted in LOBBY/RESULTS only, so a racer is chosen for the whole cup. Time trial is solo only (a multiplayer room
  switches back to `race` with a toast): no items, no bots, and you start with a Turbo Trio. A tournament match would
  always be a plain race without bots (kart isn't offered in tournaments today).
- **Grid.** Seated humans who aren't away (max 30) plus `min(settings.bots, 11, free slots)` bots (ids `bot:<n>`;
  racers nobody picked come first, repeats are numbered), shuffled. From GP round 2 the grid is in reverse points order.
- **Finish window.** The first **human** across the line opens it: `race.finishDeadline = now + finishWindowSec`
  (computer racers never open it). The race ends when every human is home (finished, retired or DNF) or the window
  closes; karts still out are DNF'd by the sim but keep their standing by distance (GP points by position). The max race
  time (`laps × 120 s + 60 s`) caps everything. A race decided while the room is still in COUNTDOWN finishes as soon as
  the room reaches PLAYING.
- **Grand Prix.** A cup's four races run inside one platform match, so the roster, disconnect handling and the single
  outcome report span the cup. Points come from `KART_GP_POINTS` (bots score too); `gp[id].places[i]` is the place in
  round i+1 (0 = DNF or didn't race); leavers keep their row. If everyone seated is away, the cup ends with the
  standings so far.
- **Pause** (`kart:pause` `{ paused }`): solo rooms only, COUNTDOWN/PLAYING until the race is decided; multiplayer rooms
  reply `not_allowed`; a 1 s play-on cooldown after each resume. Mirrored as `race.paused`. While paused the sim doesn't
  step, no snapshots or own states are sent, input packets are dropped, and every clock stands still: the countdown, the
  finish window and max race time (sim time) and the room's named timers (`freezeTimers`). On resume `goAt`,
  `finishDeadline` and `phaseEndsAt` move forward by the pause, and the client restarts its snapshot clock filter
  (`onResume`). A disconnect keeps the pause; a racer gone for good lifts it. In multiplayer the same menu is titled
  "Race menu" and the race continues underneath.
- **Disconnects.** A transient drop marks the kart disconnected (it coasts, then turns into a ghost); reconnecting
  resumes it. Away (grace expired) or left → the kart is retired (`dnf` reason `disconnected` or `left`).
- **Outcomes.** A single race reports finishers by finish time (identical times share a place), then every kart that
  didn't finish as one last group; bots are `nonPlayerIds`; `scores` are finish times (`lowerIsBetter`); reason
  `finished`; a race nobody finished reports nothing. A cup reports placements by points (ties share), leavers last,
  reason `cup_finished`, and only if someone scored. Stats extras: `minLapMs`, `fastestLaps` (2+ racers), `itemHits`
  (items on), `maxCupPoints` (GP). `endMatch` always runs.

## 5. Tracks

A track is a `KartTrackDef` (`trackdef.ts` documents every field): a closed ring of control points
`[x, y, z?, halfWidth?]` (travel = point order, `points[0]` on the start line), road half-width (4–16), shoulder (0–20),
off-road material, a default edge (wall or drop) with per-span overrides, and features at lap fractions with lateral
offsets: surface zones (ice, mud, conveyor), boost pads, ramps (and gaps to jump), item rows (2–6 cubes), hazards
(bumper, stomper, sweeper, roller, laser; motion is a pure function of the tick, lasers blink before switching on,
rollers wind up), branches (road or dirt routes that leave at `from` and rejoin at `to`; progress maps linearly onto the
span, and no gate is placed inside it), landmarks (render only), `biome`, `decorSeed` (scenery scatter) and `parLapMs`.

### Adding a track

1. **Contract.** Add the id to `KART_TRACK_IDS` and `KART_TRACKS` (name, cup, tagline, feature chips). Cups hold four
   tracks each (`KART_CUPS`; one GP round per track).
2. **Def.** Write `packages/game-core/src/kart/tracks/<id>.ts` and register it in `tracks/index.ts`. Lay it out with
   `turtle([...])` (`tracks/path.ts`: straights and exact-radius arcs, heights ramp per piece, the loop closes itself)
   and place features with `pieceFrac(path, piece, t)`; `pixel-plaza.ts` is the reference. Map its biome in the
   client's `trackInfo.ts`.
3. **Author for the physics.** The minimum flat-out radius is about 16 u at 30 u/s, so wider corners are flat-out; a
   drift pays through its mini-turbo on a long constant arc (stage 2 ≈ 35 u of arc, stage 3 ≈ 60 u). Aim for laps of
   35–55 s. Keep the grid on a straight wide enough for 30 slots and away from gaps and branches, and put the first jump
   well after the start (a lap-1 fall in traffic feels unfair). Put item rows on straights and pads on drift exits, keep
   dirt cuts slower than the road unless you boost, leave hazards a clear lane (a racing-line follower that never dodges
   must take ≤ 0.5 hits/lap), and give each track 1–3 recognisable landmarks at the ends of straights.
4. **Preview.** `pnpm exec tsx scripts/kart-track-preview.ts <id…|all>` writes a top-down SVG and PNG (heights, edges,
   zones, pads, ramps, gaps, items, hazards, branches, landmarks, grid, gates; default output `.scratch/kart/previews/`,
   which is git-ignored) and prints a lint (length, tightest corners, slopes, overlaps, landmark clearance, item rows in
   corners). Flags: `--out <dir>`, `--no-png`, `--spline` (ignore `buildTrack`), `--drive` with optional `--racer <id>`
   (pure-pursuit laps on the real physics, with and without drifting, per route; the trace is drawn on the map), and
   `--race` with optional `--solo`, `--racers a,b`, `--skill hard`, `--laps 3`, `--items` (a headless `KartSim` race:
   laps, falls, hazard hits, branch use). `lab/probe.ts` prints lengths, gates, branches and the lap fraction of every
   control point.
5. **Validation.** `buildTrack` throws a `KartTrackError` naming the problem: fields out of range; self-intersection or
   overlapping roads (unless one passes ≥ 6 u above); slopes steeper than 0.4; curves too tight for the road width;
   zones, pads, ramps or hazards off the road or over a gap; a gap without a ramp within 40 u, or too long to jump; a
   ramp whose flight leaves the road; rollers that leave no 2.4 u safe lane; branches that wrap the line, overlap a gap,
   leave or rejoin too sharply or run back over the main road; a landmark on the road; the grid over a gap or branch; too
   few gates.
6. **Par.** `pnpm exec tsx packages/game-core/src/kart/lab/pars.ts <id>` measures the hard bot's best clean lap (nova,
   no items, no hazard hit or fall in that lap) and prints the hard mean and median against it; set `parLapMs` to it.
   Time-trial medals: gold ≤ par, silver ≤ par × 1.07, bronze ≤ par × 1.16 (`results/order.ts`).
7. **Tests.** `bots.test.ts` runs every id in `KART_TRACK_IDS` (hard bots finish, the best clean lap within 1.2 % of par
   and the median within +2 %, skill tiers, hazard fairness, no stuck bots). Add the id to `IDS` in
   `tracks/tracks.test.ts` (content on the road, landmark clearance, personality); builder mechanics live in
   `track.test.ts`; `render.test.ts` checks that every landmark kind is one the renderer knows.

### Landmarks

`Landmark.kind` picks a model in `apps/web/src/games/kart/render/landmarks.ts` (unknown kinds fall back to `tower`).
Models face the road, so `yaw: 0` is usually right; `scale` multiplies everything. The core rejects a landmark within
`hw + shoulder + 1` of the road unless it floats (`FLOATING_LANDMARKS`, or `z ≥ 8`) or spans (`SPANNING_LANDMARKS` with
`|d| < 1`; the renderer sizes the arch to the road). Keep the footprint plus about 4 u clear:
`|d| ≥ halfWidth + shoulder + footprint × scale + 4`.

| Kind              | Model                                                     | Footprint | Height | Biomes                |
| ----------------- | --------------------------------------------------------- | --------- | ------ | --------------------- |
| `arcade-cabinet`  | Giant DASCADE cabinet: lit screen, marquee, joystick      | 9.0       | 37     | city                  |
| `billboard`       | Neon billboard on legs                                    | 5.4       | 16     | any                   |
| `tower`           | Stepped neon skyscraper with antenna (the fallback)       | 8.1       | 61     | city, cyber           |
| `arch`            | Neon gate; with `d: 0` it straddles the road              | 15.7      | 17     | any                   |
| `radar-dish`      | Radar dish on a lattice mount                             | 4.0       | 20     | desert                |
| `mesa-arch`       | Red-rock arch; with `d: 0` it straddles the road          | 21.0      | 30     | desert                |
| `lighthouse`      | Striped lighthouse with a turning beam                    | 7.0       | 34     | harbor                |
| `crane`           | Dockside gantry crane (scenery; the hazards are separate) | 5.8       | 27     | harbor, factory       |
| `cargo-ship`      | Container ship (sits in the water)                        | —         | 18     | harbor                |
| `ice-castle`      | Crystal ice castle                                        | 18.2      | 36     | snow                  |
| `frozen-joystick` | Giant joystick frozen in ice                              | 7.0       | 26     | snow                  |
| `ferris-wheel`    | Turning ferris wheel                                      | 11.2      | 40     | carnival              |
| `circus-tent`     | Striped big top with pennants                             | 14.8      | 22     | carnival              |
| `gears`           | Wall of three turning cogs                                | 21.0      | 25     | factory               |
| `smokestack`      | Pair of smokestacks (smoke at fx FULL)                    | 8.0       | 58     | factory               |
| `blimp`           | Drifting DASCADE blimp                                    | —         | floats | sky, city             |
| `cpu-tower`       | Giant CPU chip on a stand                                 | 3.0       | 22     | cyber                 |
| `data-spire`      | Glowing crystal spire with rings                          | 6.0       | 46     | cyber, sky            |
| `cloud-island`    | Floating island with a waterfall                          | —         | floats | sky                   |
| `hot-air-balloon` | Bobbing striped balloon                                   | —         | floats | sky, desert, carnival |

Footprints are ground-contact half-extents (u, scale 1) measured from the model by `landmarkFootprint(kind, biome)`;
heights are the model's top in the city biome. `tracks.test.ts` (`FOOTPRINT`) and the preview (`LANDMARK_RADIUS`) keep
their own conservative clearance tables: keep them at or above the measured footprint.

## 6. Items

| Item              | Uses | Effect                                                                            |
| ----------------- | ---- | --------------------------------------------------------------------------------- |
| `turbo`, `turbo3` | 1, 3 | A boost (78 ticks) that ignores off-road                                          |
| `puck`, `puck3`   | 1, 3 | A straight shot (backwards with `back`); 3 wall bounces                           |
| `seeker`          | 1    | Follows the racing line to the racer directly ahead; homes in over the last ~25 u |
| `mine`            | 1    | Dropped behind (lobbed ahead with `ahead`); arms after 0.3 s                      |
| `fizz`            | 1    | A slick puddle: grip loss for 0.8 s, not a spin                                   |
| `shield`          | 1    | Blocks one hit for 10 s                                                           |
| `magnet`          | 1    | Tugs toward the kart ahead for 3.5 s, stronger the bigger the gap                 |
| `warp`            | 1    | Rides the racing line for 3 s, intangible                                         |
| `pulse`           | 1    | Spins up to 8 karts within 120 u ahead; shields block it                          |

An item cube starts a 1.1 s roulette (the server rolls when it stops) and respawns after 2 s. Holding the item button
trails a puck, mine or fizz behind the kart, where it blocks one hit from behind. Every hit goes through `applyHit`: a
spin, then immunity, so hits never chain. The distribution interpolates four `ANCHORS` tables (position fraction 0,
1/3, 2/3 and 1), counts a big gap to the leader as being further back, never gives the leader a seeker or magnet, never
gives the front quarter a warp or pulse (`RARE_MIN_POSITION_FRAC`), and gives a lone racer none of the four.

### Adding an item

1. **Contract.** Append the id to `KART_ITEM_IDS` and `KART_ITEMS` (name, category, blurb, uses). Ids are wire codes
   (index + 1), so append only; the snapshot's item nibble holds codes up to 15.
2. **Weights.** Add it to all four `ANCHORS` rows in `items.ts`; `items.test.ts` checks the sums and the fairness rules.
3. **Logic.** Self-affecting effects (a boost, a state timer) go in `stepKart`'s item block (`kart.ts`, with a `CODE_*`
   constant in `itemcodes.ts`), so the predictor sees them instantly. Anything that touches others goes in
   `ItemWorld.use` (spawn an entity or apply hits) and, for entities, `ItemWorld.step`; tuning goes in `ITEM_TUNING`.
   Trailable items join `TRAILABLE_ITEMS`; aim follows `aimsBack` and `trapThrowsAhead`. A new `KartState` field
   changes `kart:own` (§3).
4. **Entities.** Append the kind to `EntityKind` and `ENTITY_KINDS` (`items.ts`; encoded as its index). On the client:
   the controller's `ENTITY_KIND` map, `entityFromSnap` (`render/pose.ts`), `KartEntityKind` (`render/types.ts`) and a
   case in the entity layer's `drawEntities` (`render/karts.ts`, `ITEM_MODELS`).
5. **Art.** A fixed colour in `ITEM_COLORS` (`art/palette.ts`), a model in `art/items.ts` (`ItemModelId`,
   `modelForItem`), a HUD icon in `art/icons.ts` (an SVG string for `itemIconUrl`), the slot reel in `hud/Hud.tsx`, and
   any use effect through `triggerFx`.
6. **Sound.** A case in `kartSfx.use(item)` and, if it hits, in `impact(cause)` (`audio/sounds.ts`).
7. **Tests.** `items.test.ts` (behaviour, blocking, caps), `netcode.test.ts` (entities round-trip) and `art.test.ts`
   (every item has a colour, a model and an icon). Update the catalog's controls and how-to-play if it changes them.

## 7. Racers, karts and art

- **Racers.** `KART_RACERS` in the contract: stats 1–5 summing to 15, archetype, blurb, `colors.main` (the default
  paint) and `colors.trim`. Physics comes from `specFromStats` with the `BALANCE` coefficients (`spec.ts`); every
  stat-3 value equals nova's. Speed → top speed (a 4 % spread); Accel → thrust (0 → 95 % in ~2.1 s at Accel 4 … ~4.1 s
  at Accel 1), and so recovery from every hit, bump and wall; Handling → yaw rate, drift tightness and charge speed;
  Grip → the lateral limit and steering at speed, off-road, ice; Weight → bump mass. A new racer needs art (below) and
  a balance re-check (§9; `lab/pack.ts` assumes eight racers).
- **Voxel models** (`art/`). `MeshBuilder` (`builder.ts`) merges primitives with per-vertex colour and glow into one
  geometry drawn with the shared voxel material (`materials.ts`: Lambert, glow, fresnel rim). A racer is a torso and a
  head (`racers.ts`: the `TORSO` and `HEAD` builders; the head sits on `HEAD_PIVOT` so it can lean and look back), its
  colours in `palette.ts` (`racerExtra` → `RACER_ART`) and a kart emblem (`EMBLEM` in `karts.ts`). A kart body is an
  entry in `KART_BODY_IDS`/`KART_BODIES`, a builder in `BODY` and its anchors in `KART_SPECS` (wheels, seat, exhausts,
  trailed item, name tag); bodies are cosmetic. `art.test.ts` builds every racer × body and checks bounds and triangle
  counts.
- **Portraits.** `renderRacerPortrait(racer, body, paint, size, view)` (`art/portrait.ts`) renders PNG data URLs from the
  real model with one shared offscreen renderer, which releases its WebGL context about 2.5 s after the last portrait;
  `lobby/Portrait.tsx` loads it lazily and shows a flat badge until then.
- **Landmarks.** Add the kind to `LANDMARK_KINDS` and a `DEFS` entry (a `base` builder and optional animated parts) in
  `render/landmarks.ts`. Floating or spanning kinds also go in the core's `FLOATING_LANDMARKS`/`SPANNING_LANDMARKS` and
  the renderer's `NO_GROUND_PAD`/`ARCH_KINDS`. Then update the clearance tables (§5).
- **Biome props.** Each biome (`render/biomes.ts`: sky, fog, terrain, asphalt, curbs, wall style, water or cloud sea)
  lists `PropRule`s (kind, density, near/far distance, scale, clusters). A prop kind is a `PropKind` plus builders in
  `VARIANTS` (`render/props.ts`), scattered deterministically from `decorSeed` and drawn as chunked InstancedMeshes. A new
  biome also needs its `BiomeId` in `trackdef.ts` and a label in `trackInfo.ts`.
- **Everything is procedural** (geometry and canvas textures): there are no image or model files.

## 8. Themes, settings and audio

- **World materials.** `worldPalette(biome, offroad, materials)` (`render/biomes.ts`) reads `asphalt`, `asphaltLine`
  (lane and edge lines), `curbA`, `curbB`, `offroad` and `metal`, and leans the sky and fog 30 % toward `sky` and
  `skyHorizon`. `matOr(materials, key, ORIG)` returns the exact biome colour when the theme gives nothing (Delta Neon) or
  an invalid value, so Delta Neon stays pixel-identical (`art.test.ts`). The stage backdrop is
  `var(--mat-sky, #0b0820)`; the top-down fallback reads `grass` and `asphalt` with its own fallbacks.
- **In place.** `RaceStage` calls `watchThemeTokens(host, (t) => renderer.setThemeTokens(t))`; the world recolours and
  redraws its canvas textures in place, never rebuilding or resetting the scene.
- **Fixed colours.** Paint, racer art, item colours, drift stages (cyan → gold → magenta), prism cubes, hazard danger
  glows and the start lights never follow the theme. HUD and lobby chrome use theme tokens; numbers use `--font-num`.
- **fx.** Particle budgets scale with fx (FULL all, REDUCED about 45 %, MINIMAL a trickle); speed lines need fx on and no
  reduced motion; the results confetti is thinner at REDUCED and absent at MINIMAL or with reduced motion.
- **Reduced motion.** A fixed FOV, no shake, a gentler follow, a static intro shot, camera cuts instead of blends, frozen
  landmark animation and a still showroom.
- **Quality.** `recommendedKartQuality()` (`render/quality.ts`) picks the starting tier: desktops `high`, capable phones
  `medium`, weak devices `low`. Tiers cap the pixel ratio at 1.25, 1.5 and 2 (MSAA is always on). Auto-quality steps
  down one tier after about 3 s of frames over 26 ms and never steps back up. Without WebGL the race runs in the
  top-down view.
- **Audio.** Every sound goes through the shared pipeline: `kartSfx` (`audio/sounds.ts`) plays `synth.tone` and
  `synth.noise` on the SFX bus, with per-sound minimum gaps. The engine (`audio/engine.ts`) is a continuous voice for
  the local kart plus a quieter one for the nearest other kart, on the shared context and bus; it holds the jukebox dip
  with `synth.hold('kart-engine', …)` while audible and goes silent when the race is frozen (paused, intermission,
  results), when spectating and when the tab is hidden.

## 9. Balance and bots

`BALANCE` was tuned against 8-kart hard-bot pack races over every track (`lab/pack.ts`, grid rotated per race): 512
races with and without items gave mean places of 4.14–4.89 and win rates of 9–16 % per racer. `balance.test.ts` pins a
seeded 64-race subset, solo flying laps within 4 % across racers, and the per-stat lap value (`lab/statvalue.ts`,
stat 1 → 5, solo: speed about 4 %, handling about 2.5 %, grip about 2 %, accel about 1 %). Bots (`bot.ts`) drive through
the normal input path with a minimum-curvature racing line, per-corner drift decisions, hazard dodging and timing, item
tactics and skill-scaled mistakes; normal laps are about 8 % slower than hard, easy about 18 %.

```sh
pnpm exec tsx packages/game-core/src/kart/lab/run.ts                 # feel report: speed curves, yaw, slip, radii, stages
pnpm exec tsx packages/game-core/src/kart/lab/pack.ts 16 [noitems]   # pack balance: mean place, wins
pnpm exec tsx packages/game-core/src/kart/lab/packsearch.ts '{"accelPerAccel":[3,3.5]}' 16 [firstSeed]   # BALANCE grid, pack races
pnpm exec tsx packages/game-core/src/kart/lab/balancetune.ts [seeds]  # coordinate descent on BALANCE
pnpm exec tsx packages/game-core/src/kart/lab/solotune.ts --eval      # solo pace spread (deterministic)
pnpm exec tsx packages/game-core/src/kart/lab/statvalue.ts [--curve] ['{"gripPerGrip":1}'] [id…]   # lap value of each stat point
pnpm exec tsx packages/game-core/src/kart/lab/balance-report.ts [id…] # per-racer solo lap spread
pnpm exec tsx packages/game-core/src/kart/lab/bots.ts hard            # every track: finishes, lap vs par, items, hazards
pnpm exec tsx packages/game-core/src/kart/lab/tiers.ts                # solo lap per bot skill
pnpm exec tsx packages/game-core/src/kart/lab/hazards.ts [id…]        # hazard hits/lap: blind line follower vs bots
pnpm exec tsx packages/game-core/src/kart/lab/aborts.ts hard          # drift quality (aborted hops)
pnpm exec tsx packages/game-core/src/kart/lab/shortcuts.ts [id…]      # branch value with and without a turbo
pnpm exec tsx packages/game-core/src/kart/lab/start.ts                # start boost / wheelspin cost
pnpm exec tsx packages/game-core/src/kart/lab/hits.ts                 # spin / stumble cost per racer
pnpm exec tsx packages/game-core/src/kart/lab/race.ts pixel-plaza hard 30   # one headless race + perf
```

After any physics, balance or bot change, re-measure the pars (`lab/pars.ts`) and run the engine tests.

## 10. Testing and ops

```sh
pnpm vitest run packages/game-core/src/kart     # engine
pnpm vitest run apps/game-server/test/kart.test.ts apps/game-server/test/kart-adversarial.test.ts apps/game-server/test/kart-prewarm.test.ts
pnpm vitest run apps/web/src/games/kart packages/shared/src/games/kart.test.ts   # client units; input packing
```

Engine suites: `track` (geometry, projection, branches, hazards, validation), `tracks/tracks` (the six non-reference
tracks), `kart` (physics and feel), `items` (distribution, every item, boxes, caps), `sim` (progress and anti-cheat,
credit bank, races, bumps, shortcuts), `netcode` (codecs, predictor exactness, ghosts), `determinism`, `bots`,
`balance`, `perf`. Client suites: `net/interp`, `input`, `art`, `render`, `render/camera`, `results/order`, `docs`.

- **E2E** (`e2e/kart.spec.ts`: the solo lobby, a race against bots, pause, a full lap finished by the server autopilot,
  a two-player room, touch controls, exit and re-enter). The autopilot is the `kart:test` hook, which the room
  registers only when `DASCADE_RELAXED_LIMITS=1` **and** `NODE_ENV` isn't `production`: a production server doesn't know
  the message, and Colyseus drops a client that sends an unknown type. So test a build on a non-production server that
  serves the client (the default `pnpm test:e2e` web server sets `NODE_ENV=production`):

  ```sh
  pnpm build
  SERVE_WEB=1 DASCADE_RELAXED_LIMITS=1 PORT=<p> node apps/game-server/dist/index.js
  E2E_BASE_URL=http://127.0.0.1:<p> E2E_OUTPUT=test-results/kart pnpm exec playwright test e2e/kart.spec.ts \
    --project=chromium --project=mobile --project=mobile-safari
  ```

  The client forwards test actions only when the page has opted in (`?kartTest=1` or the `kart-test` session flag).
  `kart:test` takes `{ action: 'autopilot', on }` (the game's normal bot drives your kart through the credit bank, and
  the client stops sending inputs; cleared every race) or `{ action: 'finish' }` (your kart jumps to 60 u before the
  line on its final lap).

- **Dev server.** `DASCADE_ONLY_GAMES=kart PORT=<p> DASCADE_RELAXED_LIMITS=1 pnpm --filter @dascade/game-server dev`.
  `tsx watch` restarts on every save, so rooms vanish mid-race; for long scripted sessions run
  `node --import tsx src/index.ts` from `apps/game-server` and restart it by hand after engine changes.
- **`kart:diag`** (the same gate as `kart:test`, players only) replies with the room's tick timing (avg/p99/max),
  snapshot, own and input counters (dropped frames, `seqRestarts`), event-loop delay and memory. The load script uses it.
- **Load.** `LOAD_URL=http://127.0.0.1:<p> pnpm load:kart -- --clients 30` against a relaxed, non-production server (as
  for E2E; `DASCADE_ONLY_GAMES=kart` is optional and `DASCADE_LATENCY_MS=120` simulates latency). Each client runs a
  60 Hz `KartPredictor` driven by `KartBot` (or `--driver line`) and meters its socket. Flags: `--clients 1..30`,
  `--bots`, `--laps`, `--track`, `--items on|off`, `--seconds`, `--mode race|gp`, `--churn N` (disconnect and
  reconnect), `--spectators N`, `--spikes N` (0.4–2 s send stalls, then a flush), `--hostile N` (junk every frame),
  `--json FILE`.
- **F3 net-debug overlay** (or `?netdebug=1&lag=120&jitter=30`): ping, RTT, jitter, interpolation delay, buffered and
  extrapolated samples, corrections, pending inputs, snapshots/s, kbit/s, own states and whether it is predicting,
  renderer fps, draw calls and pixel ratio, plus a client-side latency and jitter conditioner (`net/netSim.ts`).
- **Render harness** (dev server only; not in the build): `http://localhost:<web>/src/games/kart/render/harness.html`
  runs an offline race (core `KartSim` + bots) through the real renderer. A race:
  `?track=<id>&bots=11&auto=1&skip=20&cam=chase|intro|orbit|spectate&q=high&fx=high&rm=1&theme=<id>&hud=0`. The showroom:
  `?gallery=1&track=<id>&slot=0&cam=orbit&flags=<KF bits>&stage=0..3&lights=0..4`, or any spot with
  `&at=<lap fraction>&d=<lateral>&solo=1`. Sheets: `?portraits=1` (`&view=face|rear&only=<racer>&size=<px>`),
  `?icons=1`, `?attract=1`. Keys: arrows or WASD, Space drift, X or Shift item, Z aim back. `window.__KH__` exposes
  `stats()`, `camera(mode)`, `target(slot)`, `skip(seconds)` and `fx(kind, slot)`.
- **Start-up.** Performance marks `kart:load-start`, `kart:renderer-chunk`, `kart:renderer-created` and
  `kart:first-frame`. A track builds in 4–16 ms once per process; the server pre-builds all eight on unref'd timers when
  the first kart room opens, and the lobby builds the previewed track in idle time.

### Load results

One lap of pixel-plaza with items, on a bundled server with relaxed limits; the load generator ran on the same laptop
(its CPU, not the server's, is the limit at 30 clients). Measured before `kart:own` grew from 60 to 64 B (+0.6 kbit/s).

| Karts | Tick avg / p99 / max (ms) | Loop delay p99 (ms) | RSS (MB) | Snapshot (B) | Down per client, kbit/s (snap + own + other) | Corrections/min (> 3 u) | Ack lag p50 / p95 (ms) | Result                         |
| ----- | ------------------------- | ------------------- | -------- | ------------ | -------------------------------------------- | ----------------------- | ---------------------- | ------------------------------ |
| 8     | 0.22 / 1.09 / 8.5         | 3.8                 | 131      | 189          | 44.1 (30.2 + 9.6 + 4.3)                      | 2.8 (0)                 | 17 / 33                | 8/8 finished, orders correct   |
| 16    | 0.25 / 1.18 / 7.0         | 3.3                 | 106      | 345          | 69.8 (55.1 + 9.6 + 5.1)                      | 3.5 (0)                 | 17 / 33                | 16/16 finished, orders correct |
| 24    | 0.39 / 2.63 / 48.3        | 6.1                 | 95       | 504          | 96.7 (80.5 + 9.6 + 6.6)                      | 9.8 (0)                 | 17 / 33                | 24/24 finished, orders correct |
| 30    | 0.35 / 1.71 / 12.9        | 5.3                 | 92       | 623          | 116.5 (99.5 + 9.6 + 7.4)                     | 11.1 (0)                | 17 / 33                | 30/30 finished, orders correct |

A full 30-kart room costs about 2 % of one core (0.35 ms of a 16.7 ms tick) and about 15 KB/s (~53 MB an hour) per
client. Also measured at 30 karts: 3 hostile clients with 12 lag spikes and 4 drops (honest racers saw 0 errors and all
finished; hostile karts only hurt themselves), 10 extra spectators (the room maximum of 40), 120 ms of simulated latency
(small corrections rise to about 1.8/s in a tight pack; large ones stay near 0.6/min), and a full Grand Prix of 24
humans + 6 bots (4 races, 3 automatic intermissions, exact points). The single-tick maxima (e.g. 48 ms at 24 karts)
coincide with load-generator and GC hitches, so trust p99. Other disconnect cases are covered by the server integration
tests.
