import type { TaskState, Source, Snippet, Citation, Artifact } from '@apolla/contracts';

export interface PlanSketch {
  subquestions: string[];
}

export interface Estimate {
  seconds: number;
}

/** Streamed by Orchestrator.run(). The UI (T13) renders the task trace from these. */
export type TaskEvent =
  | { type: 'plan'; plan: PlanSketch; estimate: Estimate }
  | { type: 'step-start'; state: TaskState; stepId: string }
  | { type: 'step-end'; state: TaskState; stepId: string; summary?: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'snippets'; snippets: Snippet[] }
  | { type: 'delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'cost'; totalUsd: number }
  | { type: 'done'; taskId: string }
  | { type: 'error'; message: string };
