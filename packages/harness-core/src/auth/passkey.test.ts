import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import { verifyAssertion, InMemoryChallengeStore, InMemoryPasskeyRepository, type PasskeyCredential, type PublicKeyJwk } from './passkey';

// A software authenticator standing in for a hardware passkey: P-256 key, ES256 (IEEE-P1363) signature.
function makeAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as unknown as PublicKeyJwk;
  return {
    jwk,
    sign: (challenge: string) => cryptoSign('sha256', Buffer.from(challenge, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
  };
}
const cred = (userId: string, jwk: PublicKeyJwk): PasskeyCredential => ({ id: randomBytes(8).toString('base64url'), userId, publicKey: jwk, label: 'test', createdAt: '2026-01-01' });

describe('passkey assertion verification (S33)', () => {
  it('accepts a valid signature over the challenge and rejects a forged one', () => {
    const auth = makeAuthenticator();
    const c = cred('u1', auth.jwk);
    const challenge = 'Y2hhbGxlbmdl';
    expect(verifyAssertion(c, challenge, auth.sign(challenge))).toBe(true);
    // wrong challenge, tampered signature, and another key's signature all fail
    expect(verifyAssertion(c, 'different', auth.sign(challenge))).toBe(false);
    expect(verifyAssertion(c, challenge, auth.sign(challenge).slice(0, -4) + 'AAAA')).toBe(false);
    expect(verifyAssertion(c, challenge, makeAuthenticator().sign(challenge))).toBe(false);
  });

  it('fails closed on a malformed key or signature', () => {
    const bad = cred('u1', { kty: 'EC', crv: 'P-256', x: 'nope', y: 'nope' });
    expect(verifyAssertion(bad, 'c', 'AAAA')).toBe(false);
    expect(verifyAssertion(cred('u1', makeAuthenticator().jwk), 'c', '')).toBe(false);
  });

  it('challenges are single-use and expire', () => {
    const store = new InMemoryChallengeStore(1000);
    const c = store.issue('u1', 1000);
    expect(store.consume(c, 1500)).toEqual({ userId: 'u1' });
    expect(store.consume(c, 1500)).toBeNull(); // reuse rejected
    const c2 = store.issue('u1', 1000);
    expect(store.consume(c2, 9999)).toBeNull(); // expired
  });

  it('repository is owner-scoped', async () => {
    const repo = new InMemoryPasskeyRepository();
    const a = cred('alice', makeAuthenticator().jwk);
    await repo.save(a);
    await repo.save(cred('bob', makeAuthenticator().jwk));
    expect((await repo.listByUser('alice')).map((c) => c.id)).toEqual([a.id]);
    await repo.delete('bob', a.id); // wrong owner → no-op
    expect(await repo.getById(a.id)).toBeDefined();
    await repo.delete('alice', a.id);
    expect(await repo.getById(a.id)).toBeUndefined();
  });
});
