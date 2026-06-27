import type { Surface } from '@apolla/contracts';
import type { ModelRouter } from '../router/router';
import type { PromptRegistry } from '../prompts/registry';

export interface SurfaceRunInput {
  ownerId: string;
  projectId?: string;
  surface: Surface;
  /** Raw text input (inputKind='text'). */
  text?: string;
  /** Source workspace doc path (inputKind='doc'). */
  sourcePath?: string;
  params?: Record<string, unknown>;
  /** Workspace path to write the result to. */
  outputPath: string;
  taskId?: string;
}

export type SurfaceEvent =
  | { type: 'input'; chars: number }
  | { type: 'delta'; text: string }
  | { type: 'structured'; data: unknown }
  | { type: 'written'; path: string; version: number }
  | { type: 'done'; path: string; version: number }
  | { type: 'error'; message: string };

/** Context handed to an executor: the resolved (untrusted) input + params + shared harness pieces. */
export interface SurfaceExecCtx {
  router: ModelRouter;
  prompts: PromptRegistry;
  surface: Surface;
  inputContent: string;
  params: Record<string, unknown>;
}

/** One chunk from an executor: a streaming delta, and/or the final content (+ optional structured payload). */
export type SurfaceChunk = { delta?: string; content?: string; structured?: unknown };

/** An executor turns input → output content. Must yield exactly one chunk carrying `content`. */
export type SurfaceExecutorFn = (ctx: SurfaceExecCtx) => AsyncIterable<SurfaceChunk>;
