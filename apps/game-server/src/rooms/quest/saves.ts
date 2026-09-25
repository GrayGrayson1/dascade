/**
 * Signed DASQuest saves.
 *
 * A save is `dq1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. The payload holds
 * a player-agnostic run snapshot plus display info. Saves live on players' devices, so
 * the server trusts nothing it didn't sign: the signature is verified in constant time,
 * then the run is re-validated structurally and against the current pack version.
 *
 * Key: `DASCADE_SAVE_SECRET`. Outside production a fixed development key is used so local
 * saves keep working. That key is public (it is in this file), so in production it is
 * never used: without a real secret, saving and loading are disabled (with a startup
 * warning) instead of accepting saves anyone could forge.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { QuestSaveInfo } from '@dascade/shared/games/quest';
import type { RunState } from '@dascade/game-core/quest';
import { log } from '../../lib/log.ts';

const PREFIX = 'dq1';
const DEV_SECRET = 'dascade-dev-save-secret';
/** Shorter production secrets still work but get a startup warning. */
const RECOMMENDED_SECRET_LENGTH = 32;

export const SAVES_DISABLED_MESSAGE = 'Saved adventures are turned off on this server.';

export type SaveKey = { enabled: true; key: string; source: 'env' | 'dev-default' } | { enabled: false; reason: string };

type Env = Readonly<Record<string, string | undefined>>;

/** Resolve the HMAC key for saves (read on every call so tests can switch environments). */
export function resolveSaveKey(env: Env = process.env): SaveKey {
  const configured = env.DASCADE_SAVE_SECRET?.trim() ?? '';
  const production = env.NODE_ENV === 'production';
  if (production) {
    if (!configured) return { enabled: false, reason: 'DASCADE_SAVE_SECRET is not set' };
    if (configured === DEV_SECRET) return { enabled: false, reason: 'DASCADE_SAVE_SECRET is the public development default' };
  }
  if (configured) return { enabled: true, key: configured, source: 'env' };
  return { enabled: true, key: DEV_SECRET, source: 'dev-default' };
}

export function savesEnabled(env: Env = process.env): boolean {
  return resolveSaveKey(env).enabled;
}

/** Startup check: explain loudly when production saves are off or weakly keyed. */
export function warnAboutSaveKey(env: Env = process.env, warn: (msg: string, data?: Record<string, unknown>) => void = log.warn): void {
  if (env.NODE_ENV !== 'production') return;
  const key = resolveSaveKey(env);
  if (!key.enabled) {
    warn(`DASQuest saves are DISABLED: ${key.reason}. Set DASCADE_SAVE_SECRET to a long random value (e.g. \`openssl rand -hex 32\`) to enable checkpoints.`);
  } else if (key.key.length < RECOMMENDED_SECRET_LENGTH) {
    warn(`DASCADE_SAVE_SECRET is short (${key.key.length} chars); use at least ${RECOMMENDED_SECRET_LENGTH} random characters so saves can't be forged.`);
  }
}

// The room registry imports this module when the server boots with the quest room enabled.
warnAboutSaveKey();

function mac(key: string, body: string): string {
  return createHmac('sha256', key).update(`${PREFIX}.${body}`).digest('base64url');
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

/** Sign a save, or null when saves are disabled on this server. */
export function signSave(payload: SavePayload): string | null {
  const key = resolveSaveKey();
  if (!key.enabled) return null;
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${PREFIX}.${body}.${mac(key.key, body)}`;
}

export type VerifyResult = { ok: true; info: QuestSaveInfo; run: unknown } | { ok: false; error: string };

export function verifySave(blob: string): VerifyResult {
  const key = resolveSaveKey();
  if (!key.enabled) return { ok: false, error: SAVES_DISABLED_MESSAGE };
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'That is not a DASQuest save.' };
  const [, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(key.key, body));
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
