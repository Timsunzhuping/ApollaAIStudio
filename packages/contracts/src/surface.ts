import { z } from 'zod';

/** What a surface consumes: free text, or an existing workspace document (read into the data channel). */
export const SurfaceInputKind = z.enum(['text', 'doc']);
export type SurfaceInputKind = z.infer<typeof SurfaceInputKind>;

export const SurfaceExecutor = z.enum(['translate', 'sheet', 'notes', 'generic']);
export type SurfaceExecutor = z.infer<typeof SurfaceExecutor>;

/**
 * A declarative text product surface (Sprint 08): a typed transform over text / workspace docs whose
 * output is written back into the workspace. New surface ≈ one config entry + executor — the
 * SurfaceRuntime reuses the Prompt Registry, Model Router, and Workspace (capability-as-config).
 */
export const Surface = z.object({
  id: z.string(),
  title: z.string().default(''),
  inputKind: SurfaceInputKind.default('text'),
  /** JSON-Schema-ish description of accepted params (e.g. targetLang). Informational + UI hints. */
  params: z.record(z.any()).default({}),
  promptRef: z.string(),
  /** Output file mime when written to the workspace. */
  outputMime: z.string().default('text/markdown'),
  executor: SurfaceExecutor.default('generic'),
});
export type Surface = z.infer<typeof Surface>;
