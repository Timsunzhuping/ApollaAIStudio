import { z } from 'zod';

/**
 * Product events (S29): the single source of truth the north-star metric is derived from.
 * An "effective workflow" = a task that (1) reached delivered, (2) had any adoption action,
 * and (3) was not marked unusable — see PRD §9 (北极星) and docs/MVP plan §1.
 */
export const ProductEventType = z.enum([
  'user_registered',
  'task_submitted',
  'task_delivered',
  'task_failed',
  'artifact_adopted',
  'feedback_given',
]);
export type ProductEventType = z.infer<typeof ProductEventType>;

export const AdoptionType = z.enum(['export', 'save_workspace', 'share', 'save_skill', 'media', 'rerun']);
export type AdoptionType = z.infer<typeof AdoptionType>;

export const FeedbackVerdict = z.enum(['up', 'down', 'unusable']);
export type FeedbackVerdict = z.infer<typeof FeedbackVerdict>;

export const ProductEvent = z.object({
  id: z.string(),
  ownerId: z.string(),
  type: ProductEventType,
  taskId: z.string().optional(),
  /** For artifact_adopted. */
  adoption: AdoptionType.optional(),
  /** For feedback_given. */
  verdict: FeedbackVerdict.optional(),
  /** ISO timestamp — injected by the caller for deterministic tests. */
  at: z.string(),
});
export type ProductEvent = z.infer<typeof ProductEvent>;
