/** Delivery context for a consume attempt (drives retry/terminal decisions, S16-T5). */
export interface JobRunContext {
  attempt: number;
  maxAttempts: number;
}

/** Consumes a queued job (by id) and runs it to a terminal state. */
export type JobHandler = (jobId: string, ctx?: JobRunContext) => Promise<void>;

/**
 * Swappable execution substrate (S16): InProcess by default / Redis(BullMQ) in prod — the same
 * capability-as-config pattern as the LLM/media/search/payment/auth adapters. The web BFF only
 * `enqueue`s; a consumer (the web itself in-process, or a standalone worker) `process`es. Jobs are
 * persisted before enqueue, so the durable run-log + reconcile drive correctness, not the queue.
 */
export interface JobQueue {
  /** Whether jobs execute in this same process (web self-executes) vs. handed to a worker. */
  readonly inProcess: boolean;
  /** Hand a persisted (queued) job to the queue for execution. */
  enqueue(jobId: string): Promise<void>;
  /** Register the consumer. Call in the process that should execute jobs (web in-process / worker). */
  process(handler: JobHandler): void;
  /** Stop consuming / release resources. */
  close?(): Promise<void>;
}

/**
 * In-process queue: runs the handler detached in the same process (the Sprint 05 behavior). Default
 * and offline — root tests + e2e use this, no broker required. Buffers enqueues until a consumer is
 * registered; `idle()` awaits all in-flight runs (deterministic test/await hook).
 */
export class InProcessJobQueue implements JobQueue {
  readonly inProcess = true;
  private handler?: JobHandler;
  private readonly buffered: string[] = [];
  private readonly inflight = new Set<Promise<void>>();

  process(handler: JobHandler): void {
    this.handler = handler;
    const queued = this.buffered.splice(0);
    for (const id of queued) this.dispatch(id);
  }

  enqueue(jobId: string): Promise<void> {
    if (!this.handler) this.buffered.push(jobId);
    else this.dispatch(jobId);
    return Promise.resolve();
  }

  private dispatch(jobId: string): void {
    const p = Promise.resolve()
      .then(() => this.handler!(jobId))
      .catch(() => {}) // the handler persists terminal failure; never crash the process
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Await all in-flight runs (used by tests + graceful drain). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  /** Graceful drain: wait for in-flight runs to finish. */
  async close(): Promise<void> {
    await this.idle();
  }
}
