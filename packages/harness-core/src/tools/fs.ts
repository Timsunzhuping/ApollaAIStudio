import type { ToolResult, UntrustedContent } from '@apolla/contracts';
import type { Tool, ToolContext } from './types';
import type { WorkspaceRepository } from '../workspace/types';
import { normalizeWorkspacePath } from '../workspace/path';

export interface WorkspaceToolScope {
  ownerId: string;
  projectId?: string;
}

const READ_SCHEMA = {
  type: 'object',
  properties: { path: { type: 'string' }, version: { type: 'integer', minimum: 1 } },
  required: ['path'],
  additionalProperties: false,
};
const WRITE_SCHEMA = {
  type: 'object',
  properties: { path: { type: 'string' }, content: { type: 'string' }, mime: { type: 'string' } },
  required: ['path', 'content'],
  additionalProperties: false,
};
const LIST_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

/** fs_read — read a workspace file's content into the UNTRUSTED data channel (risk=read). */
export class FsReadTool implements Tool {
  readonly name = 'fs_read';
  readonly risk = 'read' as const;
  readonly source = 'native' as const;
  readonly schema = READ_SCHEMA;
  constructor(private readonly repo: WorkspaceRepository, private readonly scope: WorkspaceToolScope) {}

  async invoke(args: { path?: string; version?: number }, _ctx?: ToolContext): Promise<ToolResult> {
    try {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const file = await this.repo.read(this.scope.ownerId, path, { projectId: this.scope.projectId, version: args.version });
      if (!file) return { ok: false, data: [], error: `no such file: ${path}` };
      const data: UntrustedContent[] = [{ kind: 'untrusted', sourceId: `workspace:${path}`, origin: `workspace:${path}@v${file.version}`, content: file.content }];
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** fs_list — list the workspace file tree (risk=read). */
export class FsListTool implements Tool {
  readonly name = 'fs_list';
  readonly risk = 'read' as const;
  readonly source = 'native' as const;
  readonly schema = LIST_SCHEMA;
  constructor(private readonly repo: WorkspaceRepository, private readonly scope: WorkspaceToolScope) {}

  async invoke(_args: unknown, _ctx?: ToolContext): Promise<ToolResult> {
    const entries = await this.repo.list(this.scope.ownerId, { projectId: this.scope.projectId });
    const listing = entries.map((e) => `${e.path} (v${e.version}, ${e.size}B)`).join('\n') || '(empty)';
    return { ok: true, data: [{ kind: 'untrusted', sourceId: 'workspace:listing', origin: 'workspace:/', content: listing }] };
  }
}

/** fs_write — write a new version of a workspace file (risk=low_write → needs confirm/allowlist). */
export class FsWriteTool implements Tool {
  readonly name = 'fs_write';
  readonly risk = 'low_write' as const;
  readonly source = 'native' as const;
  readonly schema = WRITE_SCHEMA;
  constructor(private readonly repo: WorkspaceRepository, private readonly scope: WorkspaceToolScope) {}

  async invoke(args: { path?: string; content?: string; mime?: string }, _ctx?: ToolContext): Promise<ToolResult> {
    try {
      const path = normalizeWorkspacePath(String(args.path ?? ''));
      const file = await this.repo.write({
        ownerId: this.scope.ownerId,
        projectId: this.scope.projectId,
        path,
        content: String(args.content ?? ''),
        mime: args.mime,
      });
      return { ok: true, data: [{ kind: 'untrusted', sourceId: `workspace:${path}`, origin: `workspace:${path}@v${file.version}`, content: `wrote ${path} v${file.version} (${file.size}B)` }] };
    } catch (e) {
      return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Build the workspace tool trio bound to one owner/project scope. */
export function makeWorkspaceTools(repo: WorkspaceRepository, scope: WorkspaceToolScope): Tool[] {
  return [new FsReadTool(repo, scope), new FsListTool(repo, scope), new FsWriteTool(repo, scope)];
}
