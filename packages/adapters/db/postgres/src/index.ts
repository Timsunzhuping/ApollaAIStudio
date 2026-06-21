import postgres from 'postgres';
import { Task } from '@apolla/contracts';
import type { Task as TaskT } from '@apolla/contracts';
import type { TaskRepository } from '@apolla/harness-core';

export type Sql = postgres.Sql;

export { PostgresUserRepository, PostgresProjectRepository, PostgresSkillRepository } from './repos';
export { PostgresMemory } from './memory';
export { PostgresMediaRepository } from './media';
export { PostgresConnectorRepository } from './connector';
export { PostgresAuditRepository } from './audit';
export { PostgresJobRepository } from './job';

/** Open a connection pool. Reads DATABASE_URL by default. */
export function createSql(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error('DATABASE_URL is not set');
  return postgres(url);
}

/** Idempotent schema migration (kept in sync with migrations/0001_init.sql). */
export const MIGRATION = `
CREATE TABLE IF NOT EXISTS tasks (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  project_id  text,
  type        text NOT NULL,
  state       text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner_id);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id);

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  email       text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id);

CREATE TABLE IF NOT EXISTS memory_items (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  kind        text NOT NULL DEFAULT 'note',
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  fts         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS memory_owner_idx ON memory_items (owner_id);
CREATE INDEX IF NOT EXISTS memory_fts_idx ON memory_items USING gin (fts);

CREATE TABLE IF NOT EXISTS user_model (
  owner_id    text PRIMARY KEY,
  data        jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  owner_id    text NOT NULL,
  name        text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, name)
);

CREATE TABLE IF NOT EXISTS media_tasks (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  project_id  text,
  status      text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media_tasks (owner_id);

CREATE TABLE IF NOT EXISTS connectors (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connectors_owner_idx ON connectors (owner_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  task_id     text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_owner_idx ON audit_log (owner_id);
CREATE INDEX IF NOT EXISTS audit_task_idx ON audit_log (task_id);

CREATE TABLE IF NOT EXISTS jobs (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  status      text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs (owner_id);

CREATE TABLE IF NOT EXISTS job_events (
  job_id  text NOT NULL,
  seq     bigserial,
  data    jsonb NOT NULL,
  PRIMARY KEY (job_id, seq)
);
`;

export async function migrate(sql: Sql): Promise<void> {
  // Advisory lock serializes concurrent migrators (parallel test workers) — CREATE TABLE
  // IF NOT EXISTS races on the type catalog otherwise.
  await sql`SELECT pg_advisory_lock(727274)`;
  try {
    await sql.unsafe(MIGRATION);
  } finally {
    await sql`SELECT pg_advisory_unlock(727274)`;
  }
}

/**
 * Postgres-backed TaskRepository. Implements the Sprint 01 Repository interface unchanged —
 * the orchestrator and BFF swap to this without code edits (ARCHITECTURE upgrade-by-swap).
 * The whole Task is stored as JSONB and re-validated through the contract schema on read.
 */
export class PostgresTaskRepository implements TaskRepository {
  constructor(private readonly sql: Sql) {}

  private async upsert(task: TaskT): Promise<void> {
    await this.sql`
      INSERT INTO tasks (id, owner_id, project_id, type, state, data, updated_at)
      VALUES (${task.id}, ${task.ownerId}, ${task.projectId ?? null}, ${task.type}, ${task.state}, ${this.sql.json(task)}, now())
      ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        project_id = EXCLUDED.project_id,
        type = EXCLUDED.type,
        state = EXCLUDED.state,
        data = EXCLUDED.data,
        updated_at = now()
    `;
  }

  async create(task: TaskT): Promise<TaskT> {
    await this.upsert(task);
    return Task.parse(task);
  }

  async save(task: TaskT): Promise<void> {
    await this.upsert(task);
  }

  async get(id: string): Promise<TaskT | undefined> {
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM tasks WHERE id = ${id}`;
    return rows[0] ? Task.parse(rows[0].data) : undefined;
  }

  async list(ownerId?: string): Promise<TaskT[]> {
    const rows = ownerId
      ? await this.sql<{ data: unknown }[]>`SELECT data FROM tasks WHERE owner_id = ${ownerId} ORDER BY created_at`
      : await this.sql<{ data: unknown }[]>`SELECT data FROM tasks ORDER BY created_at`;
    return rows.map((r) => Task.parse(r.data));
  }
}
