/**
 * The black box (OPS-01 C): an event room's snapshot, sealed so that only this server can read it.
 *
 * `sb1.<iv>.<ciphertext>.<tag>` (base64url): the JSON snapshot, deflated, then AES-256-GCM encrypted
 * and authenticated. The key is derived (HKDF-SHA256, its own label) from `DASCADE_SAVE_SECRET`, which
 * Render already generates for DASQuest saves. The presenter's console only carries the blob and
 * hands it back after a restart; it can't read or change it (snapshots hold the answers). In production
 * without a real secret, black boxes are off (keep-alive still works). Snapshots expire after 24 hours.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const PREFIX = 'sb1';
const DEV_SECRET = 'dascade-dev-save-secret';
export const BLACKBOX_TTL_MS = 24 * 3600_000;
/** Inflated snapshots larger than this are refused (a sealed blob is ours, but never trust a size). */
const MAX_JSON_BYTES = 4 * 1024 * 1024;
/** Clock skew tolerated for a snapshot "from the future" (another instance's clock). */
const SKEW_MS = 5 * 60_000;

type Env = Readonly<Record<string, string | undefined>>;

/** The sealing key, or null when black boxes are off (production without a real secret). */
export function blackBoxKey(env: Env = process.env): Buffer | null {
  const configured = env.DASCADE_SAVE_SECRET?.trim() ?? '';
  const production = env.NODE_ENV === 'production';
  if (production && (!configured || configured === DEV_SECRET)) return null;
  const secret = configured || DEV_SECRET;
  return Buffer.from(hkdfSync('sha256', secret, 'dascade', 'showdown-blackbox-v1', 32));
}

export function blackBoxEnabled(env: Env = process.env): boolean {
  return blackBoxKey(env) !== null;
}

/** Seals a snapshot (must carry `takenAt`). Null when black boxes are off. */
export function sealBlackBox(snapshot: { takenAt: number }, env: Env = process.env): string | null {
  const key = blackBoxKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(PREFIX));
  const body = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(snapshot)))), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString('base64url')}.${body.toString('base64url')}.${tag.toString('base64url')}`;
}

/** Opens a sealed snapshot: null if it's forged, damaged, expired or from another key. */
export function openBlackBox<T extends { takenAt: number }>(blob: string, now = Date.now(), env: Env = process.env): T | null {
  const key = blackBoxKey(env);
  if (!key || typeof blob !== 'string') return null;
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const body = Buffer.from(parts[2]!, 'base64url');
    const tag = Buffer.from(parts[3]!, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(PREFIX));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    const json = inflateRawSync(plain, { maxOutputLength: MAX_JSON_BYTES }).toString('utf8');
    const snapshot = JSON.parse(json) as T;
    if (!snapshot || typeof snapshot.takenAt !== 'number') return null;
    if (now - snapshot.takenAt > BLACKBOX_TTL_MS || snapshot.takenAt - now > SKEW_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}
