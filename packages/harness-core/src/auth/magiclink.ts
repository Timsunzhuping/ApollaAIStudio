import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET = () => process.env.MAGICLINK_SECRET ?? process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me';

interface MagicPayload {
  userId: string;
  exp: number;
  jti: string; // single-use id
}

function sign(payloadB64: string): string {
  return createHmac('sha256', SECRET()).update(payloadB64).digest('base64url');
}

/** A signed, single-use, expiring passwordless sign-in token (S20). */
export function newMagicToken(userId: string, opts: { now?: number; ttlMs?: number } = {}): { token: string; jti: string } {
  const now = opts.now ?? Date.now();
  const payload: MagicPayload = { userId, exp: now + (opts.ttlMs ?? 15 * 60 * 1000), jti: randomBytes(16).toString('hex') };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${b64}.${sign(b64)}`, jti: payload.jti };
}

/** Verify signature + expiry; returns the payload, or null. Single-use is enforced by the caller. */
export function verifyMagicToken(token: string | undefined, opts: { now?: number } = {}): { userId: string; jti: string } | null {
  if (!token) return null;
  const [b64, mac] = token.split('.');
  if (!b64 || !mac) return null;
  const expected = sign(b64);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as MagicPayload;
    if (!payload.userId || !payload.jti || payload.exp <= (opts.now ?? Date.now())) return null;
    return { userId: payload.userId, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Single-use store for magic-link token ids (jti). consume() returns true on first use only. */
export interface MagicLinkRepository {
  consume(jti: string): Promise<boolean>;
}

export class InMemoryMagicLinkRepository implements MagicLinkRepository {
  private readonly used = new Set<string>();
  async consume(jti: string): Promise<boolean> {
    if (this.used.has(jti)) return false;
    this.used.add(jti);
    return true;
  }
}

/** Delivers the sign-in link to the user (Stub offline / real email in prod). */
export interface MagicLinkDelivery {
  send(email: string, link: string): Promise<void>;
}

/** Offline delivery — records the last link per email so tests/dev can retrieve it (no email sent). */
export class StubMagicLinkDelivery implements MagicLinkDelivery {
  private readonly byEmail = new Map<string, string>();
  async send(email: string, link: string): Promise<void> {
    this.byEmail.set(email.toLowerCase(), link);
  }
  last(email: string): string | undefined {
    return this.byEmail.get(email.toLowerCase());
  }
}
