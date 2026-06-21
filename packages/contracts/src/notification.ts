import { z } from 'zod';

/** A user-facing notification (in-app feed; optionally delivered out-of-band) (PRD §5). */
export const Notification = z.object({
  id: z.string(),
  ownerId: z.string(),
  kind: z.enum(['job-done', 'job-failed']),
  title: z.string(),
  body: z.string().optional(),
  jobId: z.string().optional(),
  read: z.boolean().default(false),
  createdAt: z.string().optional(),
});
export type Notification = z.infer<typeof Notification>;
