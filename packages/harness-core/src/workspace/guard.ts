import { randomUUID } from 'node:crypto';
import type { AuditEntry, WorkspaceFile, WorkspaceEntry } from '@apolla/contracts';
import { normalizeWorkspacePath, PathError } from './path';
import type { WorkspaceRepository, WorkspaceWriteInput, WorkspaceScope } from './types';

export interface WorkspaceGuardLimits {
  /** Max distinct file paths per owner+project scope. */
  maxFiles: number;
  /** Max total bytes (latest versions) per owner+project scope. */
  maxBytes: number;
}

export interface WorkspaceGuardDeps {
  base: WorkspaceRepository;
  limits?: Partial<WorkspaceGuardLimits>;
  audit?: (entry: AuditEntry) => Promise<void> | void;
}

const DEFAULTS: WorkspaceGuardLimits = { maxFiles: 200, maxBytes: 5_000_000 };

/**
 * Wraps a WorkspaceRepository with quota enforcement + write auditing (S7-T6). Every write —
 * including a traversal rejection — is recorded to the audit sink; writes that would exceed the
 * per-scope file-count or byte quota are denied. Reads/list/history are delegated unchanged.
 */
export class GuardedWorkspaceRepository implements WorkspaceRepository {
  private readonly limits: WorkspaceGuardLimits;
  constructor(private readonly d: WorkspaceGuardDeps) {
    this.limits = { ...DEFAULTS, ...d.limits };
  }

  private async audit(ownerId: string, status: AuditEntry['status'], summary: string): Promise<void> {
    await this.d.audit?.({
      id: randomUUID(),
      ownerId,
      taskId: 'workspace',
      tool: 'fs_write',
      risk: 'low_write',
      decision: status === 'denied' ? 'deny' : 'allow',
      status,
      summary,
    });
  }

  async write(input: WorkspaceWriteInput): Promise<WorkspaceFile> {
    let path: string;
    try {
      path = normalizeWorkspacePath(input.path);
    } catch (e) {
      await this.audit(input.ownerId, 'denied', `rejected path: ${input.path}`);
      throw e instanceof PathError ? e : new PathError(String(e));
    }
    const entries = await this.d.base.list(input.ownerId, { projectId: input.projectId });
    const existing = entries.find((e) => e.path === path);
    const newSize = Buffer.byteLength(input.content, 'utf8');
    if (!existing && entries.length >= this.limits.maxFiles) {
      await this.audit(input.ownerId, 'denied', `file quota (${this.limits.maxFiles}) reached`);
      throw new Error(`workspace file quota reached (${this.limits.maxFiles} files)`);
    }
    const projected = entries.reduce((s, e) => s + e.size, 0) - (existing?.size ?? 0) + newSize;
    if (projected > this.limits.maxBytes) {
      await this.audit(input.ownerId, 'denied', `byte quota (${this.limits.maxBytes}) exceeded`);
      throw new Error(`workspace byte quota exceeded (${this.limits.maxBytes} bytes)`);
    }
    const file = await this.d.base.write({ ...input, path });
    await this.audit(input.ownerId, 'executed', `wrote ${path} v${file.version}`);
    return file;
  }

  read(ownerId: string, path: string, opts?: WorkspaceScope & { version?: number }): Promise<WorkspaceFile | undefined> {
    return this.d.base.read(ownerId, path, opts);
  }
  list(ownerId: string, opts?: WorkspaceScope): Promise<WorkspaceEntry[]> {
    return this.d.base.list(ownerId, opts);
  }
  history(ownerId: string, path: string, opts?: WorkspaceScope): Promise<WorkspaceFile[]> {
    return this.d.base.history(ownerId, path, opts);
  }
  async rollback(ownerId: string, path: string, version: number, opts?: WorkspaceScope): Promise<WorkspaceFile> {
    const old = await this.d.base.read(ownerId, path, { ...opts, version });
    if (!old) throw new Error(`no version ${version} of "${path}"`);
    return this.write({ ownerId, projectId: opts?.projectId, path, content: old.content, mime: old.mime });
  }
}
