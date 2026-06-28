import { describe, it, expect } from 'vitest';
import type { JobSpec } from '@apolla/contracts';
import { JobRunner } from './runner';
import { InProcessJobQueue } from './queue';
import { InMemoryJobRepository } from '../repo/memory';

const spec: JobSpec = { kind: 'research', input: { question: 'EVs' }, allowTools: [] };

describe('JobQueue (S16)', () => {
  it('enqueue → consume runs the job and persists the log (decoupled producer)', async () => {
    const repo = new InMemoryJobRepository();
    const queue = new InProcessJobQueue();
    const runner = new JobRunner({
      repo,
      queue,
      idGen: () => 'jq1',
      resolve: async function* () { yield { type: 'plan' }; yield { type: 'done' }; },
    });
    queue.process((id) => runner.run(id)); // caller registers the consumer (web/worker)

    const { job } = await runner.start('u', spec);
    expect(job.status).toBe('queued'); // start only enqueues
    await queue.idle();
    expect((await repo.get('jq1'))?.status).toBe('done');
    expect((await repo.events('jq1')).map((e: any) => e.type)).toEqual(['plan', 'done']);
  });

  it('buffers enqueues until a consumer registers', async () => {
    const repo = new InMemoryJobRepository();
    const queue = new InProcessJobQueue();
    const runner = new JobRunner({ repo, queue, idGen: () => 'jb', resolve: async function* () { yield { type: 'done' }; } });
    await runner.start('u', spec); // enqueued before any consumer exists
    expect((await repo.get('jb'))?.status).toBe('queued');
    queue.process((id) => runner.run(id)); // draining the buffer
    await queue.idle();
    expect((await repo.get('jb'))?.status).toBe('done');
  });

  it('run() is idempotent — a redelivered/terminal job is not re-executed', async () => {
    const repo = new InMemoryJobRepository();
    const queue = new InProcessJobQueue();
    let runs = 0;
    const runner = new JobRunner({
      repo,
      queue,
      idGen: () => 'ji',
      resolve: async function* () { runs++; yield { type: 'done' }; },
    });
    queue.process((id) => runner.run(id));
    await runner.start('u', spec);
    await queue.idle();
    expect(runs).toBe(1);
    // Redeliver the same job id (simulating an at-least-once queue / reconcile race).
    await runner.run('ji');
    await runner.run('ji');
    expect(runs).toBe(1); // terminal → skipped, log not duplicated
    expect((await repo.events('ji')).length).toBe(1);
  });
});
