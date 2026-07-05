import { z } from 'zod';
import { LLMMessage } from './model';

/**
 * Unified chat (S28 / PRD §6.1): a lightweight conversation surface next to research.
 * Messages are stored on the conversation (jsonb) — one record per thread, MVP scale.
 */
export const ChatMode = z.enum(['auto', 'gpt', 'claude']);
export type ChatMode = z.infer<typeof ChatMode>;

export const Conversation = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  messages: z.array(LLMMessage).default([]),
  /** True once the transcript has been auto-compacted at least once (PRD §12.F). */
  compacted: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;
