import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 Base32 (uppercase, no padding) — the encoding authenticator apps expect. */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/i, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export interface TotpOptions {
  now?: number; // injected clock (ms) for deterministic tests
  period?: number;
  digits?: number;
}

/** A fresh Base32 TOTP secret (160-bit). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The current TOTP code for `secret` (RFC 6238, HMAC-SHA1). */
export function generateTotp(secret: string, opts: TotpOptions = {}): string {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const now = opts.now ?? Date.now();
  const counter = Math.floor(now / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Verify a code against `secret` within ±`window` steps (clock skew tolerance). */
export function verifyTotp(secret: string, code: string, opts: TotpOptions & { window?: number } = {}): boolean {
  const period = opts.period ?? 30;
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const trimmed = code.trim();
  for (let w = -window; w <= window; w++) {
    if (generateTotp(secret, { ...opts, now: now + w * period * 1000 }) === trimmed) return true;
  }
  return false;
}

/** An `otpauth://` URI for an authenticator app to scan. */
export function otpauthUri(secret: string, account: string, issuer = 'Apolla'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** One-time backup codes (shown once at enrollment; stored scrypt-hashed by the caller). */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => randomBytes(5).toString('hex'));
}
