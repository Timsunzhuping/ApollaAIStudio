import { describe, it, expect } from 'vitest';
import {
  StubOAuthProvider,
  InMemoryIdentityRepository,
  InMemoryOAuthStateStore,
  newState,
  newPkce,
} from './oauth';

describe('StubOAuthProvider', () => {
  it('runs the full offline flow: authorizeUrl → exchange → identity', async () => {
    const p = new StubOAuthProvider();
    const url = p.authorizeUrl({ state: 'st', pkceChallenge: 'ch', redirectUri: 'http://x/cb' });
    expect(url).toContain('code=');
    expect(url).toContain('state=st');
    const u = new URL(url);
    const tokens = await p.exchangeCode({ code: u.searchParams.get('code')!, pkceVerifier: 'v', redirectUri: 'http://x/cb' });
    const id = await p.fetchIdentity(tokens);
    expect(id).toMatchObject({ email: 'stub-user@apolla.dev', emailVerified: true });
    expect(id.providerId).toBeTruthy();
  });

  it('decodes a chosen email + unverified flag from the code', async () => {
    const p = new StubOAuthProvider();
    const tokens = await p.exchangeCode({ code: 'stub:me@x.dev:gh-9:unverified', pkceVerifier: 'v', redirectUri: 'r' });
    expect(await p.fetchIdentity(tokens)).toEqual({ providerId: 'gh-9', email: 'me@x.dev', emailVerified: false });
  });
});

describe('newPkce / newState', () => {
  it('produces distinct values and an S256 challenge', () => {
    expect(newState()).not.toBe(newState());
    const a = newPkce();
    expect(a.verifier).toBeTruthy();
    expect(a.challenge).not.toBe(a.verifier);
  });
});

describe('InMemoryOAuthStateStore', () => {
  it('is single-use and honors expiry', async () => {
    const store = new InMemoryOAuthStateStore();
    await store.put('s1', { provider: 'stub', pkceVerifier: 'v', redirectUri: 'r', expiresAt: 10_000 });
    expect(await store.consume('s1', 5_000)).toMatchObject({ pkceVerifier: 'v' });
    expect(await store.consume('s1', 5_000)).toBeUndefined(); // single-use
    await store.put('s2', { provider: 'stub', pkceVerifier: 'v', redirectUri: 'r', expiresAt: 1_000 });
    expect(await store.consume('s2', 5_000)).toBeUndefined(); // expired
    expect(await store.consume('missing')).toBeUndefined();
  });
});

describe('InMemoryIdentityRepository', () => {
  it('links + finds by provider and lists by user', async () => {
    const repo = new InMemoryIdentityRepository();
    await repo.link({ userId: 'u1', provider: 'google', providerId: 'g1', email: 'a@x.dev' });
    await repo.link({ userId: 'u1', provider: 'github', providerId: 'h1', email: 'a@x.dev' });
    expect((await repo.findByProvider('google', 'g1'))?.userId).toBe('u1');
    expect(await repo.findByProvider('google', 'nope')).toBeUndefined();
    expect((await repo.listByUser('u1')).map((i) => i.provider).sort()).toEqual(['github', 'google']);
  });
});
