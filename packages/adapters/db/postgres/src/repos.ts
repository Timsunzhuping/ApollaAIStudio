import { randomUUID } from 'node:crypto';
import { User, Project, SkillDef, Session, ApiToken, Subscription, OAuthIdentity, type User as UserT, type Project as ProjectT, type SkillDef as SkillDefT, type Session as SessionT, type ApiToken as ApiTokenT, type Subscription as SubscriptionT, type OAuthIdentity as OAuthIdentityT } from '@apolla/contracts';
import type { UserRepository, ProjectRepository, SkillRepository, SessionRepository, ApiTokenRepository, SubscriptionRepository, IdentityRepository, MagicLinkRepository, MfaRecord, CollabAccessRepository } from '@apolla/harness-core';
import type { Sql } from './index';

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: Sql) {}

  async upsertByEmail(email: string): Promise<UserT> {
    const rows = await this.sql<{ id: string; email: string }[]>`
      INSERT INTO users (id, email) VALUES (${randomUUID()}, ${email})
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email
    `;
    return User.parse(rows[0]);
  }

  async register(email: string, passwordHash: string): Promise<UserT> {
    const rows = await this.sql<{ id: string; email: string }[]>`
      INSERT INTO users (id, email, password_hash) VALUES (${randomUUID()}, ${email}, ${passwordHash})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email
    `;
    if (!rows[0]) throw new Error('email already registered');
    return User.parse(rows[0]);
  }

  async findCredentialByEmail(email: string): Promise<{ user: UserT; passwordHash: string | null } | undefined> {
    const rows = await this.sql<{ id: string; email: string; password_hash: string | null }[]>`
      SELECT id, email, password_hash FROM users WHERE email = ${email}
    `;
    const r = rows[0];
    return r ? { user: User.parse({ id: r.id, email: r.email }), passwordHash: r.password_hash } : undefined;
  }

  async get(id: string): Promise<UserT | undefined> {
    const rows = await this.sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE id = ${id}`;
    return rows[0] ? User.parse(rows[0]) : undefined;
  }

  async getMfa(userId: string): Promise<MfaRecord | undefined> {
    const rows = await this.sql<{ totp_secret: string | null; recovery_codes: unknown; mfa_enabled: boolean }[]>`
      SELECT totp_secret, recovery_codes, mfa_enabled FROM users WHERE id = ${userId}
    `;
    const r = rows[0];
    if (!r) return undefined;
    return { secret: r.totp_secret, recoveryHashes: (r.recovery_codes as string[]) ?? [], enabled: r.mfa_enabled };
  }
  async saveMfa(userId: string, mfa: MfaRecord): Promise<void> {
    await this.sql`
      UPDATE users SET totp_secret = ${mfa.secret}, recovery_codes = ${this.sql.json(mfa.recoveryHashes)}, mfa_enabled = ${mfa.enabled}
      WHERE id = ${userId}
    `;
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly sql: Sql) {}

  async create(session: SessionT): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, owner_id, expires_at) VALUES (${session.id}, ${session.ownerId}, ${session.expiresAt})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async get(id: string, now: Date = new Date()): Promise<SessionT | undefined> {
    const rows = await this.sql<{ id: string; owner_id: string; expires_at: Date }[]>`
      SELECT id, owner_id, expires_at FROM sessions WHERE id = ${id}
    `;
    const r = rows[0];
    if (!r) return undefined;
    if (r.expires_at.getTime() <= now.getTime()) {
      await this.delete(id);
      return undefined;
    }
    return Session.parse({ id: r.id, ownerId: r.owner_id, expiresAt: r.expires_at.toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.sql`DELETE FROM sessions WHERE id = ${id}`;
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(private readonly sql: Sql) {}

  async create(project: ProjectT): Promise<ProjectT> {
    await this.sql`
      INSERT INTO projects (id, owner_id, name, description)
      VALUES (${project.id}, ${project.ownerId}, ${project.name}, ${project.description})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
    `;
    return Project.parse(project);
  }

  async get(id: string): Promise<ProjectT | undefined> {
    const rows = await this.sql<
      { id: string; owner_id: string; name: string; description: string }[]
    >`SELECT id, owner_id, name, description FROM projects WHERE id = ${id}`;
    const r = rows[0];
    return r ? Project.parse({ id: r.id, ownerId: r.owner_id, name: r.name, description: r.description }) : undefined;
  }

  async list(ownerId: string): Promise<ProjectT[]> {
    const rows = await this.sql<
      { id: string; owner_id: string; name: string; description: string }[]
    >`SELECT id, owner_id, name, description FROM projects WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => Project.parse({ id: r.id, ownerId: r.owner_id, name: r.name, description: r.description }));
  }
}

