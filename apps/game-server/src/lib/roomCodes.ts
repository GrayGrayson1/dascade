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

/** Claims a specific code (a restored room keeps its old one). False when it's in use. */
export async function claimRoomCode(presence: Presence, code: string): Promise<boolean> {
  if (await presence.sismember(KEY, code)) return false;
  // A shared (Redis) presence answers how many members it added: 0 = someone claimed it in between.
  const added = (await presence.sadd(KEY, code)) as unknown;
  return typeof added === 'number' ? added > 0 : true;
}

export async function releaseRoomCode(presence: Presence, code: string): Promise<void> {
  await presence.srem(KEY, code);
}
