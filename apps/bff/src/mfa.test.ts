import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateTotp, type StubMagicLinkDelivery } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

const email = () => `mfa${Date.now()}_${Math.floor(Math.random() * 1e6)}@x.ai`;
const PW = 'hunter2hunter2';
const j = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function register(e: string): Promise<string> {
  const r = await j('POST', '/api/auth/register', { email: e, password: PW });
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

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

async function enableMfa(cookie: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const enroll = (await (await j('POST', '/api/auth/mfa/enroll', {}, { cookie })).json()) as { secret: string; recoveryCodes: string[] };
  const verify = await j('POST', '/api/auth/mfa/verify', { code: generateTotp(enroll.secret) }, { cookie });
  expect(verify.status).toBe(200);
  return enroll;
}

describe('MFA + step-up (S20)', () => {
  it('enables MFA, then login requires a second factor (fail-closed)', async () => {
    const e = email();
    const cookie = await register(e);
    const { secret } = await enableMfa(cookie);
    expect(((await (await j('GET', '/api/auth/me', undefined, { cookie })).json()) as { mfaEnabled: boolean }).mfaEnabled).toBe(true);

    // Password alone now returns a pending challenge — NOT a session.
    const login = await j('POST', '/api/auth/login', { email: e, password: PW });
    const lb = (await login.json()) as { mfaRequired?: boolean; pendingToken?: string; id?: string };
    expect(lb.mfaRequired).toBe(true);
    expect(lb.id).toBeUndefined();
    expect(login.headers.get('set-cookie')).toBeNull(); // no session cookie yet

    // A bad code is rejected; the correct TOTP completes login.
    expect((await j('POST', '/api/auth/mfa/login', { pendingToken: lb.pendingToken, code: '000000' })).status).toBe(401);
    const done = await j('POST', '/api/auth/mfa/login', { pendingToken: lb.pendingToken, code: generateTotp(secret) });
    expect(done.status).toBe(200);
    expect(done.headers.get('set-cookie')).toContain('apolla_session=');
  });

  it('a recovery code logs in once and cannot be reused', async () => {
    const e = email();
    const cookie = await register(e);
    const { recoveryCodes } = await enableMfa(cookie);
    const pending = ((await (await j('POST', '/api/auth/login', { email: e, password: PW })).json()) as { pendingToken: string }).pendingToken;
    expect((await j('POST', '/api/auth/mfa/login', { pendingToken: pending, code: recoveryCodes[0] })).status).toBe(200);
    // a second pending + the same recovery code → rejected (single-use)
    const pending2 = ((await (await j('POST', '/api/auth/login', { email: e, password: PW })).json()) as { pendingToken: string }).pendingToken;
    expect((await j('POST', '/api/auth/mfa/login', { pendingToken: pending2, code: recoveryCodes[0] })).status).toBe(401);
  });

  it('magic-link request is enumeration-safe and verify logs in once', async () => {
    const e = email();
    await register(e);
    // unknown + known email both return 200
    expect((await j('POST', '/api/auth/magic-link/request', { email: 'nobody@nowhere.test' })).status).toBe(200);
    expect((await j('POST', '/api/auth/magic-link/request', { email: e })).status).toBe(200);

    const link = (harness.magicLinkDelivery as StubMagicLinkDelivery).last(e)!;
    const token = new URL(link).searchParams.get('token')!;
    const verify = await j('POST', '/api/auth/magic-link/verify', { token });
    expect(verify.status).toBe(200);
    expect(verify.headers.get('set-cookie')).toContain('apolla_session=');
    // single-use: the same token cannot be replayed
    expect((await j('POST', '/api/auth/magic-link/verify', { token })).status).toBe(401);
  });
});
