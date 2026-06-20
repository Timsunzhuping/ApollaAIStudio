import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function keyBytes(key = process.env.SECRETS_KEY ?? 'dev-insecure-secrets-key-change-me'): Buffer {
  // Derive a stable 32-byte key from whatever SECRETS_KEY is provided.
  return createHash('sha256').update(key).digest();
}

/** Encrypt a secret with AES-256-GCM. Returns base64("iv.tag.ciphertext"). */
export function encryptSecret(plaintext: string, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.');
}

/** Decrypt a value produced by encryptSecret. Throws on tampering (GCM auth). */
export function decryptSecret(blob: string, key?: string): string {
  const [ivB, tagB, ctB] = blob.split('.');
  if (!ivB || !tagB || !ctB) throw new Error('malformed secret blob');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
