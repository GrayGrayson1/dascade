/**
 * Artist rotation. Each round every seated player draws once, in join order. Players
 * who join mid-round are appended to the current round; players who leave are dropped;
 * players who cannot draw when their turn comes up (disconnected) are skipped for the round.
 */
export class TurnOrder {
  private queue: string[] = [];
  private readonly drawn: string[] = [];
  private currentRound = 0;

  get round(): number {
    return this.currentRound;
  }

  /** Players who already drew (or were skipped) this round, in order. */
  get done(): readonly string[] {
    return this.drawn;
  }

  /** Players still waiting for their turn this round. */
  get pending(): readonly string[] {
    return this.queue;
  }

  /** Turns this round so far + still to come. */
  get turnsThisRound(): number {
    return this.drawn.length + this.queue.length;
  }

  startRound(playerIds: readonly string[]): number {
    this.currentRound++;
    this.queue = [...new Set(playerIds)];
    this.drawn.length = 0;
    return this.currentRound;
  }

  /** Adds a late joiner to the current round (no-op if they already drew or are queued). */
  add(id: string): void {
    if (this.currentRound === 0) return;
    if (this.queue.includes(id) || this.drawn.includes(id)) return;
    this.queue.push(id);
  }

  remove(id: string): void {
    this.queue = this.queue.filter((q) => q !== id);
  }

  /** Next artist this round, skipping players `canDraw` rejects. Null when the round is over. */
  next(canDraw: (id: string) => boolean): string | null {
    while (this.queue.length > 0) {
      const id = this.queue.shift() as string;
      this.drawn.push(id);
      if (canDraw(id)) return id;
    }
    return null;
  }

  reset(): void {
    this.queue = [];
    this.drawn.length = 0;
    this.currentRound = 0;
  }
}
