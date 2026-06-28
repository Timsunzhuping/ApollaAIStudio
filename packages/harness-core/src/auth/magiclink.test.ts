import { describe, it, expect } from 'vitest';
import { newMagicToken, verifyMagicToken, InMemoryMagicLinkRepository } from './magiclink';

describe('magic-link token (S20)', () => {
  it('signs and verifies, carrying the userId', () => {
    const now = 1_700_000_000_000;
    const { token, jti } = newMagicToken('user-1', { now });
    const v = verifyMagicToken(token, { now });
    expect(v).toMatchObject({ userId: 'user-1', jti });
  });

  it('rejects expired, tampered, and malformed tokens', () => {
    const now = 1_700_000_000_000;
    const { token } = newMagicToken('user-1', { now, ttlMs: 1000 });
    expect(verifyMagicToken(token, { now: now + 2000 })).toBeNull(); // expired
    expect(verifyMagicToken(token + 'x', { now })).toBeNull(); // tampered mac
    expect(verifyMagicToken('garbage', { now })).toBeNull();
    expect(verifyMagicToken(undefined, { now })).toBeNull();
  });

  it('single-use store consumes a jti exactly once', async () => {
    const repo = new InMemoryMagicLinkRepository();
    const { jti } = newMagicToken('u', {});
    expect(await repo.consume(jti)).toBe(true);
    expect(await repo.consume(jti)).toBe(false); // replay rejected
  });
});
