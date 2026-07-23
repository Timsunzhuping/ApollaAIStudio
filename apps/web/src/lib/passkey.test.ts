import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerPasskey, loginWithPasskey, type KeyStore } from './passkey';

function fakeRes(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

/** In-memory KeyStore (jsdom has no IndexedDB). */
function memStore(): KeyStore {
  const m = new Map<string, CryptoKey>();
  return {
    async put(id, key) { m.set(id, key); },
    async get(id) { return m.get(id); },
    async ids() { return [...m.keys()]; },
    async remove(id) { m.delete(id); },
  };
}

const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

describe('software passkey client (S33)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers: generates a P-256 key, signs the server challenge, and the signature verifies', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url: u, body });
      if (u.endsWith('/register/start')) return fakeRes({ challenge: 'server-challenge-1' });
      if (u.endsWith('/register/finish')) return fakeRes({ id: body.credentialId, label: body.label });
      return fakeRes({});
    }));

    const store = memStore();
    const res = await registerPasskey('My Mac', store);
    expect(res.label).toBe('My Mac');

    const finish = calls.find((c) => c.url.endsWith('/register/finish'))!.body;
    // the private key was persisted locally under the credential id
    expect(await store.get(String(finish.credentialId))).toBeDefined();
    // and the ES256 signature over the challenge verifies against the registered public key (P1363),
    // proving interop with the server-side verifier.
    const jwk = finish.publicKey as JsonWebKey;
    const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64uToBytes(String(finish.signature)),
      new TextEncoder().encode('server-challenge-1'),
    );
    expect(ok).toBe(true);
  });

  it('login: picks the locally-held credential from the server list and signs the fresh challenge', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url: u, body });
      if (u.endsWith('/register/start')) return fakeRes({ challenge: 'c-reg' });
      if (u.endsWith('/register/finish')) return fakeRes({ id: body.credentialId, label: 'x' });
      if (u.endsWith('/login/start')) return fakeRes({ challenge: 'c-login', credentialIds: ['unknown-id', calls.find((c) => c.url.endsWith('/register/finish'))!.body.credentialId] });
      if (u.endsWith('/login/finish')) return fakeRes({ id: 'u1', email: 'a@x.ai' });
      return fakeRes({});
    }));

    const store = memStore();
    await registerPasskey('dev', store);
    await loginWithPasskey('a@x.ai', store);
    const finish = calls.find((c) => c.url.endsWith('/login/finish'))!.body;
    expect(finish.challenge).toBe('c-login');
    expect(typeof finish.signature).toBe('string');
    expect((await store.ids())).toContain(finish.credentialId);
  });

  it('login fails cleanly when no local key matches the account', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/login/start')) return fakeRes({ challenge: 'c', credentialIds: ['other'] });
      return fakeRes({});
    }));
    await expect(loginWithPasskey('a@x.ai', memStore())).rejects.toThrow(/No passkey/);
  });
});
