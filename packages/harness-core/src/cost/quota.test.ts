import { describe, it, expect } from 'vitest';
import { Quota, PLANS } from './quota';

describe('Quota', () => {
  it('allows under the free limit and blocks at/over it', async () => {
    let count = 0;
    const quota = new Quota(async () => count);
    count = 3;
    expect((await quota.check('u1')).ok).toBe(true);
    count = PLANS.free!.taskLimit;
    const status = await quota.check('u1');
    expect(status.ok).toBe(false);
    expect(status.limit).toBe(PLANS.free!.taskLimit);
    expect(status.plan).toBe('free');
  });

  it('honors a higher plan', async () => {
    const quota = new Quota(
      async () => 1000,
      () => PLANS.pro!,
    );
    expect((await quota.check('u1')).ok).toBe(true);
  });
});
