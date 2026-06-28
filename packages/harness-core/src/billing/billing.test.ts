import { describe, it, expect } from 'vitest';
import type { PlanDef, Subscription } from '@apolla/contracts';
import { StubPaymentProvider, InMemorySubscriptionRepository } from './stub';
import { resolveEntitlements, hasFeature } from './entitlements';
import { Quota } from '../cost/quota';

const PLANS: PlanDef[] = [
  { id: 'free', name: 'Free', taskLimit: 50, features: ['research'], priceUsd: 0 },
  { id: 'pro', name: 'Pro', taskLimit: 100000, features: ['research', 'cowork'], priceUsd: 20 },
];

describe('StubPaymentProvider', () => {
  it('creates a checkout url and verifies its own signed webhooks', async () => {
    const p = new StubPaymentProvider();
    const co = await p.createCheckout({ ownerId: 'u', plan: 'pro' });
    expect(co.url).toContain('pro');
    const { rawBody, signature } = p.simulateEvent({ type: 'subscription.created', ownerId: 'u', plan: 'pro', status: 'active' });
    const ev = p.parseWebhook(rawBody, signature);
    expect(ev).toMatchObject({ type: 'subscription.created', ownerId: 'u', plan: 'pro' });
  });

  it('rejects a tampered or unsigned webhook', () => {
    const p = new StubPaymentProvider();
    const { rawBody, signature } = p.simulateEvent({ type: 'subscription.created', ownerId: 'u', plan: 'pro', status: 'active' });
    expect(p.parseWebhook(rawBody + 'x', signature)).toBeNull();
    expect(p.parseWebhook(rawBody, undefined)).toBeNull();
  });
});

describe('SubscriptionRepository idempotency', () => {
  it('marks an event processed once', async () => {
    const repo = new InMemorySubscriptionRepository();
    expect(await repo.markEventProcessed('evt1')).toBe(true);
    expect(await repo.markEventProcessed('evt1')).toBe(false);
  });
});

describe('resolveEntitlements (fail-closed to free)', () => {
  const sub = (o: Partial<Subscription>): Subscription => ({ ownerId: 'u', plan: 'pro', status: 'active', ...o });
  it('active pro → pro; otherwise free', () => {
    expect(resolveEntitlements(sub({}), PLANS).id).toBe('pro');
    expect(resolveEntitlements(undefined, PLANS).id).toBe('free');
    expect(resolveEntitlements(sub({ status: 'canceled' }), PLANS).id).toBe('free');
    expect(resolveEntitlements(sub({ periodEnd: new Date(Date.now() - 1000).toISOString() }), PLANS).id).toBe('free');
    expect(resolveEntitlements(sub({ plan: 'ghost' }), PLANS).id).toBe('free');
    expect(hasFeature(resolveEntitlements(sub({}), PLANS), 'cowork')).toBe(true);
  });
});

describe('Quota reads the subscription plan (S13)', () => {
  it('free is limited; an active pro subscription raises the limit', async () => {
    const subs = new InMemorySubscriptionRepository();
    const planOf = async (id: string) => resolveEntitlements(await subs.get(id), PLANS);
    const quota = new Quota(async () => 60, planOf); // 60 used
    expect((await quota.check('u')).ok).toBe(false); // free limit 50
    await subs.save({ ownerId: 'u', plan: 'pro', status: 'active' });
    const q = await quota.check('u');
    expect(q.ok).toBe(true);
    expect(q.plan).toBe('Pro');
  });
});
