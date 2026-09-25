import type { Presence } from '@colyseus/core';
import { generateRoomCode, type Rng } from '@dascade/shared';

const KEY = 'dascade:room-codes';

/** Allocates a unique human-friendly room code (unique across processes when a shared presence is used). */
export async function allocateRoomCode(presence: Presence, rng: Rng): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = generateRoomCode(rng);
    const taken = await presence.sismember(KEY, code);
    if (!taken) {
      await presence.sadd(KEY, code);
      return code;
    }
  }
  throw new Error('Unable to allocate a unique room code');
}

export async function releaseRoomCode(presence: Presence, code: string): Promise<void> {
  await presence.srem(KEY, code);
}
