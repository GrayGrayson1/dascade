/**
 * Security sweep (Oct 2026), F-05: connect-src is the site itself and its own WebSocket origin, never
 * any host (it was `ws: wss:`).
 */
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../src/server.ts';

describe('Content-Security-Policy connect-src (F-05)', () => {
  const connectSrc = (csp: string) => csp.split('; ').find((d) => d.startsWith('connect-src '));

  it('is the site itself and its own WebSocket origin, never any host', () => {
    expect(connectSrc(contentSecurityPolicy('dascade.example', true, ''))).toBe("connect-src 'self' wss://dascade.example");
    expect(connectSrc(contentSecurityPolicy('127.0.0.1:2731', false, ''))).toBe("connect-src 'self' ws://127.0.0.1:2731");
    expect(contentSecurityPolicy('dascade.example', true, '')).not.toMatch(/connect-src[^;]*\b(?:ws|wss):(?:\s|;|$)/);
  });

  it('keeps Supabase when it is configured', () => {
    expect(connectSrc(contentSecurityPolicy('dascade.example', true, 'https://abc.supabase.co'))).toBe(
      "connect-src 'self' wss://dascade.example https://abc.supabase.co wss://abc.supabase.co",
    );
  });

  it('never writes an unexpected Host header into the policy', () => {
    for (const host of ['evil; script-src *', 'a b', 'x"y', '', undefined]) {
      expect(connectSrc(contentSecurityPolicy(host, true, ''))).toBe("connect-src 'self'");
    }
  });
});
