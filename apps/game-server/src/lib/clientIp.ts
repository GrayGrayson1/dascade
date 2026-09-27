/**
 * Trustworthy client IPs for per-IP throttling.
 *
 * Colyseus' AuthContext.ip takes the FIRST hop of X-Real-IP / X-Forwarded-For / X-Client-IP,
 * which any client can forge, and HTTP matchmaking requests carry no socket address at all
 * (so without a proxy every client shared one "unknown" bucket). Instead, the HTTP server
 * stamps every request with the address we actually trust (see server.ts), per TRUST_PROXY:
 *   - auto (default): if the TCP peer is loopback/private (a reverse proxy on the platform's
 *     network: Fly, Render, Railway, k8s, nginx), walk X-Forwarded-For from the right, skipping
 *     proxy hops (private/loopback addresses and Cloudflare's published edge ranges — Render and
 *     many hosts sit behind Cloudflare, whose edge IP would otherwise put a whole region in one
 *     bucket), and use the first remaining address: the one the outermost proxy appended. Entries
 *     further left are client-supplied and never read. A public peer is a direct client, so its
 *     headers are ignored.
 *   - 0: always the TCP peer address.
 *   - n: the n-th address from the right of X-Forwarded-For (n trusted proxy hops).
 */
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { AuthContext } from '@colyseus/core';

export const CLIENT_IP_HEADER = 'x-dascade-client-ip';

export type TrustProxy = number | 'auto';

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'auto') return 'auto';
  if (value === 'true') return 1;
  if (value === 'false') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 'auto';
}

let trustProxy: TrustProxy = parseTrustProxy(process.env.TRUST_PROXY);

/** Override the proxy trust mode (tests). */
export function setTrustProxy(mode: TrustProxy): void {
  trustProxy = mode;
}

function stripMapped(ip: string): string {
  const addr = ip.trim().toLowerCase();
  return addr.startsWith('::ffff:') && addr.includes('.') ? addr.slice(7) : addr;
}

/** Loopback, RFC 1918, CGNAT (100.64/10), link-local and IPv6 unique-local/link-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  const addr = stripMapped(ip);
  if (addr.includes(':')) return addr === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(addr) || /^fe[89ab][0-9a-f]?:/.test(addr);
  const [a = -1, b = -1] = addr.split('.').map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, fetched 2026-09-27). Refresh
 * them if Cloudflare announces changes; a missing range only makes that edge's clients share a bucket.
 */
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const cloudflare = new BlockList();
for (const [ranges, type] of [[CLOUDFLARE_V4, 'ipv4'], [CLOUDFLARE_V6, 'ipv6']] as const) {
  for (const range of ranges) {
    const [net = '', prefix = ''] = range.split('/');
    cloudflare.addSubnet(net, Number(prefix), type);
  }
}

/** A Cloudflare edge address (a proxy hop, never a client). */
export function isCloudflareAddress(ip: string): boolean {
  const addr = stripMapped(ip);
  const family = isIP(addr);
  return family !== 0 && cloudflare.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

function forwardedFor(req: IncomingMessage): string[] {
  const raw = req.headers['x-forwarded-for'];
  return (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveClientIp(req: IncomingMessage, mode: TrustProxy = trustProxy): string {
  const peer = stripMapped(req.socket?.remoteAddress ?? '');
  if (mode === 'auto') {
    if (!peer || !isPrivateAddress(peer)) return peer;
    // Behind a proxy: the right-most hop that isn't itself a proxy is the client. Stop at anything
    // malformed (no trusted proxy wrote it) and fall back to the last proxy hop seen.
    let candidate = peer;
    const list = forwardedFor(req);
    for (let i = list.length - 1; i >= 0; i--) {
      const addr = stripMapped(list[i]!);
      if (isIP(addr) === 0) break;
      candidate = addr;
      if (!isPrivateAddress(addr) && !isCloudflareAddress(addr)) return addr;
    }
    return candidate;
  }
  if (mode > 0) {
    const list = forwardedFor(req);
    if (list.length > 0) return stripMapped(list[Math.max(0, list.length - mode)] ?? peer);
  }
  return peer;
}

/** Overwrites any client-supplied value of our internal header with the trusted address. */
export function stampClientIp(req: IncomingMessage): void {
  req.headers[CLIENT_IP_HEADER] = resolveClientIp(req) || 'unknown';
}

/** The stamped address for a matchmaking request (falls back to Colyseus' own guess). */
export function clientIpFromAuth(context: AuthContext | undefined): string {
  let stamped: string | null | undefined;
  try {
    stamped = context?.headers?.get(CLIENT_IP_HEADER);
  } catch {
    stamped = undefined;
  }
  return stamped || context?.ip || 'unknown';
}

/** Rate-limit key: IPv4 as-is (incl. IPv4-mapped IPv6), IPv6 grouped by /64 (one subscriber/LAN). */
export function ipRateKey(ip: string): string {
  let addr = stripMapped(ip);
  if (!addr.includes(':')) return addr;
  addr = addr.split('%')[0] ?? addr; // zone id
  const [head = '', tail = ''] = addr.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headParts.length - tailParts.length);
  const full = addr.includes('::') ? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts] : headParts;
  return `${full
    .slice(0, 4)
    .map((h) => h.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
