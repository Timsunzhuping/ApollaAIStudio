import { randomUUID } from 'node:crypto';
import type { Job, JobSpec } from '@apolla/contracts';
import type { JobRepository, JobResolver } from './types';

export interface JobRunnerDeps {
  repo: JobRepository;
  resolve: JobResolver;
  /** Called once a job reaches a terminal state (notifications hook, S5-T5). */
  onComplete?: (job: Job) => Promise<void> | void;
  /** Quota/eligibility gate — applies to ALL jobs incl. scheduler-triggered ones (S5-T7). */
  canRun?: (ownerId: string) => Promise<boolean> | boolean;
  idGen?: () => string;
}

/**
 * Background job runner (S5-T1): starts an orchestrator run detached from the HTTP request,
 * appends each event to a persisted run-log (so it can be replayed on reconnect), and drives the
 * job to a terminal state. start() returns immediately; `done` resolves when the run finishes.
 */
export class JobRunner {
  private readonly idGen: () => string;

  constructor(private readonly d: JobRunnerDeps) {
    this.idGen = d.idGen ?? (() => randomUUID());
  }

  async start(
    ownerId: string,
    spec: JobSpec,
    opts: { scheduledTaskId?: string } = {},
  ): Promise<{ job: Job; done: Promise<void> }> {
    const job: Job = {
      id: this.idGen(),
      ownerId,
      kind: spec.kind,
      input: spec.input,
      status: 'queued',
      scheduledTaskId: opts.scheduledTaskId,
    };
    await this.d.repo.create(job);
    // Quota/eligibility gate — also catches scheduler-triggered jobs that bypass the HTTP layer.
    if (this.d.canRun && !(await this.d.canRun(ownerId))) {
      job.status = 'failed';
      job.error = 'quota exceeded';
      await this.d.repo.save(job);
      await this.d.onComplete?.(job);
      return { job, done: Promise.resolve() };
    }
    // Mutate a copy in the background so the returned job stays a clean 'queued' snapshot.
    const done = this.runInBackground({ ...job }, spec);
    return { job, done };
  }

  private async runInBackground(job: Job, spec: JobSpec): Promise<void> {
    job.status = 'running';
    await this.d.repo.save(job);
    try {
      for await (const ev of this.d.resolve(job.ownerId, spec, job.id)) {
        await this.d.repo.appendEvent(job.id, ev);
      }
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
    }
    await this.d.repo.save(job);
    await this.d.onComplete?.(job);
  }
}
