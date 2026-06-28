import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { StubPaymentProvider } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function register(): Promise<string> {
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `bill${Date.now()}_${Math.round(performance.now())}@x.ai`, password: 'hunter2hunter2' }) });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}
const authed = (cookie: string, body?: unknown): RequestInit => ({ method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

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

describe('billing (S13)', () => {
  it('stub checkout activates pro; subscription + entitlements reflect it', async () => {
    const c = await register();
    const before = (await (await fetch(`${base}/api/billing/subscription`, authed(c))).json()) as { plan: { id: string } };
    expect(before.plan.id).toBe('free');
    const co = (await (await fetch(`${base}/api/billing/checkout`, authed(c, { plan: 'pro' })).then()).json()) as { activated: boolean };
    expect(co.activated).toBe(true);
    const after = (await (await fetch(`${base}/api/billing/subscription`, authed(c))).json()) as { subscription: { status: string }; plan: { id: string } };
    expect(after.subscription.status).toBe('active');
    expect(after.plan.id).toBe('pro');
  });

  it('premium features are gated to Pro: free → 402, pro → allowed', async () => {
    const free = await register();
    // Cowork + Media are Pro-only; free is blocked before any work starts.
    expect((await fetch(`${base}/api/cowork`, authed(free, { goal: 'x' }))).status).toBe(402);
    expect((await fetch(`${base}/api/media`, authed(free, { alias: 'image_premium', prompt: 'a cat' }))).status).toBe(402);
    // Upgrade → media is allowed (staging only; no background job started in the test).
    const pro = await register();
    await fetch(`${base}/api/billing/checkout`, authed(pro, { plan: 'pro' }));
    expect((await fetch(`${base}/api/media`, authed(pro, { alias: 'image_premium', prompt: 'a cat' }))).status).toBe(201);
  });

  it('webhook verifies signature + is idempotent; cancel returns to free', async () => {
    const c = await register();
    const meId = ((await (await fetch(`${base}/api/auth/me`, authed(c))).json()) as { id: string }).id;
    const stub = new StubPaymentProvider();
    const evtId = `evt_${Date.now()}_${Math.round(performance.now())}`; // unique per run (billing_events persists)
    const { rawBody, signature } = stub.simulateEvent({ id: evtId, type: 'subscription.created', ownerId: meId, plan: 'pro', status: 'active' });
    // bad signature → 401
    expect((await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'x-apolla-signature': 'bad' }, body: rawBody })).status).toBe(401);
    // valid → applied
    expect((await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'x-apolla-signature': signature }, body: rawBody })).status).toBe(200);
    // duplicate event id → idempotent (still 200, not re-applied)
    const dup = (await (await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'x-apolla-signature': signature }, body: rawBody })).json()) as { duplicate?: boolean };
    expect(dup.duplicate).toBe(true);
    expect(((await (await fetch(`${base}/api/billing/subscription`, authed(c))).json()) as { plan: { id: string } }).plan.id).toBe('pro');
    // cancel → free
    await fetch(`${base}/api/billing/cancel`, authed(c, {}));
    expect(((await (await fetch(`${base}/api/billing/subscription`, authed(c))).json()) as { plan: { id: string } }).plan.id).toBe('free');
  });
});
