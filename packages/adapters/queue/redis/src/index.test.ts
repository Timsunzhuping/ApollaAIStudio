import { describe, it, expect } from 'vitest';
import type { JobSpec } from '@apolla/contracts';
import { JobRunner, InMemoryJobRepository } from '@apolla/harness-core';
import { RedisJobQueue } from './index';

const spec: JobSpec = { kind: 'research', input: { question: 'EVs' }, allowTools: [] };
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gated integration test: only runs when a real Redis is available (CI service / local compose).
// Offline (no REDIS_URL) it is skipped — the root suite stays hermetic.
const RUN = !!process.env.REDIS_URL;

describe.skipIf(!RUN)('RedisJobQueue (integration)', () => {
  it('enqueues a job id and the worker consumes it', async () => {
    const queueName = `test-${Date.now()}`;
    const producer = new RedisJobQueue({ queueName });
    const consumer = new RedisJobQueue({ queueName, concurrency: 1 });
    const seen: string[] = [];
    let resolveDone: () => void;
    const done = new Promise<void>((r) => { resolveDone = r; });
    consumer.process(async (jobId) => { seen.push(jobId); resolveDone(); });

    await producer.enqueue('job-xyz');
    await done;
    expect(seen).toEqual(['job-xyz']);

    await producer.close();
    await consumer.close();
  });

  it('web enqueues, worker consumes: the job runs to terminal over Redis (idempotent)', async () => {
    const queueName = `runner-${Date.now()}`;
    const repo = new InMemoryJobRepository(); // shared store (Postgres in prod) across both processes
    let runs = 0;
    // "Web": enqueue-only — never registers a consumer.
    const webQueue = new RedisJobQueue({ queueName });
    const web = new JobRunner({ repo, queue: webQueue, idGen: () => 'rj', resolve: async function* () { runs++; yield { type: 'done' }; } });
    // "Worker": separate runner on the same queue + store, registers the consumer.
    const workerQueue = new RedisJobQueue({ queueName, concurrency: 1 });
    const worker = new JobRunner({ repo, queue: workerQueue, resolve: async function* () { runs++; yield { type: 'done' }; } });
    workerQueue.process((id) => worker.run(id));

    const { job } = await web.start('u', spec);
    expect(job.status).toBe('queued'); // web only enqueued

    for (let i = 0; i < 50 && (await repo.get('rj'))?.status !== 'done'; i++) await settle(100);
    expect((await repo.get('rj'))?.status).toBe('done');
    expect(runs).toBe(1); // worker ran it exactly once
    expect((await repo.events('rj')).length).toBe(1);

    await webQueue.close();
    await workerQueue.close();
  });
});
