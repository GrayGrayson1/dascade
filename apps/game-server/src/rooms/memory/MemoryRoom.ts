/**
 * Memory Matrix — server-driven (classics kit ClassicsRoom).
 *
 * The room generates every pattern with the crypto RNG, plays it on the server clock (a pattern
 * broadcast carries its server start time), judges every tap (RoundJudge) and owns scores and
 * lives. Everyone in a match gets the same pattern each round. Nothing hidden sits in state:
 * patterns only travel at show time and the answer is revealed when the round closes; players'
 * public marks show progress counts, never tiles.
 *
 * Disconnects never stall: the input window always closes on its timer (unfinished = a miss).
 * Head-to-head (tournaments): same rounds; placements by score, equal scores draw; an opponent who
 * leaves forfeits at once (the remaining player's run ends there — see finishIfOpponentsLeft).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import type { CreateOptions } from '@dascade/shared';
import { CLASSICS_MSG, type RunEndReason, type RunSummary, type RunVerdict } from '@dascade/shared/games/classics';
import {
  DEFAULT_MEMORY_SETTINGS,
  MEMORY_LIVES,
  MEMORY_MSG,
  MemorySettingsSchema,
  MemoryTapSchema,
  memoryBoardKey,
  type MemoryFeedback,
  type MemoryMarkState,
  type MemoryPatternMsg,
  type MemoryReveal,
  type MemorySettings,
  type MemoryYou,
} from '@dascade/shared/games/memory';
import { MAX_ROUNDS, RoundJudge, generatePattern, roundSpec, type RoundSpec } from '@dascade/game-core/memory';
import type { PlayerRecord } from '../BaseGameRoom.ts';
import { ClassicsRoom, ClassicsState } from '../classics/index.ts';

export const MemoryMark = schema(
  {
    progress: t.uint8().default(0),
    state: t.string().default('waiting'),
  },
  'MemoryMark',
);
export type MemoryMark = SchemaType<typeof MemoryMark>;

export const MemoryState = ClassicsState.extend(
  {
    stage: t.string().default('idle'),
    stageEndsAt: t.float64().default(0),
    grid: t.uint8().default(3),
    kind: t.string().default('sequence'),
    count: t.uint8().default(0),
    marks: t.map(MemoryMark),
  },
  'MemoryState',
);
export type MemoryState = SchemaType<typeof MemoryState>;

interface Contender {
  id: string;
  score: number;
  lives: number;
  cleared: number;
  alive: boolean;
  /** Left the match (placed last). */
  left: boolean;
  judge: RoundJudge | null;
}

export class MemoryRoom extends ClassicsRoom<MemoryState, MemorySettings> {
  readonly gameId = 'memory' as const;
  protected readonly settingsSchema = MemorySettingsSchema;
  protected readonly statLabel = 'Rounds';
  /** Stage timings (ms); tests shorten them. */
  protected introMs = 1_100;
  protected reviewMs = 1_700;
  protected showLeadMs = 250;
  protected firstRoundDelayMs = 600;

  private contenders = new Map<string, Contender>();
  private spec: RoundSpec | null = null;
  private pattern: number[] = [];
  private inputOpenedAt = 0;
  private patternMsg: MemoryPatternMsg | null = null;

  protected defaultSettings(): MemorySettings {
    return structuredClone(DEFAULT_MEMORY_SETTINGS);
  }

  protected createState(): MemoryState {
    return new MemoryState();
  }

  protected boardKey(): string {
    return memoryBoardKey(this.getSettings());
  }

  protected override modeLabel(): string {
    const s = this.getSettings();
    return `${s.variant}/${s.rule}`;
  }

  protected override onRoomCreated(options: CreateOptions): void {
    super.onRoomCreated(options);
    this.settingsEditablePhases = this.isSolo ? ['LOBBY', 'PLAYING'] : ['LOBBY'];
    this.handle(MEMORY_MSG.tap, MemoryTapSchema, (p, tap) => this.onTap(p, tap.round, tap.tile), {
      phases: ['PLAYING'],
      playersOnly: true,
      rate: { burst: 20, perSecond: 12 },
    });
  }

  // ---------------------------------------------------------------------------
  // Kit hooks
  // ---------------------------------------------------------------------------

  private startingLives(): number {
    return this.getSettings().rule === 'sudden' ? 1 : MEMORY_LIVES;
  }

  private enroll(ids: string[]): void {
    this.contenders.clear();
    this.state.marks.clear();
    for (const id of ids) {
      this.contenders.set(id, { id, score: 0, lives: this.startingLives(), cleared: 0, alive: true, left: false, judge: null });
      const mark = new MemoryMark();
      this.state.marks.set(id, mark);
      this.updateStanding(id, this.summaryOf(id));
    }
  }

