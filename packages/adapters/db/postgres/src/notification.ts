import { Notification, type Notification as NotificationT } from '@apolla/contracts';
import type { NotificationRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres NotificationRepository — notification as JSONB + read flag (S5-T5). */
export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly sql: Sql) {}

  async create(n: NotificationT): Promise<void> {
    await this.sql`
      INSERT INTO notifications (id, owner_id, read, data) VALUES (${n.id}, ${n.ownerId}, ${n.read}, ${this.sql.json(n)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async list(ownerId: string): Promise<NotificationT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM notifications WHERE owner_id = ${ownerId} ORDER BY created_at DESC`;
    return rows.map((r) => Notification.parse(r.data));
  }

  async markRead(ownerId: string, id: string): Promise<void> {
    await this.sql`
      UPDATE notifications SET read = true, data = jsonb_set(data, '{read}', 'true')
      WHERE id = ${id} AND owner_id = ${ownerId}
    `;
  }
}
