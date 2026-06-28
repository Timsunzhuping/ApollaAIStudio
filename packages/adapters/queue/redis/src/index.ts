import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { JobQueue, JobHandler } from '@apolla/harness-core';

// BullMQ bundles its own ioredis typings, so an IORedis instance needs a structural cast.
const asConnection = (c: IORedis): ConnectionOptions => c as unknown as ConnectionOptions;

export interface RedisJobQueueOptions {
  url?: string;
  queueName?: string;
  concurrency?: number;
  /** Max delivery attempts (BullMQ retries when the handler throws). */
  attempts?: number;
  /** Base delay (ms) for exponential backoff between attempts. */
  backoffMs?: number;
}

/**
 * Distributed durable job queue over BullMQ/Redis (env-gated by REDIS_URL) — the prod execution
 * substrate behind the JobQueue interface. The web `enqueue`s (by jobId, deduped); a worker process
 * `process`es. Durability/replay come from the persisted job + run-log (Postgres); Redis only carries
 * the "run this jobId" signal, so a lost message is recovered by reconcile re-enqueue.
 */
export class RedisJobQueue implements JobQueue {
  readonly inProcess = false;
  private readonly url: string;
  private readonly name: string;
  private readonly concurrency: number;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly conn: IORedis;
  private readonly queue: Queue;
  private worker?: Worker;
  private workerConn?: IORedis;

  constructor(opts: RedisJobQueueOptions = {}) {
    const url = opts.url ?? process.env.REDIS_URL;
    if (!url) throw new Error('RedisJobQueue requires a url (REDIS_URL)');
    this.url = url;
    this.name = opts.queueName ?? process.env.JOB_QUEUE_NAME ?? 'apolla-jobs';
    this.concurrency = opts.concurrency ?? Number(process.env.JOB_CONCURRENCY ?? 4);
    this.attempts = opts.attempts ?? Number(process.env.JOB_ATTEMPTS ?? 1);
    this.backoffMs = opts.backoffMs ?? Number(process.env.JOB_BACKOFF_MS ?? 2000);
    this.conn = new IORedis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(this.name, { connection: asConnection(this.conn) });
  }

  async enqueue(jobId: string): Promise<void> {
    await this.queue.add(
      'run',
      { jobId },
      {
        jobId, // dedupe: BullMQ ignores a duplicate add while a job with this id is active
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMs },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  process(handler: JobHandler): void {
    this.workerConn = new IORedis(this.url, { maxRetriesPerRequest: null });
    this.worker = new Worker(this.name, async (job) => handler(String(job.data.jobId)), {
      connection: asConnection(this.workerConn),
      concurrency: this.concurrency,
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.workerConn?.quit().catch(() => {});
    await this.conn.quit().catch(() => {});
  }
}
