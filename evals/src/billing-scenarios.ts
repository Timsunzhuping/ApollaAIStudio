import { StubPaymentProvider, InMemorySubscriptionRepository, resolveEntitlements, hasFeature, Quota } from '@apolla/harness-core';
import type { PlanDef } from '@apolla/contracts';
import type { CheckResult } from './checks';

const PLANS: PlanDef[] = [
  { id: 'free', name: 'Free', taskLimit: 50, features: ['research'], priceUsd: 0 },
  { id: 'pro', name: 'Pro', taskLimit: 100000, features: ['research', 'cowork'], priceUsd: 20 },
];

/**
 * Billing entitlements (S13): a verified webhook activates a subscription → entitlements + quota
 * lift to pro; cancellation fails closed back to free. Fully offline (StubPaymentProvider).
 */
export async function billingEntitlements(): Promise<CheckResult> {
  const issues: string[] = [];
  const provider = new StubPaymentProvider();
  const subs = new InMemorySubscriptionRepository();
  const planOf = async (id: string) => resolveEntitlements(await subs.get(id), PLANS);
  const quota = new Quota(async () => 60, planOf); // 60 used → over the free limit of 50

  // free: cowork locked, quota exceeded
  if (hasFeature(await planOf('u'), 'cowork')) issues.push('free should not have cowork');
  if ((await quota.check('u')).ok) issues.push('free quota should be exceeded at 60 used');

  // apply a signed "created" webhook → active pro
  const { rawBody, signature } = provider.simulateEvent({ type: 'subscription.created', ownerId: 'u', plan: 'pro', status: 'active' });
  const ev = provider.parseWebhook(rawBody, signature);
  if (!ev) issues.push('valid webhook failed to verify');
  else await subs.save({ ownerId: 'u', plan: ev.plan!, status: 'active' });

  if (!hasFeature(await planOf('u'), 'cowork')) issues.push('pro should unlock cowork');
  if (!(await quota.check('u')).ok) issues.push('pro quota should allow 60 used');

  // cancel → fail closed to free
  await subs.save({ ownerId: 'u', plan: 'pro', status: 'canceled' });
  if (hasFeature(await planOf('u'), 'cowork')) issues.push('canceled should fall back to free (no cowork)');

  return { name: 'billing-entitlements', ok: issues.length === 0, issues };
}

export async function runBillingScenarios(): Promise<CheckResult[]> {
  return [await billingEntitlements()];
}
