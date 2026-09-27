/**
 * ClassicsRoom — shared room toolkit for the six DAScade Classics games.
 *
 * Handles everything the Classics have in common so each game only writes its rules:
 *  - per-player standings (`state.standings`) + match meta (`state.classics`),
 *  - instant solo play: a solo room starts at once; the player sees the instructions card
 *    (status 'ready'), presses Start (`classics:start`), plays, sees the verified result
 *    (status 'over') and can Retry — all inside PLAYING, no lobby round-trips,
 *  - multiplayer matches: LOBBY → COUNTDOWN (runs prepared, same content for everyone) →
 *    PLAYING → every entrant finished (or the timed race ends) → reportOutcome (placements by
 *    score, ties share a place, leavers last) → RESULTS → host rematch / lobby,
 *  - verified high scores (only results a room reports through playerFinished()).
 *
 * Game rooms implement: statLabel, boardKey(), beginSoloRun(), prepareMatch(), abortRun()
 * (+ optionally modeLabel(), matchDurationMs(), onMatchLive(), onTimeUp()).
 *
 * ClassicsRoom implements these BaseGameRoom hooks — if a game overrides one it MUST call
 * super first: onRoomCreated, onPlayerJoined, onCountdownStart, onGameStart, onPlayerRemoved,
 * onReturnToLobby.
 */
import type { CreateOptions } from '@dascade/shared';
import { EmptySchema, RATE } from '@dascade/shared';
import {
  CLASSICS_MSG,
  type ClassicsEvent,
  type ClassicsStatus,
  type RunEndReason,
  type RunSummary,
} from '@dascade/shared/games/classics';
import { BaseGameRoom, type PlayerRecord, type RemovalReason } from '../BaseGameRoom.ts';
import { ClassicsStanding, type ClassicsState } from './schema.ts';
import { highScores, type RecordResult } from './highScores.ts';

/** Reasons that count towards high scores (a real, finished, verified result). */
const RECORDABLE: ReadonlySet<RunEndReason> = new Set<RunEndReason>(['over', 'time', 'lag']);

export interface FinishInfo extends RecordResult {
  /** New best for this player in this room session. */
  best: boolean;
  board: string;
}

export abstract class ClassicsRoom<S extends ClassicsState = ClassicsState, Settings extends object = Record<string, unknown>> extends BaseGameRoom<
  S,
  Settings
