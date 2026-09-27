/**
 * TournamentEngine — the pure, deterministic Tournament Center rules.
 *
 * State is a plain JSON `TournamentData` (snapshot/restore/persist freely). Every mutation
 * validates its preconditions (throwing `TournamentError` on bad input), applies the change,
 * then `refresh()` re-derives the bracket: slots resolve from finished feeder matches, byes and
 * forfeits settle automatically, matches become READY when both participants are known (and the
 * event isn't paused), Swiss rounds are paired when the previous round is done, and the event
 * completes when nothing is left to play. Organizers never edit brackets by hand.
 *
 * Idempotency: `recordGame` accepts game N of a match only once and only while the match is live;
 * stale/duplicate reports are ignored and reported as such. Because resolution is re-derived from
 * results, the order in which concurrent matches finish never changes the outcome.
 *
 * Randomness (random seeding, lots, first-round colours) comes from the injected Rng — the server
 * passes its crypto RNG, tests a seeded one.
 */
import {
  GAME_CATALOG,
  LIMITS,
  cleanNickname,
  maskProfanity,
  randomId,
  type Rng,
  type SeedingMethod,
  type TournamentAuditActor,
  type TournamentAuditEntry,
  type TournamentCapability,
  type TournamentConfig,
  type TournamentRoundView,
  type TournamentStandings,
  type TournamentStatus,
} from '@dascade/shared';
import { buildDoubleElimination, buildSingleElimination, newMatch, roundRobinSchedule } from './brackets.ts';
import { deciderFor, firstForGame, seriesState, type SeriesSpec, type SeriesState } from './series.ts';
import { computeStandings, eliminationOutcome, fieldOf, isFinished, isOut } from './standings.ts';
import { colourPreference, pairSwissRound, type SwissPlayer } from './swiss.ts';
import { TournamentError, type EngineEvent, type EngineMatch, type EngineParticipant, type TournamentData } from './types.ts';

export interface EngineDeps {
  rng: Rng;
  now: () => number;
}

export interface RegisterInput {
  name: string;
  avatar: string;
  identity: string | null;
  rating: number;
  ratingGames: number;
  provisional: boolean;
}

export interface RecordGameResult {
  accepted: boolean;
  /** Why a report was ignored: 'not_live' | 'stale' | 'invalid_winner'. */
  reason?: string;
  decided: boolean;
  series: SeriesState | null;
}

/** Audit entries kept in engine data (the public state shows the last TOURNAMENT_LIMITS.audit). */
const AUDIT_KEEP = 500;
const PRE_START: readonly TournamentStatus[] = ['DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY'];
const TERMINAL: readonly TournamentStatus[] = ['COMPLETE', 'CANCELLED'];

export function autoSwissRounds(n: number): number {
  if (n <= 2) return 1;
  const log = Math.ceil(Math.log2(n));
  return Math.min(n - 1, Math.max(3, log + (n > 8 ? 1 : 0)));
}

export class TournamentEngine {
  private events: EngineEvent[] = [];

  constructor(
    public data: TournamentData,
    private readonly deps: EngineDeps,
  ) {}

