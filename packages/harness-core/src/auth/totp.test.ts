import { describe, it, expect } from 'vitest';
import { generateTotp, verifyTotp, newTotpSecret, otpauthUri, newRecoveryCodes } from './totp';
import { hashPassword, verifyPassword } from './password';

// RFC 6238 Appendix B test secret "12345678901234567890" (ASCII) in Base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC 6238 SHA-1 test vector at T=59s', () => {
    expect(generateTotp(RFC_SECRET, { now: 59_000 })).toBe('287082');
  });

  it('verifies the current code and tolerates ±1 step of skew', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, { now });
    expect(verifyTotp(RFC_SECRET, code, { now })).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, { now: now + 30_000 })).toBe(true); // +1 step
    expect(verifyTotp(RFC_SECRET, code, { now: now - 30_000 })).toBe(true); // -1 step
    expect(verifyTotp(RFC_SECRET, code, { now: now + 120_000 })).toBe(false); // out of window
    expect(verifyTotp(RFC_SECRET, '000000', { now })).toBe(false);
  });

  it('generates a usable secret + otpauth URI', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const uri = otpauthUri(secret, 'me@x.dev');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(`secret=${secret}`);
    // a code from the fresh secret verifies against itself
    const now = Date.now();
    expect(verifyTotp(secret, generateTotp(secret, { now }), { now })).toBe(true);
  });
});

describe('recovery codes', () => {
  it('are single-use when stored scrypt-hashed', () => {
    const codes = newRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    let hashes = codes.map(hashPassword);
    // consume one: find + remove
    const idx = hashes.findIndex((h) => verifyPassword(codes[3]!, h));
    expect(idx).toBe(3);
    hashes = hashes.filter((_, i) => i !== idx);
    expect(hashes.some((h) => verifyPassword(codes[3]!, h))).toBe(false); // can't reuse
    expect(hashes.some((h) => verifyPassword(codes[4]!, h))).toBe(true); // others still work
  });
});
