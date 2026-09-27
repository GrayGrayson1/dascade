/**
 * Night resolution ("Blackout"). All actions are simultaneous; the resolution order is:
 *
 *  1. JAM     — every living Jammer's target is jammed for the night.
 *  2. ATTACK  — the Glitch team's target is the living Sysop with the most Glitch picks
 *               (ties are broken by the server RNG; no picks → no attack).
 *  3. SHIELD  — a living, un-jammed Firewall's target is shielded (self-shields allowed).
 *  4. CORRUPT — the attack target is corrupted unless shielded ("blocked").
 *  5. SCAN    — each Scanner learns GLITCH / CLEAN about their target, or JAMMED if jammed.
 *               Scans resolve even when the Scanner is corrupted the same night.
 *  6. CLUE    — each Tracer still online gets a pair of living players (never themselves):
 *               exactly one Glitch and one Sysop, in random order — or JAMMED if jammed.
 *
 * Picks are re-validated here (players can leave or be removed after picking): picks from
 * offline actors, by the wrong role, or at invalid targets are ignored.
 */
import type { Rng } from '@dascade/shared';
import { roleTeam, type DeceptionRole, type DeceptionScanResult } from '@dascade/shared/games/deception';

export interface NightInput {
  cycle: number;
  roles: ReadonlyMap<string, DeceptionRole>;
  /** Players online at the start of resolution. */
  alive: ReadonlySet<string>;
  /** Glitch-team attack picks (actor → target). */
  attacks: ReadonlyMap<string, string | null>;
  scans: ReadonlyMap<string, string | null>;
  shields: ReadonlyMap<string, string | null>;
  jams: ReadonlyMap<string, string | null>;
  /** Firewall → player shielded the previous night (can't be shielded again tonight). */
  lastShield?: ReadonlyMap<string, string>;
}

export interface NightOutcome {
  cycle: number;
  /** The Glitch team's chosen target (null = no attack). */
  attackTarget: string | null;
  /** The target was chosen by the RNG among tied picks. */
  attackTieBreak: boolean;
  /** The attack was stopped by a shield. */
  blocked: boolean;
  /** The player corrupted tonight (null when blocked / no attack). */
  corrupted: string | null;
  jammed: string[];
  jams: Array<{ actorId: string; targetId: string }>;
  shields: Array<{ actorId: string; targetId: string; jammed: boolean; held: boolean }>;
  scans: Array<{ actorId: string; targetId: string; result: DeceptionScanResult }>;
  clues: Array<{ actorId: string; pair: [string, string] | null; jammed: boolean }>;
}

const isGlitch = (roles: ReadonlyMap<string, DeceptionRole>, id: string) => {
  const role = roles.get(id);
  return role !== undefined && roleTeam(role) === 'glitches';
};

/** Stable iteration: sort by id so a seeded RNG reproduces the same result regardless of Map order. */
const sortedEntries = (m: ReadonlyMap<string, string | null>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function resolveNight(input: NightInput, rng: Rng): NightOutcome {
  const { roles, alive } = input;
  const roleOf = (id: string) => roles.get(id);
  const living = (id: string | null | undefined): id is string => typeof id === 'string' && alive.has(id);

  // 1. Jams.
  const jams: NightOutcome['jams'] = [];
  const jammed = new Set<string>();
  for (const [actor, target] of sortedEntries(input.jams)) {
    if (!living(actor) || roleOf(actor) !== 'jammer' || !living(target) || target === actor || isGlitch(roles, target)) continue;
    jams.push({ actorId: actor, targetId: target });
    jammed.add(target);
  }

  // 2. Attack target: most picks among living Glitches; RNG breaks ties.
  const tally = new Map<string, number>();
  for (const [actor, target] of sortedEntries(input.attacks)) {
    if (!living(actor) || !isGlitch(roles, actor) || !living(target) || isGlitch(roles, target)) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  let attackTarget: string | null = null;
  let attackTieBreak = false;
  if (tally.size > 0) {
    const top = Math.max(...tally.values());
    const tied = [...tally]
      .filter(([, n]) => n === top)
      .map(([id]) => id)
      .sort();
    attackTieBreak = tied.length > 1;
    attackTarget = tied.length === 1 ? (tied[0] as string) : (tied[rng.int(tied.length)] as string);
  }

  // 3. Shields.
  const shields: NightOutcome['shields'] = [];
  const shielded = new Set<string>();
  for (const [actor, target] of sortedEntries(input.shields)) {
    if (!living(actor) || roleOf(actor) !== 'firewall' || !living(target)) continue;
    if (input.lastShield?.get(actor) === target) continue;
    const isJammed = jammed.has(actor);
    if (!isJammed) shielded.add(target);
    shields.push({ actorId: actor, targetId: target, jammed: isJammed, held: false });
  }

  // 4. Corruption.
  const blocked = attackTarget !== null && shielded.has(attackTarget);
  const corrupted = attackTarget !== null && !blocked ? attackTarget : null;
  if (blocked) for (const s of shields) s.held = !s.jammed && s.targetId === attackTarget;

  // 5. Scans (resolve even if the Scanner was corrupted tonight).
  const scans: NightOutcome['scans'] = [];
  for (const [actor, target] of sortedEntries(input.scans)) {
    if (!living(actor) || roleOf(actor) !== 'scanner' || !living(target) || target === actor) continue;
    const result: DeceptionScanResult = jammed.has(actor) ? 'jammed' : isGlitch(roles, target) ? 'glitch' : 'clean';
    scans.push({ actorId: actor, targetId: target, result });
  }

  // 6. Clues for Tracers who are still online at dawn.
  const clues: NightOutcome['clues'] = [];
  const onlineAtDawn = [...alive].filter((id) => id !== corrupted).sort();
  const tracers = onlineAtDawn.filter((id) => roleOf(id) === 'tracer');
  for (const tracer of tracers) {
    if (jammed.has(tracer)) {
      clues.push({ actorId: tracer, pair: null, jammed: true });
      continue;
    }
    const glitches = onlineAtDawn.filter((id) => id !== tracer && isGlitch(roles, id));
    const sysops = onlineAtDawn.filter((id) => id !== tracer && !isGlitch(roles, id));
    if (glitches.length === 0 || sysops.length === 0) {
      clues.push({ actorId: tracer, pair: null, jammed: false });
      continue;
    }
    const g = glitches[rng.int(glitches.length)] as string;
    const s = sysops[rng.int(sysops.length)] as string;
    clues.push({ actorId: tracer, pair: rng.int(2) === 0 ? [g, s] : [s, g], jammed: false });
  }

  return { cycle: input.cycle, attackTarget, attackTieBreak, blocked, corrupted, jammed: [...jammed].sort(), jams, shields, scans, clues };
}