  static create(config: TournamentConfig, deps: EngineDeps): TournamentEngine {
    const now = deps.now();
    const data: TournamentData = {
      version: 1,
      config: structuredClone(config),
      status: 'DRAFT',
      paused: false,
      participants: [],
      seedingMethod: null,
      matches: [],
      roundsPaired: 0,
      totalRounds: 0,
      championId: null,
      checkInEndsAt: 0,
      createdAt: now,
      startedAt: 0,
      completedAt: 0,
      endedEarly: false,
      audit: [],
      auditSeq: 0,
      entrySeq: 0,
    };
    return new TournamentEngine(data, deps);
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  get status(): TournamentStatus {
    return this.data.status;
  }

  get capability(): TournamentCapability {
    const cap = GAME_CATALOG[this.data.config.gameId]?.tournament;
    if (!cap) throw new TournamentError('invalid', 'This game cannot be played in tournaments.');
    return cap;
  }

  get sides(): boolean {
    return GAME_CATALOG[this.data.config.gameId]?.tournament?.sides ?? false;
  }

  participant(id: string): EngineParticipant | undefined {
    return this.data.participants.find((p) => p.id === id);
  }

  match(id: string): EngineMatch | undefined {
    return this.data.matches.find((m) => m.id === id);
  }

  /** Registered entries still in contention for a place in the field (before the start). */
  entries(): EngineParticipant[] {
    return this.data.participants.filter((p) => p.status === 'registered' || p.status === 'checked_in');
  }

  /** The participant's READY / IN_PROGRESS match (never more than one). */
  activeMatchFor(pid: string): EngineMatch | null {
    return this.data.matches.find((m) => (m.status === 'READY' || m.status === 'IN_PROGRESS') && (m.a === pid || m.b === pid)) ?? null;
  }

  seriesSpec(m: EngineMatch): SeriesSpec {
    return { a: m.a ?? '', b: m.b ?? '', bestOf: m.bestOf, requireWinner: m.requireWinner, sides: this.sides, firstId: m.firstId };
  }

  series(m: EngineMatch): SeriesState | null {
    if (!m.a || !m.b) return null;
    return seriesState(this.seriesSpec(m), m.games);
  }

  /** The game a live match plays next: number, side and decider type. */
  nextGame(m: EngineMatch): { n: number; firstId: string | null; decider: '' | 'sudden_death' | 'armageddon' } | null {
    const s = this.series(m);
    if (!s || s.decided || !s.next) return null;
    return { n: s.next.n, firstId: s.next.firstId, decider: s.next.decider };
  }

  standings(): TournamentStandings {
    return computeStandings(this.data);
  }

  rounds(): TournamentRoundView[] {
    const d = this.data;
    if (d.config.format === 'round_robin' || d.config.format === 'swiss') {
      const out: TournamentRoundView[] = [];
      for (let r = 1; r <= d.totalRounds; r++) {
        const ms = d.matches.filter((m) => m.bracket === 'main' && m.round === r);
        const bye = ms.find((m) => m.resultKind === 'bye');
        out.push({
          bracket: 'main',
          round: r,
          label: d.config.format === 'swiss' ? `Swiss round ${r}` : `Round ${r}`,
          status: roundStatus(ms),
          byeId: bye?.a ?? '',
        });
      }
      return out;
    }
    const groups = new Map<string, EngineMatch[]>();
    for (const m of d.matches) {
      const key = `${m.bracket}|${m.round}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.values()].map((ms) => ({
      bracket: ms[0]!.bracket,
      round: ms[0]!.round,
      label: ms[0]!.roundLabel,
      status: roundStatus(ms),
      byeId: '',
    }));
  }

  /** RR/Swiss: earliest round with unfinished matches. Elimination: earliest winners round still live. */
  currentRound(): number {
    const d = this.data;
    if (d.status !== 'IN_PROGRESS') return d.status === 'COMPLETE' ? d.totalRounds : 0;
    const pool = d.matches.filter((m) => m.bracket === 'main' || m.bracket === 'winners');
    const open = pool.filter((m) => !isFinished(m));
    if (open.length === 0) {
      if (d.config.format === 'swiss') return d.roundsPaired;
      return d.totalRounds;
    }
    return Math.min(...open.map((m) => m.round));
  }

  /** Short label for listings: "Semifinal", "Swiss round 3 of 5", "Registration open". */
  stageLabel(): string {
    const d = this.data;
    switch (d.status) {
      case 'DRAFT':
        return 'Draft';
      case 'REGISTRATION':
        return 'Registration open';
      case 'CHECK_IN':
        return 'Check-in open';
      case 'READY':
        return 'Starting soon';
      case 'COMPLETE':
        return 'Complete';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        break;
    }
    if (d.paused) return 'Paused';
    if (d.config.format === 'swiss' || d.config.format === 'round_robin') {
      return `${d.config.format === 'swiss' ? 'Swiss round' : 'Round'} ${this.currentRound()} of ${d.totalRounds}`;
    }
    const live = d.matches.filter((m) => !isFinished(m) && m.status !== 'WAITING');
    const first = live[0] ?? d.matches.find((m) => !isFinished(m));
    return first?.roundLabel ?? 'In progress';
  }

  /** Room-level audit entries (match room failures, relaunches, notices). */
  note(actor: TournamentAuditActor, action: string, text: string, extra: Partial<Pick<TournamentAuditEntry, 'reason' | 'matchId' | 'participantId'>> = {}): void {
    this.audit(actor, action, text, extra);
  }

  drainEvents(): EngineEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  /** Replace the config (the caller validated it with TournamentConfigSchema). */
  updateConfig(next: TournamentConfig): void {
    this.requireStatus(PRE_START, 'The format is locked once the tournament has started.');
    const prev = this.data.config;
    if (next.gameId !== prev.gameId && this.data.status !== 'DRAFT') {
      throw new TournamentError('not_allowed', 'The game can only change while the tournament is a draft.');
    }
    if (next.checkIn !== prev.checkIn && this.data.status === 'CHECK_IN') {
      throw new TournamentError('not_allowed', 'Close check-in before turning it off.');
    }
    const entries = this.entries().length;
    if (next.maxField < entries) {
      throw new TournamentError('invalid', `${entries} players are already registered — the field can't be smaller than that.`);
    }
    this.data.config = structuredClone(next);
    this.audit('organizer', 'configure', 'Tournament settings updated.');
  }

  openRegistration(): void {
    this.requireStatus(['DRAFT', 'CHECK_IN', 'READY'], 'Registration can only open before the start.');
    const reopened = this.data.status !== 'DRAFT';
    this.data.status = 'REGISTRATION';
    this.data.checkInEndsAt = 0;
    this.audit('organizer', 'open_registration', reopened ? 'Registration reopened.' : 'Registration opened.');
    this.emit({ kind: 'status', text: 'Registration is open.' });
  }

  closeRegistration(): void {
    this.requireStatus(['REGISTRATION'], 'Registration is not open.');
    this.audit('organizer', 'close_registration', 'Registration closed.');
    if (this.data.config.checkIn) this.startCheckIn();
    else {
      this.data.status = 'READY';
      this.emit({ kind: 'status', text: 'Registration closed.' });
    }
  }

  openCheckIn(): void {
    this.requireStatus(['REGISTRATION', 'READY'], 'Check-in opens after registration.');
    if (!this.data.config.checkIn) this.data.config = { ...this.data.config, checkIn: true };
    this.startCheckIn();
  }

  private startCheckIn(): void {
    const minutes = this.data.config.checkInMinutes;
    this.data.status = 'CHECK_IN';
    this.data.checkInEndsAt = minutes > 0 ? this.deps.now() + minutes * 60_000 : 0;
    this.audit('organizer', 'open_check_in', minutes > 0 ? `Check-in opened for ${minutes} minutes.` : 'Check-in opened.');
    this.emit({ kind: 'status', text: 'Check-in is open — confirm you are here!' });
  }

  closeCheckIn(actor: TournamentAuditActor = 'organizer'): void {
    this.requireStatus(['CHECK_IN'], 'Check-in is not open.');
    this.data.status = 'READY';
    this.data.checkInEndsAt = 0;
    const missed = this.data.participants.filter((p) => p.status === 'registered');
    for (const p of missed) p.status = 'no_show';
    this.renumberSeeds();
    this.audit(
      actor,
      'close_check_in',
      `Check-in closed${actor === 'system' ? ' (deadline)' : ''}.${missed.length ? ` Not checked in: ${missed.map((p) => p.name).join(', ')}.` : ''}`,
    );
    this.emit({ kind: 'status', text: 'Check-in closed.' });
  }

  /** Time-based transitions (check-in deadline). Returns true when something changed. */
  tick(now: number): boolean {
    if (this.data.status === 'CHECK_IN' && this.data.checkInEndsAt > 0 && now >= this.data.checkInEndsAt) {
      this.closeCheckIn('system');
      return true;
    }
    return false;
  }

  register(input: RegisterInput): EngineParticipant {
    this.requireStatus(['REGISTRATION', 'CHECK_IN'], 'Registration is closed.');
    if (input.identity && this.data.participants.some((p) => p.identity === input.identity && p.status !== 'withdrawn')) {
      throw new TournamentError('duplicate', 'You are already registered in this tournament.');
    }
    if (this.entries().length >= this.data.config.maxField) throw new TournamentError('full', 'The field is full.');
    const name = this.uniqueName(maskProfanity(cleanNickname(input.name, LIMITS.nickname)));
    let id = `p${randomId(7, this.deps.rng)}`;
    while (this.participant(id)) id = `p${randomId(7, this.deps.rng)}`;
    const lateEntry = this.data.status === 'CHECK_IN';
    const p: EngineParticipant = {
      id,
      name,
      avatar: input.avatar,
      identity: input.identity,
      rating: input.rating,
      ratingGames: input.ratingGames,
      provisional: input.provisional,
      entry: ++this.data.entrySeq,
      registeredAt: this.deps.now(),
      status: lateEntry ? 'checked_in' : 'registered',
      checkedIn: lateEntry,
      seed: 0,
      sides: [],
      byes: 0,
    };
    this.data.participants.push(p);
    this.emit({ kind: 'registered', text: `${name} registered.`, participantId: id });
    return p;
  }

  /** Update a participant's rating snapshot (before the start). */
  setRating(pid: string, rating: number, games: number, provisional: boolean): void {
    const p = this.participant(pid);
    if (!p || !PRE_START.includes(this.data.status)) return;
    p.rating = rating;
    p.ratingGames = games;
    p.provisional = provisional;
  }

  setCheckIn(pid: string, checkedIn: boolean, actor: TournamentAuditActor): void {
    const p = this.requireParticipant(pid);
    if (actor === 'participant') this.requireStatus(['CHECK_IN'], 'Check-in is not open.');
    else this.requireStatus(['CHECK_IN', 'READY'], 'Check-in is not open.');
    if (!['registered', 'checked_in', 'no_show'].includes(p.status)) {
      throw new TournamentError('not_allowed', `${p.name} is not in the field.`);
    }
    if (checkedIn && p.status === 'no_show' && this.entries().length >= this.data.config.maxField) {
      throw new TournamentError('full', 'The field is full.');
    }
    p.checkedIn = checkedIn;
    p.status = checkedIn ? 'checked_in' : this.data.status === 'READY' ? 'no_show' : 'registered';
    if (!checkedIn) p.seed = 0;
    this.renumberSeeds();
    if (actor === 'organizer') this.audit('organizer', 'check_in', `${p.name} ${checkedIn ? 'checked in' : 'marked as not checked in'} by the organizer.`, { participantId: pid });
  }

  /** Participant leaves. Before the start the entry is deleted; afterwards remaining matches are forfeited. */
  withdraw(pid: string): void {
    const p = this.requireParticipant(pid);
    if (TERMINAL.includes(this.data.status)) throw new TournamentError('wrong_status', 'The tournament is over.');
    if (PRE_START.includes(this.data.status)) {
      this.data.participants = this.data.participants.filter((x) => x.id !== pid);
      this.renumberSeeds();
      this.emit({ kind: 'withdrawn', text: `${p.name} withdrew.`, participantId: pid });
      return;
    }
    if (isOut(p) || p.status === 'eliminated') throw new TournamentError('not_allowed', `${p.name} is no longer in the tournament.`);
    p.status = 'withdrawn';
    this.forfeitLive(p, 'Withdrew');
    this.audit('participant', 'withdraw', `${p.name} withdrew from the tournament.`, { participantId: pid });
    this.emit({ kind: 'withdrawn', text: `${p.name} withdrew.`, participantId: pid });
    this.refresh();
  }

  seed(method: SeedingMethod, order?: readonly string[]): void {
    this.requireStatus(['REGISTRATION', 'CHECK_IN', 'READY'], 'Seeding happens before the start.');
    const pool = this.seedPool();
    if (pool.length === 0) throw new TournamentError('invalid', 'Nobody to seed yet.');
    let ordered: EngineParticipant[];
    let note = '';
    if (method === 'manual') {
      if (!order) throw new TournamentError('invalid', 'Manual seeding needs the full order.');
      const ids = new Set(pool.map((p) => p.id));
      if (order.length !== pool.length || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
        throw new TournamentError('invalid', 'The seed order must list every entry exactly once.');
      }
      ordered = order.map((id) => this.participant(id)!);
    } else if (method === 'random') {
      ordered = shuffle(pool, this.deps.rng);
    } else {
      // Rating: shuffle first so equal ratings are ordered by lot, then a stable sort.
      ordered = shuffle(pool, this.deps.rng).sort((a, b) => b.rating - a.rating);
      const ties = new Set<number>();
      for (let i = 1; i < ordered.length; i++) if (ordered[i]!.rating === ordered[i - 1]!.rating) ties.add(ordered[i]!.rating);
      if (ties.size) note = ' Equal ratings were ordered by lot.';
    }
    ordered.forEach((p, i) => (p.seed = i + 1));
    for (const p of this.data.participants) if (!ordered.includes(p)) p.seed = 0;
    this.data.seedingMethod = method;
    const labels: Record<SeedingMethod, string> = { random: 'a random draw', manual: 'the organizer’s order', rating: 'DASCADE rating' };
    this.audit('organizer', 'seed', `Seeded by ${labels[method]}.${note}`);
  }

  begin(): void {
    this.requireStatus(['REGISTRATION', 'CHECK_IN', 'READY'], 'The tournament has already started.');
    const d = this.data;
    if (d.config.checkIn && d.status === 'REGISTRATION') {
      throw new TournamentError('not_allowed', 'Open check-in first (or turn check-in off).');
    }
    if (d.status === 'CHECK_IN') {
      d.status = 'READY';
      d.checkInEndsAt = 0;
      for (const p of d.participants) if (p.status === 'registered') p.status = 'no_show';
    }
    const field = this.seedPool();
    if (field.length < 2) throw new TournamentError('not_allowed', 'At least two participants are needed to start.');
    // Seeds must cover exactly the field: keep the seeded order, append anyone unseeded (by the configured method).
    const seeded = field.filter((p) => p.seed > 0).sort((a, b) => a.seed - b.seed);
    const unseeded = field.filter((p) => p.seed === 0);
    if (!d.seedingMethod || seeded.length === 0) {
      this.seed(d.config.seeding === 'manual' ? 'random' : d.config.seeding);
    } else if (unseeded.length > 0) {
      const extra = d.seedingMethod === 'rating' ? shuffle(unseeded, this.deps.rng).sort((a, b) => b.rating - a.rating) : shuffle(unseeded, this.deps.rng);
      [...seeded, ...extra].forEach((p, i) => (p.seed = i + 1));
      this.audit('system', 'seed', `Late entries seeded last: ${extra.map((p) => p.name).join(', ')}.`);
    } else {
      seeded.forEach((p, i) => (p.seed = i + 1));
    }
    for (const p of d.participants) {
      if (field.includes(p)) p.status = 'active';
      else if (p.status === 'registered' || p.status === 'checked_in') p.status = 'no_show';
      if (!field.includes(p)) p.seed = 0;
    }
    const ids = fieldOf(d).map((p) => p.id);
    const bestOf = d.config.bestOf;
    switch (d.config.format) {
      case 'single_elimination':
        d.matches = buildSingleElimination(ids.length, bestOf);
        d.totalRounds = Math.log2(Math.max(2, d.matches.filter((m) => m.round === 1).length * 2));
        break;
      case 'double_elimination':
        d.matches = buildDoubleElimination(ids.length, bestOf, d.config.grandFinalReset);
        d.totalRounds = d.matches.filter((m) => m.bracket === 'winners').reduce((mx, m) => Math.max(mx, m.round), 0);
        break;
      case 'round_robin':
        d.matches = this.buildRoundRobin(ids);
        d.totalRounds = Math.max(0, ...d.matches.map((m) => m.round));
        break;
      case 'swiss': {
        const requested = d.config.swissRounds;
        d.totalRounds = Math.min(ids.length - 1, requested > 0 ? requested : autoSwissRounds(ids.length));
        d.totalRounds = Math.max(1, d.totalRounds);
        d.matches = [];
        d.roundsPaired = 0;
        break;
      }
    }
    if (d.config.format !== 'swiss') d.roundsPaired = d.totalRounds;
    d.status = 'IN_PROGRESS';
    d.startedAt = this.deps.now();
    this.audit('organizer', 'begin', `Tournament started with ${ids.length} participants.`);
    this.emit({ kind: 'status', text: 'The tournament has started!' });
    this.refresh();
  }

  pause(): void {
    this.requireStatus(['IN_PROGRESS'], 'Only a running tournament can be paused.');
    if (this.data.paused) return;
    this.data.paused = true;
    this.audit('organizer', 'pause', 'New matches paused (live matches continue).');
    this.emit({ kind: 'paused', text: 'The organizer paused new matches.' });
  }

  resume(): void {
    this.requireStatus(['IN_PROGRESS'], 'Only a running tournament can be resumed.');
    if (!this.data.paused) return;
    this.data.paused = false;
    this.audit('organizer', 'resume', 'Tournament resumed.');
    this.emit({ kind: 'resumed', text: 'The tournament resumed.' });
    this.refresh();
  }

  // ===========================================================================
  // Results
  // ===========================================================================

  /** The match room started game N (first call moves the match to IN_PROGRESS). */
  markStarted(matchId: string): boolean {
    const m = this.match(matchId);
    if (!m || m.status !== 'READY') return false;
    m.status = 'IN_PROGRESS';
    m.startedAt = this.deps.now();
    this.emit({ kind: 'match_started', text: `${m.label} is under way.`, matchId });
    return true;
  }

  /**
   * Record game `gameNumber` of a live match. Idempotent: a repeated or out-of-order report is
   * ignored (`accepted: false`) and can never advance anyone twice.
   */
  recordGame(matchId: string, gameNumber: number, winnerId: string | null, reason = ''): RecordGameResult {
    const m = this.match(matchId);
    if (!m || (m.status !== 'READY' && m.status !== 'IN_PROGRESS') || this.data.status !== 'IN_PROGRESS') {
      return { accepted: false, reason: 'not_live', decided: false, series: null };
    }
    if (gameNumber !== m.games.length + 1) {
      return { accepted: false, reason: 'stale', decided: false, series: this.series(m) };
    }
    if (winnerId !== null && winnerId !== m.a && winnerId !== m.b) {
      return { accepted: false, reason: 'invalid_winner', decided: false, series: this.series(m) };
    }
    const spec = this.seriesSpec(m);
    if (m.status === 'READY') {
      m.status = 'IN_PROGRESS';
      m.startedAt = this.deps.now();
    }
    m.games.push({
      n: gameNumber,
      winnerId,
      firstId: firstForGame(spec, gameNumber),
      decider: deciderFor(spec, gameNumber),
      reason: reason.slice(0, 40),
      at: this.deps.now(),
    });
    const s = seriesState(spec, m.games);
    const winnerName = winnerId ? this.participant(winnerId)?.name : null;
    this.emit({ kind: 'game_result', text: `${m.label}, game ${gameNumber}: ${winnerName ? `${winnerName} wins` : 'draw'}.`, matchId });
    if (s.decided) {
      if (s.needsLots) {
        const winner = this.deps.rng.int(2) === 0 ? m.a! : m.b!;
        this.finish(m, winner, 'lots', 'Decided by lot');
        this.audit('system', 'lots', `${m.label} was level after every decider — ${this.participant(winner)?.name} advances by lot.`, { matchId });
      } else {
        this.finish(m, s.winner, 'played', s.note);
      }
    }
    this.refresh();
    return { accepted: true, decided: s.decided, series: s };
  }

  /** Organizer / no-show forfeit: `pid` loses the match (stays in the event). */
  forfeit(matchId: string, pid: string, reason: string, actor: TournamentAuditActor = 'organizer'): void {
    this.requireStatus(['IN_PROGRESS'], 'The tournament is not running.');
    const m = this.requireMatch(matchId);
    if (isFinished(m) || !m.a || !m.b) throw new TournamentError('not_allowed', 'That match is not waiting to be played.');
    if (pid !== m.a && pid !== m.b) throw new TournamentError('invalid', 'That participant is not in this match.');
    const winner = pid === m.a ? m.b : m.a;
    const loser = this.participant(pid)!;
    this.finish(m, winner, 'forfeit', `Forfeit — ${reason}`);
    this.audit(actor, actor === 'system' ? 'no_show' : 'forfeit', `${loser.name} forfeits ${m.label}.`, { matchId, participantId: pid, reason });
    this.refresh();
  }

  disqualify(pid: string, reason: string): void {
    const p = this.requireParticipant(pid);
    if (TERMINAL.includes(this.data.status)) throw new TournamentError('wrong_status', 'The tournament is over.');
    if (p.status === 'disqualified') return;
    if (PRE_START.includes(this.data.status)) {
      p.status = 'disqualified';
      p.seed = 0;
      this.renumberSeeds();
    } else {
      if (isOut(p) || p.status === 'eliminated') throw new TournamentError('not_allowed', `${p.name} is no longer in the tournament.`);
      p.status = 'disqualified';
      this.forfeitLive(p, 'Disqualified');
    }
    this.audit('organizer', 'disqualify', `${p.name} was disqualified.`, { participantId: pid, reason });
    this.emit({ kind: 'disqualified', text: `${p.name} was disqualified.`, participantId: pid });
    this.refresh();
  }

  /**
   * Organizer decision. Allowed on an unfinished match with both participants, or on a finished one
   * whose dependent matches haven't started (they are re-derived).
   */
  override(matchId: string, outcome: 'win' | 'draw' | 'double_forfeit', winnerId: string | null, reason: string): void {
    this.requireStatus(['IN_PROGRESS'], 'Results can only be changed while the tournament runs.');
    const m = this.requireMatch(matchId);
    if (!m.a || !m.b) throw new TournamentError('not_allowed', 'Both participants must be known.');
    if (m.status === 'VOID' || m.resultKind === 'bye') throw new TournamentError('not_allowed', 'That match has nothing to decide.');
    if (outcome === 'win' && winnerId !== m.a && winnerId !== m.b) throw new TournamentError('invalid', 'Pick one of the two participants.');
    if (outcome === 'draw' && m.requireWinner) throw new TournamentError('not_allowed', 'Bracket matches need a winner.');
    const dependents = this.dependents(m);
    if (isFinished(m)) {
      const blocked = dependents.find((x) => x.status === 'IN_PROGRESS' || (isFinished(x) && x.resultKind !== 'void' && x.resultKind !== 'bye'));
      if (blocked) throw new TournamentError('not_allowed', `${blocked.label} has already started — this result can no longer change.`);
    }
    if (this.data.config.format === 'swiss' && isFinished(m) && m.round < this.data.roundsPaired) {
      // Later rounds were paired from the old result and none has started: pair them again.
      this.data.matches = this.data.matches.filter((x) => x.round <= m.round);
      this.data.roundsPaired = m.round;
      this.audit('system', 'pairing', `Swiss round ${m.round + 1} will be paired again after a result change.`);
    }
    const before = this.describeResult(m);
    const winner = outcome === 'win' ? winnerId : null;
    if (outcome === 'double_forfeit') this.finish(m, null, 'double_forfeit', `Double forfeit — ${reason}`);
    else this.finish(m, winner, 'override', 'Organizer decision');
    for (const x of dependents) this.resetMatch(x);
    this.audit('organizer', 'override', `${m.label}: ${before ? `${before} → ` : ''}${this.describeResult(m)}.`, { matchId, reason });
    this.emit({ kind: 'override', text: `The organizer decided ${m.label}.`, matchId });
    this.refresh();
  }

  /** Finish now: unfinished matches become VOID; RR/Swiss standings stand. */
  end(reason: string): void {
    this.requireStatus(['IN_PROGRESS'], 'Only a running tournament can be ended.');
    for (const m of this.data.matches) {
      if (!isFinished(m)) this.voidMatch(m, 'Tournament ended');
    }
    this.data.endedEarly = true;
    this.audit('organizer', 'end', 'The organizer ended the tournament.', { reason });
    this.complete();
  }

  cancel(reason: string): void {
    if (TERMINAL.includes(this.data.status)) throw new TournamentError('wrong_status', 'The tournament is already over.');
    for (const m of this.data.matches) if (!isFinished(m)) this.voidMatch(m, 'Tournament cancelled');
    this.data.status = 'CANCELLED';
    this.data.paused = false;
    this.data.completedAt = this.deps.now();
    this.audit('organizer', 'cancel', 'The tournament was cancelled.', { reason });
    this.emit({ kind: 'status', text: 'The tournament was cancelled.' });
  }

  // ===========================================================================
  // Derivation
  // ===========================================================================

  /** Re-derive slots, byes, forfeits, readiness, Swiss pairings and completion. */
  refresh(): void {
    const d = this.data;
    if (d.status !== 'IN_PROGRESS') return;
    for (let guard = 0; guard < 1000; guard++) {
      // Colour history / byes / bracket statuses must include every result before sides are allocated or a round is paired.
      this.deriveParticipants();
      let changed = d.config.format === 'single_elimination' || d.config.format === 'double_elimination' ? this.resolveElimination() : this.resolveFixed();
      if (!changed && d.config.format === 'swiss') changed = this.maybePairSwiss();
      if (!changed) break;
    }
    this.deriveParticipants();
    if (this.allDone()) this.complete();
  }

  private resolveElimination(): boolean {
    const d = this.data;
    const byId = new Map(d.matches.map((m) => [m.id, m]));
    const bySeed = new Map(fieldOf(d).map((p) => [p.seed, p.id]));
    let changed = false;
    for (const m of d.matches) {
      if (m.status !== 'WAITING') continue;
      if (m.conditional) {
        const gf = byId.get('GF')!;
        if (!isFinished(gf)) continue;
        const needed =
          gf.winner !== null &&
          gf.winner === gf.b &&
          (gf.resultKind === 'played' || gf.resultKind === 'override' || gf.resultKind === 'lots') &&
          this.eligible(gf.a) &&
          this.eligible(gf.b);
        if (!needed) {
          this.voidMatch(m, 'Not needed');
          changed = true;
          continue;
        }
        if (m.a !== gf.a || m.b !== gf.b) {
          m.a = gf.a;
          m.b = gf.b;
          changed = true;
        }
        if (this.settleReady(m)) changed = true;
        continue;
      }
      const slots: Array<{ resolved: boolean; pid: string | null }> = m.sources.map((src) => {
        if (!src) return { resolved: true, pid: null };
        if (src.kind === 'seed') return { resolved: true, pid: bySeed.get(src.seed) ?? null };
        const from = byId.get(src.matchId)!;
        if (!isFinished(from)) return { resolved: false, pid: null };
        return { resolved: true, pid: src.kind === 'winner' ? from.winner : from.loser };
      });
      const [sa, sb] = slots as [{ resolved: boolean; pid: string | null }, { resolved: boolean; pid: string | null }];
      if (m.a !== (sa.resolved ? sa.pid : null) || m.b !== (sb.resolved ? sb.pid : null)) {
        m.a = sa.resolved ? sa.pid : null;
        m.b = sb.resolved ? sb.pid : null;
        changed = true;
      }
      if (!sa.resolved || !sb.resolved) continue;
      if (this.settle(m)) changed = true;
    }
    return changed;
  }

  private resolveFixed(): boolean {
    let changed = false;
    for (const m of this.data.matches) {
      if (m.status !== 'WAITING') continue;
      if (this.settle(m)) changed = true;
    }
    return changed;
  }

  /** Both slots are known: settle byes/forfeits or make the match READY. */
  private settle(m: EngineMatch): boolean {
    if (!m.a && !m.b) {
      this.voidMatch(m, '');
      return true;
    }
    if (!m.a || !m.b) {
      const present = (m.a ?? m.b)!;
      if (!this.eligible(present)) {
        this.voidMatch(m, '');
        return true;
      }
      this.finish(m, present, 'bye', 'Bye');
      return true;
    }
    const okA = this.eligible(m.a);
    const okB = this.eligible(m.b);
    if (!okA && !okB) {
      this.finish(m, null, 'double_forfeit', 'Neither participant can play');
      return true;
    }
    if (!okA || !okB) {
      this.finish(m, okA ? m.a : m.b, 'dq', this.outNote(okA ? m.b : m.a));
      return true;
    }
    return this.settleReady(m);
  }

  private settleReady(m: EngineMatch): boolean {
    if (this.data.paused || m.status !== 'WAITING') return false;
    if (m.bracket === 'main' && this.data.config.format === 'round_robin') {
      // A participant never has two live matches: earlier rounds come first.
      const busy = this.data.matches.some(
        (x) => x !== m && x.bracket === 'main' && !isFinished(x) && x.round < m.round && (x.a === m.a || x.b === m.a || x.a === m.b || x.b === m.b),
      );
      if (busy) return false;
    }
    if (this.activeMatchFor(m.a!) || this.activeMatchFor(m.b!)) return false;
    if (this.sides && m.firstId === null) m.firstId = this.allocateFirst(m.a!, m.b!);
    m.status = 'READY';
    this.emit({ kind: 'match_ready', text: `${m.label}: ${this.participant(m.a!)?.name} v ${this.participant(m.b!)?.name}.`, matchId: m.id });
    return true;
  }

  private maybePairSwiss(): boolean {
    const d = this.data;
    if (d.paused || d.roundsPaired >= d.totalRounds) return false;
    if (d.matches.some((m) => !isFinished(m))) return false;
    const eligible = fieldOf(d).filter((p) => this.eligible(p.id));
    if (eligible.length < 2) return false;
    const standings = computeStandings(d);
    const points = new Map(standings.rows.map((r) => [r.participantId, r.points]));
    const players: SwissPlayer[] = eligible.map((p) => ({
      id: p.id,
      points: points.get(p.id) ?? 0,
      seed: p.seed,
      opponents: d.matches.filter((m) => m.a === p.id || m.b === p.id).map((m) => (m.a === p.id ? m.b : m.a)).filter((x): x is string => Boolean(x)),
      byes: d.matches.filter((m) => m.resultKind === 'bye' && m.a === p.id).length,
      sides: p.sides,
    }));
    const round = d.roundsPaired + 1;
    const pairing = pairSwissRound(players, round, { sides: this.sides, rng: this.deps.rng });
    pairing.pairs.forEach((pair, i) => {
      const m = newMatch({
        id: `S${round}-${i + 1}`,
        bracket: 'main',
        round,
        order: i,
        roundLabel: `Swiss round ${round}`,
        label: `Swiss round ${round} · Board ${i + 1}`,
        sources: [null, null],
        bestOf: d.config.bestOf,
        requireWinner: false,
        a: pair.a,
        b: pair.b,
      });
      m.firstId = pair.firstId;
      d.matches.push(m);
    });
    if (pairing.bye) {
      const m = newMatch({
        id: `S${round}-bye`,
        bracket: 'main',
        round,
        order: pairing.pairs.length,
        roundLabel: `Swiss round ${round}`,
        label: `Swiss round ${round} · Bye`,
        sources: [null, null],
        bestOf: d.config.bestOf,
        requireWinner: false,
        a: pairing.bye,
        b: null,
      });
      d.matches.push(m);
    }
    d.roundsPaired = round;
    for (const c of pairing.compromises) this.audit('system', 'pairing', `Round ${round}: ${this.nameIds(c)}.`);
    this.emit({ kind: 'round_started', text: `Swiss round ${round} is paired.`, round });
    return true;
  }

  private buildRoundRobin(ids: string[]): EngineMatch[] {
    const schedule = roundRobinSchedule(ids);
    const out: EngineMatch[] = [];
    schedule.forEach((pairings, r) => {
      const round = r + 1;
      let board = 0;
      for (const p of pairings) {
        if ('bye' in p) {
          out.push(
            newMatch({
              id: `R${round}-bye`,
              bracket: 'main',
              round,
              order: pairings.length - 1,
              roundLabel: `Round ${round}`,
              label: `Round ${round} · Bye`,
              sources: [null, null],
              bestOf: this.data.config.bestOf,
              requireWinner: false,
              a: p.bye,
              b: null,
            }),
          );
          continue;
        }
        const m = newMatch({
          id: `R${round}-${board + 1}`,
          bracket: 'main',
          round,
          order: board,
          roundLabel: `Round ${round}`,
          label: `Round ${round} · Board ${board + 1}`,
          sources: [null, null],
          bestOf: this.data.config.bestOf,
          requireWinner: false,
          a: p.first,
          b: p.second,
        });
        if (this.sides) m.firstId = p.first;
        out.push(m);
        board++;
      }
    });
    return out;
  }

  private deriveParticipants(): void {
    const d = this.data;
    // Colour history: side in game 1 of played matches, chronologically.
    const played = d.matches
      .filter((m) => isFinished(m) && m.games.length > 0 && m.firstId && m.a && m.b)
      .sort((x, y) => (x.completedAt || 0) - (y.completedAt || 0) || x.round - y.round);
    for (const p of d.participants) {
      p.sides = [];
      p.byes = 0;
    }
    for (const m of played) {
      const first = this.participant(m.firstId!);
      const secondId = m.firstId === m.a ? m.b : m.a;
      const second = secondId ? this.participant(secondId) : undefined;
      first?.sides.push('first');
      second?.sides.push('second');
    }
    for (const m of d.matches) if (m.resultKind === 'bye' && m.a) this.participant(m.a)!.byes++;
    if (d.config.format === 'single_elimination' || d.config.format === 'double_elimination') {
      const outcome = eliminationOutcome(d);
      for (const p of fieldOf(d)) {
        if (isOut(p)) continue;
        p.status = outcome.eliminated.has(p.id) ? 'eliminated' : 'active';
      }
    }
  }

  private allDone(): boolean {
    const d = this.data;
    if (d.matches.some((m) => !isFinished(m))) return false;
    if (d.config.format === 'swiss') {
      const eligible = fieldOf(d).filter((p) => this.eligible(p.id));
      return d.roundsPaired >= d.totalRounds || eligible.length < 2;
    }
    return true;
  }

  private complete(): void {
    const d = this.data;
    d.status = 'COMPLETE';
    d.paused = false;
    d.completedAt = this.deps.now();
    this.deriveParticipants();
    const champion =
      d.config.format === 'single_elimination' || d.config.format === 'double_elimination'
        ? eliminationOutcome(d).championId
        : (computeStandings(d).rows.find((r) => r.rank === 1)?.participantId ?? null);
    d.championId = champion;
    const p = champion ? this.participant(champion) : undefined;
    if (p) p.status = 'champion';
    this.audit('system', 'complete', p ? `Tournament complete — ${p.name} is the champion!` : 'Tournament complete.');
    this.emit({ kind: 'champion', text: p ? `${p.name} wins the tournament!` : 'The tournament is complete.', participantId: champion ?? undefined });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private finish(m: EngineMatch, winner: string | null, kind: EngineMatch['resultKind'], note: string): void {
    m.winner = winner;
    m.loser = winner === null ? null : winner === m.a ? m.b : m.a;
    m.draw = winner === null && (kind === 'played' || kind === 'override');
    m.resultKind = kind;
    m.resultNote = note;
    m.status = kind === 'forfeit' || kind === 'dq' || kind === 'double_forfeit' ? 'FORFEIT' : 'COMPLETE';
    m.completedAt = this.deps.now();
    if (kind !== 'bye') {
      const w = winner ? this.participant(winner)?.name : null;
      this.emit({ kind: 'match_complete', text: `${m.label}: ${w ? `${w} wins` : m.draw ? 'drawn' : 'no winner'}.`, matchId: m.id });
    }
  }

  private voidMatch(m: EngineMatch, note: string): void {
    m.status = 'VOID';
    m.resultKind = 'void';
    m.resultNote = note;
    m.winner = null;
    m.loser = null;
    m.draw = false;
    m.completedAt = this.deps.now();
  }

  private resetMatch(m: EngineMatch): void {
    if (m.sources.every((s) => s === null)) return; // fixed pairings (RR/Swiss) never re-derive
    m.status = 'WAITING';
    m.a = null;
    m.b = null;
    m.firstId = null;
    m.games = [];
    m.winner = null;
    m.loser = null;
    m.draw = false;
    m.resultKind = null;
    m.resultNote = '';
    m.startedAt = 0;
    m.completedAt = 0;
  }

  /** Matches whose slots come from `m` (winner/loser), incl. the conditional reset after the grand final. */
  private dependents(m: EngineMatch): EngineMatch[] {
    if (this.data.config.format === 'swiss') {
      // Later Swiss rounds were paired from this result.
      return m.round < this.data.roundsPaired ? this.data.matches.filter((x) => x.round > m.round) : [];
    }
    if (this.data.config.format === 'round_robin') return [];
    return this.data.matches.filter((x) => x.sources.some((s) => s && s.kind !== 'seed' && s.matchId === m.id));
  }

  /** Forfeit a removed participant's live (or pending, fully known) matches. */
  private forfeitLive(p: EngineParticipant, note: string): void {
    for (const m of this.data.matches) {
      if (isFinished(m) || (m.a !== p.id && m.b !== p.id)) continue;
      if (!m.a || !m.b) continue;
      if (m.status === 'WAITING' && m.bracket !== 'main') continue; // resolved when the slot settles
      const other = m.a === p.id ? m.b : m.a;
      if (this.eligible(other)) this.finish(m, other, 'dq', note);
      else this.finish(m, null, 'double_forfeit', 'Neither participant can play');
    }
  }

  private eligible(pid: string | null): boolean {
    if (!pid) return false;
    const p = this.participant(pid);
    return Boolean(p) && (p!.status === 'active' || p!.status === 'champion' || p!.status === 'eliminated');
  }

  private outNote(pid: string | null): string {
    const p = pid ? this.participant(pid) : undefined;
    if (p?.status === 'withdrawn') return 'Withdrew';
    return 'Disqualified';
  }

  private allocateFirst(a: string, b: string): string {
    const pa = colourPreference(this.participant(a)?.sides ?? []);
    const pb = colourPreference(this.participant(b)?.sides ?? []);
    if (pa.want && pb.want && pa.want !== pb.want) return pa.want === 'first' ? a : b;
    if (pa.want && (!pb.want || pa.strength > pb.strength)) return pa.want === 'first' ? a : b;
    if (pb.want && (!pa.want || pb.strength > pa.strength)) return pb.want === 'first' ? b : a;
    // Equal (or no) preference: lot — never silently favour a seed.
    return this.deps.rng.int(2) === 0 ? a : b;
  }

  /** Entries that would take part if the tournament started now. */
  private seedPool(): EngineParticipant[] {
    const d = this.data;
    if (d.config.checkIn && (d.status === 'READY' || d.status === 'IN_PROGRESS')) return d.participants.filter((p) => p.status === 'checked_in');
    return this.entries();
  }

  private renumberSeeds(): void {
    const seeded = this.data.participants.filter((p) => p.seed > 0 && (p.status === 'registered' || p.status === 'checked_in'));
    for (const p of this.data.participants) if (!seeded.includes(p)) p.seed = 0;
    seeded.sort((a, b) => a.seed - b.seed).forEach((p, i) => (p.seed = i + 1));
    if (seeded.length === 0) this.data.seedingMethod = null;
  }

  private uniqueName(base: string): string {
    const taken = new Set(this.data.participants.filter((p) => p.status !== 'withdrawn').map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    const chars = Array.from(base);
    for (let i = 2; i < 200; i++) {
      const candidate = `${chars.slice(0, LIMITS.nickname - 4).join('').trimEnd()} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${chars.slice(0, 10).join('')} ${randomId(4, this.deps.rng)}`;
  }

  private describeResult(m: EngineMatch): string {
    if (!isFinished(m)) return '';
    if (m.resultKind === 'double_forfeit') return 'double forfeit';
    if (m.winner) return `${this.participant(m.winner)?.name ?? 'Unknown'} wins`;
    return m.draw ? 'draw' : 'no result';
  }

  private nameIds(text: string): string {
    let out = text;
    for (const p of this.data.participants) out = out.split(p.id).join(p.name);
    return out;
  }

  private audit(actor: TournamentAuditActor, action: string, text: string, extra: Partial<Pick<TournamentAuditEntry, 'reason' | 'matchId' | 'participantId'>> = {}): void {
    const entry: TournamentAuditEntry = { id: ++this.data.auditSeq, at: this.deps.now(), actor, action, text };
    if (extra.reason) entry.reason = extra.reason;
    if (extra.matchId) entry.matchId = extra.matchId;
    if (extra.participantId) entry.participantId = extra.participantId;
    this.data.audit.push(entry);
    if (this.data.audit.length > AUDIT_KEEP) this.data.audit.splice(0, this.data.audit.length - AUDIT_KEEP);
  }

  private emit(event: EngineEvent): void {
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
  }

  private requireStatus(allowed: readonly TournamentStatus[], message: string): void {
    if (!allowed.includes(this.data.status)) throw new TournamentError('wrong_status', message);
  }

  private requireParticipant(pid: string): EngineParticipant {
    const p = this.participant(pid);
    if (!p) throw new TournamentError('not_found', 'Unknown participant.');
    return p;
  }

  private requireMatch(id: string): EngineMatch {
    const m = this.match(id);
    if (!m) throw new TournamentError('not_found', 'Unknown match.');
    return m;
  }
}

function roundStatus(ms: EngineMatch[]): TournamentRoundView['status'] {
  if (ms.length === 0) return 'pending';
  if (ms.every((m) => isFinished(m))) return 'complete';
  if (ms.some((m) => m.status === 'READY' || m.status === 'IN_PROGRESS' || isFinished(m))) return 'active';
  return 'pending';
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
