import { z } from 'zod';
import { JobSpec } from './job';

/** A recurring task: a cron expression + the JobSpec to run when it fires (PRD §5). */
export const ScheduledTask = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string().default(''),
  /** 5-field cron (min hour dom month dow), evaluated in UTC. */
  cron: z.string(),
  jobSpec: JobSpec,
  enabled: z.boolean().default(true),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type ScheduledTask = z.infer<typeof ScheduledTask>;
