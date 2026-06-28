import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function signup(): Promise<{ cookie: string; email: string }> {
  const email = `httpacct_${randomUUID()}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hunter2hunter2' }) });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, email };
}
const post = (cookie: string, path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
const get = (cookie: string, path: string) => fetch(`${base}${path}`, { headers: { cookie } });

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

describe('account lifecycle endpoints (S22)', () => {
  it('exports, deletes (with confirmation), and the session is revoked', async () => {
    const { cookie, email } = await signup();
    await post(cookie, '/api/projects', { name: 'P', description: 'd' });

    const exp = await get(cookie, '/api/account/export');
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-disposition')).toContain('attachment');
    const bundle = (await exp.json()) as { projects: unknown[] };
    expect(bundle.projects.length).toBe(1);

    // wrong confirmation → 401, account survives
    expect((await post(cookie, '/api/account/delete', { confirm: 'nope@x.ai' })).status).toBe(401);
    expect((await get(cookie, '/api/auth/me')).status).toBe(200);

    // correct confirmation → deleted, session revoked
    expect((await post(cookie, '/api/account/delete', { confirm: email })).status).toBe(200);
    expect((await get(cookie, '/api/auth/me')).status).toBe(401);
  });

  it('imports a bundle re-owned to the caller', async () => {
    const src = await signup();
    await post(src.cookie, '/api/projects', { name: 'Imported', description: 'x' });
    const bundle = await (await get(src.cookie, '/api/account/export')).json();

    const dst = await signup();
    expect((await post(dst.cookie, '/api/account/import', { bundle: { not: 'valid' } })).status).toBe(400);
    const ok = await post(dst.cookie, '/api/account/import', { bundle });
    expect(ok.status).toBe(200);
    const projects = (await (await get(dst.cookie, '/api/projects')).json()) as { name: string }[];
    expect(projects.map((p) => p.name)).toContain('Imported');
  });
});
