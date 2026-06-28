import { describe, it, expect } from 'vitest';
import { newApiToken, parseApiToken, InMemoryApiTokenRepository } from './token';
import { hashPassword, verifyPassword } from './password';

describe('API tokens', () => {
  it('generates a parseable apolla_<id>_<secret> token whose secret verifies against its hash', () => {
    const { id, secret, plaintext } = newApiToken();
    expect(plaintext).toBe(`apolla_${id}_${secret}`);
    const parsed = parseApiToken(plaintext)!;
    expect(parsed.id).toBe(id);
    expect(verifyPassword(parsed.secret, hashPassword(secret))).toBe(true);
  });

  it('rejects malformed tokens', () => {
    expect(parseApiToken(undefined)).toBeNull();
    expect(parseApiToken('garbage')).toBeNull();
    expect(parseApiToken('apolla_only')).toBeNull();
  });

  it('repo: create / get / list-by-owner / delete (owner-scoped)', async () => {
    const repo = new InMemoryApiTokenRepository();
    await repo.create({ id: 't1', ownerId: 'u1', name: 'a', hashedToken: 'h' });
    await repo.create({ id: 't2', ownerId: 'u2', name: 'b', hashedToken: 'h' });
    expect((await repo.list('u1')).map((t) => t.id)).toEqual(['t1']);
    await repo.delete('u2', 't1'); // wrong owner — no-op
    expect(await repo.get('t1')).toBeTruthy();
    await repo.delete('u1', 't1');
    expect(await repo.get('t1')).toBeUndefined();
  });
});
