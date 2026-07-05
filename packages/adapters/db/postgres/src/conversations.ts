import { Conversation, type Conversation as ConversationT } from '@apolla/contracts';
import type { ConversationRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres ConversationRepository — chat threads survive restarts/redeploys (S28 follow-up). */
export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly sql: Sql) {}

  async create(c: ConversationT): Promise<ConversationT> {
    await this.sql`
      INSERT INTO conversations (id, owner_id, updated_at, data)
      VALUES (${c.id}, ${c.ownerId}, ${c.updatedAt}, ${this.sql.json(c)})
      ON CONFLICT (id) DO NOTHING
    `;
    return c;
  }

  async get(id: string): Promise<ConversationT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM conversations WHERE id = ${id}`;
    return rows[0] ? Conversation.parse(rows[0].data) : undefined;
  }

  async save(c: ConversationT): Promise<void> {
    await this.sql`
      INSERT INTO conversations (id, owner_id, updated_at, data)
      VALUES (${c.id}, ${c.ownerId}, ${c.updatedAt}, ${this.sql.json(c)})
      ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, data = EXCLUDED.data
    `;
  }

  async list(ownerId: string): Promise<ConversationT[]> {
    const rows = await this.sql<{ data: unknown }[]>`
      SELECT data FROM conversations WHERE owner_id = ${ownerId} ORDER BY updated_at DESC
    `;
    return rows.map((r) => Conversation.parse(r.data));
  }
}
