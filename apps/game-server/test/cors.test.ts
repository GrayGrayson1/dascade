/**
 * Security sweep (Oct 2026), F-01: CORS answers only the site's own origin, and never with credentials.
 * Colyseus' defaults (`Access-Control-Allow-Origin: *` with `Allow-Credentials: true`) went on every
 * response, the HTML included.
 */
import http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { allowedOrigin, installCors } from '../src/lib/cors.ts';
import { bootTestServer } from './helpers.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer());
});
afterEach(() => {
  installCors(true); // the test server runs as development
});
afterAll(async () => {
  await colyseus.shutdown();
});

/** A raw request, so the Host and Origin headers are exactly what a browser would send. */
function request(method: string, path: string, headers: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end();
  });
}

const CREDENTIALS = 'access-control-allow-credentials';
const ALLOW_ORIGIN = 'access-control-allow-origin';

describe('CORS (F-01)', () => {
  it('echoes only the site’s own origin, and never sends a credentials header', async () => {
    installCors(false);
    const host = `play.example.test:${port}`;
    const own = await request('GET', '/api/health', { host, origin: `https://${host}` });
    expect(own.statusCode).toBe(200);
    expect(own.headers[ALLOW_ORIGIN]).toBe(`https://${host}`);
    expect(own.headers[CREDENTIALS]).toBeUndefined();

    const other = await request('GET', '/api/health', { host, origin: 'https://evil.example' });
    expect(other.headers[ALLOW_ORIGIN]).toBeUndefined();
    expect(other.headers[CREDENTIALS]).toBeUndefined();
    expect(other.headers['access-control-allow-methods']).toBeUndefined();

    // No Origin (a plain page load): no CORS headers at all.
    const plain = await request('GET', '/api/health', { host });
    expect(Object.keys(plain.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('answers a preflight from another site with nothing it could use', async () => {
    installCors(false);
    const res = await request('OPTIONS', '/matchmake/create/test', {
      host: `127.0.0.1:${port}`,
      origin: 'https://evil.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers[ALLOW_ORIGIN]).toBeUndefined();
    expect(res.headers[CREDENTIALS]).toBeUndefined();
  });

  it('development still allows the Vite dev server (same host, another port) and localhost', async () => {
    const pre = await request('OPTIONS', '/matchmake/create/test', {
      host: `127.0.0.1:${port}`,
      origin: 'http://127.0.0.1:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers[ALLOW_ORIGIN]).toBe('http://127.0.0.1:5173');
    expect(pre.headers['access-control-allow-methods']).toContain('POST');
    expect(pre.headers['access-control-allow-headers']).toMatch(/content-type/i);
    expect(pre.headers[CREDENTIALS]).toBeUndefined();

    expect(allowedOrigin('http://192.168.1.20:5173', '192.168.1.20:2567', true)).toBe('http://192.168.1.20:5173');
    expect(allowedOrigin('http://localhost:5173', '127.0.0.1:2567', true)).toBe('http://localhost:5173');
    expect(allowedOrigin('http://localhost:5173', 'dascade.example:443', false)).toBeNull();
    expect(allowedOrigin('https://evil.example', '127.0.0.1:2567', true)).toBeNull();
  });

  it('allows a client hosted elsewhere only when its origin is listed (CORS_ORIGINS)', () => {
    const cdn = ['https://cdn.example'];
    expect(allowedOrigin('https://cdn.example', 'dascade.example', false, cdn)).toBe('https://cdn.example');
    expect(allowedOrigin('https://cdn.example.evil', 'dascade.example', false, cdn)).toBeNull();
    expect(allowedOrigin('https://cdn.example', 'dascade.example', false)).toBeNull();
  });

  it('refuses malformed and non-web origins', () => {
    for (const origin of ['null', 'file://', 'javascript:alert(1)', 'https://site.test/path', 'not a url', '']) {
      expect(allowedOrigin(origin, 'site.test', false)).toBeNull();
    }
    expect(allowedOrigin('https://site.test', null, false)).toBeNull();
    expect(allowedOrigin('https://SITE.test', 'site.test', false)).toBeNull(); // not the serialized origin
    expect(allowedOrigin('https://site.test', 'SITE.TEST', false)).toBe('https://site.test');
  });
});
