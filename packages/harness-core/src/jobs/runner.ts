import { randomUUID } from 'node:crypto';
import type { Job, JobSpec } from '@apolla/contracts';
import type { JobRepository, JobResolver } from './types';
import { InProcessJobQueue, type JobQueue } from './queue';

export interface JobRunnerDeps {
  repo: JobRepository;
  resolve: JobResolver;
  /** Called once a job reaches a terminal state (notifications hook, S5-T5). */
  onComplete?: (job: Job) => Promise<void> | void;
  /** Quota/eligibility gate — applies to ALL jobs incl. scheduler-triggered ones (S5-T7). */
  canRun?: (ownerId: string) => Promise<boolean> | boolean;
  idGen?: () => string;
  /**
   * Execution substrate (S16). Omit → an internal InProcessJobQueue is created + the consumer is
   * auto-registered (standalone/test convenience). Pass one → the CALLER registers the consumer
   * (web in-process mode, or the worker), so the web can enqueue-only in distributed mode.
   */
  queue?: JobQueue;
}

/**
 * Background job runner (S5-T1, S16). `start()` persists a queued job, applies the quota gate, and
 * enqueues it; the queue's consumer calls `run(jobId)` to drive it to terminal state, appending each
 * orchestrator event to a persisted run-log (replayable on reconnect, across processes).
 */
export class JobRunner {
  private readonly idGen: () => string;
  readonly queue: JobQueue;

  constructor(private readonly d: JobRunnerDeps) {
    this.idGen = d.idGen ?? (() => randomUUID());
    this.queue = d.queue ?? new InProcessJobQueue();
    if (!d.queue) this.queue.process((id) => this.run(id)); // standalone: self-consume
  }

  async start(ownerId: string, spec: JobSpec, opts: { scheduledTaskId?: string } = {}): Promise<{ job: Job }> {
    const job: Job = {
      id: this.idGen(),
      ownerId,
      kind: spec.kind,
      input: spec.input,
      allowTools: spec.allowTools ?? [],
      status: 'queued',
      scheduledTaskId: opts.scheduledTaskId,
    };
    await this.d.repo.create(job);
    // Fast-fail quota gate so the HTTP caller / scheduler sees rejection synchronously.
    if (this.d.canRun && !(await this.d.canRun(ownerId))) {
      job.status = 'failed';
      job.error = 'quota exceeded';
      await this.d.repo.save(job);
      await this.d.onComplete?.(job);
      return { job };
    }
    await this.queue.enqueue(job.id); // persisted before enqueue → durable + reconcilable
    return { job };
  }

  /**
   * Execute a queued (or reconciled/interrupted) job to terminal state. Idempotent: a job that is
   * already running or terminal is skipped, so redelivery / reconcile re-enqueue never double-runs.
   */
  async run(jobId: string): Promise<void> {
    const job = await this.d.repo.get(jobId);
    if (!job) return;
    if (job.status !== 'queued' && job.status !== 'interrupted') return; // idempotent consume
    // Authoritative quota gate (covers worker/delayed execution, not just the start() fast-fail).
    if (this.d.canRun && !(await this.d.canRun(job.ownerId))) {
      job.status = 'failed';
      job.error = 'quota exceeded';
      await this.d.repo.save(job);
      await this.d.onComplete?.(job);
      return;
    }
    job.status = 'running';
    await this.d.repo.save(job);
    try {
      const spec: JobSpec = { kind: job.kind, input: job.input, allowTools: job.allowTools ?? [] };
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

  /** Await all in-flight in-process runs (tests + graceful drain). No-op for non-in-process queues. */
  async idle(): Promise<void> {
    if (this.queue instanceof InProcessJobQueue) await this.queue.idle();
  }
}
