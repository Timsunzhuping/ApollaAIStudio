import { z } from 'zod';

/** Task state machine (ARCHITECTURE §3.9). The research flow walks plan→…→deliver→done. */
export const TaskState = z.enum([
  'plan',
  'search',
  'extract',
  'compare',
  'generate',
  'deliver',
  'done',
  'failed',
]);
export type TaskState = z.infer<typeof TaskState>;

export const TaskType = z.enum(['research', 'chat', 'translate', 'writer', 'sheet']);
export type TaskType = z.infer<typeof TaskType>;

/** A retrieved source. `trusted` is false for anything pulled from the open web/files. */
export const Source = z.object({
  id: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  trusted: z.boolean().default(false),
});
export type Source = z.infer<typeof Source>;

/** A claim with its backing sources — the unit checked by citation-correctness evals. */
export const Citation = z.object({
  claim: z.string(),
  sourceIds: z.array(z.string()).min(1),
});
export type Citation = z.infer<typeof Citation>;

export const Step = z.object({
  id: z.string(),
  state: TaskState,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  summary: z.string().optional(),
  costUsd: z.number().default(0),
});
export type Step = z.infer<typeof Step>;

export const Artifact = z.object({
  id: z.string(),
  type: z.enum(['report', 'slides', 'webpage', 'sheet']),
  format: z.enum(['markdown', 'html', 'pdf', 'xlsx']),
  uri: z.string().optional(),
  content: z.string().optional(),
});
export type Artifact = z.infer<typeof Artifact>;

/** The central object: observable, billable, replayable, archivable (ARCHITECTURE §3.9). */
export const Task = z.object({
  id: z.string(),
  type: TaskType,
  state: TaskState,
  ownerId: z.string(),
  projectId: z.string().optional(),
  question: z.string().optional(),
  steps: z.array(Step).default([]),
  sources: z.array(Source).default([]),
  citations: z.array(Citation).default([]),
  artifacts: z.array(Artifact).default([]),
  totalCostUsd: z.number().default(0),
  replayable: z.literal(true).default(true),
  createdAt: z.string().optional(),
});
export type Task = z.infer<typeof Task>;
