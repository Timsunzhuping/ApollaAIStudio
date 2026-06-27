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

describe('observability (S10-T5)', () => {
  it('sets a request-id header on every response', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('exposes aggregate metrics at /metrics (no auth, no sensitive data)', async () => {
    await fetch(`${base}/api/health`);
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    const snap = (await res.json()) as { counters: Record<string, number>; latency: { count: number } };
    expect(snap.counters['http.requests']).toBeGreaterThanOrEqual(1);
    expect(snap.latency.count).toBeGreaterThanOrEqual(1);
    // sanity: snapshot is just numbers — no string secrets
    expect(JSON.stringify(snap)).not.toMatch(/password|cookie|secret|session/i);
  });
});