  protected beginSoloRun(player: PlayerRecord): void {
    this.enroll([player.id]);
    this.schedule('memory:stage', 300, () => this.startRound(1));
  }

  protected prepareMatch(entrants: PlayerRecord[]): void {
    this.enroll(entrants.map((p) => p.id));
    this.state.stage = 'idle';
    this.state.round = 0;
  }

  protected override onMatchLive(): void {
    // An opponent may have walked out during the countdown.
    this.finishIfOpponentsLeft();
    this.schedule('memory:stage', this.firstRoundDelayMs, () => this.startRound(1));
  }

  protected abortRun(playerId: string, reason: RunEndReason): void {
    const c = this.contenders.get(playerId);
    if (!c || !c.alive) return;
    c.alive = false;
    if (reason === 'left') c.left = true;
    if (c.judge) c.judge.closed = true;
    const mark = this.state.marks.get(playerId);
    if (mark) mark.state = 'out';
    if (reason === 'quit') {
      // Solo quit: stop the round machine; the player returns to the start card.
      this.cancel('memory:stage');
      this.resetStage();
      return;
    }
    this.finish(playerId, reason);
    this.maybeCloseEarly();
    this.finishIfOpponentsLeft();
  }

  /**
   * Head-to-head Tournament Center games: once every opponent has LEFT (leavers are placed last), the
   * one still playing has won — end their run now instead of making them play on alone (and so a
   * later leave of theirs can't turn the forfeit into a shared last place). Opponents who lost all
   * their lives don't count: the survivor may still need to beat their score.
   */
  private finishIfOpponentsLeft(): void {
    if (!this.tournamentMatch || this.phase !== 'PLAYING') return;
    const alive = this.alive();
    const others = [...this.contenders.values()].filter((c) => !c.alive);
    if (alive.length !== 1 || others.length === 0 || !others.every((c) => c.left)) return;
    const last = alive[0]!;
    last.alive = false;
    if (last.judge) last.judge.closed = true;
    this.cancel('memory:stage');
    this.resetStage();
    this.finish(last.id, 'over');
  }

  // ---------------------------------------------------------------------------
  // Round machine
  // ---------------------------------------------------------------------------

  /** Finish a player: record + tell them their verified result (rank on the board etc.). */
  private finish(id: string, reason: RunEndReason): void {
    const summary = this.summaryOf(id);
    const info = this.playerFinished(id, summary, reason);
    const s = this.standingOf(id);
    const verdict: RunVerdict = {
      ...summary,
      runId: `m${this.state.classics.matchNo}-${s?.runs ?? 0}`,
      reason,
      ticks: 0,
      best: info.best,
      rank: info.rank,
      entryId: info.entryId,
      board: info.board,
    };
    this.sendTo(id, CLASSICS_MSG.verdict, verdict);
  }

  private summaryOf(id: string): RunSummary {
    const c = this.contenders.get(id);
    return { score: c?.score ?? 0, level: Math.max(1, this.state.round), lives: c?.lives ?? 0, stat: c?.cleared ?? 0 };
  }

  private alive(): Contender[] {
    return [...this.contenders.values()].filter((c) => c.alive);
  }

  private setStage(stage: MemoryState['stage'], durationMs: number): void {
    this.state.stage = stage;
    this.state.stageEndsAt = durationMs > 0 ? Date.now() + durationMs : 0;
  }

  private resetStage(): void {
    this.state.stage = 'idle';
    this.state.stageEndsAt = 0;
    this.spec = null;
    this.pattern = [];
    this.patternMsg = null;
  }

  private startRound(round: number): void {
    if (this.phase !== 'PLAYING') return;
    const alive = this.alive();
    if (alive.length === 0) return;
    const spec = roundSpec(this.getSettings().variant, round);
    this.spec = spec;
    this.pattern = generatePattern(spec, this.rng);
    this.patternMsg = null;
    this.state.round = spec.round;
    this.state.grid = spec.size;
    this.state.kind = spec.kind;
    this.state.count = spec.count;
    for (const c of alive) {
      c.judge = new RoundJudge(spec, this.pattern);
      const mark = this.state.marks.get(c.id);
      if (mark) {
        mark.progress = 0;
        mark.state = 'watch';
      }
      this.sendYou(c.id);
    }
    this.setStage('intro', this.introMs);
    this.schedule('memory:stage', this.introMs, () => this.show());
  }

  private show(): void {
    const spec = this.spec;
    if (!spec || this.phase !== 'PLAYING') return;
    const showAt = Date.now() + this.showLeadMs;
    const msg: MemoryPatternMsg = { round: spec.round, kind: spec.kind, size: spec.size, tiles: [...this.pattern], stepMs: spec.stepMs, gapMs: spec.gapMs, showAt };
    this.patternMsg = msg;
    this.broadcast(MEMORY_MSG.pattern, msg);
    this.setStage('show', this.showLeadMs + spec.showMs);
    this.schedule('memory:stage', this.showLeadMs + spec.showMs, () => this.openInput());
  }

