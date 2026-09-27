/**
 * DeceptionGame — the complete, pure DASception rules state for one match.
 *
 * The room owns timers, networking and privacy; this class owns every rule:
 * who is online, night picks (validated per role), night resolution, votes (private until
 * tallied), Sudo, runoffs, eliminations, intel history, win checks and final scoring.
 * Deterministic for a given Rng (tests use createSeededRng; the server uses crypto).
 */
import type { Rng } from '@dascade/shared';
import {
  DECEPTION_ROLE_INFO,
  roleTeam,
  type DeceptionActionKind,
  type DeceptionFate,
  type DeceptionFinalReport,
  type DeceptionIntel,
  type DeceptionNightRecap,
  type DeceptionPick,
  type DeceptionRole,
  type DeceptionSetup,
  type DeceptionTeam,
} from '@dascade/shared/games/deception';
import { dealRoles } from './roles.ts';
import { resolveNight, type NightOutcome } from './night.ts';
import { tallyVotes, type CastVote, type VoteOutcome } from './vote.ts';

export type DeceptionErrorCode = 'not_allowed' | 'wrong_phase' | 'invalid_target' | 'locked' | 'already_voted';

export type DeceptionResult = { ok: true } | { ok: false; code: DeceptionErrorCode; message: string };

const ok: DeceptionResult = { ok: true };
const fail = (code: DeceptionErrorCode, message: string): DeceptionResult => ({ ok: false, code, message });

/** Points: team victory, survival, and good calls (see scoreboard in the rules drawer). */
export const DECEPTION_POINTS = { win: 100, survive: 25, goodVote: 10, glitchVote: 10 } as const;

export interface DeceptionSeat {
  id: string;
  role: DeceptionRole;
  alive: boolean;
  fate: DeceptionFate;
  outCycle: number;
}

export interface DeceptionWin {
  team: DeceptionTeam;
  reason: DeceptionFinalReport['reason'];
}

interface Stats {
  /** Sysop votes cast on actual Glitches. */
  goodVotes: number;
  /** Glitch votes for a Sysop who was then disconnected. */
  glitchVotes: number;
  /** Day votes received (all rounds). */
  votesAgainst: number;
  shieldsHeld: number;
  glitchesFound: number;
}

export class DeceptionGame {
  readonly seats = new Map<string, DeceptionSeat>();
  /** Current night number (1 = first night). */
  cycle = 0;
  private nightOpen = false;
  private voteOpen = false;
  private picks = new Map<string, Partial<Record<DeceptionActionKind, DeceptionPick>>>();
  private readonly lastShield = new Map<string, string>();
  private readonly sudoSpent = new Set<string>();
  private votes = new Map<string, CastVote>();
  private runoffCandidates: string[] | null = null;
  private readonly intel = new Map<string, DeceptionIntel[]>();
  private readonly stats = new Map<string, Stats>();
  readonly nights: DeceptionNightRecap[] = [];

  constructor(roles: ReadonlyMap<string, DeceptionRole>) {
    for (const [id, role] of roles) {
      this.seats.set(id, { id, role, alive: true, fate: '', outCycle: 0 });
      this.intel.set(id, []);
      this.stats.set(id, { goodVotes: 0, glitchVotes: 0, votesAgainst: 0, shieldsHeld: 0, glitchesFound: 0 });
    }
  }

