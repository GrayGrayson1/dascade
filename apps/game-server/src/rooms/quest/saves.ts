/**
 * Signed DASQuest saves.
 *
 * A save is `dq1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. The payload holds
 * a player-agnostic run snapshot plus display info. Saves live on players' devices, so
 * the server trusts nothing it didn't sign: the signature is verified in constant time,
 * then the run is re-validated structurally and against the current pack version.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { QuestSaveInfo } from '@dascade/shared/games/quest';
import type { RunState } from '@dascade/game-core/quest';

const PREFIX = 'dq1';
const DEV_SECRET = 'dascade-dev-save-secret';

function secret(): string {
  return process.env.DASCADE_SAVE_SECRET ?? DEV_SECRET;
}

function mac(body: string): string {
  return createHmac('sha256', secret()).update(`${PREFIX}.${body}`).digest('base64url');
}

export interface SavePayload {
  info: QuestSaveInfo;
  run: RunState;
}

const InfoSchema = z.strictObject({
  id: z.string().min(1).max(64),
  packId: z.string().min(1).max(40),
  packTitle: z.string().max(80),
  chapter: z.number().int().min(1).max(12),
  chapterTitle: z.string().max(80),
  nodeTitle: z.string().max(80),
  savedAt: z.number().int().min(0),
  credits: z.number().int(),
  score: z.number().int(),
  heroes: z
    .array(
      z.strictObject({
        slot: z.number().int().min(0).max(15),
        name: z.string().max(40),
        archetype: z.enum(['guardian', 'scout', 'tinker', 'trickster', 'analyst', 'seer']),
        hp: z.number().int().min(0),
        maxHp: z.number().int().min(1),
        ko: z.boolean(),
      }),
    )
    .max(16),
});

export function signSave(payload: SavePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${PREFIX}.${body}.${mac(body)}`;
}

export type VerifyResult = { ok: true; info: QuestSaveInfo; run: unknown } | { ok: false; error: string };

export function verifySave(blob: string): VerifyResult {
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'That is not a DASQuest save.' };
  const [, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: 'That save has been modified or was made by a different server.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'That save is damaged.' };
  }
  const shape = z.strictObject({ info: InfoSchema, run: z.unknown() }).safeParse(parsed);
  if (!shape.success) return { ok: false, error: 'That save is damaged.' };
  return { ok: true, info: shape.data.info, run: shape.data.run };
}
