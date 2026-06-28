import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

describe('version + readiness probes (S24)', () => {
  it('GET /api/version returns version + mode and leaks nothing sensitive', async () => {
    const r = await fetch(`${base}/api/version`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(typeof body.version).toBe('string');
    expect(body.mode).toBeDefined();
    const text = JSON.stringify(body).toLowerCase();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('password');
  });

  it('GET /api/ready reports readiness (pings the DB in Postgres mode)', async () => {
    const r = await fetch(`${base}/api/ready`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ready: boolean }).ready).toBe(true);
  });

  it('GET /api/health includes the version', async () => {
    const body = (await (await fetch(`${base}/api/health`)).json()) as { version?: string };
    expect(typeof body.version).toBe('string');
  });
});
