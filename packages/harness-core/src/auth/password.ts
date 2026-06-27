import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (no external dependency). Each password gets a random salt; the
 * stored string is `salt:hash` (both hex). Verification is constant-time. Plaintext passwords are
 * NEVER stored or logged.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
