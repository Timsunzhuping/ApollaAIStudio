import { randomBytes, randomUUID } from 'node:crypto';
import type { ApiToken } from '@apolla/contracts';

/**
 * API token format: `apolla_<id>_<secret>`. The id is indexed for O(1) lookup; only the secret is
 * scrypt-hashed + verified (constant-time). This avoids scanning every token per request while
 * keeping the stored value non-reversible. The plaintext is shown to the user exactly once.
 */
export function newApiToken(): { id: string; secret: string; plaintext: string } {
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const secret = randomBytes(24).toString('base64url');
  return { id, secret, plaintext: `apolla_${id}_${secret}` };
}

export function parseApiToken(plaintext: string | undefined): { id: string; secret: string } | null {
  if (!plaintext) return null;
  const m = /^apolla_([a-z0-9]+)_(.+)$/i.exec(plaintext.trim());
  return m ? { id: m[1]!, secret: m[2]! } : null;
}

/** Persistence for API tokens (Sprint 12). */
export interface ApiTokenRepository {
  create(token: ApiToken): Promise<void>;
  get(id: string): Promise<ApiToken | undefined>;
  list(ownerId: string): Promise<ApiToken[]>;
  delete(ownerId: string, id: string): Promise<void>;
  touch(id: string, at: string): Promise<void>;
}

export class InMemoryApiTokenRepository implements ApiTokenRepository {
  private readonly byId = new Map<string, ApiToken>();
  async create(token: ApiToken): Promise<void> {
    this.byId.set(token.id, { ...token });
  }
  async get(id: string): Promise<ApiToken | undefined> {
    const t = this.byId.get(id);
    return t ? { ...t } : undefined;
  }
  async list(ownerId: string): Promise<ApiToken[]> {
    return [...this.byId.values()].filter((t) => t.ownerId === ownerId).map((t) => ({ ...t }));
  }
  async delete(ownerId: string, id: string): Promise<void> {
    const t = this.byId.get(id);
    if (t && t.ownerId === ownerId) this.byId.delete(id);
  }
  async touch(id: string, at: string): Promise<void> {
    const t = this.byId.get(id);
    if (t) t.lastUsedAt = at;
  }
}
