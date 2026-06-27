import { Job, type Job as JobT } from '@apolla/contracts';
import type { JobRepository } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres JobRepository — Job as JSONB + an ordered job_events run-log (S5-T1). */
export class PostgresJobRepository implements JobRepository {
  constructor(private readonly sql: Sql) {}

  async create(job: JobT): Promise<JobT> {
    await this.sql`
      INSERT INTO jobs (id, owner_id, status, data) VALUES (${job.id}, ${job.ownerId}, ${job.status}, ${this.sql.json(job)})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data
    `;
    return Job.parse(job);
  }

  async save(job: JobT): Promise<void> {
    await this.create(job);
  }

  async get(id: string): Promise<JobT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM jobs WHERE id = ${id}`;
    return rows[0] ? Job.parse(rows[0].data) : undefined;
  }

  async list(ownerId: string): Promise<JobT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM jobs WHERE owner_id = ${ownerId} ORDER BY created_at DESC`;
    return rows.map((r) => Job.parse(r.data));
  }

  async listNonTerminal(): Promise<JobT[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at`;
    return rows.map((r) => Job.parse(r.data));
  }

  async appendEvent(jobId: string, event: unknown): Promise<void> {
    await this.sql`INSERT INTO job_events (job_id, data) VALUES (${jobId}, ${this.sql.json(event as never)})`;
  }

  async events(jobId: string): Promise<unknown[]> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM job_events WHERE job_id = ${jobId} ORDER BY seq`;
    return rows.map((r) => r.data);
  }
}
