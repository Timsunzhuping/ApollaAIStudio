import { randomUUID } from 'node:crypto';
import type { Job, JobSpec } from '@apolla/contracts';
import type { JobRepository, JobResolver } from './types';
import { InProcessJobQueue, type JobQueue, type JobRunContext } from './queue';
import { NoopTracer, formatTraceparent, type Tracer } from '../obs/tracer';
import { tracedGen, currentSpanContext } from '../obs/context';

const ZERO_TRACE = '0'.repeat(32);

/** W3C traceparent for the enclosing span context, or undefined when not tracing. */
function traceparentOf(ctx: { traceId: string; spanId: string } | undefined): string | undefined {
  return ctx && ctx.traceId !== ZERO_TRACE ? formatTraceparent(ctx) : undefined;
}

export interface JobRunnerDeps {
  repo: JobRepository;
  resolve: JobResolver;
  /** Called once a job reaches a terminal state (notifications hook, S5-T5). */
  onComplete?: (job: Job) => Promise<void> | void;
  /** Quota/eligibility gate — applies to ALL jobs incl. scheduler-triggered ones (S5-T7). */
  canRun?: (ownerId: string) => Promise<boolean> | boolean;
  idGen?: () => string;
  /** Tracer for the job.run span + cross-process trace continuation (S17). Defaults to Noop. */
  tracer?: Tracer;
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
  private readonly tracer: Tracer;
  readonly queue: JobQueue;

  constructor(private readonly d: JobRunnerDeps) {
    this.idGen = d.idGen ?? (() => randomUUID());
    this.tracer = d.tracer ?? new NoopTracer();
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
      // Capture the enclosing trace (e.g. the HTTP request span) so the worker continues it (S17).
      traceparent: traceparentOf(currentSpanContext()),
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
   * On failure with attempts remaining (`ctx.maxAttempts > 1`, Redis path) it resets the job to
   * `interrupted` + re-throws so the queue retries with backoff; the last attempt marks `failed`.
   */
  async run(jobId: string, ctx: JobRunContext = { attempt: 1, maxAttempts: 1 }): Promise<void> {
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
    // A retry (re-enqueued interrupted job) re-emits from the start — drop the partial run-log first.
    if (job.status === 'interrupted') await this.d.repo.clearEvents(job.id);
    job.status = 'running';
    await this.d.repo.save(job);
    try {
      const spec: JobSpec = { kind: job.kind, input: job.input, allowTools: job.allowTools ?? [] };
      // job.run span continues the originating trace (web → worker); orchestrator/LLM spans nest.
      const parent = this.tracer.extract(job.traceparent);
      const events = tracedGen(this.tracer, 'job.run', () => this.d.resolve(job.ownerId, spec, job.id), {
        parent,
        attributes: { kind: job.kind, jobId: job.id },
      });
      await this.withTimeout(
        (async () => {
          for await (const ev of events) await this.d.repo.appendEvent(job.id, ev);
        })(),
      );
      job.status = 'done';
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (ctx.attempt < ctx.maxAttempts) {
        // Leave it re-runnable + signal the queue to retry with backoff.
        job.status = 'interrupted';
        job.error = message;
        await this.d.repo.save(job);
        throw e;
      }
      job.status = 'failed';
      job.error = message;
    }
    await this.d.repo.save(job);
    await this.d.onComplete?.(job);
  }

  /** Optional wall-clock cap on a job run (JOB_TIMEOUT_MS, 0 = off). The orchestrator can't be
   * cancelled, but the job is marked failed/retried so it never hangs the queue. */
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    const ms = Number(process.env.JOB_TIMEOUT_MS ?? 0);
    if (!ms) return work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('job timeout')), ms);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Await all in-flight in-process runs (tests + graceful drain). No-op for non-in-process queues. */
  async idle(): Promise<void> {
    if (this.queue instanceof InProcessJobQueue) await this.queue.idle();
  }
}
