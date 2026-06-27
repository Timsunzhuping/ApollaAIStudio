import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { RateLimiter } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';
import { setRateLimiters } from './security';

let server: Server;
let harness: Harness;
let base: string;

const generous = () => setRateLimiters(new RateLimiter({ ratePerSec: 1000, burst: 1000 }), new RateLimiter({ ratePerSec: 1000, burst: 1000 }));

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  generous();
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

describe('security perimeter (S10-T4)', () => {
  it('sets security headers on responses', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('rejects an over-large request body with 413', async () => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('echoes CORS headers only for an allowlisted origin', async () => {
    process.env.CORS_ORIGIN = 'http://allowed.example';
    try {
      const ok = await fetch(`${base}/api/health`, { headers: { origin: 'http://allowed.example' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('http://allowed.example');
      expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
      const no = await fetch(`${base}/api/health`, { headers: { origin: 'http://evil.example' } });
      expect(no.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      delete process.env.CORS_ORIGIN;
    }
  });

  it('rate-limits by IP with 429 + Retry-After', async () => {
    setRateLimiters(new RateLimiter({ ratePerSec: 0.001, burst: 1 }), new RateLimiter({ ratePerSec: 1000, burst: 1000 }));
    try {
      const first = await fetch(`${base}/api/health`);
      expect(first.status).toBe(200);
      const second = await fetch(`${base}/api/health`);
      expect(second.status).toBe(429);
      expect(second.headers.get('retry-after')).toBeTruthy();
    } finally {
      generous();
    }
  });
});
