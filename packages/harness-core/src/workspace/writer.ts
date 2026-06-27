import { randomUUID } from 'node:crypto';
import type { ModelAlias } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';
import { assembleRequest } from '../safety/untrusted';
import type { WorkspaceRepository } from './types';

export interface WriterDeps {
  router: ModelRouter;
  prompts: PromptRegistry;
  workspace: WorkspaceRepository;
  alias?: ModelAlias;
}

export interface WriterInput {
  ownerId: string;
  projectId?: string;
  path: string;
  instruction: string;
  taskId?: string;
}

export type WriterEvent =
  | { type: 'read'; path: string; version: number }
  | { type: 'delta'; text: string }
  | { type: 'written'; path: string; version: number }
  | { type: 'done'; path: string; version: number }
  | { type: 'error'; message: string };

/**
 * Writer (S7-T3): AI-edit a workspace document into a NEW version. Reads the current version into
 * the untrusted data channel, applies the instruction via the model, writes the result as v+1.
 * The old version is preserved (workspace is append-only → editable + reversible).
 */
export class WriterOrchestrator {
  constructor(private readonly d: WriterDeps) {}

  async *run(input: WriterInput): AsyncIterable<WriterEvent> {
    const alias = this.d.alias ?? 'claude_write';
    try {
      const current = await this.d.workspace.read(input.ownerId, input.path, { projectId: input.projectId });
      if (!current) {
        yield { type: 'error', message: `no such file: ${input.path}` };
        return;
      }
      yield { type: 'read', path: current.path, version: current.version };

      const system = this.d.prompts.render('writer.edit').text;
      const req = assembleRequest({
        system,
        user: input.instruction,
        data: [{ kind: 'untrusted', sourceId: `workspace:${current.path}`, origin: `workspace:${current.path}@v${current.version}`, content: current.content }],
      });
      let edited = '';
      for await (const chunk of this.d.router.complete(alias, req)) {
        edited += chunk.delta;
        yield { type: 'delta', text: chunk.delta };
      }

      const written = await this.d.workspace.write({
        ownerId: input.ownerId,
        projectId: input.projectId,
        path: current.path,
        content: edited.trim() || current.content,
        mime: current.mime,
      });
      yield { type: 'written', path: written.path, version: written.version };
      yield { type: 'done', path: written.path, version: written.version };
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Stable id helper for callers that need a taskId. */
export const writerTaskId = (): string => randomUUID();
