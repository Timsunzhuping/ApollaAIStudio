import { AuditEntry, type AuditEntry as AuditEntryT } from '@apolla/contracts';
import type { AuditRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres AuditRepository — append-only audit of tool calls + verdicts (S4-T5). */
export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly sql: Sql) {}

  async record(entry: AuditEntryT): Promise<void> {
    await this.sql`
      INSERT INTO audit_log (id, owner_id, task_id, data)
      VALUES (${entry.id}, ${entry.ownerId}, ${entry.taskId}, ${this.sql.json(entry)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async list(ownerId: string, taskId?: string): Promise<AuditEntryT[]> {
    const rows = taskId
      ? await this.sql<{ data: unknown }[]>`SELECT data FROM audit_log WHERE owner_id = ${ownerId} AND task_id = ${taskId} ORDER BY created_at`
      : await this.sql<{ data: unknown }[]>`SELECT data FROM audit_log WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => AuditEntry.parse(r.data));
  }
}
