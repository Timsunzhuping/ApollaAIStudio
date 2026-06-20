import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './secrets';

describe('secrets (AES-GCM)', () => {
  it('round-trips a secret', () => {
    const blob = encryptSecret('super-secret-token', 'k1');
    expect(blob).not.toContain('super-secret-token');
    expect(decryptSecret(blob, 'k1')).toBe('super-secret-token');
  });

  it('fails to decrypt with the wrong key or tampered ciphertext', () => {
    const blob = encryptSecret('a longer secret value', 'k1');
    expect(() => decryptSecret(blob, 'k2')).toThrow();
    const tampered = (blob[0] === 'A' ? 'B' : 'A') + blob.slice(1); // corrupt the IV
    expect(() => decryptSecret(tampered, 'k1')).toThrow();
  });
});
