import { describe, it, expect, afterEach } from 'vitest';
import type { Job, JobSpec } from '@apolla/contracts';
import { JobRunner } from './runner';
import { InProcessJobQueue } from './queue';
import { InMemoryJobRepository } from '../repo/memory';

const spec: JobSpec = { kind: 'research', input: {}, allowTools: [] };

describe('JobRunner reliability (S16-T5)', () => {
  afterEach(() => { delete process.env.JOB_TIMEOUT_MS; });

  it('retries with attempts then marks failed on the last attempt', async () => {
    const repo = new InMemoryJobRepository();
    const completed: Job[] = [];
    const runner = new JobRunner({
      repo,
      idGen: () => 'jr',
      queue: new InProcessJobQueue(), // caller-managed; we drive run() directly with attempt ctx
      onComplete: (j) => { completed.push(j); },
      resolve: async function* () { yield { type: 'plan' }; throw new Error('boom'); },
    });
    await runner.start('u', spec); // enqueued but no consumer registered → stays queued
    expect((await repo.get('jr'))?.status).toBe('queued');

    // attempt 1 of 3 → interrupted + rethrow (queue would back off + retry)
    await expect(runner.run('jr', { attempt: 1, maxAttempts: 3 })).rejects.toThrow('boom');
    expect((await repo.get('jr'))?.status).toBe('interrupted');
    expect(completed).toHaveLength(0);

    // last attempt → terminal failed + onComplete, no rethrow
    await runner.run('jr', { attempt: 3, maxAttempts: 3 });
    expect((await repo.get('jr'))?.status).toBe('failed');
    expect(completed).toHaveLength(1);
  });

  it('a clean retry resets the run-log (no duplicated events)', async () => {
    const repo = new InMemoryJobRepository();
    let attempt = 0;
    const runner = new JobRunner({
      repo,
      idGen: () => 'jc',
      queue: new InProcessJobQueue(),
      resolve: async function* () {
        attempt++;
        yield { type: 'plan' };
        if (attempt === 1) throw new Error('transient');
        yield { type: 'done' };
      },
    });
    await runner.start('u', spec);
    await expect(runner.run('jc', { attempt: 1, maxAttempts: 2 })).rejects.toThrow();
    await runner.run('jc', { attempt: 2, maxAttempts: 2 });
    expect((await repo.get('jc'))?.status).toBe('done');
    expect((await repo.events('jc')).map((e: any) => e.type)).toEqual(['plan', 'done']); // not plan,plan,done
  });

  it('fails a job that exceeds JOB_TIMEOUT_MS', async () => {
    process.env.JOB_TIMEOUT_MS = '50';
    const repo = new InMemoryJobRepository();
    const runner = new JobRunner({
      repo,
      idGen: () => 'jt',
      queue: new InProcessJobQueue(),
      resolve: async function* () {
        await new Promise((r) => { const t = setTimeout(r, 3000); (t as { unref?: () => void }).unref?.(); });
        yield { type: 'done' };
      },
    });
    await runner.start('u', spec);
    await runner.run('jt'); // default attempts → terminal
    const job = await repo.get('jt');
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('timeout');
  });

  it('enforces the quota gate on the worker path (run)', async () => {
    const repo = new InMemoryJobRepository();
    let ran = false;
    const runner = new JobRunner({
      repo,
      idGen: () => 'jq',
      queue: new InProcessJobQueue(),
      canRun: () => false,
      resolve: async function* () { ran = true; yield { type: 'done' }; },
    });
    await repo.create({ id: 'jq', ownerId: 'u', kind: 'research', input: {}, allowTools: [], status: 'queued' });
    await runner.run('jq');
    expect((await repo.get('jq'))?.error).toContain('quota');
    expect(ran).toBe(false);
  });
});
