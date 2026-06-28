import type { Subscription, WebhookEvent } from '@apolla/contracts';

export interface CheckoutInput {
  ownerId: string;
  plan: string;
  successUrl?: string;
}

/**
 * Swappable payment provider (Stub offline / Stripe prod) — same capability-as-config pattern as
 * the LLM/media/search adapters. Card data is handled entirely by the provider's hosted checkout;
 * we only ever receive a checkout URL + signed webhooks.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<{ url: string; ref?: string }>;
  cancel(ownerId: string, providerRef?: string): Promise<void>;
  /** Verify the signature over the RAW body and parse a normalized event, or null if invalid. */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null;
}

/** Persistence for subscriptions + webhook idempotency. */
export interface SubscriptionRepository {
  get(ownerId: string): Promise<Subscription | undefined>;
  save(sub: Subscription): Promise<void>;
  /** Record a processed webhook event id; returns true if newly recorded (false = already seen). */
  markEventProcessed(eventId: string): Promise<boolean>;
}
