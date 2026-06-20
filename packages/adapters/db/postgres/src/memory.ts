import { randomUUID } from 'node:crypto';
import { MemoryItem, UserModel, type MemoryItem as MemoryItemT, type UserModel as UserModelT } from '@apolla/contracts';
import type { Memory } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres Memory: FTS recall over memory_items + JSONB user_model (PRD §12.B). */
export class PostgresMemory implements Memory {
  constructor(private readonly sql: Sql) {}

  async recall(ownerId: string, query: string, limit = 5): Promise<MemoryItemT[]> {
    // OR the terms (matches the in-memory word-overlap semantics); websearch_to_tsquery ANDs by default.
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const orQuery = terms.join(' OR ');
    const rows = await this.sql<{ id: string; owner_id: string; kind: string; content: string }[]>`
      SELECT id, owner_id, kind, content
      FROM memory_items
      WHERE owner_id = ${ownerId} AND fts @@ websearch_to_tsquery('english', ${orQuery})
      ORDER BY ts_rank(fts, websearch_to_tsquery('english', ${orQuery})) DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => MemoryItem.parse({ id: r.id, ownerId: r.owner_id, kind: r.kind, content: r.content }));
  }

  async note(item: { ownerId: string; content: string; kind?: 'note' | 'fact' }): Promise<void> {
    await this.sql`
      INSERT INTO memory_items (id, owner_id, kind, content)
      VALUES (${randomUUID()}, ${item.ownerId}, ${item.kind ?? 'note'}, ${item.content})
    `;
  }

  async getUserModel(ownerId: string): Promise<UserModelT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM user_model WHERE owner_id = ${ownerId}`;
    return rows[0] ? UserModel.parse(rows[0].data) : undefined;
  }

  async setUserModel(ownerId: string, patch: Partial<Omit<UserModelT, 'ownerId'>>): Promise<UserModelT> {
    const current = (await this.getUserModel(ownerId)) ?? { ownerId, formats: [] };
    const next = UserModel.parse({ ...current, ...patch, ownerId });
    await this.sql`
      INSERT INTO user_model (owner_id, data) VALUES (${ownerId}, ${this.sql.json(next)})
      ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data
    `;
    return next;
  }

  async clear(ownerId: string): Promise<void> {
    await this.sql`DELETE FROM memory_items WHERE owner_id = ${ownerId}`;
    await this.sql`DELETE FROM user_model WHERE owner_id = ${ownerId}`;
  }
}
