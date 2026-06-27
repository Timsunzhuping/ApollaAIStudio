import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { InMemorySessionRepository } from './session';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored).not.toContain('correct horse'); // never stores plaintext
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('uses a random salt (same password → different hash)', () => {
    expect(hashPassword('pw').split(':')[0]).not.toBe(hashPassword('pw').split(':')[0]);
  });

  it('rejects empty/malformed stored hashes', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('InMemorySessionRepository', () => {
  it('stores, retrieves, and deletes sessions', async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: 's1', ownerId: 'u', expiresAt: new Date(Date.now() + 10_000).toISOString() });
    expect((await repo.get('s1'))?.ownerId).toBe('u');
    await repo.delete('s1');
    expect(await repo.get('s1')).toBeUndefined();
  });

  it('treats an expired session as absent and evicts it', async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: 's2', ownerId: 'u', expiresAt: new Date(Date.now() - 1).toISOString() });
    expect(await repo.get('s2')).toBeUndefined();
  });
});
