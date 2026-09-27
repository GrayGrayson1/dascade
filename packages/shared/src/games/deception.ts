/**
 * DASception — shared contract (roles, setup table, settings, messages, public/private shapes).
 *
 * The Delta Alpha network has been infiltrated. Loyal **Sysops** (the majority, who don't know
 * each other) try to find and disconnect the hidden **Glitches** (a minority who know each other)
 * before the Glitches take over the network.
 *
 * Cycle: BOOT (private role reveal) → NIGHT "Blackout" (Glitches pick a target together,
 * special roles act in secret) → DAWN "Reboot" (public system log) → DAY (timed discussion) →
 * VOTE (private until reveal) → [RUNOFF] → VERDICT (reveal + disconnect) → win check → NIGHT…
 *
 * SECURITY: roles, night actions, Glitch identities and votes before the reveal are
 * server-private. They are NEVER written to synchronized state or broadcast; each player only
 * receives their own `deception:private` payload (spectators receive nothing private).
 */
import { z } from 'zod';
import type { PartyPublicView } from '../party.ts';

// ---------------------------------------------------------------------------
// Teams + roles
// ---------------------------------------------------------------------------

export const DECEPTION_TEAMS = ['sysops', 'glitches'] as const;
export type DeceptionTeam = (typeof DECEPTION_TEAMS)[number];

export const DECEPTION_ROLES = ['sysop', 'scanner', 'firewall', 'tracer', 'sudo', 'glitch', 'jammer'] as const;
export type DeceptionRole = (typeof DECEPTION_ROLES)[number];

/** Special roles the host can switch on in a custom mix (plain Sysop/Glitch fill the rest). */
export const DECEPTION_SPECIALS = ['scanner', 'firewall', 'tracer', 'sudo', 'jammer'] as const;
export type DeceptionSpecial = (typeof DECEPTION_SPECIALS)[number];

/** Night abilities (what a `deception:act` message can carry). */
export const DECEPTION_ACTIONS = ['attack', 'scan', 'shield', 'jam'] as const;
export type DeceptionActionKind = (typeof DECEPTION_ACTIONS)[number];

export interface DeceptionRoleInfo {
  id: DeceptionRole;
  name: string;
  team: DeceptionTeam;
  /** One-sentence rule (shown on the role card and in the rules drawer). */
  rule: string;
  /** Short "how to play it" tip for first-timers. */
  tip: string;
  /** Night ability kinds this role submits (attack is the shared Glitch team vote). */
  actions: readonly DeceptionActionKind[];
}

export const DECEPTION_ROLE_INFO: Record<DeceptionRole, DeceptionRoleInfo> = {
  sysop: {
    id: 'sysop',
    name: 'Sysop',
    team: 'sysops',
    rule: 'No night ability — your power is your voice and your vote.',
    tip: 'Listen for stories that do not add up, and vote out the Glitches by day.',
    actions: [],
  },
  scanner: {
    id: 'scanner',
    name: 'Scanner',
    team: 'sysops',
    rule: 'Each night, scan one other player to learn whether they are a Glitch.',
    tip: 'Share results carefully — the Glitches will target a Scanner who reveals too early.',
    actions: ['scan'],
  },
  firewall: {
    id: 'firewall',
    name: 'Firewall',
    team: 'sysops',
    rule: 'Each night, shield one player (you may pick yourself) from the Glitch attack — never the same player two nights in a row.',
    tip: 'Protect whoever the Glitches most want gone: a trusted Scanner, or yourself.',
    actions: ['shield'],
  },
  tracer: {
    id: 'tracer',
    name: 'Tracer',
    team: 'sysops',
    rule: 'Each dawn you receive a clue: two names — exactly one of them is a Glitch.',
    tip: 'Cross-check clues from different nights to narrow down the Glitches.',
    actions: [],
  },
  sudo: {
    id: 'sudo',
    name: 'Sudo',
    team: 'sysops',
    rule: 'Once per game, cast a Sudo vote: it counts twice and is shown as a Sudo vote at the reveal.',
    tip: 'Save it for a vote where you are sure — using it reveals that you are the Sudo.',
    actions: [],
  },
  glitch: {
    id: 'glitch',
    name: 'Glitch',
    team: 'glitches',
    rule: 'Each night, vote with your fellow Glitches on which player to corrupt.',
    tip: 'Blend in by day: accuse, defend and vote like a loyal Sysop would.',
    actions: ['attack'],
  },
  jammer: {
    id: 'jammer',
    name: 'Jammer',
    team: 'glitches',
    rule: 'A Glitch who can also jam one player each night: their ability fails (scans and clues read JAMMED, shields fail).',
    tip: 'Jam whoever you think is the Scanner or Firewall — you are never told if you guessed right.',
    actions: ['attack', 'jam'],
  },
};

