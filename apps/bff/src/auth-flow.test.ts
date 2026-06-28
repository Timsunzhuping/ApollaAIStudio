import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

// End-to-end HTTP test of auth + multi-tenant isolation (S10-T1/T2). Boots the real handler against
// a constructed harness on an ephemeral port and drives it with fetch (manual cookie handling).

let server: Server;
let harness: Harness;
let base: string;

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

let seq = 0;
async function register(): Promise<string> {
  const email = `u${Date.now()}_${seq++}@x.ai`;
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hunter2hunter2' }) });
  expect(res.status).toBe(201);
  return res.headers.get('set-cookie')!.split(';')[0]!; // "apolla_session=..."
}
const authed = (cookie: string, body?: unknown): RequestInit => ({
  method: body ? 'POST' : 'GET',
  headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

describe('auth + isolation (HTTP)', () => {
  it('protected endpoints require a session', async () => {
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
  });

  it('register → session cookie → me works', async () => {
    const cookie = await register();
    const me = await fetch(`${base}/api/auth/me`, authed(cookie));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toMatch(/@x\.ai$/);
  });

  it('duplicate register is 409; wrong password is 401', async () => {
    const email = `dup${Date.now()}@x.ai`;
    const body = { email, password: 'hunter2hunter2' };
    expect((await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(201);
    expect((await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(409);
    const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'wrongwrong' }) });
    expect(bad.status).toBe(401);
  });

  it('a user cannot toggle another user\'s schedule (IDOR fail-closed)', async () => {
    const a = await register();
    const b = await register();
    const created = await fetch(`${base}/api/schedules`, authed(a, { name: 'mine', cron: '0 8 * * *', kind: 'research', input: { question: 'x' } }));
    const sched = (await created.json()) as { id: string };
    // B cannot toggle A's schedule
    const bToggle = await fetch(`${base}/api/schedules/${sched.id}/toggle`, authed(b, { enabled: false }));
    expect(bToggle.status).toBe(404);
    // A can
    const aToggle = await fetch(`${base}/api/schedules/${sched.id}/toggle`, authed(a, { enabled: false }));
    expect(aToggle.status).toBe(200);
  });

  it('a user cannot read another user\'s job (IDOR fail-closed)', async () => {
    const a = await register();
    const b = await register();
    const aId = ((await (await fetch(`${base}/api/auth/me`, authed(a))).json()) as { id: string }).id;
    // Seed a terminal job owned by A directly (avoids spawning a background runner in tests).
    await harness.jobRepo.create({ id: 'idor-job-1', ownerId: aId, kind: 'research', input: {}, allowTools: [], status: 'done' });
    expect((await fetch(`${base}/api/jobs/idor-job-1`, authed(b))).status).toBe(404);
    expect((await fetch(`${base}/api/jobs/idor-job-1`, authed(a))).status).toBe(200);
  });

  it('a user cannot read another user\'s workspace file (owner-scoped)', async () => {
    const a = await register();
    const b = await register();
    await fetch(`${base}/api/workspace/save-artifact`, authed(a, { path: 'secret.md', content: 'top secret' }));
    expect((await fetch(`${base}/api/workspace/file?path=secret.md`, authed(b))).status).toBe(404);
    const aRead = await fetch(`${base}/api/workspace/file?path=secret.md`, authed(a));
    expect(aRead.status).toBe(200);
    expect(((await aRead.json()) as { content: string }).content).toBe('top secret');
  });
});
