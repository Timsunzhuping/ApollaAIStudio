import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookEvent, type WebhookEvent as WebhookEventT } from '@apolla/contracts';
import type { PaymentProvider, CheckoutInput } from '@apolla/harness-core';

export interface StripeOptions {
  secretKey?: string;
  webhookSecret?: string;
  /** Map a plan id → Stripe Price id (from env). */
  priceFor?: (plan: string) => string | undefined;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Stripe payment provider over the REST API (fetch-based, no SDK) — env-gated, same shape as the
 * other adapters. Card data is handled by Stripe's hosted Checkout; we only receive a URL + signed
 * webhooks. parseWebhook verifies the `Stripe-Signature` HMAC over `t.rawBody` (offline-testable).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  private readonly key: string;
  private readonly webhookSecret: string;
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly priceFor: (plan: string) => string | undefined;

  constructor(opts: StripeOptions = {}) {
    this.key = opts.secretKey ?? process.env.STRIPE_SECRET_KEY ?? '';
    this.webhookSecret = opts.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '';
    this.base = opts.baseUrl ?? 'https://api.stripe.com';
    this.fetch = opts.fetchFn ?? fetch;
    this.priceFor = opts.priceFor ?? ((plan) => process.env[`STRIPE_PRICE_${plan.toUpperCase()}`]);
  }

  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    if (!res.ok) throw new Error(`Stripe ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async createCheckout(input: CheckoutInput): Promise<{ url: string; ref?: string }> {
    const price = this.priceFor(input.plan);
    if (!price) throw new Error(`no Stripe price configured for plan "${input.plan}"`);
    const session = await this.post('/v1/checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: input.ownerId,
      'metadata[ownerId]': input.ownerId,
      'metadata[plan]': input.plan,
      success_url: input.successUrl ?? 'https://app.example/billing?ok=1',
      cancel_url: input.successUrl ?? 'https://app.example/billing',
    });
    return { url: String(session.url ?? ''), ref: String(session.id ?? '') };
  }

  async cancel(_ownerId: string, providerRef?: string): Promise<void> {
    if (providerRef) await this.post(`/v1/subscriptions/${providerRef}`, { cancel_at_period_end: 'true' });
  }

  /** Verify Stripe's `Stripe-Signature: t=...,v1=...` HMAC over `${t}.${rawBody}`, then map the event. */
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEventT | null {
    if (!signature || !this.webhookSecret) return null;
    const parts = Object.fromEntries(signature.split(',').map((p) => p.split('=') as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(v1);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return mapStripeEvent(rawBody);
  }
}

/** Map a raw Stripe event into our normalized WebhookEvent (subscription lifecycle only). */
export function mapStripeEvent(rawBody: string): WebhookEventT | null {
  let evt: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const obj = evt.data?.object ?? {};
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const ownerId = meta.ownerId ?? String(obj.client_reference_id ?? '');
  if (!ownerId || !evt.id) return null;
  const base = { id: evt.id, ownerId, providerRef: String(obj.id ?? '') };
  if (evt.type === 'checkout.session.completed' || evt.type === 'customer.subscription.created') {
    return safe({ ...base, type: 'subscription.created', plan: meta.plan, status: 'active' });
  }
  if (evt.type === 'customer.subscription.deleted') {
    return safe({ ...base, type: 'subscription.canceled', status: 'canceled' });
  }
  if (evt.type === 'customer.subscription.updated') {
    return safe({ ...base, type: 'subscription.updated', plan: meta.plan, status: 'active' });
  }
  return null;
}

function safe(o: unknown): WebhookEventT | null {
  const r = WebhookEvent.safeParse(o);
  return r.success ? r.data : null;
}