export const DECEPTION_TEAM_INFO: Record<DeceptionTeam, { name: string; goal: string }> = {
  sysops: { name: 'Sysops', goal: 'Find and disconnect every Glitch.' },
  glitches: { name: 'Glitches', goal: 'Stay hidden until the Glitches equal or outnumber the Sysops.' },
};

export function roleTeam(role: DeceptionRole): DeceptionTeam {
  return DECEPTION_ROLE_INFO[role].team;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DECEPTION_LIMITS = {
  minPlayers: 4,
  maxPlayers: 20,
  maxGlitches: 6,
  /** Safety net: the match ends after this many nights (Glitches win: they outlasted the audit). */
  maxCycles: 15,
  teamChatLines: 60,
  teamChatChars: 200,
  /** Public timeline entries kept in state. */
  log: 80,
} as const;

export const DeceptionRoleSetSchema = z.enum(['beginner', 'standard', 'custom']);
export type DeceptionRoleSet = z.infer<typeof DeceptionRoleSetSchema>;

export const DeceptionSettingsSchema = z.object({
  /** Beginner (Scanner + Firewall), Standard (scales with players) or a custom mix. */
  roleSet: DeceptionRoleSetSchema,
  /** Custom mix: which special roles are in play (each at most once). */
  customRoles: z.object({
    scanner: z.boolean(),
    firewall: z.boolean(),
    tracer: z.boolean(),
    sudo: z.boolean(),
    jammer: z.boolean(),
  }),
  /** Custom mix: Glitch team size (0 = automatic from the player count). */
  glitchCount: z.number().int().min(0).max(DECEPTION_LIMITS.maxGlitches),
  /** Reveal a player's role when they are disconnected or corrupted. */
  revealRoles: z.boolean(),
  nightSeconds: z.number().int().min(20).max(120),
  discussionSeconds: z.number().int().min(30).max(300),
  voteSeconds: z.number().int().min(15).max(120),
  /** Players may vote "Skip" (skip beats or ties the top suspect → nobody is disconnected). */
  allowSkip: z.boolean(),
  /** Tied top vote: 'runoff' = one runoff vote between the tied players (tied again → nobody), 'none' = nobody. */
  tieRule: z.enum(['runoff', 'none']),
  /** 'full' = everyone sees who voted for whom; 'tally' = only the totals. */
  voteReveal: z.enum(['full', 'tally']),
});
export type DeceptionSettings = z.infer<typeof DeceptionSettingsSchema>;

export const DEFAULT_DECEPTION_SETTINGS: DeceptionSettings = {
  roleSet: 'standard',
  customRoles: { scanner: true, firewall: true, tracer: false, sudo: true, jammer: false },
  glitchCount: 0,
  revealRoles: true,
  nightSeconds: 40,
  discussionSeconds: 90,
  voteSeconds: 40,
  allowSkip: true,
  tieRule: 'runoff',
  voteReveal: 'full',
};

// ---------------------------------------------------------------------------
// Setup table (pure; used by the server at start and by the lobby preview)
// ---------------------------------------------------------------------------

/**
 * Glitch team size by player count (≈ one Glitch per 3–4 players):
 *
 * | Players | Glitches |
 * |---------|----------|
 * | 4       | 1 (mini setup) |
 * | 5–6     | 1        |
 * | 7–9     | 2        |
 * | 10–12   | 3        |
 * | 13–16   | 4        |
 * | 17–20   | 5        |
 */
export function autoGlitchCount(players: number): number {
  if (players <= 6) return 1;
  if (players <= 9) return 2;
  if (players <= 12) return 3;
  if (players <= 16) return 4;
  return 5;
}

/**
 * Special roles per preset:
 * - Beginner: Scanner + Firewall at every size.
 * - Standard: Scanner + Firewall; + Sudo from 6 players; + Jammer (one of the Glitches) from 7;
 *   + Tracer from 10.
 * The 4-player "mini setup" is 1 Glitch, Scanner, Firewall and 1 Sysop — quick and swingy,
 * meant for trying the game out rather than serious play.
 */
export function presetSpecials(roleSet: Exclude<DeceptionRoleSet, 'custom'>, players: number): DeceptionSpecial[] {
  if (roleSet === 'beginner') return ['scanner', 'firewall'];
  const out: DeceptionSpecial[] = ['scanner', 'firewall'];
  if (players >= 6) out.push('sudo');
  if (players >= 7) out.push('jammer');
  if (players >= 10) out.push('tracer');
  return out;
}

export interface DeceptionSetup {
  players: number;
  glitches: number;
  /** Role → count (every role present, 0 when absent). Sums to `players`. */
  counts: Record<DeceptionRole, number>;
}

export type DeceptionSetupResult = { ok: true; setup: DeceptionSetup } | { ok: false; error: string };

/** The role list for `players` seats under `settings`, or a human-readable reason it can't start. */
export function planSetup(
  players: number,
  settings: Pick<DeceptionSettings, 'roleSet' | 'customRoles' | 'glitchCount'>,
): DeceptionSetupResult {
  if (!Number.isInteger(players) || players < DECEPTION_LIMITS.minPlayers) {
    return { ok: false, error: `DASception needs at least ${DECEPTION_LIMITS.minPlayers} players.` };
  }
  if (players > DECEPTION_LIMITS.maxPlayers) {
    return { ok: false, error: `DASception supports at most ${DECEPTION_LIMITS.maxPlayers} players.` };
  }
  const roleSet = settings.roleSet;
  const custom = roleSet === 'custom';
  const specials = roleSet === 'custom' ? DECEPTION_SPECIALS.filter((r) => settings.customRoles[r]) : presetSpecials(roleSet, players);
  const glitches = custom && settings.glitchCount > 0 ? settings.glitchCount : autoGlitchCount(players);
  if (glitches < 1) return { ok: false, error: 'There must be at least one Glitch.' };
  if (glitches * 2 >= players) {
    return { ok: false, error: `${glitches} Glitches is too many for ${players} players — the Glitches must start as a minority.` };
  }
  const sysopSpecials = specials.filter((r) => roleTeam(r) === 'sysops');
  const sysopSeats = players - glitches;
  if (sysopSpecials.length > sysopSeats) {
    return { ok: false, error: `Too many special Sysop roles (${sysopSpecials.length}) for ${sysopSeats} Sysop seats.` };
  }
  const counts = Object.fromEntries(DECEPTION_ROLES.map((r) => [r, 0])) as Record<DeceptionRole, number>;
  for (const r of sysopSpecials) counts[r] = 1;
  counts.sysop = sysopSeats - sysopSpecials.length;
  const jammer = specials.includes('jammer');
  counts.jammer = jammer ? 1 : 0;
  counts.glitch = glitches - counts.jammer;
  return { ok: true, setup: { players, glitches, counts } };
}

/** "2 Glitches (1 Jammer) · Scanner · Firewall · 3 Sysops" style summary. */
export function describeSetup(setup: DeceptionSetup): string {
  const parts: string[] = [];
  const g = setup.glitches;
  parts.push(`${g} Glitch${g === 1 ? '' : 'es'}${setup.counts.jammer ? ' (incl. Jammer)' : ''}`);
  for (const r of ['scanner', 'firewall', 'tracer', 'sudo'] as const) if (setup.counts[r]) parts.push(DECEPTION_ROLE_INFO[r].name);
  if (setup.counts.sysop) parts.push(`${setup.counts.sysop} Sysop${setup.counts.sysop === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const DECEPTION_MSG = {
  /** client → server: I've read my role card (boot) / I'm ready to vote (day). */
  ready: 'deception:ready',
  /** client → server: a night action ({ kind, target, lock }). */
  act: 'deception:act',
  /** client → server: a day vote ({ target | 'skip', sudo }). One per player per vote round. */
  vote: 'deception:vote',
  /** client → server: a line in the Glitch team channel (living Glitches, night only). */
  teamSay: 'deception:teamsay',
  /** server → one player: everything private this player may currently know. */
  private: 'deception:private',
  /** server → living Glitches: the team channel log. */
  team: 'deception:team',
  /** server → everyone: public moments for sounds/animation (state stays the source of truth). */
  event: 'deception:event',
} as const;

const PlayerIdSchema = z.string().min(1).max(64);

export const DeceptionReadySchema = z.object({ ready: z.boolean() });
export type DeceptionReadyPayload = z.infer<typeof DeceptionReadySchema>;

export const DeceptionActSchema = z.object({
  kind: z.enum(DECEPTION_ACTIONS),
  /** null clears an unlocked pick. */
  target: PlayerIdSchema.nullable(),
  /** Lock the pick in (can't change it afterwards). */
  lock: z.boolean().optional(),
});
export type DeceptionActPayload = z.infer<typeof DeceptionActSchema>;

export const DeceptionVoteSchema = z.object({
  target: z.union([PlayerIdSchema, z.literal('skip')]),
  /** Sudo only, once per game, never on "skip". */
  sudo: z.boolean().optional(),
});
export type DeceptionVotePayload = z.infer<typeof DeceptionVoteSchema>;

export const DeceptionTeamSaySchema = z.object({ text: z.string().min(1).max(500) });

// ---------------------------------------------------------------------------
// Public (synchronized) state
// ---------------------------------------------------------------------------

export const DECEPTION_STAGES = ['idle', 'boot', 'night', 'dawn', 'day', 'vote', 'runoff', 'verdict', 'final'] as const;
export type DeceptionStage = (typeof DECEPTION_STAGES)[number];

export type DeceptionFate = '' | 'corrupted' | 'disconnected' | 'left';

/** Per-player public status ("network node"). */
export interface DeceptionNodeView {
  /** Seat order (join order at the deal). */
  seat: number;
  /** Captured at the deal (players who leave stay recognisable). */
  name: string;
  avatar: string;
  color: string;
  alive: boolean;
  /** Night/cycle the player went offline (0 = still online). */
  outCycle: number;
  fate: DeceptionFate;
  /** Role — '' unless revealed (on elimination when revealRoles is on, or at the end). */
  role: DeceptionRole | '';
}

/** One public line of the match timeline. */
export type DeceptionLogEntry =
  | { kind: 'dawn'; cycle: number; outcome: 'corrupted' | 'blocked' | 'quiet'; playerId?: string; role?: DeceptionRole | '' }
  | {
      kind: 'verdict';
      cycle: number;
      outcome: 'disconnected' | 'tie' | 'skipped' | 'no_votes';
      playerId?: string;
      role?: DeceptionRole | '';
      runoff: boolean;
    }
  | { kind: 'left'; cycle: number; playerId: string; role?: DeceptionRole | '' };

export interface DeceptionDawnReport {
  cycle: number;
  outcome: 'corrupted' | 'blocked' | 'quiet';
  playerId?: string;
  role?: DeceptionRole | '';
}

export interface DeceptionVoteLine {
  voterId: string;
  target: string | 'skip';
  weight: number;
}

export interface DeceptionVerdict {
  cycle: number;
  runoff: boolean;
  mode: 'full' | 'tally';
  /** Full mode: every cast vote (abstentions omitted). Tally mode: []. */
  votes: DeceptionVoteLine[];
  /** Totals per target (player id or 'skip'), highest first. */
  tally: Array<{ target: string | 'skip'; votes: number }>;
  /** A Sudo vote was cast this round (tally mode shows this without the name). */
  sudo: boolean;
  outcome: 'disconnected' | 'tie' | 'skipped' | 'no_votes' | 'runoff';
  playerId?: string;
  role?: DeceptionRole | '';
  /** Tied players when the outcome is a tie or a runoff. */
  tied?: string[];
  abstained: number;
}

/** Full reveal published when the match ends (everyone, including spectators). */
export interface DeceptionFinalReport {
  winner: DeceptionTeam;
  reason: 'purged' | 'takeover' | 'timeout';
  roles: Array<{ playerId: string; name: string; role: DeceptionRole; alive: boolean; fate: DeceptionFate; score: number }>;
  /** Night-by-night secrets, revealed at the end. */
  nights: DeceptionNightRecap[];
  awards: Array<{ id: 'sharp' | 'survivor' | 'shield' | 'scanner' | 'mastermind'; playerId: string; name: string; value: string }>;
}

export interface DeceptionNightRecap {
  cycle: number;
  attackTarget: string | null;
  blocked: boolean;
  shields: Array<{ actorId: string; targetId: string; jammed: boolean }>;
  scans: Array<{ actorId: string; targetId: string; result: DeceptionScanResult }>;
  jams: Array<{ actorId: string; targetId: string }>;
  clues: Array<{ actorId: string; pair: [string, string] | null; jammed: boolean }>;
}

/**
 * Public state. Extends the party kit view: `seats[id].answered` means "read my role card"
 * during boot, "ready to vote" during the day and "has voted" during a vote/runoff — it is
 * never set during the night (that would reveal who has a night ability).
 */
export interface DeceptionPublicState extends PartyPublicView {
  stage: DeceptionStage;
  /** Match counter: private payloads carry the same number (ignore stale ones). */
  match: number;
  cycle: number;
  /** Per-player public status keyed by player id (match participants only). */
  nodes: Record<string, DeceptionNodeView>;
  /** JSON DeceptionSetup of the running match (role counts are public; who has them is not). */
  setupJson: string;
  /** JSON DeceptionDawnReport of the latest dawn ('' before the first). */
  dawnJson: string;
  /** JSON DeceptionVerdict of the latest vote ('' before the first). */
  verdictJson: string;
  /** JSON string[]: players in the current runoff. */
  runoffJson: string;
  /** JSON DeceptionLogEntry[]: the public timeline. */
  logJson: string;
  winner: DeceptionTeam | '';
  /** JSON DeceptionFinalReport ('' until the match ends). */
  finalJson: string;
}

// ---------------------------------------------------------------------------
// Private payloads
// ---------------------------------------------------------------------------

export type DeceptionScanResult = 'glitch' | 'clean' | 'jammed';

/** What a player learned from their own ability (history, newest last). */
export type DeceptionIntel =
  | { kind: 'scan'; cycle: number; targetId: string; result: DeceptionScanResult }
  | { kind: 'shield'; cycle: number; targetId: string; outcome: 'held' | 'quiet' | 'jammed' }
  | { kind: 'clue'; cycle: number; pair: [string, string] | null; jammed: boolean }
  | { kind: 'jam'; cycle: number; targetId: string }
  | { kind: 'attack'; cycle: number; targetId: string | null; outcome: 'corrupted' | 'blocked' | 'none' };

export interface DeceptionPick {
  target: string | null;
  locked: boolean;
}

export interface DeceptionPrivate {
  /** Increments per match so stale payloads from a previous match are ignored. */
  match: number;
  /** null for spectators and players not dealt into this match. */
  role: DeceptionRole | null;
  team: DeceptionTeam | null;
  alive: boolean;
  /** Glitch team only: every Glitch (including you) with their role and status. */
  allies: Array<{ id: string; role: DeceptionRole; alive: boolean }>;
  /** Your picks this night (only the kinds your role has). */
  picks: Partial<Record<DeceptionActionKind, DeceptionPick>>;
  /** Glitch team only: each living Glitch's current attack pick this night. */
  teamPicks: Array<{ id: string; target: string | null; locked: boolean }>;
  /** Firewall: who you shielded last night (can't pick them again tonight). */
  lastShield: string | null;
  /** Sudo: already used the double vote. */
  sudoUsed: boolean;
  /** Your vote in the current vote/runoff (private until the reveal). */
  vote: { target: string | 'skip'; sudo: boolean } | null;
  /** Everything your ability told you so far. */
  intel: DeceptionIntel[];
}

export interface DeceptionTeamLine {
  id: string;
  playerId: string;
  name: string;
  text: string;
  ts: number;
  cycle: number;
}

export interface DeceptionTeamLog {
  match: number;
  lines: DeceptionTeamLine[];
}

export type DeceptionEvent =
  | { type: 'boot' }
  | { type: 'night'; cycle: number }
  | { type: 'dawn'; cycle: number; outcome: DeceptionDawnReport['outcome']; playerId?: string }
  | { type: 'day'; cycle: number }
  | { type: 'vote'; cycle: number; runoff: boolean }
  | { type: 'verdict'; cycle: number; outcome: DeceptionVerdict['outcome']; playerId?: string }
  | { type: 'left'; playerId: string }
  | { type: 'final'; winner: DeceptionTeam };

/** Ghost channel: chat from eliminated players and spectators (never reaches living players mid-match). */
export const DECEPTION_GHOST_PREFIX = 'ghost_';
