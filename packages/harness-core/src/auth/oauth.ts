import { createHash, randomBytes } from 'node:crypto';
import type { OAuthIdentity } from '@apolla/contracts';

export interface OAuthTokens {
  accessToken: string;
  [k: string]: unknown;
}

export interface ResolvedIdentity {
  providerId: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Swappable identity provider (OAuth 2.0 / OIDC) — Stub offline / Google + GitHub in prod, same
 * capability-as-config pattern as the LLM/media/search/payment adapters. We never persist OAuth
 * tokens: we exchange the code, read the verified email, and issue our own signed session.
 */
export interface AuthProvider {
  readonly name: string;
  authorizeUrl(input: { state: string; pkceChallenge: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; pkceVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  fetchIdentity(tokens: OAuthTokens): Promise<ResolvedIdentity>;
}

/** Generate a single-use CSRF state token. */
export function newState(): string {
  return randomBytes(24).toString('base64url');
}

/** Generate a PKCE verifier + S256 challenge pair (RFC 7636). */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Offline identity provider for demo/CI. authorizeUrl points straight back at the callback with a
 * synthetic code (simulating instant consent); the code carries the identity so tests can drive
 * specific emails. Format: `stub:<email>:<providerId>[:unverified]`.
 */
export class StubOAuthProvider implements AuthProvider {
  readonly name: string;
  private readonly defaultEmail: string;
  constructor(name = 'stub', defaultEmail = 'stub-user@apolla.dev') {
    this.name = name;
    this.defaultEmail = defaultEmail;
  }
  authorizeUrl(input: { state: string; redirectUri: string }): string {
    const code = `stub:${this.defaultEmail}:stub-1`;
    const sep = input.redirectUri.includes('?') ? '&' : '?';
    return `${input.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(input.state)}`;
  }
  async exchangeCode(input: { code: string }): Promise<OAuthTokens> {
    return { accessToken: input.code };
  }
  async fetchIdentity(tokens: OAuthTokens): Promise<ResolvedIdentity> {
    const parts = String(tokens.accessToken).split(':');
    if (parts[0] !== 'stub' || !parts[1] || !parts[2]) throw new Error('invalid stub code');
    return { providerId: parts[2], email: parts[1], emailVerified: parts[3] !== 'unverified' };
  }
}

export interface IdentityRepository {
  findByProvider(provider: string, providerId: string): Promise<OAuthIdentity | undefined>;
  link(identity: OAuthIdentity): Promise<void>;
  listByUser(userId: string): Promise<OAuthIdentity[]>;
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly byKey = new Map<string, OAuthIdentity>();
  private key(provider: string, providerId: string): string {
    return `${provider}:${providerId}`;
  }
  async findByProvider(provider: string, providerId: string): Promise<OAuthIdentity | undefined> {
    const i = this.byKey.get(this.key(provider, providerId));
    return i ? { ...i } : undefined;
  }
  async link(identity: OAuthIdentity): Promise<void> {
    this.byKey.set(this.key(identity.provider, identity.providerId), { ...identity });
  }
  async listByUser(userId: string): Promise<OAuthIdentity[]> {
    return [...this.byKey.values()].filter((i) => i.userId === userId).map((i) => ({ ...i }));
  }
}

export interface OAuthStateEntry {
  provider: string;
  pkceVerifier: string;
  redirectUri: string;
  expiresAt: number;
}

/** Single-use, expiring store for OAuth `state` (CSRF + PKCE binding). */
export interface OAuthStateStore {
  put(state: string, entry: OAuthStateEntry): Promise<void>;
  consume(state: string, now?: number): Promise<OAuthStateEntry | undefined>;
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly states = new Map<string, OAuthStateEntry>();
  async put(state: string, entry: OAuthStateEntry): Promise<void> {
    this.states.set(state, entry);
  }
  async consume(state: string, now: number = Date.now()): Promise<OAuthStateEntry | undefined> {
    const entry = this.states.get(state);
    if (!entry) return undefined;
    this.states.delete(state); // single-use: gone whether or not it was valid
    if (entry.expiresAt <= now) return undefined;
    return entry;
  }
}
