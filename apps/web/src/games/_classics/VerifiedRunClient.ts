/**
 * Client side of authority model 2 ("locally simulated, server-verified").
 *
 *   const run = new VerifiedRunClient(createBlocksSim);
 *   run.attach();                         // subscribes to classics:run / ack / verdict
 *   // every fixed step:
 *   if (run.canStep()) run.step(codes);   // codes = this tick's input codes
 *   // render run.sim; show run.verdict when it arrives (the SERVER's result).
 *
 * - The engine runs locally at 60 Hz for instant feel; accepted input codes are recorded at
 *   their tick and streamed to the server in small batches.
 * - Reconnects: the server re-sends the ticket with its verified log; we either keep our
 *   (further ahead) local sim and resend from the server's position, or — after a page reload —
 *   rebuild the sim by replaying the server's log and continue from there.
 * - The server's verdict is final. If it ends the run first (divergence), the local sim stops.
 * - At most CLASSICS.maxEventsPerTick codes are applied per tick (the server's flood guard); after a
 *   main-thread stall the rest carry over to the next ticks instead of getting the run rejected.
 * - Every run ends at CLASSICS.maxRunTicks (the server's length cap) like a timed race.
 */
import { CLASSICS, CLASSICS_MSG, type RunAck, type RunInputBatch, type RunTicket, type RunVerdict } from '@dascade/shared/games/classics';
import { InputRecorder, advanceSim, decodeEvents, type ClassicsSim, type SimFactory } from '@dascade/game-core/classics/shared';
import { getLastMessage, getStateSnapshot, serverNow, session, subscribeMessage, subscribeState, useSessionStore } from '../../net/session.ts';
import { takeTick } from './tickQueue.ts';
import type { ClassicsPublicState } from '@dascade/shared/games/classics';

export type RunPhase = 'none' | 'waiting' | 'running' | 'ended' | 'verified';

export class VerifiedRunClient<S extends ClassicsSim = ClassicsSim> {
  phase: RunPhase = 'none';
  sim: S | null = null;
  ticket: RunTicket | null = null;
  verdict: RunVerdict | null = null;
  /** The sim was rebuilt from the server log (page reload) — solo shows a Resume prompt. */
  resumed = false;
  private pending: RunTicket | null = null;
  private readonly recorder = new InputRecorder();
  private readonly unsubs: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  private sinceFlush = 0;
  private finalSent = false;
  /** Codes that didn't fit in their tick (flood guard), applied first on the next ticks. */
  private carry: number[] = [];
  private lastStatus = useSessionStore.getState().status;

  constructor(private readonly factory: SimFactory<S>) {}

  // ---------------------------------------------------------------------------
  attach(): void {
    this.unsubs.push(subscribeMessage(CLASSICS_MSG.run, (t) => this.onTicket(t as RunTicket)));
    this.unsubs.push(subscribeMessage(CLASSICS_MSG.ack, (a) => this.onAck(a as RunAck)));
    this.unsubs.push(subscribeMessage(CLASSICS_MSG.verdict, (v) => this.onVerdict(v as RunVerdict)));
    this.unsubs.push(subscribeState(() => this.tryActivate()));
    this.unsubs.push(
      useSessionStore.subscribe((s) => {
        if (s.status === this.lastStatus) return;
        this.lastStatus = s.status;
        // Back online: anything unsent is flushed on the next step (the server's ticket rewinds us).
        if (s.status === 'connected') this.sinceFlush = CLASSICS.batchEveryTicks;
      }),
    );
    const t = getLastMessage<RunTicket>(CLASSICS_MSG.run);
    if (t) this.onTicket(t);
    const v = getLastMessage<RunVerdict>(CLASSICS_MSG.verdict);
    if (v && this.ticket && v.runId === this.ticket.runId) this.onVerdict(v);
  }

  detach(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.listeners.clear();
  }

