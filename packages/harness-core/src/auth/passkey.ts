import { randomBytes, createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Passkeys / WebAuthn-style authentication (S33). The security core of WebAuthn is a public-key
 * challenge–response: the authenticator holds a private key, the server stores the public key, and
 * login proves possession by signing a fresh, single-use challenge (ES256 / P-256). We implement that
 * core faithfully with Node crypto; full CTAP attestation-object / CBOR parsing (anti-fraud metadata,
 * not the auth core) is intentionally out of scope and noted as follow-up.
 *
 * The signed payload is the challenge bytes; signatures are IEEE-P1363 (raw r||s), matching what
 * WebCrypto `ECDSA` produces in the browser. Public keys travel as JWK.
 */
// `type` (not interface) so these structurally satisfy postgres's JSONValue when persisted as jsonb.
export type PublicKeyJwk = {
  kty: string;
  crv: string;
  x: string;
  y: string;
};

export type PasskeyCredential = {
  id: string; // credential id (base64url), unique
  userId: string;
  publicKey: PublicKeyJwk;
  label: string;
  createdAt: string;
};

export interface PasskeyRepository {
  save(cred: PasskeyCredential): Promise<void>;
  getById(id: string): Promise<PasskeyCredential | undefined>;
  listByUser(userId: string): Promise<PasskeyCredential[]>;
  delete(userId: string, id: string): Promise<void>;
}

/** A fresh, single-use, short-lived challenge to be signed by the authenticator. */
export function newChallenge(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Verify an assertion: does `signature` (IEEE-P1363, base64url) over `challenge` validate against the
 * credential's public key? Fail-closed on any malformed key/signature.
 */
export function verifyAssertion(cred: PasskeyCredential, challenge: string, signatureB64: string): boolean {
  try {
    if (!challenge || !signatureB64) return false;
    const key = createPublicKey({ key: cred.publicKey as unknown as import('node:crypto').JsonWebKey, format: 'jwk' });
    const data = Buffer.from(challenge, 'utf8');
    const sig = Buffer.from(signatureB64, 'base64url');
    return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

/** In-memory challenge store: single-use + TTL (default 2 min). Optionally bound to a user. */
export class InMemoryChallengeStore {
  private readonly ch = new Map<string, { userId?: string; exp: number }>();
  constructor(private readonly ttlMs = 2 * 60 * 1000) {}

  issue(userId?: string, now = Date.now()): string {
    const c = newChallenge();
    this.ch.set(c, { userId, exp: now + this.ttlMs });
    return c;
  }
  /** Consume a challenge exactly once; returns its binding (or null if unknown/expired/reused). */
  consume(challenge: string, now = Date.now()): { userId?: string } | null {
    const entry = this.ch.get(challenge);
    if (!entry) return null;
    this.ch.delete(challenge);
    if (entry.exp <= now) return null;
    return { userId: entry.userId };
  }
}

export class InMemoryPasskeyRepository implements PasskeyRepository {
  private readonly byId = new Map<string, PasskeyCredential>();
  async save(cred: PasskeyCredential): Promise<void> {
    this.byId.set(cred.id, cred);
  }
  async getById(id: string): Promise<PasskeyCredential | undefined> {
    return this.byId.get(id);
  }
  async listByUser(userId: string): Promise<PasskeyCredential[]> {
    return [...this.byId.values()].filter((c) => c.userId === userId);
  }
  async delete(userId: string, id: string): Promise<void> {
    const c = this.byId.get(id);
    if (c && c.userId === userId) this.byId.delete(id);
  }
}
