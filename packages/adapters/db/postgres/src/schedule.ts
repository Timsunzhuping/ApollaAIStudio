import { ScheduledTask, type ScheduledTask as ScheduledTaskT } from '@apolla/contracts';
import type { ScheduledTaskRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres ScheduledTaskRepository — task as JSONB; enabled column for the scheduler scan. */
export class PostgresScheduledTaskRepository implements ScheduledTaskRepository {
  constructor(private readonly sql: Sql) {}

  async save(task: ScheduledTaskT): Promise<ScheduledTaskT> {
    await this.sql`
      INSERT INTO scheduled_tasks (id, owner_id, enabled, data)
      VALUES (${task.id}, ${task.ownerId}, ${task.enabled}, ${this.sql.json(task)})
      ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, data = EXCLUDED.data
    `;
    return ScheduledTask.parse(task);
  }

  async get(id: string): Promise<ScheduledTaskT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM scheduled_tasks WHERE id = ${id}`;
    return rows[0] ? ScheduledTask.parse(rows[0].data) : undefined;
  }

  async list(ownerId: string): Promise<ScheduledTaskT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM scheduled_tasks WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => ScheduledTask.parse(r.data));
  }

  async listEnabled(): Promise<ScheduledTaskT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM scheduled_tasks WHERE enabled = true`;
    return rows.map((r) => ScheduledTask.parse(r.data));
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.sql`DELETE FROM scheduled_tasks WHERE id = ${id} AND owner_id = ${ownerId}`;
  }
}
