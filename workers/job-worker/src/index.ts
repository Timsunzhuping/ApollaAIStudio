import { buildHarness } from '@apolla/bff/harness';
import { reconcileJobs } from '@apolla/harness-core';

/**
 * Standalone job worker (S16). In distributed mode (REDIS_URL set) the web BFF only enqueues; this
 * process consumes the shared queue, executes jobs to terminal state, and owns the cron scheduler
 * (single point — no double-ticking across web instances). In the default in-process mode the web
 * self-executes, so this worker is only meaningful with a shared (Redis) queue.
 */
async function main(): Promise<void> {
  const h = await buildHarness();

  // Own execution: consume the queue.
  h.jobQueue.process((id) => h.jobs.run(id));

  // Durable recovery: grab jobs left non-terminal by a prior crash/deploy, reconcile (running →
  // interrupted), then re-enqueue them — run()'s idempotency guard re-executes queued/interrupted only.
  const pending = await h.jobRepo.listNonTerminal().catch(() => []);
  const interrupted = await reconcileJobs(h.jobRepo).catch(() => 0);
  for (const job of pending) await h.jobQueue.enqueue(job.id).catch(() => {});

  // Own scheduling: tick the cron here (single point in distributed deployments).
  const cron = setInterval(() => {
    h.scheduler.tick(new Date()).catch(() => {});
  }, 30_000);

  console.log(`[job-worker] ready (${interrupted} interrupted re-queued, persistence=${h.persistence}, queue=${h.jobQueue.inProcess ? 'in-process' : 'distributed'})`);

  const shutdown = (): void => {
    clearInterval(cron);
    void h.jobQueue.close?.();
    void h.close?.().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref(); // hard cap if in-flight lingers
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
