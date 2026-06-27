import type { Job, JobSpec } from '@apolla/contracts';

/** Persistence for background jobs + their replayable run-log (S5-T1). */
export interface JobRepository {
  create(job: Job): Promise<Job>;
  get(id: string): Promise<Job | undefined>;
  save(job: Job): Promise<void>;
  list(ownerId: string): Promise<Job[]>;
  /** All non-terminal jobs (queued/running) across owners — for startup reconciliation (S10-T6). */
  listNonTerminal(): Promise<Job[]>;
  /** Append one orchestrator event to the job's run-log (ordered). */
  appendEvent(jobId: string, event: unknown): Promise<void>;
  /** The run-log in order (for reconnect/replay). */
  events(jobId: string): Promise<unknown[]>;
}

/** Resolves a JobSpec to the orchestrator event stream that fulfills it (composition root). */
export type JobResolver = (ownerId: string, spec: JobSpec, jobId: string) => AsyncIterable<unknown>;
