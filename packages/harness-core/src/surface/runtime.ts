import { randomUUID } from 'node:crypto';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';
import type { WorkspaceRepository } from '../workspace/types';
import type { SurfaceRunInput, SurfaceEvent, SurfaceExecutorFn } from './types';

export interface SurfaceRuntimeDeps {
  router: ModelRouter;
  prompts: PromptRegistry;
  workspace: WorkspaceRepository;
}

/**
 * SurfaceRuntime (S8-T1): resolves a surface's input (raw text or a workspace doc → untrusted data
 * channel), dispatches to the executor registered for `surface.executor`, then writes the output
 * back into the workspace (versioned/audited/quota'd via the injected GuardedWorkspaceRepository).
 * Adding a surface = a config entry + an executor — no new plumbing (capability-as-config).
 */
export class SurfaceRuntime {
  private readonly executors = new Map<string, SurfaceExecutorFn>();
  constructor(private readonly d: SurfaceRuntimeDeps) {}

  registerExecutor(kind: string, fn: SurfaceExecutorFn): this {
    this.executors.set(kind, fn);
    return this;
  }

  async *run(input: SurfaceRunInput): AsyncIterable<SurfaceEvent> {
    try {
      // Resolve input content. A doc input is read from the workspace and treated as UNTRUSTED data.
      let inputContent = input.text ?? '';
      if (input.surface.inputKind === 'doc') {
        if (!input.sourcePath) {
          yield { type: 'error', message: 'a source document path is required' };
          return;
        }
        const src = await this.d.workspace.read(input.ownerId, input.sourcePath, { projectId: input.projectId });
        if (!src) {
          yield { type: 'error', message: `no such file: ${input.sourcePath}` };
          return;
        }
        inputContent = src.content;
      }
      yield { type: 'input', chars: inputContent.length };

      const exec = this.executors.get(input.surface.executor);
      if (!exec) {
        yield { type: 'error', message: `no executor for surface "${input.surface.id}" (${input.surface.executor})` };
        return;
      }

      let content: string | undefined;
      let structured: unknown;
      for await (const chunk of exec({ router: this.d.router, prompts: this.d.prompts, surface: input.surface, inputContent, params: input.params ?? {} })) {
        if (chunk.delta !== undefined) yield { type: 'delta', text: chunk.delta };
        if (chunk.content !== undefined) {
          content = chunk.content;
          structured = chunk.structured;
        }
      }
      if (content === undefined) {
        yield { type: 'error', message: 'surface produced no output' };
        return;
      }
      if (structured !== undefined) yield { type: 'structured', data: structured };

      const file = await this.d.workspace.write({ ownerId: input.ownerId, projectId: input.projectId, path: input.outputPath, content, mime: input.surface.outputMime });
      yield { type: 'written', path: file.path, version: file.version };
      yield { type: 'done', path: file.path, version: file.version };
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Stable id helper for callers that need a taskId. */
export const surfaceTaskId = (): string => randomUUID();
