import { z } from 'zod';
import { RiskLevel } from './common';

/**
 * A Skill = declarative Markdown (frontmatter) compatible with the agentskills.io standard.
 * Managed alongside the Prompt Registry; can be auto-drafted after high-quality tasks
 * (closed learning loop, PRD §12.A). `promptRef` points at a PromptVersion id.
 */
export const SkillDef = z.object({
  name: z.string(),
  triggers: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  io: z
    .object({
      input: z.record(z.any()).optional(),
      output: z.record(z.any()).optional(),
    })
    .default({}),
  risk: RiskLevel.default('read'),
  promptRef: z.string(),
});
export type SkillDef = z.infer<typeof SkillDef>;
