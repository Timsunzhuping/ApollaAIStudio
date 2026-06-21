import { describe, it, expect } from 'vitest';
import type { Job } from '@apolla/contracts';
import { notifyJobComplete, StubDelivery } from './notify';
import { InMemoryNotificationRepository } from '../repo/memory';

const job = (status: Job['status']): Job => ({ id: 'j1', ownerId: 'u1', kind: 'research', input: {}, status, error: status === 'failed' ? 'boom' : undefined });

describe('notifyJobComplete', () => {
  it('creates an in-app notification and delivers out-of-band on success', async () => {
    const repo = new InMemoryNotificationRepository();
    const delivery = new StubDelivery();
    let n = 0;
    await notifyJobComplete(job('done'), { repo, delivery, idGen: () => `n${n++}` });
    const list = await repo.list('u1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'job-done', jobId: 'j1', read: false });
    expect(delivery.sent).toHaveLength(1);
  });

  it('marks failure notifications and can be marked read', async () => {
    const repo = new InMemoryNotificationRepository();
    await notifyJobComplete(job('failed'), { repo, idGen: () => 'nf' });
    const [n] = await repo.list('u1');
    expect(n).toMatchObject({ kind: 'job-failed', body: 'boom' });
    await repo.markRead('u1', 'nf');
    expect((await repo.list('u1'))[0]!.read).toBe(true);
  });

  it('isolates notifications by owner', async () => {
    const repo = new InMemoryNotificationRepository();
    await notifyJobComplete({ ...job('done'), ownerId: 'u2', id: 'j2' }, { repo, idGen: () => 'n2' });
    expect(await repo.list('u1')).toEqual([]);
    expect((await repo.list('u2')).length).toBe(1);
  });
});
