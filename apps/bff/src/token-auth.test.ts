import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;
let cookie: string;

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `tok${Date.now()}@x.ai`, password: 'hunter2hunter2' }) });
  cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

describe('API token auth (S12-T1)', () => {
  it('issues a token (plaintext once) usable as a Bearer credential; revoke disables it', async () => {
    const created = (await (await fetch(`${base}/api/tokens`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ext' }) })).json()) as { id: string; token: string };
    expect(created.token).toMatch(/^apolla_/);

    // Bearer token authenticates with no cookie
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${created.token}` } });
    expect(me.status).toBe(200);

    // listing never returns the plaintext
    const list = (await (await fetch(`${base}/api/tokens`, { headers: { cookie } })).json()) as { id: string; token?: string }[];
    expect(JSON.stringify(list)).not.toContain(created.token);

    // revoke → Bearer rejected
    await fetch(`${base}/api/tokens/${created.id}`, { method: 'DELETE', headers: { cookie } });
    const after = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${created.token}` } });
    expect(after.status).toBe(401);
  });

  it('rejects a bogus Bearer token', async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { authorization: 'Bearer apolla_deadbeef_nope' } });
    expect(res.status).toBe(401);
  });
});
