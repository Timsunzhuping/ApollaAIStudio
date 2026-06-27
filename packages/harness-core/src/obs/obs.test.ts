import { describe, it, expect } from 'vitest';
import { Metrics } from './metrics';
import { reconcileJobs } from '../jobs/recovery';
import { InMemoryJobRepository } from '../repo/memory';
import type { Job } from '@apolla/contracts';

describe('Metrics', () => {
  it('counts and buckets latencies; snapshot is plain numbers', () => {
    const m = new Metrics();
    m.inc('http.requests');
    m.inc('http.requests', 2);
    m.observe(7);
    m.observe(9000);
    const snap = m.snapshot();
    expect(snap.counters['http.requests']).toBe(3);
    expect(snap.latency.count).toBe(2);
    expect(snap.latency.histogram.reduce((a, b) => a + b, 0)).toBe(2);
    expect(snap.latency.histogram[snap.latency.histogram.length - 1]).toBe(1); // 9000ms → overflow bucket
  });
});

describe('reconcileJobs (S10-T6)', () => {
  const job = (id: string, status: Job['status']): Job => ({ id, ownerId: 'u', kind: 'research', input: {}, status });

  it('marks queued/running jobs interrupted and leaves terminal ones alone', async () => {
    const repo = new InMemoryJobRepository();
    await repo.create(job('a', 'running'));
    await repo.create(job('b', 'queued'));
    await repo.create(job('c', 'done'));
    const interrupted: string[] = [];
    const n = await reconcileJobs(repo, { onInterrupted: (j) => { interrupted.push(j.id); } });
    expect(n).toBe(2);
    expect(interrupted.sort()).toEqual(['a', 'b']);
    expect((await repo.get('a'))?.status).toBe('interrupted');
    expect((await repo.get('b'))?.status).toBe('interrupted');
    expect((await repo.get('c'))?.status).toBe('done');
  });
});
