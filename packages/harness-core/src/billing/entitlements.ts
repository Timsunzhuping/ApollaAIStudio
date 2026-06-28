import type { PlanDef, Subscription } from '@apolla/contracts';

/** A safe minimal plan used when no config free plan exists (fail-closed). */
const FALLBACK_FREE: PlanDef = { id: 'free', name: 'Free', taskLimit: 50, features: [], priceUsd: 0 };

/**
 * Resolve an owner's effective plan from their subscription + the configured plans (S13-T2).
 * Fail-closed: anything other than an active subscription on a known plan resolves to free.
 */
export function resolveEntitlements(sub: Subscription | undefined, plans: PlanDef[]): PlanDef {
  const free = plans.find((p) => p.id === 'free') ?? FALLBACK_FREE;
  if (!sub || sub.status !== 'active') return free;
  if (sub.periodEnd && new Date(sub.periodEnd).getTime() <= Date.now()) return free;
  return plans.find((p) => p.id === sub.plan) ?? free;
}

/** Whether the owner's plan includes a feature. */
export function hasFeature(plan: PlanDef, feature: string): boolean {
  return plan.features.includes(feature);
}
