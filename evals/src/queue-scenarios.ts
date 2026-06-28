import type { JobSpec } from '@apolla/contracts';
import { JobRunner, InProcessJobQueue, InMemoryJobRepository } from '@apolla/harness-core';
import type { CheckResult } from './checks';

const spec: JobSpec = { kind: 'research', input: { question: 'EVs' }, allowTools: [] };

/**
 * Job queue (S16): a persisted job is enqueued by the producer, consumed to terminal state by the
 * registered consumer, and its run-log is replayable — and redelivery is idempotent. Fully offline
 * (InProcessJobQueue), mirroring the distributed web-enqueue → worker-consume contract.
 */
export async function jobQueueLifecycle(): Promise<CheckResult> {
  const issues: string[] = [];
  const repo = new InMemoryJobRepository();
  const queue = new InProcessJobQueue();
  let runs = 0;
  const runner = new JobRunner({
    repo,
    queue,
    idGen: () => 'eval-job',
    resolve: async function* () { runs++; yield { type: 'plan' }; yield { type: 'done' }; },
  });
  queue.process((id) => runner.run(id)); // consumer (web in-process / worker)

  const { job } = await runner.start('u', spec);
  if (job.status !== 'queued') issues.push('start() should only enqueue (queued)');
  await queue.idle();

  if ((await repo.get('eval-job'))?.status !== 'done') issues.push('job did not reach done');
  const events = (await repo.events('eval-job')).map((e) => (e as { type: string }).type);
  if (events.join(',') !== 'plan,done') issues.push(`unexpected run-log: ${events.join(',')}`);

  // Redelivery / reconcile race must not re-run a terminal job.
  await runner.run('eval-job');
  if (runs !== 1) issues.push('terminal job was re-executed (not idempotent)');

  return { name: 'job-queue-lifecycle', ok: issues.length === 0, issues };
}

export async function runQueueScenarios(): Promise<CheckResult[]> {
  return [await jobQueueLifecycle()];
}
