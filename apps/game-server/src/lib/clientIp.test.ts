import { describe, expect, it } from 'vitest';
import { isCloudflareAddress, resolveClientIp } from './clientIp.ts';

const req = (peer: string, xff?: string | string[]) =>
  ({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} }) as never;

describe('resolveClientIp (auto)', () => {
  it('behind Render + Cloudflare: skips the edge and proxy hops, returns the client', () => {
    // client → Cloudflare edge (appends the client) → Render proxy (appends the edge) → us (private peer)
    expect(resolveClientIp(req('10.201.4.7', '198.51.100.7, 172.70.34.12'), 'auto')).toBe('198.51.100.7');
    expect(resolveClientIp(req('10.201.4.7', '2001:db8:5::9, 2a06:98c1:3120::3, 10.0.0.9'), 'auto')).toBe('2001:db8:5::9');
    expect(resolveClientIp(req('::ffff:10.1.2.3', '::ffff:198.51.100.20, ::ffff:104.23.5.6'), 'auto')).toBe('198.51.100.20');
  });

  it('ignores spoofed entries left of the client', () => {
    expect(resolveClientIp(req('10.0.0.5', '1.1.1.1, 9.9.9.9, 198.51.100.7, 162.158.1.1'), 'auto')).toBe('198.51.100.7');
    expect(resolveClientIp(req('10.0.0.5', 'garbage, 198.51.100.7, 162.158.1.1'), 'auto')).toBe('198.51.100.7');
    // A forged Cloudflare-looking entry left of the real client is never reached.
    expect(resolveClientIp(req('10.0.0.5', ['104.16.0.1', '203.0.113.50, 172.64.1.1']), 'auto')).toBe('203.0.113.50');
  });

  it('never lets malformed entries become the key; falls back to the last proxy hop', () => {
    expect(resolveClientIp(req('10.0.0.5', 'not-an-ip, 172.64.1.1'), 'auto')).toBe('172.64.1.1');
    expect(resolveClientIp(req('10.0.0.5', '10.0.0.2'), 'auto')).toBe('10.0.0.2');
    expect(resolveClientIp(req('10.0.0.5'), 'auto')).toBe('10.0.0.5');
  });

  it('a public peer is the client itself (its headers are ignored)', () => {
    expect(resolveClientIp(req('203.0.113.9', '1.2.3.4'), 'auto')).toBe('203.0.113.9');
    expect(resolveClientIp(req('162.158.1.1', '1.2.3.4'), 'auto')).toBe('162.158.1.1');
  });

  it('numeric TRUST_PROXY keeps counting hops from the right', () => {
    expect(resolveClientIp(req('10.0.0.5', 'a, 198.51.100.7, 172.64.1.1'), 1)).toBe('172.64.1.1');
    expect(resolveClientIp(req('10.0.0.5', 'a, 198.51.100.7, 172.64.1.1'), 2)).toBe('198.51.100.7');
    expect(resolveClientIp(req('10.0.0.5', '198.51.100.7'), 0)).toBe('10.0.0.5');
  });
});

describe('isCloudflareAddress', () => {
  it('matches the published IPv4 and IPv6 ranges only', () => {
    expect(
      ['173.245.48.1', '104.16.0.1', '104.27.255.255', '172.71.0.1', '131.0.75.255', '2606:4700::6810:84e5', '2a06:98c7::1'].every(
        isCloudflareAddress,
      ),
    ).toBe(true);
    expect(['104.28.0.1', '8.8.8.8', '172.63.255.255', '2001:db8::1', '2a06:98d0::1', 'nope', ''].some(isCloudflareAddress)).toBe(false);
  });
});
