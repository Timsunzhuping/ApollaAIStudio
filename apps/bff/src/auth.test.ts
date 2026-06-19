import { describe, it, expect } from 'vitest';
import { verify } from './auth';
import { createHmac } from 'node:crypto';

const SECRET = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me';
function token(userId: string, mac?: string): string {
  const m = mac ?? createHmac('sha256', SECRET).update(userId).digest('base64url');
  return `${Buffer.from(userId).toString('base64url')}.${m}`;
}

describe('session auth', () => {
  it('verifies a correctly signed token', () => {
    expect(verify(token('user_42'))).toBe('user_42');
  });

  it('rejects a tampered signature', () => {
    expect(verify(token('user_42', 'not-the-real-mac'))).toBeNull();
  });

  it('rejects a forged user id with a reused signature', () => {
    const real = token('user_42');
    const [, mac] = real.split('.');
    expect(verify(token('user_99', mac))).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verify(undefined)).toBeNull();
    expect(verify('garbage')).toBeNull();
  });
});
