import { z } from 'zod';

/** A recalled memory item (cross-session, PRD §12.B). */
export const MemoryItem = z.object({
  id: z.string(),
  ownerId: z.string(),
  kind: z.enum(['note', 'fact']).default('note'),
  content: z.string(),
  createdAt: z.string().optional(),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

/** Structured user model — editable, user-visible writing/preference profile. */
export const UserModel = z.object({
  ownerId: z.string(),
  style: z.string().optional(),
  language: z.string().optional(),
  formats: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type UserModel = z.infer<typeof UserModel>;
