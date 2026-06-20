import { z } from 'zod';

/** One audited action: a tool call with its Safety verdict, confirmation, and outcome (S4-T5). */
export const AuditEntry = z.object({
  id: z.string(),
  ownerId: z.string(),
  taskId: z.string(),
  tool: z.string(),
  risk: z.string(),
  decision: z.enum(['allow', 'confirm', 'deny']),
  /** For low_write (confirm) actions: whether the human approved. */
  confirmed: z.boolean().optional(),
  status: z.enum(['executed', 'denied', 'error']),
  summary: z.string().optional(),
  at: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