  /** Notified on phase changes (ticket, start, end, verdict) — cheap; not per tick. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of [...this.listeners]) l();
  }

  // ---------------------------------------------------------------------------
  private currentMatchNo(): number | null {
    const s = getStateSnapshot<ClassicsPublicState>();
    return s?.classics ? s.classics.matchNo : null;
  }

  private onTicket(t: RunTicket): void {
    if (this.ticket && t.runId === this.ticket.runId) {
      // Same run re-sent after a reconnect: the server's position is authoritative for sending.
      if (t.resume) this.recorder.rewind(t.resume.upTo, t.resume.ackSeq);
      else this.recorder.rewind(0, 0);
      this.finalSent = false;
      this.sinceFlush = CLASSICS.batchEveryTicks;
      if (!this.sim) this.adopt(t);
      return;
    }
    this.pending = t;
    this.tryActivate();
  }

  private tryActivate(): void {
    const t = this.pending;
    if (!t) return;
    const matchNo = this.currentMatchNo();
    if (matchNo === null || t.matchNo !== matchNo) return;
    this.pending = null;
    this.adopt(t);
  }

  private adopt(t: RunTicket): void {
    this.ticket = t;
    this.verdict = null;
    this.finalSent = false;
    this.carry = [];
    this.sinceFlush = 0;
    this.resumed = false;
    const sim = this.factory(t.seed, t.options);
    if (t.resume && t.resume.upTo > 0) {
      const decoded = decodeEvents(t.resume.events, 0, t.resume.upTo, Number.MAX_SAFE_INTEGER);
      const events = decoded.ok ? decoded.events : [];
      advanceSim(sim, events, t.resume.upTo);
      this.recorder.load(events, t.resume.upTo, t.resume.ackSeq);
      this.resumed = true;
    } else {
      this.recorder.load([], 0, 0);
    }
    this.sim = sim;
    this.phase = t.ended || sim.over ? 'ended' : serverNow() >= t.startAt ? 'running' : 'waiting';
    this.changed();
  }

  private onAck(a: RunAck): void {
    if (!this.ticket || a.runId !== this.ticket.runId || !a.resync) return;
    this.recorder.rewind(a.upTo, a.seq);
    this.finalSent = false;
    this.sinceFlush = CLASSICS.batchEveryTicks;
  }

  private onVerdict(v: RunVerdict): void {
    if (!this.ticket || v.runId !== this.ticket.runId) return;
    this.verdict = v;
    this.phase = 'verified';
    this.changed();
  }

  // ---------------------------------------------------------------------------
  /** Milliseconds until the run clock starts (0 when started). */
  msUntilStart(): number {
    return this.ticket ? Math.max(0, this.ticket.startAt - serverNow()) : 0;
  }

  /** Call every fixed step before step(): promotes waiting → running at startAt. */
  canStep(): boolean {
    if (this.phase === 'waiting' && this.ticket && serverNow() >= this.ticket.startAt) {
      this.phase = 'running';
      this.changed();
    }
    return this.phase === 'running' && this.sim !== null;
  }

  /** Apply this tick's input codes (only codes the engine accepts are recorded) and step once. */
  step(codes: readonly number[]): void {
    const sim = this.sim;
    const t = this.ticket;
    if (!sim || !t || this.phase !== 'running') return;
    const queue = this.carry.length ? [...this.carry, ...codes] : codes;
    this.carry = takeTick(queue, (code) => {
      if (!sim.input(code)) return false;
      this.recorder.record(sim.tick, code);
      return true;
    });
    sim.step();
    const limitHit = (t.limitTicks > 0 && sim.tick >= t.limitTicks) || sim.tick >= CLASSICS.maxRunTicks;
    if (sim.over || limitHit) {
      this.phase = 'ended';
      this.flush(true);
      this.changed();
      return;
    }
    if (++this.sinceFlush >= CLASSICS.batchEveryTicks) this.flush(false);
  }

  /** Send everything recorded since the last batch (split to the batch cap). */
  flush(final: boolean): void {
    const sim = this.sim;
    const t = this.ticket;
    if (!sim || !t) return;
    if (useSessionStore.getState().status !== 'connected') return;
    this.sinceFlush = 0;
    for (let guard = 0; guard < 64; guard++) {
      const batch = this.recorder.take(sim.tick);
      if (!batch) break;
      const isLast = batch.upTo >= sim.tick;
      const payload: RunInputBatch = { runId: t.runId, seq: batch.seq, upTo: batch.upTo, events: batch.events };
      if (final && isLast) {
        payload.final = true;
        payload.clientScore = Math.max(0, Math.floor(sim.summary().score));
        this.finalSent = true;
      }
      session.send(CLASSICS_MSG.input, payload);
    }
    if (final && !this.finalSent && this.recorder.sentUpTo >= sim.tick) {
      // Nothing new to send (already flushed through this tick): the server ends the run from its own replay.
      this.finalSent = true;
    }
  }

  /** Called each frame while ended but unverified: keeps re-flushing (e.g. after a reconnect). */
  pump(): void {
    if (this.phase === 'ended' && this.sim && this.recorder.pending(this.sim.tick)) this.flush(true);
  }

  get runId(): string | null {
    return this.ticket?.runId ?? null;
  }
}