  /** Deal a new match: `playerIds` in join order. */
  static deal(playerIds: readonly string[], setup: DeceptionSetup, rng: Rng): DeceptionGame {
    return new DeceptionGame(dealRoles(playerIds, setup, rng));
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  has(id: string): boolean {
    return this.seats.has(id);
  }

  roleOf(id: string): DeceptionRole | null {
    return this.seats.get(id)?.role ?? null;
  }

  teamOf(id: string): DeceptionTeam | null {
    const role = this.roleOf(id);
    return role ? roleTeam(role) : null;
  }

  isAlive(id: string): boolean {
    return this.seats.get(id)?.alive === true;
  }

  isGlitch(id: string): boolean {
    return this.teamOf(id) === 'glitches';
  }

  /** Online (not eliminated) player ids, in seat order. */
  alive(): string[] {
    return [...this.seats.values()].filter((s) => s.alive).map((s) => s.id);
  }

  livingOf(team: DeceptionTeam): string[] {
    return this.alive().filter((id) => this.teamOf(id) === team);
  }

  /** Glitch roster (for Glitch players only — the room must never send this to anyone else). */
  glitchRoster(): Array<{ id: string; role: DeceptionRole; alive: boolean }> {
    return [...this.seats.values()].filter((s) => roleTeam(s.role) === 'glitches').map((s) => ({ id: s.id, role: s.role, alive: s.alive }));
  }

  /** Night action kinds this player has tonight (none when offline). */
  actionsOf(id: string): readonly DeceptionActionKind[] {
    const seat = this.seats.get(id);
    if (!seat || !seat.alive) return [];
    return DECEPTION_ROLE_INFO[seat.role].actions;
  }

  picksOf(id: string): Partial<Record<DeceptionActionKind, DeceptionPick>> {
    const out: Partial<Record<DeceptionActionKind, DeceptionPick>> = {};
    for (const kind of this.actionsOf(id)) out[kind] = { ...(this.picks.get(id)?.[kind] ?? { target: null, locked: false }) };
    return out;
  }

  /** Each living Glitch's current attack pick (Glitch team view). */
  teamPicks(): Array<{ id: string; target: string | null; locked: boolean }> {
    return this.livingOf('glitches').map((id) => {
      const pick = this.picks.get(id)?.attack;
      return { id, target: pick?.target ?? null, locked: pick?.locked ?? false };
    });
  }

  lastShieldOf(id: string): string | null {
    return this.lastShield.get(id) ?? null;
  }

  sudoUsed(id: string): boolean {
    return this.sudoSpent.has(id);
  }

  voteOf(id: string): CastVote | null {
    const v = this.votes.get(id);
    return v ? { ...v } : null;
  }

  hasVoted(id: string): boolean {
    return this.votes.has(id);
  }

  intelOf(id: string): DeceptionIntel[] {
    return (this.intel.get(id) ?? []).map((i) => structuredClone(i));
  }

  get isNight(): boolean {
    return this.nightOpen;
  }

  get isVoting(): boolean {
    return this.voteOpen;
  }

  get runoff(): readonly string[] | null {
    return this.runoffCandidates;
  }

  /** Candidates of the open vote (everyone online, or the runoff players). */
  voteCandidates(): string[] {
    if (this.runoffCandidates) return this.runoffCandidates.filter((id) => this.isAlive(id));
    return this.alive();
  }

  /** Every online player accepted by `active` has locked every night action they have. */
  nightDone(active: (id: string) => boolean = () => true): boolean {
    for (const id of this.alive()) {
      if (!active(id)) continue;
      for (const kind of this.actionsOf(id)) if (!this.picks.get(id)?.[kind]?.locked) return false;
    }
    return true;
  }

  /** Every online player accepted by `active` has voted. */
  votesDone(active: (id: string) => boolean = () => true): boolean {
    return this.alive().every((id) => !active(id) || this.votes.has(id));
  }

  // ---------------------------------------------------------------------------
  // Night
  // ---------------------------------------------------------------------------

  beginNight(): void {
    this.cycle++;
    this.nightOpen = true;
    this.voteOpen = false;
    this.picks = new Map();
  }

  submitAction(actorId: string, kind: DeceptionActionKind, target: string | null, lock = false): DeceptionResult {
    if (!this.nightOpen) return fail('wrong_phase', 'Night actions are only possible during the blackout.');
    const actor = this.seats.get(actorId);
    if (!actor) return fail('not_allowed', 'You are not playing in this match.');
    if (!actor.alive) return fail('not_allowed', 'You are offline — you can no longer act.');
    if (!DECEPTION_ROLE_INFO[actor.role].actions.includes(kind)) return fail('not_allowed', 'Your role does not have that ability.');
    const mine = this.picks.get(actorId) ?? {};
    if (mine[kind]?.locked) return fail('locked', 'You already locked that in.');
    if (target === null) {
      if (lock) return fail('invalid_target', 'Pick a player first.');
      mine[kind] = { target: null, locked: false };
      this.picks.set(actorId, mine);
      return ok;
    }
    const t = this.seats.get(target);
    if (!t || !t.alive) return fail('invalid_target', 'That player is not online.');
    switch (kind) {
      case 'scan':
        if (target === actorId) return fail('invalid_target', 'You cannot scan yourself.');
        break;
      case 'shield':
        if (this.lastShield.get(actorId) === target)
          return fail('invalid_target', 'You cannot shield the same player two nights in a row.');
        break;
      case 'jam':
        if (target === actorId) return fail('invalid_target', 'You cannot jam yourself.');
        if (roleTeam(t.role) === 'glitches') return fail('invalid_target', 'You cannot jam a fellow Glitch.');
        break;
      case 'attack':
        if (roleTeam(t.role) === 'glitches') return fail('invalid_target', 'Glitches cannot target a fellow Glitch.');
        break;
    }
    mine[kind] = { target, locked: lock };
    this.picks.set(actorId, mine);
    return ok;
  }

  /** Close the night: resolve every pick, corrupt the target, record intel. */
  resolveNight(rng: Rng): NightOutcome {
    const byKind = (kind: DeceptionActionKind) => {
      const m = new Map<string, string | null>();
      for (const [id, p] of this.picks) {
        const pick = p[kind];
        if (pick?.target) m.set(id, pick.target);
      }
      return m;
    };
    const outcome = resolveNight(
      {
        cycle: this.cycle,
        roles: new Map([...this.seats.values()].map((s) => [s.id, s.role])),
        alive: new Set(this.alive()),
        attacks: byKind('attack'),
        scans: byKind('scan'),
        shields: byKind('shield'),
        jams: byKind('jam'),
        lastShield: this.lastShield,
      },
      rng,
    );
    this.nightOpen = false;

    // Firewall "not twice in a row" tracks the pick (even a jammed one); no pick clears it.
    for (const s of [...this.seats.values()].filter((x) => x.role === 'firewall')) {
      const pick = this.picks.get(s.id)?.shield?.target;
      const valid = outcome.shields.find((sh) => sh.actorId === s.id);
      if (pick && valid) this.lastShield.set(s.id, pick);
      else this.lastShield.delete(s.id);
    }

    const glitchesAtNight = this.livingOf('glitches');
    if (outcome.corrupted) this.eliminate(outcome.corrupted, 'corrupted');

    for (const s of outcome.scans) {
      this.pushIntel(s.actorId, { kind: 'scan', cycle: this.cycle, targetId: s.targetId, result: s.result });
      if (s.result === 'glitch') this.stat(s.actorId).glitchesFound++;
    }
    for (const s of outcome.shields) {
      this.pushIntel(s.actorId, {
        kind: 'shield',
        cycle: this.cycle,
        targetId: s.targetId,
        outcome: s.jammed ? 'jammed' : s.held ? 'held' : 'quiet',
      });
      if (s.held) this.stat(s.actorId).shieldsHeld++;
    }
    for (const c of outcome.clues) this.pushIntel(c.actorId, { kind: 'clue', cycle: this.cycle, pair: c.pair, jammed: c.jammed });
    for (const j of outcome.jams) this.pushIntel(j.actorId, { kind: 'jam', cycle: this.cycle, targetId: j.targetId });
    for (const g of glitchesAtNight) {
      this.pushIntel(g, {
        kind: 'attack',
        cycle: this.cycle,
        targetId: outcome.attackTarget,
        outcome: outcome.attackTarget === null ? 'none' : outcome.blocked ? 'blocked' : 'corrupted',
      });
    }

    this.nights.push({
      cycle: this.cycle,
      attackTarget: outcome.attackTarget,
      blocked: outcome.blocked,
      shields: outcome.shields.map((s) => ({ actorId: s.actorId, targetId: s.targetId, jammed: s.jammed })),
      scans: outcome.scans.map((s) => ({ ...s })),
      jams: outcome.jams.map((j) => ({ ...j })),
      clues: outcome.clues.map((c) => ({ actorId: c.actorId, pair: c.pair ? [c.pair[0], c.pair[1]] : null, jammed: c.jammed })),
    });
    this.picks = new Map();
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Day vote
  // ---------------------------------------------------------------------------

  /** Open a vote. `runoff` limits the candidates (a runoff between tied players). */
  beginVote(runoff: readonly string[] | null = null): void {
    this.voteOpen = true;
    this.nightOpen = false;
    this.votes = new Map();
    this.runoffCandidates = runoff ? [...runoff] : null;
  }

  castVote(voterId: string, target: string | 'skip', opts: { sudo?: boolean; allowSkip: boolean }): DeceptionResult {
    if (!this.voteOpen) return fail('wrong_phase', 'Voting is closed.');
    const voter = this.seats.get(voterId);
    if (!voter) return fail('not_allowed', 'You are not playing in this match.');
    if (!voter.alive) return fail('not_allowed', 'You are offline — you can no longer vote.');
    if (this.votes.has(voterId)) return fail('already_voted', 'Your vote is already locked in.');
    const sudo = Boolean(opts.sudo);
    if (target === 'skip') {
      if (!opts.allowSkip) return fail('not_allowed', 'Skipping is turned off in this game — pick a player.');
      if (sudo) return fail('not_allowed', 'A Sudo vote must name a player.');
    } else {
      if (target === voterId) return fail('invalid_target', 'You cannot vote for yourself.');
      if (!this.voteCandidates().includes(target)) {
        return fail(
          'invalid_target',
          this.runoffCandidates ? 'In a runoff you can only vote for the tied players.' : 'That player is not online.',
        );
      }
    }
    if (sudo) {
      if (voter.role !== 'sudo') return fail('not_allowed', 'Only the Sudo can cast a Sudo vote.');
      if (this.sudoSpent.has(voterId)) return fail('not_allowed', 'You already used your Sudo vote.');
      this.sudoSpent.add(voterId);
    }
    this.votes.set(voterId, { target, sudo });
    return ok;
  }

  /**
   * Close the vote and apply it. A 'runoff' outcome leaves the candidates in `runoff` for the
   * room to open a runoff vote with `beginVote(game.runoff)`.
   */
  resolveVote(opts: { allowSkip: boolean; tieRule: 'runoff' | 'none' }): VoteOutcome {
    const isRunoff = this.runoffCandidates !== null;
    const outcome = tallyVotes({
      voters: new Set(this.alive()),
      candidates: new Set(this.voteCandidates()),
      votes: this.votes,
      allowSkip: opts.allowSkip,
      tieRule: opts.tieRule,
      isRunoff,
    });
    this.voteOpen = false;
    for (const line of outcome.lines) {
      if (line.target === 'skip') continue;
      this.stat(line.target).votesAgainst += line.weight;
      if (!this.isGlitch(line.voterId) && this.isGlitch(line.target)) this.stat(line.voterId).goodVotes++;
    }
    if (outcome.outcome === 'disconnected' && outcome.playerId) {
      const out = outcome.playerId;
      if (!this.isGlitch(out)) {
        for (const line of outcome.lines) if (line.target === out && this.isGlitch(line.voterId)) this.stat(line.voterId).glitchVotes++;
      }
      this.eliminate(out, 'disconnected');
    }
    this.runoffCandidates = outcome.outcome === 'runoff' ? [...(outcome.tied ?? [])] : null;
    this.votes = new Map();
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Eliminations + win
  // ---------------------------------------------------------------------------

  /** Take a player offline (corrupted at night, disconnected by vote, or left the room). */
  eliminate(id: string, fate: Exclude<DeceptionFate, ''>): boolean {
    const seat = this.seats.get(id);
    if (!seat || !seat.alive) return false;
    seat.alive = false;
    seat.fate = fate;
    seat.outCycle = this.cycle;
    this.picks.delete(id);
    // A Glitch pick at someone who just went offline is void.
    for (const p of this.picks.values()) {
      for (const kind of Object.keys(p) as DeceptionActionKind[]) {
        const pick = p[kind];
        if (pick?.target === id) p[kind] = { target: null, locked: false };
      }
    }
    // While a vote is open, the leaver's own vote is void, and so are votes for them: those
    // voters may vote again (a spent Sudo vote is refunded).
    if (this.voteOpen) {
      this.votes.delete(id);
      for (const [voter, vote] of this.votes) {
        if (vote.target !== id) continue;
        this.votes.delete(voter);
        if (vote.sudo) this.sudoSpent.delete(voter);
      }
    }
    return true;
  }

  /** Sysops win when no Glitch is online; Glitches win once they equal or outnumber the Sysops. */
  winner(): DeceptionWin | null {
    const glitches = this.livingOf('glitches').length;
    const sysops = this.livingOf('sysops').length;
    if (glitches === 0) return { team: 'sysops', reason: 'purged' };
    if (glitches >= sysops) return { team: 'glitches', reason: 'takeover' };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Final report
  // ---------------------------------------------------------------------------

  scoreOf(id: string, winner: DeceptionTeam): number {
    const seat = this.seats.get(id);
    if (!seat) return 0;
    const st = this.stat(id);
    let score = 0;
    if (roleTeam(seat.role) === winner) score += DECEPTION_POINTS.win;
    if (seat.alive) score += DECEPTION_POINTS.survive;
    score += st.goodVotes * DECEPTION_POINTS.goodVote + st.glitchVotes * DECEPTION_POINTS.glitchVote;
    return score;
  }

  finalReport(win: DeceptionWin, names: ReadonlyMap<string, string>): DeceptionFinalReport {
    const nameOf = (id: string) => names.get(id) ?? 'Player';
    const roles = [...this.seats.values()].map((s) => ({
      playerId: s.id,
      name: nameOf(s.id),
      role: s.role,
      alive: s.alive,
      fate: s.fate,
      score: this.scoreOf(s.id, win.team),
    }));
    const awards: DeceptionFinalReport['awards'] = [];
    const best = (pick: (st: Stats, seat: DeceptionSeat) => number, filter: (seat: DeceptionSeat) => boolean) => {
      let top: { seat: DeceptionSeat; value: number } | null = null;
      for (const seat of this.seats.values()) {
        if (!filter(seat)) continue;
        const value = pick(this.stat(seat.id), seat);
        if (value > 0 && (!top || value > top.value)) top = { seat, value };
      }
      return top;
    };
    const sharp = best(
      (st) => st.goodVotes,
      (s) => roleTeam(s.role) === 'sysops',
    );
    if (sharp)
      awards.push({
        id: 'sharp',
        playerId: sharp.seat.id,
        name: nameOf(sharp.seat.id),
        value: `${sharp.value} vote${sharp.value === 1 ? '' : 's'} on Glitches`,
      });
    const scanner = best(
      (st) => st.glitchesFound,
      (s) => s.role === 'scanner',
    );
    if (scanner)
      awards.push({
        id: 'scanner',
        playerId: scanner.seat.id,
        name: nameOf(scanner.seat.id),
        value: `found ${scanner.value} Glitch${scanner.value === 1 ? '' : 'es'}`,
      });
    const shield = best(
      (st) => st.shieldsHeld,
      (s) => s.role === 'firewall',
    );
    if (shield)
      awards.push({
        id: 'shield',
        playerId: shield.seat.id,
        name: nameOf(shield.seat.id),
        value: `blocked ${shield.value} attack${shield.value === 1 ? '' : 's'}`,
      });
    // Mastermind: the surviving Glitch who drew the fewest votes (stayed under the radar).
    const survivors = [...this.seats.values()].filter((s) => s.alive && roleTeam(s.role) === 'glitches');
    if (win.team === 'glitches' && survivors.length > 0) {
      const quietest = survivors.sort((a, b) => this.stat(a.id).votesAgainst - this.stat(b.id).votesAgainst)[0] as DeceptionSeat;
      const n = this.stat(quietest.id).votesAgainst;
      awards.push({
        id: 'mastermind',
        playerId: quietest.id,
        name: nameOf(quietest.id),
        value: `${n} vote${n === 1 ? '' : 's'} against all game`,
      });
    }
    const lastSysop = win.team === 'sysops' ? [...this.seats.values()].filter((s) => s.alive && roleTeam(s.role) === 'sysops') : [];
    if (lastSysop.length === 1) {
      const s = lastSysop[0] as DeceptionSeat;
      awards.push({ id: 'survivor', playerId: s.id, name: nameOf(s.id), value: 'last Sysop standing' });
    }
    return { winner: win.team, reason: win.reason, roles, nights: this.nights.map((n) => structuredClone(n)), awards };
  }

  private pushIntel(id: string, entry: DeceptionIntel): void {
    this.intel.get(id)?.push(entry);
  }

  private stat(id: string): Stats {
    let st = this.stats.get(id);
    if (!st) {
      st = { goodVotes: 0, glitchVotes: 0, votesAgainst: 0, shieldsHeld: 0, glitchesFound: 0 };
      this.stats.set(id, st);
    }
    return st;
  }
}
