import { z } from 'zod';

export const JobKind = z.enum(['research', 'agent', 'skill', 'media', 'cowork']);
export type JobKind = z.infer<typeof JobKind>;

export const JobStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type JobStatus = z.infer<typeof JobStatus>;

/** What to run in the background — kind + free-form input consumed by the resolver. */
export const JobSpec = z.object({
  kind: JobKind,
  input: z.record(z.any()).default({}),
  /** Pre-authorized low_write tools for background agent jobs (S5-T7). */
  allowTools: z.array(z.string()).default([]),
});
export type JobSpec = z.infer<typeof JobSpec>;

/** A background job — observable, replayable (via its run-log), owner-scoped (PRD §5). */
export const Job = z.object({
  id: z.string(),
  ownerId: z.string(),
  kind: JobKind,
  input: z.record(z.any()).default({}),
  status: JobStatus,
  error: z.string().optional(),
  scheduledTaskId: z.string().optional(),
  createdAt: z.string().optional(),
});
export type Job = z.infer<typeof Job>;
