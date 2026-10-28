/**
 * CORS for every HTTP response (security sweep F-01).
 *
 * Colyseus answers EVERY request it sees (the HTML, /api, /matchmake) with
 * `matchMaker.controller.DEFAULT_CORS_HEADERS` merged with `getCorsHeaders()`: by default
 * `Access-Control-Allow-Origin: *` (or the caller's Origin echoed back) with
 * `Access-Control-Allow-Credentials: true` and PUT/PATCH/DELETE. The site only ever talks to itself,
 * so instead:
 *   - another site's Origin gets no CORS headers at all (the browser then refuses its reads);
 *   - the site's own origin (same host as the request) is echoed back;
 *   - never a credentials header (the site sets no cookies; the web client omits credentials);
 *   - in development, the Vite dev server (same host name, another port) and localhost are allowed;
 *   - a client hosted elsewhere (VITE_SERVER_URL) is allowed by listing its origin in CORS_ORIGINS.
 */
import { matchMaker } from '@colyseus/core';

const ALLOWED_METHODS = 'GET, HEAD, POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The origin to echo back for this request, or null when it gets no CORS headers. */
export function allowedOrigin(origin: string | null, host: string | null, dev: boolean, extra: readonly string[] = []): string | null {
  if (!origin) return null;
  if (extra.includes(origin)) return origin;
  if (!host) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== origin) return null;
  const requestHost = host.toLowerCase();
  if (url.host === requestHost) return origin;
  if (!dev) return null;
  const requestHostname = requestHost.replace(/:\d+$/, '');
  return url.hostname === requestHostname || LOCAL_HOSTS.has(url.hostname) ? origin : null;
}

/** The CORS headers for a request's headers (Colyseus' `getCorsHeaders` contract). */
export function corsHeaders(headers: Headers, dev: boolean, extra: readonly string[] = []): Record<string, string> {
  const origin = headers.get('origin');
  if (!origin) return {};
  const allowed = allowedOrigin(origin, headers.get('host'), dev, extra);
  if (!allowed) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** Replaces Colyseus' permissive defaults (they are merged into every response, so they go entirely). */
export function installCors(dev: boolean, extra: readonly string[] = []): void {
  (matchMaker.controller as { DEFAULT_CORS_HEADERS: Record<string, string> }).DEFAULT_CORS_HEADERS = {};
  matchMaker.controller.getCorsHeaders = (headers) => corsHeaders(headers, dev, extra);
}
