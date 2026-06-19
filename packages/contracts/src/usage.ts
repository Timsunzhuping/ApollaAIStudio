import { z } from 'zod';

/** One metered call (LLM / tool / media) for the Cost Ledger (ARCHITECTURE §3.11). */
export const UsageRecord = z.object({
  taskId: z.string().optional(),
  stepId: z.string().optional(),
  kind: z.enum(['llm', 'tool', 'media']),
  /** logical alias used, e.g. gpt_premium / claude_write / image_premium */
  alias: z.string().optional(),
  provider: z.string().optional(),
  tokensIn: z.number().nonnegative().default(0),
  tokensOut: z.number().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  cacheHit: z.boolean().default(false),
  at: z.string().optional(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;