export class PostgresSkillRepository implements SkillRepository {
  constructor(private readonly sql: Sql) {}

  async save(ownerId: string, def: SkillDefT): Promise<SkillDefT> {
    await this.sql`
      INSERT INTO skills (owner_id, name, data) VALUES (${ownerId}, ${def.name}, ${this.sql.json(def)})
      ON CONFLICT (owner_id, name) DO UPDATE SET data = EXCLUDED.data
    `;
    return SkillDef.parse(def);
  }

  async list(ownerId: string): Promise<SkillDefT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM skills WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => SkillDef.parse(r.data));
  }

  async delete(ownerId: string, name: string): Promise<void> {
    await this.sql`DELETE FROM skills WHERE owner_id = ${ownerId} AND name = ${name}`;
  }
}

export class PostgresApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly sql: Sql) {}

  async create(token: ApiTokenT): Promise<void> {
    await this.sql`
      INSERT INTO api_tokens (id, owner_id, data) VALUES (${token.id}, ${token.ownerId}, ${this.sql.json(token)})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  async get(id: string): Promise<ApiTokenT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM api_tokens WHERE id = ${id}`;
    return rows[0] ? ApiToken.parse(rows[0].data) : undefined;
  }
  async list(ownerId: string): Promise<ApiTokenT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM api_tokens WHERE owner_id = ${ownerId} ORDER BY created_at DESC`;
    return rows.map((r) => ApiToken.parse(r.data));
  }
  async delete(ownerId: string, id: string): Promise<void> {
    await this.sql`DELETE FROM api_tokens WHERE id = ${id} AND owner_id = ${ownerId}`;
  }
  async touch(id: string, at: string): Promise<void> {
    await this.sql`UPDATE api_tokens SET data = jsonb_set(data, '{lastUsedAt}', to_jsonb(${at}::text)) WHERE id = ${id}`;
  }
}

export class PostgresSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly sql: Sql) {}

  async get(ownerId: string): Promise<SubscriptionT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM subscriptions WHERE owner_id = ${ownerId}`;
    return rows[0] ? Subscription.parse(rows[0].data) : undefined;
  }
  async save(sub: SubscriptionT): Promise<void> {
    await this.sql`
      INSERT INTO subscriptions (owner_id, data) VALUES (${sub.ownerId}, ${this.sql.json(sub)})
      ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data
    `;
  }
  async markEventProcessed(eventId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO billing_events (id) VALUES (${eventId}) ON CONFLICT (id) DO NOTHING RETURNING id
    `;
    return rows.length > 0;
  }
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly sql: Sql) {}

  async findByProvider(provider: string, providerId: string): Promise<OAuthIdentityT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`
      SELECT data FROM oauth_identities WHERE provider = ${provider} AND provider_id = ${providerId}
    `;
    return rows[0] ? OAuthIdentity.parse(rows[0].data) : undefined;
  }
  async link(identity: OAuthIdentityT): Promise<void> {
    await this.sql`
      INSERT INTO oauth_identities (provider, provider_id, user_id, data)
      VALUES (${identity.provider}, ${identity.providerId}, ${identity.userId}, ${this.sql.json(identity)})
      ON CONFLICT (provider, provider_id) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data
    `;
  }
  async listByUser(userId: string): Promise<OAuthIdentityT[]> {
    const rows = await this.sql<{ data: unknown }[]>`
      SELECT data FROM oauth_identities WHERE user_id = ${userId} ORDER BY created_at
    `;
    return rows.map((r) => OAuthIdentity.parse(r.data));
  }
}

export class PostgresMagicLinkRepository implements MagicLinkRepository {
  constructor(private readonly sql: Sql) {}

  async consume(jti: string): Promise<boolean> {
    const rows = await this.sql<{ jti: string }[]>`
      INSERT INTO magic_links (jti) VALUES (${jti}) ON CONFLICT (jti) DO NOTHING RETURNING jti
    `;
    return rows.length > 0;
  }
}

export class PostgresCollabAccessRepository implements CollabAccessRepository {
  constructor(private readonly sql: Sql) {}

  async grant(docId: string, userId: string): Promise<void> {
    await this.sql`INSERT INTO collab_access (doc_id, user_id) VALUES (${docId}, ${userId}) ON CONFLICT DO NOTHING`;
  }
  async has(docId: string, userId: string): Promise<boolean> {
    const rows = await this.sql<{ user_id: string }[]>`SELECT user_id FROM collab_access WHERE doc_id = ${docId} AND user_id = ${userId}`;
    return rows.length > 0;
  }
  async list(docId: string): Promise<string[]> {
    const rows = await this.sql<{ user_id: string }[]>`SELECT user_id FROM collab_access WHERE doc_id = ${docId}`;
    return rows.map((r) => r.user_id);
  }
}
