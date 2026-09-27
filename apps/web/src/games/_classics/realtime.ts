/**
 * Client helpers for authority model 1 (server-simulated real-time: paddle, snake, asteroids).
 *
 *  - InputPump: once per fixed step, push the current intent frame (a small integer, e.g. from
 *    intentBits().pack(...)); every `every` frames it sends { seq, frames } to the server, which
 *    feeds them into an IntentQueue. Frames are only sent while connected; on reconnect the
 *    sequence simply continues (the server's queue re-anchors big jumps).
 *  - SnapshotBuffer (re-exported from game-core): interpolate remote entities ~100 ms behind.
 *  - subscribeBytes(): subscribe to a binary broadcast (room.broadcastBytes on the server).
 */
import { subscribeMessage, session, useSessionStore } from '../../net/session.ts';

export { SnapshotBuffer, intentBits, ByteReader, ByteWriter } from '@dascade/game-core/classics/shared';

export class InputPump {
  private seq = 1;
  private frames: number[] = [];
  private sentSeq = 1;

  /**
   * @param type    message type the room registered (e.g. 'snake:input')
   * @param every   frames per packet (2 at 60 Hz ≈ 30 packets/s; 1 for 20 Hz sims)
   * @param maxFrames cap per packet (older frames are dropped while offline)
   */
  constructor(
    private readonly type: string,
    private readonly every = 2,
    private readonly maxFrames = 8,
  ) {}

  /** Record this tick's frame; sends a packet when `every` frames are pending. Returns the frame's seq. */
  push(frame: number): number {
    const seq = this.seq++;
    this.frames.push(frame);
    if (this.frames.length > this.maxFrames) {
      const drop = this.frames.length - this.maxFrames;
      this.frames.splice(0, drop);
      this.sentSeq += drop;
    }
    if (this.frames.length >= this.every) this.flush();
    return seq;
  }

  flush(): void {
    if (this.frames.length === 0) return;
    if (useSessionStore.getState().status !== 'connected') return;
    session.send(this.type, { seq: this.sentSeq, inputs: this.frames });
    this.sentSeq += this.frames.length;
    this.frames = [];
  }

  /** Seq that the next pushed frame will get (for prediction bookkeeping). */
  get nextSeq(): number {
    return this.seq;
  }
}

/** Subscribe to a binary message (Uint8Array payload). Returns an unsubscribe function. */
export function subscribeBytes(type: string, handler: (bytes: Uint8Array) => void): () => void {
  return subscribeMessage(type, (payload) => {
    if (payload instanceof Uint8Array) handler(payload);
    else if (payload instanceof ArrayBuffer) handler(new Uint8Array(payload));
  });
}