> {
  /** Label for the standings' `stat` column (e.g. "Lines", "Bricks", "Rounds"). */
  protected abstract readonly statLabel: string;
  /** Countdown before multiplayer matches (solo rooms start instantly). */
  protected matchCountdownMs = 4_000;
  /** Pause between the match being decided and the RESULTS screen. */
  protected resultsDelayMs = 2_200;
  /** Player ids racing in the current match (seat order). */
  protected entrants: string[] = [];
  private matchPrepared = false;
  private finishing = false;
  /** Set once finishMatch() fixed the final ranks (live re-ranking stops). */
  private ranksFinal = false;
  /**
   * Solo pause guard for the server-simulated games (see claimSoloPause): pausing freezes the
   * sim, so rapid pause/resume would let a player "freeze-frame" through a ranked run.
   */
  protected soloPauseCooldownMs = 3_000;
  protected soloPauseBudget = 8;
  private soloPauses = 0;
  private soloLiveAt = 0;

  // ===========================================================================
  // Game hooks
  // ===========================================================================

  /** High-score board for the current settings ('' = unranked, e.g. custom rules). */
  protected abstract boardKey(): string;
  /** Solo: the player pressed Start/Retry — begin a new run for them. */
  protected abstract beginSoloRun(player: PlayerRecord): void;
  /** Multiplayer: the countdown began — set up runs for every entrant, all starting at `startAt`. */
  protected abstract prepareMatch(entrants: PlayerRecord[], startAt: number): void;
  /** Stop a live run now (quit, left, time up). The game must call playerFinished() (unless reason is 'quit'). */
  protected abstract abortRun(playerId: string, reason: RunEndReason): void;

  /** Mode label published in `state.classics.mode`. */
  protected modeLabel(): string {
    return this.isSolo ? 'solo' : 'race';
  }
  /** Timed races: match length in ms (0 = until everyone is out). */
  protected matchDurationMs(): number {
    return 0;
  }
  /** Multiplayer: PLAYING just began (runs are live). */
  protected onMatchLive(): void {}
  /** Timed race deadline reached. Default: abort every live run with 'time'. */
  protected onTimeUp(): void {
    for (const id of this.entrants) if (this.standingOf(id)?.status === 'playing') this.abortRun(id, 'time');
  }

  // ===========================================================================
  // Helpers for games
  // ===========================================================================

  protected standingOf(playerId: string): ClassicsStanding | undefined {
    return this.state.standings.get(playerId);
  }

  protected statusOf(playerId: string): ClassicsStatus {
    return (this.standingOf(playerId)?.status as ClassicsStatus | undefined) ?? 'idle';
  }

  /** Publish live progress for a player (score/level/lives/stat, optional verified tick). */
  protected updateStanding(playerId: string, summary: RunSummary, ticks?: number): void {
    const s = this.standingOf(playerId);
    if (!s) return;
    s.score = Math.max(0, Math.floor(summary.score));
    s.level = Math.max(0, Math.min(65535, Math.floor(summary.level)));
    s.lives = Math.max(0, Math.min(255, Math.floor(summary.lives)));
    s.stat = Math.max(0, Math.floor(summary.stat));
    if (ticks !== undefined) s.ticks = Math.max(0, Math.floor(ticks));
    const record = this.players.get(playerId);
    if (record) record.state.score = s.score;
    this.refreshRanks();
  }

  /**
   * A player's run/round set is over: publish the final summary, record a verified high score
   * (when `reason` is a real finish and the mode is ranked), and end the match when everyone
   * is done. Returns the recording info for the game's verdict message. `boardOverride` = the board
   * the run started on (defaults to the current settings' board).
   */
  protected playerFinished(playerId: string, summary: RunSummary, reason: RunEndReason, ticks?: number, boardOverride?: string): FinishInfo {
    // A run keeps the board it started on (solo players may change modes between runs).
    const board = boardOverride ?? this.boardKey();
    const info: FinishInfo = { rank: null, entryId: null, improved: false, best: false, board };
    const s = this.standingOf(playerId);
    this.updateStanding(playerId, summary, ticks);
    if (s) {
      s.status = reason === 'left' ? 'out' : 'over';
      if (summary.score > s.best) {
        s.best = Math.floor(summary.score);
        info.best = true;
      }
    }
    const player = this.players.get(playerId);
    if (player && board && RECORDABLE.has(reason) && summary.score > 0) {
      Object.assign(
        info,
        highScores.record(this.gameId, board, {
          identity: player.userId ? `u:${player.userId}` : player.guestId ? `g:${player.guestId}` : `p:${player.id}`,
          name: player.state.name,
          score: summary.score,
          level: summary.level,
          stat: summary.stat,
        }),
      );
      if (info.rank !== null && info.rank <= 10) {
        this.broadcastEvent({ kind: 'record', playerId, name: player.state.name, score: Math.floor(summary.score), rank: info.rank, board });
      }
    }
    if (!this.isSolo) {
      this.broadcastEvent({ kind: 'player-over', playerId, score: Math.floor(summary.score), place: s?.rank || null, reason });
      this.checkMatchEnd();
    }
    return info;
  }

  /**
   * Solo pause request (server-simulated games): returns why it is refused, or null and counts
   * it. A run allows `soloPauseBudget` pauses, each at least `soloPauseCooldownMs` of live play
   * after the last resume — enough for real life, useless for pause-stepping through a run.
   * Disconnect auto-pauses (`'disconnect'`) skip the cooldown but spend the same budget, so
   * dropping the socket on purpose can't be used as an unlimited pause button either.
   */
  protected claimSoloPause(kind: 'player' | 'disconnect' = 'player'): string | null {
    if (this.soloPauses >= this.soloPauseBudget) return `No pauses left in this run (${this.soloPauseBudget} per run).`;
    if (kind === 'player' && Date.now() < this.soloLiveAt + this.soloPauseCooldownMs) return 'Play on for a moment before pausing again.';
    this.soloPauses++;
    return null;
  }

  /** A solo game resumed; `liveAt` = when play actually continues (after the resume lead-in). */
  protected noteSoloResume(liveAt: number): void {
    this.soloLiveAt = liveAt;
  }

  protected broadcastEvent(event: ClassicsEvent): void {
    this.broadcast(CLASSICS_MSG.event, event);
  }

  /** Multiplayer: end the match once every entrant is over/out. */
  protected checkMatchEnd(): void {
    if (this.isSolo || this.finishing || this.phase !== 'PLAYING') return;
    if (this.entrants.length === 0) return;
    const live = this.entrants.some((id) => {
      const st = this.statusOf(id);
      return st === 'playing' || st === 'ready' || st === 'idle';
    });
    if (!live) this.finishMatch('complete');
  }

  /**
   * Final placements of the players who didn't leave (best first; a group = a shared place).
   * Default: by standing score, equal scores share a place. Override for games ranked by
   * something else (e.g. survival order). Leavers are appended last by finishMatch().
   */
  protected matchPlacements(finishers: string[], scores: Record<string, number>): string[][] {
    const sorted = [...finishers].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
    const placements: string[][] = [];
    for (const id of sorted) {
      const last = placements[placements.length - 1];
      if (last && scores[last[0]!] === scores[id]) last.push(id);
      else placements.push([id]);
    }
    return placements;
  }

  /** Decide the match now: placements (matchPlacements; leavers last) → reportOutcome → RESULTS. */
  protected finishMatch(reason: string): void {
    if (this.finishing || this.isSolo) return;
    this.finishing = true;
    this.cancel('classics:deadline');
    const scores: Record<string, number> = {};
    const finishers: string[] = [];
    const leavers: string[] = [];
    for (const id of this.entrants) {
      const s = this.standingOf(id);
      scores[id] = s?.score ?? 0;
      if (s?.status === 'out') leavers.push(id);
      else finishers.push(id);
    }
    const placements = this.matchPlacements(finishers, scores).filter((g) => g.length > 0);
    if (leavers.length) placements.push(leavers);
    // Final ranks follow the placements (shared place = shared rank) and stay fixed from now on.
    let place = 1;
    for (const group of placements) {
      for (const id of group) {
        const s = this.standingOf(id);
        if (s) s.rank = Math.min(255, place);
      }
      place += group.length;
    }
    this.ranksFinal = true;
    // Platform stats extras (see the tournament kit notes): `max…` keys keep the best value per player.
    const statKey = `max${this.statLabel.replace(/[^A-Za-z]/g, '') || 'Stat'}`;
    const playerStats: Record<string, Record<string, number>> = {};
    for (const id of this.entrants) {
      const s = this.standingOf(id);
      if (s) playerStats[id] = { maxLevel: s.level, [statKey]: s.stat };
    }
    this.reportOutcome({ placements, scores, reason, details: { board: this.boardKey(), mode: this.modeLabel(), matchNo: this.state.classics.matchNo, playerStats } });
    this.schedule('classics:results', this.resultsDelayMs, () => {
      if (this.phase !== 'PLAYING') return;
      let place = 0;
      const players = placements.flatMap((group) => {
        place++;
        const at = place;
        place += group.length - 1;
        return group.map((id) => {
          const record = this.players.get(id);
          const s = this.standingOf(id);
          return {
            playerId: id,
            name: record?.state.name ?? s?.name ?? 'Player',
            guestId: record?.guestId,
            userId: record?.userId,
            score: scores[id] ?? 0,
            placement: at,
          };
        });
      });
      this.endMatch({ players, details: { board: this.boardKey(), mode: this.modeLabel() } });
    });
  }

  private refreshRanks(): void {
    if (this.ranksFinal) return;
    const ids = this.isSolo ? [...this.state.standings.keys()] : this.entrants;
    const sorted = [...ids].sort((a, b) => (this.standingOf(b)?.score ?? 0) - (this.standingOf(a)?.score ?? 0));
    let rank = 0;
    let prevScore = -1;
    sorted.forEach((id, i) => {
      const s = this.standingOf(id);
      if (!s) return;
      if (s.score !== prevScore) rank = i + 1;
      prevScore = s.score;
      if (s.rank !== rank) s.rank = rank;
    });
  }

  private ensureStanding(player: PlayerRecord): ClassicsStanding {
    let s = this.standingOf(player.id);
    if (!s) {
      s = new ClassicsStanding();
      this.state.standings.set(player.id, s);
    }
    s.name = player.state.name;
    s.color = player.state.color;
    return s;
  }

  private resetStanding(s: ClassicsStanding, status: ClassicsStatus): void {
    s.score = 0;
    s.level = 0;
    s.lives = 0;
    s.stat = 0;
    s.ticks = 0;
    s.rank = 0;
    s.status = status;
  }

  // ===========================================================================
  // BaseGameRoom hooks (call super first when overriding)
  // ===========================================================================

  protected override onRoomCreated(_options: CreateOptions): void {
    this.countdownMs = this.isSolo ? 0 : this.matchCountdownMs;
    const meta = this.state.classics;
    meta.solo = this.isSolo;
    meta.statLabel = this.statLabel;
    meta.mode = this.modeLabel();
    meta.board = this.boardKey();
    highScores.setStatLabel(this.gameId, meta.board, this.statLabel);

    this.handle(CLASSICS_MSG.start, EmptySchema, (p) => this.onStartRequest(p), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: RATE.action,
    });
    this.handle(
      CLASSICS_MSG.quit,
      EmptySchema,
      (p) => {
        if (!this.isSolo || this.statusOf(p.id) !== 'playing') return;
        this.abortRun(p.id, 'quit');
        const s = this.standingOf(p.id);
        if (s) s.status = 'ready';
      },
      { phases: ['PLAYING'], playersOnly: true, rate: RATE.action },
    );
    this.handle(
      CLASSICS_MSG.rematch,
      EmptySchema,
      (p) => {
        if (this.tournamentMatch) return this.reject(p, CLASSICS_MSG.rematch, 'not_allowed', 'The tournament decides the next game.');
        this.returnToLobby();
        this.startMatch();
      },
      { phases: ['RESULTS'], hostOnly: true, rate: RATE.heavy },
    );
  }

  /**
   * Solo rooms may change settings in PLAYING (the start card's mode picker), but never while a
   * run is live: boards, multipliers and rules are read from the settings, so switching mid-run
   * could file an easy run (e.g. vs the rookie house paddle) on a harder mode's board.
   */
  protected override settingsLockReason(): string | null {
    if (!this.isSolo || this.phase !== 'PLAYING') return null;
    for (const s of this.state.standings.values()) {
      if (s.status === 'playing') return 'Finish or quit this run to change the settings.';
    }
    return null;
  }

  protected override onSettingsChanged(): void {
    const meta = this.state.classics;
    meta.mode = this.modeLabel();
    meta.board = this.boardKey();
    highScores.setStatLabel(this.gameId, meta.board, this.statLabel);
  }

  private onStartRequest(p: PlayerRecord): void {
    // Solo only: multiplayer runs start together with the match.
    if (!this.isSolo) return this.reject(p, CLASSICS_MSG.start, 'not_allowed', 'This match starts for everyone at once.');
    const status = this.statusOf(p.id);
    if (status !== 'ready' && status !== 'over' && status !== 'idle') return;
    const s = this.ensureStanding(p);
    this.resetStanding(s, 'playing');
    s.runs = Math.min(65535, s.runs + 1);
    this.entrants = [p.id];
    this.soloPauses = 0;
    this.soloLiveAt = 0;
    this.beginSoloRun(p);
  }

  protected override onPlayerJoined(player: PlayerRecord): void {
    if (!player.state.spectator) this.ensureStanding(player);
    if (this.isSolo) this.startMatch();
  }

  protected override onCountdownStart(): void {
    this.prepare(this.state.phaseEndsAt || Date.now() + this.countdownMs);
  }

  private prepare(startAt: number): void {
    this.matchPrepared = true;
    this.finishing = false;
    this.ranksFinal = false;
    const meta = this.state.classics;
    meta.matchNo = (meta.matchNo + 1) & 0xffff;
    meta.mode = this.modeLabel();
    meta.board = this.boardKey();
    if (this.isSolo) {
      meta.startAt = 0;
      meta.endsAt = 0;
      return;
    }
    const entrants = this.seatedPlayers().filter((p) => !p.away);
    this.entrants = entrants.map((p) => p.id);
    for (const id of [...this.state.standings.keys()]) if (!this.players.has(id)) this.state.standings.delete(id);
    for (const p of entrants) this.resetStanding(this.ensureStanding(p), 'playing');
    const duration = this.matchDurationMs();
    meta.startAt = startAt;
    meta.endsAt = duration > 0 ? startAt + duration : 0;
    meta.entrants = entrants.length;
    this.refreshRanks();
    this.prepareMatch(entrants, startAt);
    this.broadcastEvent({ kind: 'match-start', startAt, entrants: entrants.length });
  }

  protected override onGameStart(): void {
    if (this.isSolo) {
      if (!this.matchPrepared) this.prepare(0);
      const me = this.seatedPlayers()[0];
      if (me) {
        const s = this.ensureStanding(me);
        if (s.status === 'idle') s.status = 'ready';
      }
      return;
    }
    if (!this.matchPrepared) this.prepare(Date.now());
    const endsAt = this.state.classics.endsAt;
    if (endsAt > 0) {
      this.schedule('classics:deadline', Math.max(0, endsAt - Date.now()), () => {
        if (this.phase !== 'PLAYING') return;
        this.broadcastEvent({ kind: 'time-up' });
        this.onTimeUp();
        this.checkMatchEnd();
      });
    }
    this.onMatchLive();
    this.checkMatchEnd();
  }

  protected override onPlayerRemoved(player: PlayerRecord, _reason: RemovalReason): void {
    const inMatch = this.phase === 'COUNTDOWN' || this.phase === 'PLAYING';
    if (inMatch && this.entrants.includes(player.id)) {
      if (this.statusOf(player.id) === 'playing') this.abortRun(player.id, 'left');
      const s = this.standingOf(player.id);
      // A run that already ended keeps its verified result: leaving afterwards isn't a forfeit.
      if (s && s.status !== 'over') s.status = 'out';
      this.checkMatchEnd();
      return;
    }
    if (!inMatch && this.phase !== 'RESULTS') this.state.standings.delete(player.id);
  }

  protected override onReturnToLobby(): void {
    this.matchPrepared = false;
    this.finishing = false;
    this.ranksFinal = false;
    this.entrants = [];
    for (const id of [...this.state.standings.keys()]) {
      const p = this.players.get(id);
      if (!p || p.state.spectator) this.state.standings.delete(id);
    }
    for (const p of this.seatedPlayers()) this.resetStanding(this.ensureStanding(p), 'idle');
    const meta = this.state.classics;
    meta.startAt = 0;
    meta.endsAt = 0;
    meta.entrants = 0;
    meta.mode = this.modeLabel();
    meta.board = this.boardKey();
  }
}
