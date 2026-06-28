import { z } from 'zod';

export const SubscriptionStatus = z.enum(['active', 'canceled', 'past_due']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

/** A user's current subscription. We store only a provider reference + plan/status — never card data. */
export const Subscription = z.object({
  ownerId: z.string(),
  plan: z.string(),
  status: SubscriptionStatus,
  periodEnd: z.string().optional(),
  providerRef: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Subscription = z.infer<typeof Subscription>;

/** A normalized billing webhook (verified + parsed from the provider's raw payload). */
export const WebhookEvent = z.object({
  id: z.string(),
  type: z.enum(['subscription.created', 'subscription.updated', 'subscription.canceled']),
  ownerId: z.string(),
  plan: z.string().optional(),
  status: SubscriptionStatus.optional(),
  periodEnd: z.string().optional(),
  providerRef: z.string().optional(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;

/** A declarative plan/tier (config/plans/*.json). Quota + feature gates read from this. */
export const PlanDef = z.object({
  id: z.string(),
  name: z.string().default(''),
  taskLimit: z.number().int().nonnegative(),
  features: z.array(z.string()).default([]),
  priceUsd: z.number().nonnegative().default(0),
});
export type PlanDef = z.infer<typeof PlanDef>;
