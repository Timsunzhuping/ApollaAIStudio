import { MediaTask, type MediaTask as MediaTaskT } from '@apolla/contracts';
import type { MediaRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres MediaRepository — MediaTask as JSONB + indexed owner column (S3-T4). */
export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly sql: Sql) {}

  private async upsert(task: MediaTaskT): Promise<void> {
    await this.sql`
      INSERT INTO media_tasks (id, owner_id, project_id, status, data)
      VALUES (${task.id}, ${task.ownerId}, ${task.projectId ?? null}, ${task.status}, ${this.sql.json(task)})
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id, status = EXCLUDED.status, data = EXCLUDED.data
    `;
  }

  async create(task: MediaTaskT): Promise<MediaTaskT> {
    await this.upsert(task);
    return MediaTask.parse(task);
  }

  async save(task: MediaTaskT): Promise<void> {
    await this.upsert(task);
  }

  async get(id: string): Promise<MediaTaskT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM media_tasks WHERE id = ${id}`;
    return rows[0] ? MediaTask.parse(rows[0].data) : undefined;
  }

  async list(ownerId: string): Promise<MediaTaskT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM media_tasks WHERE owner_id = ${ownerId} ORDER BY created_at`;
    return rows.map((r) => MediaTask.parse(r.data));
  }
}
