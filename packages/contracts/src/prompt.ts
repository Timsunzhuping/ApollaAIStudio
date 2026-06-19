import { z } from 'zod';

/**
 * A versioned prompt. Prompts are declarative assets in the Prompt Registry — never inlined
 * in business code (ARCHITECTURE §3.3). `inputSchema`/`outputSchema` are JSON Schema objects.
 */
export const PromptVersion = z.object({
  promptId: z.string(),
  version: z.string(),
  scene: z.string(),
  template: z.string(),
  inputSchema: z.record(z.any()).optional(),
  outputSchema: z.record(z.any()).optional(),
  safetyConstraints: z.array(z.string()).default([]),
  evalSet: z.string().optional(),
  rollout: z.number().min(0).max(1).default(1),
  rollbackTo: z.string().optional(),
});
export type PromptVersion = z.infer<typeof PromptVersion>;
