import { StubOAuthProvider, InMemoryIdentityRepository, InMemoryOAuthStateStore, newState, newPkce } from '@apolla/harness-core';
import { InMemoryUserRepository } from '@apolla/harness-core';
import type { CheckResult } from './checks';

/**
 * Identity unification (S14): two OAuth identities on the SAME verified email resolve to ONE user;
 * an unverified email is rejected; state is single-use. Fully offline (StubOAuthProvider).
 */
export async function identityUnification(): Promise<CheckResult> {
  const issues: string[] = [];
  const provider = new StubOAuthProvider();
  const users = new InMemoryUserRepository();
  const identities = new InMemoryIdentityRepository();
  const states = new InMemoryOAuthStateStore();

  // Mirror the BFF resolveOAuthUser logic: link by verified email, fail-closed on unverified.
  async function resolve(code: string): Promise<string> {
    const tokens = await provider.exchangeCode({ code, pkceVerifier: 'v', redirectUri: 'r' });
    const ident = await provider.fetchIdentity(tokens);
    if (!ident.emailVerified) throw new Error('unverified');
    const existing = await identities.findByProvider('stub', ident.providerId);
    if (existing) return existing.userId;
    const user = await users.upsertByEmail(ident.email);
    await identities.link({ userId: user.id, provider: 'stub', providerId: ident.providerId, email: user.email });
    return user.id;
  }

  const u1 = await resolve('stub:same@x.dev:idA');
  const u2 = await resolve('stub:same@x.dev:idB'); // same email, different provider id
  if (u1 !== u2) issues.push('same-email identities should unify to one user');
  const ids = await identities.listByUser(u1);
  if (ids.length !== 2) issues.push(`expected 2 linked identities, got ${ids.length}`);

  let rejected = false;
  try {
    await resolve('stub:bad@x.dev:idC:unverified');
  } catch {
    rejected = true;
  }
  if (!rejected) issues.push('unverified email should be rejected (fail-closed)');

  // state is single-use
  const st = newState();
  const { verifier } = newPkce();
  await states.put(st, { provider: 'stub', pkceVerifier: verifier, redirectUri: 'r', expiresAt: Date.now() + 60_000 });
  if (!(await states.consume(st))) issues.push('state should consume once');
  if (await states.consume(st)) issues.push('state must not be reusable');

  return { name: 'identity-unification', ok: issues.length === 0, issues };
}

export async function runIdentityScenarios(): Promise<CheckResult[]> {
  return [await identityUnification()];
}
