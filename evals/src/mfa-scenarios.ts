import { generateTotp, verifyTotp, newTotpSecret, newRecoveryCodes, hashPassword, verifyPassword, newMagicToken, verifyMagicToken, InMemoryMagicLinkRepository } from '@apolla/harness-core';
import type { CheckResult } from './checks';

/**
 * Account security (S20): TOTP matches the RFC 6238 vector and verifies with skew; recovery codes
 * are single-use; magic-link tokens are signed, expiring, and single-use. Fully offline (injected
 * clock + in-memory store).
 */
export async function accountSecurity(): Promise<CheckResult> {
  const issues: string[] = [];

  // RFC 6238 SHA-1 vector
  if (generateTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { now: 59_000 }) !== '287082') issues.push('TOTP RFC vector mismatch');
  const secret = newTotpSecret();
  const now = 1_700_000_000_000;
  const code = generateTotp(secret, { now });
  if (!verifyTotp(secret, code, { now: now + 30_000 })) issues.push('TOTP should tolerate +1 step skew');
  if (verifyTotp(secret, code, { now: now + 120_000 })) issues.push('TOTP should reject an out-of-window code');

  // recovery codes: single-use against scrypt hashes
  const codes = newRecoveryCodes(5);
  let hashes = codes.map(hashPassword);
  const idx = hashes.findIndex((h) => verifyPassword(codes[0]!, h));
  hashes = hashes.filter((_, i) => i !== idx);
  if (hashes.some((h) => verifyPassword(codes[0]!, h))) issues.push('recovery code should be single-use');

  // magic-link: signed + expiring + single-use
  const { token, jti } = newMagicToken('u', { now, ttlMs: 1000 });
  if (verifyMagicToken(token, { now })?.userId !== 'u') issues.push('magic-link should verify a fresh token');
  if (verifyMagicToken(token, { now: now + 2000 })) issues.push('magic-link should expire');
  if (verifyMagicToken(token + 'x', { now })) issues.push('magic-link should reject a tampered token');
  const repo = new InMemoryMagicLinkRepository();
  if (!(await repo.consume(jti)) || (await repo.consume(jti))) issues.push('magic-link jti should be single-use');

  return { name: 'account-security', ok: issues.length === 0, issues };
}

export async function runMfaScenarios(): Promise<CheckResult[]> {
  return [await accountSecurity()];
}
