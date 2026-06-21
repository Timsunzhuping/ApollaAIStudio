import { describe, it, expect } from 'vitest';
import type { Job, JobSpec } from '@apolla/contracts';
import { JobRunner } from './runner';
import { InMemoryJobRepository } from '../repo/memory';

const spec: JobSpec = { kind: 'research', input: { question: 'EVs' }, allowTools: [] };

describe('JobRunner', () => {
  it('runs a job in the background and persists a replayable run-log', async () => {
    const repo = new InMemoryJobRepository();
    let n = 0;
    const runner = new JobRunner({
      repo,
      idGen: () => `job-${n++}`,
      resolve: async function* () {
        yield { type: 'plan' };
        yield { type: 'delta', text: 'hi' };
        yield { type: 'done' };
      },
    });
    const { job, done } = await runner.start('u1', spec);
    expect(job.status).toBe('queued'); // returns immediately
    await done;

    const finished = await repo.get(job.id);
    expect(finished?.status).toBe('done');
    expect((await repo.events(job.id)).map((e: any) => e.type)).toEqual(['plan', 'delta', 'done']);
  });

  it('marks a job failed when the run throws, and fires onComplete', async () => {
    const repo = new InMemoryJobRepository();
    const completed: Job[] = [];
    const runner = new JobRunner({
      repo,
      idGen: () => 'jf',
      onComplete: (j) => {
        completed.push(j);
      },
      resolve: async function* () {
        yield { type: 'plan' };
        throw new Error('boom');
      },
    });
    const { job, done } = await runner.start('u1', spec);
    await done;
    expect((await repo.get(job.id))?.status).toBe('failed');
    expect(completed).toHaveLength(1);
    expect(completed[0]!.status).toBe('failed');
  });

  it('rejects a job (failed) when canRun denies — covers scheduler-triggered jobs (S5-T7)', async () => {
    const repo = new InMemoryJobRepository();
    let resolved = false;
    const runner = new JobRunner({
      repo,
      idGen: () => 'jq',
      canRun: async () => false,
      resolve: async function* () {
        resolved = true;
        yield { type: 'done' };
      },
    });
    const { job, done } = await runner.start('u1', spec);
    await done;
    expect(job.status).toBe('failed');
    expect((await repo.get('jq'))?.error).toContain('quota');
    expect(resolved).toBe(false); // the orchestrator never ran
  });

  it('isolates jobs by owner', async () => {
    const repo = new InMemoryJobRepository();
    let n = 0;
    const runner = new JobRunner({ repo, idGen: () => `j${n++}`, resolve: async function* () { yield { type: 'done' }; } });
    await (await runner.start('u1', spec)).done;
    await (await runner.start('u2', spec)).done;
    expect((await repo.list('u1')).length).toBe(1);
  });
});
