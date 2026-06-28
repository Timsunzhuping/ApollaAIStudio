import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

// Unique per run — oauth_identities / users persist in Postgres across runs, so constant
// emails/providerIds would collide with stale rows (see billing event-id lesson).
let n = 0;
const uniqEmail = () => `oauth${Date.now()}_${n++}_${Math.round(performance.now())}@x.ai`;
const uniqPid = () => `pid_${Date.now()}_${n++}_${Math.round(performance.now())}`;

/** GET /start (no redirect-follow) → the provider authorize URL (carries the state token). */
async function start(provider = 'stub', next?: string): Promise<URL> {
  const q = next ? `?next=${encodeURIComponent(next)}` : '';
  const res = await fetch(`${base}/api/auth/oauth/${provider}/start${q}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}
/** Drive the callback for `state` with a chosen code; returns the response (manual redirect). */
function callback(provider: string, state: string, code: string): Promise<Response> {
  const u = `${base}/api/auth/oauth/${provider}/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`;
  return fetch(u, { redirect: 'manual' });
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;

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

describe('OAuth/SSO (S14)', () => {
  it('runs the stub flow end-to-end and issues a session', async () => {
    const authUrl = await start();
    const res = await callback('stub', authUrl.searchParams.get('state')!, `stub:${uniqEmail()}:${uniqPid()}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf(res) } })).json()) as { email: string; identities: { provider: string }[] };
    expect(me.identities.some((i) => i.provider === 'stub')).toBe(true);
  });

  it('unifies an OAuth identity with an existing same-email password account', async () => {
    const email = uniqEmail();
    const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hunter2hunter2' }) });
    const id1 = ((await reg.json()) as { id: string }).id;
    const authUrl = await start();
    const res = await callback('stub', authUrl.searchParams.get('state')!, `stub:${email}:${uniqPid()}`);
    const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookieOf(res) } })).json()) as { id: string; identities: { provider: string }[] };
    expect(me.id).toBe(id1); // linked, not a duplicate user
    expect(me.identities.some((i) => i.provider === 'stub')).toBe(true);
  });

  it('rejects forged, missing, and replayed state (CSRF)', async () => {
    expect((await callback('stub', 'forged', `stub:${uniqEmail()}:${uniqPid()}`)).status).toBe(400);
    const authUrl = await start();
    const state = authUrl.searchParams.get('state')!;
    expect((await callback('stub', state, `stub:${uniqEmail()}:${uniqPid()}`)).status).toBe(302); // first use ok
    expect((await callback('stub', state, `stub:${uniqEmail()}:${uniqPid()}`)).status).toBe(400); // single-use
  });

  it('blocks open redirects but allows safe relative next', async () => {
    expect((await fetch(`${base}/api/auth/oauth/stub/start?next=${encodeURIComponent('https://evil.com')}`, { redirect: 'manual' })).status).toBe(400);
    const authUrl = await start('stub', '/billing');
    const res = await callback('stub', authUrl.searchParams.get('state')!, `stub:${uniqEmail()}:${uniqPid()}`);
    expect(res.headers.get('location')).toBe('/billing');
  });

  it('fails closed on an unverified email and unknown provider', async () => {
    const authUrl = await start();
    expect((await callback('stub', authUrl.searchParams.get('state')!, `stub:${uniqEmail()}:${uniqPid()}:unverified`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/oauth/nope/start`, { redirect: 'manual' })).status).toBe(404);
  });

  it('lists registered providers', async () => {
    const r = (await (await fetch(`${base}/api/auth/providers`)).json()) as { providers: string[] };
    expect(r.providers).toContain('stub');
  });
});