  private openInput(): void {
    const spec = this.spec;
    if (!spec || this.phase !== 'PLAYING') return;
    this.inputOpenedAt = Date.now();
    for (const c of this.alive()) {
      const mark = this.state.marks.get(c.id);
      if (mark) mark.state = 'input';
    }
    this.setStage('input', spec.inputMs);
    this.schedule('memory:stage', spec.inputMs, () => this.closeInput());
    this.maybeCloseEarly();
  }

  private onTap(player: PlayerRecord, round: number, tile: number): void {
    const c = this.contenders.get(player.id);
    const spec = this.spec;
    if (!c || !c.alive || !c.judge || !spec || this.state.stage !== 'input' || round !== spec.round) return;
    const res = c.judge.tap(tile, Date.now() - this.inputOpenedAt);
    if (!res.ok && (res.reason === 'closed' || res.reason === 'range' || res.reason === 'repeat')) return;
    const mark = this.state.marks.get(player.id);
    if (res.ok) {
      c.score += res.points;
      if (mark) {
        mark.progress = res.progress;
        if (res.done) mark.state = 'done';
      }
      this.updateStanding(player.id, this.summaryOf(player.id));
    } else if (mark) mark.state = 'failed';
    const fb: MemoryFeedback = {
      round,
      tile,
      ok: res.ok,
      progress: res.progress,
      done: res.ok ? res.done : false,
      failed: !res.ok,
      points: res.ok ? res.points : 0,
    };
    this.sendTo(player, MEMORY_MSG.feedback, fb);
    this.maybeCloseEarly();
  }

  /** Close the input window as soon as every living player is done or has failed. */
  private maybeCloseEarly(): void {
    if (this.state.stage !== 'input') return;
    const open = this.alive().some((c) => c.judge && !c.judge.closed);
    if (!open) this.closeInput();
  }

  private closeInput(): void {
    const spec = this.spec;
    if (!spec || this.state.stage !== 'input' || this.phase !== 'PLAYING') return;
    this.cancel('memory:stage');
    const results: Record<string, 'done' | 'failed'> = {};
    const outs: string[] = [];
    for (const c of this.alive()) {
      const judge = c.judge;
      if (!judge) continue;
      judge.timeout();
      const mark = this.state.marks.get(c.id);
      if (judge.failed) {
        results[c.id] = 'failed';
        c.lives = Math.max(0, c.lives - 1);
        if (mark) mark.state = 'failed';
        if (c.lives === 0) outs.push(c.id);
      } else {
        results[c.id] = 'done';
        c.cleared++;
      }
      this.updateStanding(c.id, this.summaryOf(c.id));
    }
    const reveal: MemoryReveal = { round: spec.round, kind: spec.kind, size: spec.size, tiles: [...this.pattern], results };
    this.broadcast(MEMORY_MSG.reveal, reveal);
    this.patternMsg = null;
    this.setStage('review', this.reviewMs);
    for (const id of outs) {
      const c = this.contenders.get(id)!;
      c.alive = false;
      const mark = this.state.marks.get(id);
      if (mark) mark.state = 'out';
      this.finish(id, 'over');
    }
    if (this.phase !== 'PLAYING') return;
    const next = spec.round + 1;
    if (this.alive().length === 0) {
      this.schedule('memory:stage', this.reviewMs, () => this.resetStage());
      return;
    }
    if (next > MAX_ROUNDS) {
      // Nobody can go further: everyone still standing finishes with their score.
      for (const c of this.alive()) {
        c.alive = false;
        this.finish(c.id, 'time');
      }
      return;
    }
    this.schedule('memory:stage', this.reviewMs, () => this.startRound(next));
  }

  private sendYou(id: string): void {
    const c = this.contenders.get(id);
    const mark = this.state.marks.get(id);
    if (!c) return;
    const you: MemoryYou = {
      round: this.state.round,
      progress: c.judge?.progress ?? 0,
      found: c.judge ? [...c.judge.found] : [],
      state: (mark?.state as MemoryMarkState | undefined) ?? 'waiting',
    };
    this.sendTo(id, MEMORY_MSG.you, you);
  }

  protected override syncPrivate(player: PlayerRecord): void {
    if (this.contenders.has(player.id)) this.sendYou(player.id);
    // Mid-show reconnect: replay the rest of the pattern playback.
    if (this.patternMsg && this.state.stage === 'show') this.sendTo(player, MEMORY_MSG.pattern, this.patternMsg);
  }

  protected override onReturnToLobby(): void {
    super.onReturnToLobby();
    this.contenders.clear();
    this.state.marks.clear();
    this.resetStage();
  }
}
