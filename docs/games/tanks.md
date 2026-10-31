# DAS Tanks — design notes

Scorched-earth artillery for 1–8 tanks (players plus CPU gunners), free-for-all or two teams, with
spectators. A match is a run of battles on fresh battlefields with an economy between them: crews earn
credits for what they do in a battle and spend them in the armory before the next one.

| Piece | Path |
|---|---|
| Contract (settings, arsenal and prices, messages, shot scripts, views) | `packages/shared/src/games/tanks.ts` |
| Engine: terrain, liquids, weapons, simulation, battle rules, match economy, CPU gunners, quips | `packages/game-core/src/tanks/` |
| Room and schema | `apps/game-server/src/rooms/tanks/` |
| Client: presenter (playback), Phaser scene, HUD, gunner deck, armory, splashes, results | `apps/web/src/games/tanks/` |
| Tests | `packages/game-core/src/tanks/*.test.ts`, `apps/game-server/test/tanks.test.ts`, `apps/web/src/games/tanks/**/*.test.ts`, `e2e/tanks.spec.ts` |

## A match

`PLAYING` runs these stages (`battle.stage`):

1. **shop** — the armory. The next battlefield and everyone's spawn are already on screen behind it.
   Crews buy bundles with their credits and can sell back anything bought during this visit for a full
   refund. The shop closes when every crew at the controls is ready, or after 50 s. CPU crews shop
   instantly to their persona. The shop is skipped when the economy isn't `shop` or nobody can afford
   the cheapest bundle.
2. **intro** — "Battle 2 of 5", the terrain, the wall mode and the gravity.
3. **aim → resolving → idle**, repeated: turns, or volleys (below).
4. **battle_over** — the battle's winners and every crew's earnings.
5. Then the next battle's shop, or **over** — the match standings — and `RESULTS`.

**Turn order.** Each battle starts with the lowest score first ("losers first"). In teams mode the two
teams alternate and rotate through their members. Spawn positions are always random.

**Earnings (credits, shop economy).** 1,500 for fighting, 20 per point of damage to enemies, 2,500 per
knockout, 1,500 for surviving and 4,000 for winning. Damage and knockouts on teammates are deducted.
Unspent ammo and items carry over to the next battle.

**Score (the standings).** Damage (1 per point), knockouts (50 each) and the battle placement (100 / 50 /
25 for 1st / 2nd / 3rd in free-for-all; every member of the winning team gets 100). Team damage and
team knockouts are deducted. Most points after the last battle wins; ties break on battle wins, then
damage. Teams compete on summed team score. `reportOutcome` uses `reason: 'points'`.

**Economies.** `shop` (default: starting credits + earnings + the armory), `stocked` (no shop: every tank
gets `STOCKED_LOADOUT` fresh each battle) and `shells` (shells only).

## The arsenal

Prices are per bundle. The shell is free and unlimited.

| Weapon | What it does |
|---|---|
| Shell, Heavy Shell, Mini Nuke, Nuke | Blasts of growing size; the bigger ones drift less in the wind. |
| Airburst | Proximity fuse above tanks; wide blast, no crater. |
| Cluster Shot, MIRV | Split at the top of the arc into five bomblets / five full warheads (an early impact bursts and throws them out). |
| Party Popper | Bursts on impact into nine bomblets with seeded random velocities. |
| Roller, Heavy Roller | Land, roll along the surface (gravity, rolling resistance, drag), and explode when they settle in a dip, meet a tank, hit a cliff face or rock back and forth three times. |
| Leapfrog | Explodes on three landings, bouncing between them. |
| Napalm, Hot Napalm | Burning fuel that runs downhill and pools (see liquids). Tanks in the fire burn in four pulses, capped per splash. |
| Driller | Bores through hills and detonates underground; digs a buried tank out. |
| Seeker Missile | After the apex it steers horizontally toward the nearest enemy. |
| Railgun | Hitscan beam along the barrel: no gravity, no wind. Pierces up to 160 units of earth and stops at the first tank or shield. Bounces off bounce walls, wraps once through wrap walls. |
| Sky Lance | Marks where it lands; 0.9 s later an orbital beam carves a shaft there and hurts tanks within 30 units. |
| Warp Shell | Teleports its shooter to the landing point (clear of other tanks). |
| Tracer | Harmless; its path stays on screen for the rest of the battle. |
| Excavator | Clears a bowl of earth centred above the impact without hurting anyone; the way out when buried. |
| Dirt Clod, Dirt Ball, Ton of Dirt | Mounds of earth: cover, crater patches, or burial. |
| Mudslide | Liquid earth that runs into low ground and sets, burying whoever is down there. |

