import { randomUUID } from 'node:crypto';
import { WorkspaceFile, type WorkspaceFile as WorkspaceFileT, type WorkspaceEntry } from '@apolla/contracts';
import type { WorkspaceRepository, WorkspaceWriteInput, WorkspaceScope } from '@apolla/harness-core';
import { normalizeWorkspacePath } from '@apolla/harness-core';
import type { Sql } from './index';

/** Postgres versioned WorkspaceRepository — one row per (owner, project, path, version) (S7-T1). */
export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly sql: Sql) {}

  async write(input: WorkspaceWriteInput): Promise<WorkspaceFileT> {
    const path = normalizeWorkspacePath(input.path);
    const proj = input.projectId ?? '';
    const content = input.content;
    const size = Buffer.byteLength(content, 'utf8');
    const mime = input.mime ?? 'text/markdown';
    const id = randomUUID();
    // Append a new version: next version = max(existing) + 1. The CTE always yields exactly one
    // row (aggregate, no GROUP BY) so the very first write inserts correctly too.
    const rows = await this.sql<{ data: unknown }[]>`
      WITH nextv AS (
        SELECT COALESCE(MAX(version), 0) + 1 AS v
          FROM workspace_files WHERE owner_id = ${input.ownerId} AND project_id = ${proj} AND path = ${path}
      )
      INSERT INTO workspace_files (owner_id, project_id, path, version, data)
      SELECT ${input.ownerId}, ${proj}, ${path}, nextv.v,
             jsonb_build_object('id', ${id}::text, 'ownerId', ${input.ownerId}::text,
               'projectId', ${input.projectId ?? null}::text, 'path', ${path}::text, 'mime', ${mime}::text,
               'version', nextv.v, 'size', ${size}::int, 'content', ${content}::text)
        FROM nextv
      RETURNING data
    `;
    return WorkspaceFile.parse(rows[0]!.data);
  }

  async read(ownerId: string, path: string, opts?: WorkspaceScope & { version?: number }): Promise<WorkspaceFileT | undefined> {
    const p = normalizeWorkspacePath(path);
    const proj = opts?.projectId ?? '';
    const rows = opts?.version
      ? await this.sql<{ data: unknown }[]>`SELECT data FROM workspace_files WHERE owner_id = ${ownerId} AND project_id = ${proj} AND path = ${p} AND version = ${opts.version}`
      : await this.sql<{ data: unknown }[]>`SELECT data FROM workspace_files WHERE owner_id = ${ownerId} AND project_id = ${proj} AND path = ${p} ORDER BY version DESC LIMIT 1`;
    return rows[0] ? WorkspaceFile.parse(rows[0].data) : undefined;
  }

  async list(ownerId: string, opts?: WorkspaceScope): Promise<WorkspaceEntry[]> {
    const proj = opts?.projectId ?? '';
    const rows = await this.sql<{ data: unknown }[]>`
      SELECT DISTINCT ON (path) data FROM workspace_files
      WHERE owner_id = ${ownerId} AND project_id = ${proj}
      ORDER BY path, version DESC
    `;
    return rows
      .map((r) => WorkspaceFile.parse(r.data))
      .map((f) => ({ path: f.path, mime: f.mime, version: f.version, size: f.size, updatedAt: f.createdAt }));
  }

  async history(ownerId: string, path: string, opts?: WorkspaceScope): Promise<WorkspaceFileT[]> {
    const p = normalizeWorkspacePath(path);
    const proj = opts?.projectId ?? '';
    const rows = await this.sql<{ data: unknown }[]>`SELECT data FROM workspace_files WHERE owner_id = ${ownerId} AND project_id = ${proj} AND path = ${p} ORDER BY version`;
    return rows.map((r) => WorkspaceFile.parse(r.data));
  }

  async rollback(ownerId: string, path: string, version: number, opts?: WorkspaceScope): Promise<WorkspaceFileT> {
    const old = await this.read(ownerId, path, { ...opts, version });
    if (!old) throw new Error(`no version ${version} of "${path}"`);
    return this.write({ ownerId, projectId: opts?.projectId, path, content: old.content, mime: old.mime });
  }
}
