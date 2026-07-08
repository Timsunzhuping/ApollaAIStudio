import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

// A software authenticator standing in for a hardware passkey (P-256 / ES256, IEEE-P1363 signatures).
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    id: randomBytes(12).toString('base64url'),
    jwk: publicKey.export({ format: 'jwk' }),
    sign: (challenge: string) => cryptoSign('sha256', Buffer.from(challenge, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}
const post = (cookie: string | undefined, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function signup(): Promise<{ cookie: string; email: string }> {
  const email = `pk_${randomBytes(6).toString('hex')}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'hunter2hunter2' }) });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, email };
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

async function register(cookie: string, auth: ReturnType<typeof authenticator>) {
  const { challenge } = (await (await post(cookie, '/api/auth/passkey/register/start', {})).json()) as { challenge: string };
  return post(cookie, '/api/auth/passkey/register/finish', { credentialId: auth.id, publicKey: auth.jwk, signature: auth.sign(challenge), challenge, label: 'MacBook' });
}

describe('passkey registration + login (S33)', () => {
  it('registers a passkey then signs in with it (no password)', async () => {
    const { cookie, email } = await signup();
    const auth = authenticator();
    expect((await register(cookie, auth)).status).toBe(201);
    const list = (await (await fetch(`${base}/api/auth/passkey`, { headers: { cookie } })).json()) as { id: string; label: string }[];
    expect(list.map((c) => c.id)).toContain(auth.id);

    // fresh client (no cookie): start → sign the challenge → finish → session
    const start = (await (await post(undefined, '/api/auth/passkey/login/start', { email })).json()) as { challenge: string; credentialIds: string[] };
    expect(start.credentialIds).toContain(auth.id);
    const fin = await post(undefined, '/api/auth/passkey/login/finish', { credentialId: auth.id, challenge: start.challenge, signature: auth.sign(start.challenge) });
    expect(fin.status).toBe(200);
    const loginCookie = fin.headers.get('set-cookie')!.split(';')[0]!;
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: loginCookie } })).status).toBe(200);
  });

  it('rejects a forged signature, a reused challenge, and cross-account use (fail-closed)', async () => {
    const { cookie, email } = await signup();
    const auth = authenticator();
    await register(cookie, auth);

    const start = (await (await post(undefined, '/api/auth/passkey/login/start', { email })).json()) as { challenge: string };
    // a different key's signature over the right challenge → 401
    expect((await post(undefined, '/api/auth/passkey/login/finish', { credentialId: auth.id, challenge: start.challenge, signature: authenticator().sign(start.challenge) })).status).toBe(401);
    // the challenge is single-use — even the correct signature now fails (already consumed)
    expect((await post(undefined, '/api/auth/passkey/login/finish', { credentialId: auth.id, challenge: start.challenge, signature: auth.sign(start.challenge) })).status).toBe(401);
  });

  it('registration rejects a public key the caller cannot prove possession of', async () => {
    const { cookie } = await signup();
    const auth = authenticator();
    const { challenge } = (await (await post(cookie, '/api/auth/passkey/register/start', {})).json()) as { challenge: string };
    // sign with a DIFFERENT key than the public key being registered → 400
    const bad = await post(cookie, '/api/auth/passkey/register/finish', { credentialId: auth.id, publicKey: auth.jwk, challenge, signature: authenticator().sign(challenge) });
    expect(bad.status).toBe(400);
  });
});