**Defenses.** Parachute (passive: opens on any fall that would hurt), Shield (60), Heavy Shield (130),
Deflector (60, and turns incoming projectiles away at 10 strength each), Battery (+25 armor) and Fuel Can
(+150 fuel this turn). Shields, batteries and fuel cans are used during your turn (or a volley's aim
window) with `tanks:item`. A shell meets a shield at the bubble (27 units from the hull's centre). A
shield soaks blast, burn and beam damage, but not fall damage. Shields last until they're used up or the
battle ends.

**Burial.** Tanks follow the ground. If the ground drops away, the tank falls: fall damage, unless a
parachute opens. If earth piles up under its tracks, it rides up on top. If earth covers its centre
column by more than 8 units, the tank stays where it was, buried. Buried tanks can't drive, and a normal
shell fired from underground bursts at the muzzle. The Excavator and Driller dig you out.

## Rules and settings

- **Modes.** Free-for-all or teams (with optional friendly fire; you always take your own splash).
- **Turn modes.** *Turns*: one tank at a time with a turn clock. *Volley*: everyone aims, drives and
  uses items at once; firing locks the shot in. When every crew at the controls has locked in (or the
  clock runs out), every locked shot flies in one script, 160 ms apart, in turn order. Crews that never
  locked in hold fire.
- **Walls.** Open (shells leave the field), wrap-around (they come back from the other side as a new
  path), bounce (reflect, keeping 82% of their horizontal speed) and concrete (they burst on the wall).
  Random picks one per battle.
- **Gravity.** Moon (×0.6), Earth, Heavy (×1.45).
- **Terrain.** Hills, mesa, valley, peaks, dunes, canyon, cliffs, islands, or random per battle.
- **Hazards** (optional). When a new round opens, there's a 30% chance of a meteor shower (1–3 rocks)
  or lightning (1–2 bolts near tanks). Nobody is credited for hazard damage.
- **Talk.** Speech bubbles when tanks fire and die (off / some / lots). The server picks the lines so
  everyone sees the same ones (`packages/game-core/src/tanks/talk.ts`).
- **No stalling.** Turn clocks; short turns for disconnected and idle players; away players are skipped
  and never hold up a volley or the shop; when only one side is still manned, the absent side forfeits;
  a round limit ends a battle on armor left; leaving scuttles your tank and takes your crew out of the
  match.

## CPU gunners

Each CPU has the room's skill (aiming noise: rookie ±8° / ±12, veteran ±3° / ±6, ace ±1° / ±2) and a
persona:

| Persona | Targets | Weapons | Shops for |
|---|---|---|---|
| Gunner | Near and weak | Heavy, cluster, MIRV, roller | A balanced kit |
| Lobber | Anyone | High arcs: MIRV, napalm, cluster | Splitters and fire |
| Sniper | The weakest | Railgun, seeker, Ton of Dirt | Precision and a deflector |
| Bully | The match leader | Nukes, hot napalm | Big bombs and a shield |
| Vulture | The most wounded | Popper, cluster, airburst | Scatter weapons |
| Hoarder | The nearest | Heavy, rollers, dirt | Defense; keeps half its credits |
| Maniac | The biggest cluster of enemies | The biggest bombs; careless about splash | Nukes, MIRVs, hot napalm |
| Cyborg | Near and weak | Evaluates up to four of its best weapons every turn | Everything that works |

To aim, a CPU picks up to four candidate weapons and searches angle × power with the real simulation
on a scratch copy of the world, so it accounts for wind, gravity, walls, shields and splash. Burying an
enemy counts for something. Each plan is capped at 420 simulations to keep a CPU turn short on the
server. A buried CPU digs out first. CPUs switch on a shield when they have none and use a battery when
badly hurt.

## Server authority and playback

The server simulates every shot (`resolveShots`, `resolveHazard`) and broadcasts a `ShotScript`:

- one entry per launch;
- projectile paths sampled at 60 Hz, each with its owner;
- a timed event list: `boom`, `bore`, `patch`, `split`, `fire`, `beam`, `mark`, `dmg`, `shield`,
  `deflect`, `move` (with `chute`), `warp`, `death` and `quip`;
- the final tank states, plus damage and kills per shooter.

The battle moves on once `durationMs` (+700 ms) has passed. Clients replay terrain changes on their own
copy with the same engine functions (`carveCircle`, `addDirt`, `carveCapsule`, `applyPatch`), using the
script's rounded coordinates, so the client terrain stays bit-identical to the server's. This is checked
by the "client replay" test. `battle.battleSerial` changes with every battlefield built, and clients
reset their view on it.

**Liquids** (`flow.ts`). A pour runs downhill (steepest lower neighbour) to the bottom of the dip it
finds, leaving a thin film along the way. The rest settles there as a pool whose surface falls away from
the centre by a "viscosity" slope, and the pool level is found by bisection on the volume. Napalm becomes
a `fire` event (intensity per column) plus burn pulses. Mud is added to the terrain and sent as a `patch`
of absolute heights.

**Determinism.** The simulation uses only `+ - * /`, `sqrt`, `floor`, `round`, `min`, `max` and the
integer-degree direction table (`trig.ts`). Random rolls inside a script (Party Popper) come from a seed
the room draws from its crypto RNG.
