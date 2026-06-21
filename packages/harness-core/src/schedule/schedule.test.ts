import { describe, it, expect } from 'vitest';
import type { ScheduledTask } from '@apolla/contracts';
import { cronMatches, nextRun } from './cron';
import { Scheduler } from './scheduler';
import { InMemoryScheduledTaskRepository } from '../repo/memory';

describe('cron', () => {
  it('matches *, lists, ranges, and steps (UTC)', () => {
    const d = new Date('2026-06-21T08:30:00Z'); // Sun, 08:30 UTC
    expect(cronMatches('30 8 * * *', d)).toBe(true);
    expect(cronMatches('* * * * *', d)).toBe(true);
    expect(cronMatches('0 8 * * *', d)).toBe(false);
    expect(cronMatches('30 8 * * 0', d)).toBe(true); // Sunday
    expect(cronMatches('30 6-9 * * *', d)).toBe(true);
    expect(cronMatches('*/15 * * * *', d)).toBe(true); // 30 is a multiple of 15
    expect(cronMatches('*/15 * * * *', new Date('2026-06-21T08:31:00Z'))).toBe(false);
  });

  it('computes the next run strictly after a time', () => {
    const next = nextRun('0 9 * * *', new Date('2026-06-21T08:30:00Z'));
    expect(next?.toISOString()).toBe('2026-06-21T09:00:00.000Z');
  });
});

const task = (over: Partial<ScheduledTask> & Pick<ScheduledTask, 'id' | 'ownerId' | 'cron'>): ScheduledTask => ({
  name: 't',
  enabled: true,
  jobSpec: { kind: 'research', input: { question: 'x' }, allowTools: [] },
  ...over,
});

describe('Scheduler', () => {
  it('fires due tasks once per minute and records last/next run', async () => {
    const repo = new InMemoryScheduledTaskRepository();
    await repo.save(task({ id: 's1', ownerId: 'u1', cron: '30 8 * * *' }));
    await repo.save(task({ id: 's2', ownerId: 'u1', cron: '0 9 * * *' })); // not due at 08:30
    const fired: string[] = [];
    const scheduler = new Scheduler({ repo, trigger: (t) => { fired.push(t.id); } });

    const now = new Date('2026-06-21T08:30:00Z');
    expect(await scheduler.tick(now)).toEqual(['s1']);
    // same minute again → no double fire
    expect(await scheduler.tick(new Date('2026-06-21T08:30:30Z'))).toEqual([]);
    const s1 = await repo.get('s1');
    expect(s1?.lastRunAt).toBeTruthy();
    expect(s1?.nextRunAt).toBe('2026-06-22T08:30:00.000Z');
    expect(fired).toEqual(['s1']);
  });

  it('skips disabled tasks', async () => {
    const repo = new InMemoryScheduledTaskRepository();
    await repo.save(task({ id: 's1', ownerId: 'u1', cron: '* * * * *', enabled: false }));
    const scheduler = new Scheduler({ repo, trigger: () => {} });
    expect(await scheduler.tick(new Date('2026-06-21T08:30:00Z'))).toEqual([]);
  });
});
