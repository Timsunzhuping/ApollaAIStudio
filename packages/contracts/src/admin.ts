import { z } from 'zod';

/** Site-wide operational counters (S23). Aggregate only — never per-user private content. */
export const AdminStats = z.object({
  users: z.number(),
  projects: z.number(),
  tasks: z.number(),
  jobs: z.record(z.number()), // status → count
  subscriptions: z.record(z.number()), // plan → count
});
export type AdminStats = z.infer<typeof AdminStats>;

/** One user row in the operator console — metadata + plan only, no content. */
export const AdminUserRow = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string(),
  plan: z.string().nullable(),
  projects: z.number(),
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;

export const AdminUserDetail = AdminUserRow.extend({
  tasks: z.number(),
  jobs: z.number(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** A redacted audit row for the operator console (operational metadata only). */
export const AdminAuditRow = z.object({
  id: z.string(),
  ownerId: z.string(),
  tool: z.string(),
  risk: z.string(),
  decision: z.string(),
  status: z.string(),
  summary: z.string(),
  createdAt: z.string(),
});
export type AdminAuditRow = z.infer<typeof AdminAuditRow>;
