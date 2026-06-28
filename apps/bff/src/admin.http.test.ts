import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;
const ADMIN_EMAIL = `boss_${randomUUID()}@x.ai`;

async function signup(email = `u_${randomUUID()}@x.ai`): Promise<{ cookie: string; email: string }> {
  const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hunter2hunter2' }) });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, email };
}
const get = (cookie: string, path: string) => fetch(`${base}${path}`, { headers: { cookie } });
const post = (cookie: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  harness = await buildHarness();
  setHarness(harness);
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  delete process.env.ADMIN_EMAILS;
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

describe('operator console endpoints (S23)', () => {
  it('is fail-closed: non-admins get 403 on every admin route', async () => {
    const user = await signup();
    expect((await get(user.cookie, '/api/admin/stats')).status).toBe(403);
    expect((await get(user.cookie, '/api/admin/users')).status).toBe(403);
    expect((await post(user.cookie, '/api/admin/users/whoever/plan', { plan: 'pro' })).status).toBe(403);
    // me reflects non-admin
    expect(((await (await get(user.cookie, '/api/auth/me')).json()) as { isAdmin?: boolean }).isAdmin).toBe(false);
  });

  it('lets an admin read stats/users and grant a plan (audited, entitlements take effect)', async () => {
    const admin = await signup(ADMIN_EMAIL);
    const target = await signup();
    expect(((await (await get(admin.cookie, '/api/auth/me')).json()) as { isAdmin?: boolean }).isAdmin).toBe(true);

    expect((await get(admin.cookie, '/api/admin/stats')).status).toBe(200);
    const users = (await (await get(admin.cookie, '/api/admin/users?limit=200')).json()) as { id: string; email: string }[];
    expect(users.some((u) => u.email === target.email)).toBe(true);

    // unknown plan rejected; valid plan applied
    const targetId = users.find((u) => u.email === target.email)!.id;
    expect((await post(admin.cookie, `/api/admin/users/${targetId}/plan`, { plan: 'nonsense' })).status).toBe(400);
    expect((await post(admin.cookie, `/api/admin/users/${targetId}/plan`, { plan: 'pro' })).status).toBe(200);

    const detail = (await (await get(admin.cookie, `/api/admin/users/${targetId}`)).json()) as { plan: string };
    expect(detail.plan).toBe('pro');
  });
});
