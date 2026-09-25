import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== '' ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 2567),
  host: process.env.HOST ?? '0.0.0.0',
  isProduction: process.env.NODE_ENV === 'production',
  /** Built web client to serve (production single-service deployment). */
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
  /** Simulated round-trip latency for local netcode testing. */
  simulatedLatencyMs: num(process.env.DASCADE_LATENCY_MS, 0),
  /** Relax per-IP matchmaking limits (tests / load simulation). */
  relaxedLimits: process.env.DASCADE_RELAXED_LIMITS === '1' || process.env.NODE_ENV === 'test',
  /** Public Supabase URL the browser talks to (for the CSP connect-src). */
  supabasePublicUrl: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    /** Server-only secret key (sb_secret_...). Never sent to browsers. */
    secretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  },
  /** Max inbound WebSocket frame size. */
  maxPayloadBytes: 256 * 1024,
  /** Max JSON body for HTTP matchmaking (create/join options incl. initial settings). */
  maxMatchmakeBodyBytes: 128 * 1024,
  // Per-IP throttles read the client address according to TRUST_PROXY (auto | 0 | n hops):
  // see lib/clientIp.ts.
} as const;

export const supabaseEnabled = Boolean(config.supabase.url && config.supabase.secretKey);
