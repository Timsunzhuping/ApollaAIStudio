import type { WorkspaceFile, WorkspaceEntry } from '@apolla/contracts';

export interface WorkspaceWriteInput {
  ownerId: string;
  projectId?: string;
  path: string;
  content: string;
  mime?: string;
}

export interface WorkspaceScope {
  projectId?: string;
}

/**
 * Versioned, owner+project-scoped virtual filesystem (S7-T1). Writes are append-only: each write
 * to a path creates a new monotonic version. Paths are normalized + scope-checked at this layer too
 * (defense in depth — the tool layer also enforces).
 */
export interface WorkspaceRepository {
  /** Append a new version of `path`. Returns the written file (with its new version). */
  write(input: WorkspaceWriteInput): Promise<WorkspaceFile>;
  /** Read the latest version (or a specific one) of `path`, or undefined if absent. */
  read(ownerId: string, path: string, opts?: WorkspaceScope & { version?: number }): Promise<WorkspaceFile | undefined>;
  /** List the latest version of every file in the scope (the file tree). */
  list(ownerId: string, opts?: WorkspaceScope): Promise<WorkspaceEntry[]>;
  /** Full version history of `path`, oldest → newest. */
  history(ownerId: string, path: string, opts?: WorkspaceScope): Promise<WorkspaceFile[]>;
  /** Restore an old version by writing its content as a new version. Returns the new file. */
  rollback(ownerId: string, path: string, version: number, opts?: WorkspaceScope): Promise<WorkspaceFile>;
}
