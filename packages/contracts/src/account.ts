import { z } from 'zod';

/**
 * A portable export of one user's data (S22). Permissive arrays (the data is heterogeneous) — the
 * envelope is validated; secrets are NEVER included. Import re-owns everything to the importing user.
 */
export const AccountBundle = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  email: z.string(),
  projects: z.array(z.record(z.any())).default([]),
  skills: z.array(z.record(z.any())).default([]),
  workspace: z.array(z.record(z.any())).default([]),
  schedules: z.array(z.record(z.any())).default([]),
  notifications: z.array(z.record(z.any())).default([]),
  plugins: z.array(z.record(z.any())).default([]),
  connectors: z.array(z.record(z.any())).default([]),
  tasks: z.array(z.record(z.any())).default([]),
  userModel: z.record(z.any()).nullable().default(null),
});
export type AccountBundle = z.infer<typeof AccountBundle>;
