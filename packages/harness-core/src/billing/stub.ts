import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebhookEvent, type Subscription, type WebhookEvent as WebhookEventT } from '@apolla/contracts';
import type { PaymentProvider, CheckoutInput, SubscriptionRepository } from './types';

const STUB_SECRET = process.env.STUB_BILLING_SECRET ?? 'dev-billing-secret';

function sign(rawBody: string, secret = STUB_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Offline payment provider for demo/CI. createCheckout returns a local link; webhooks are HMAC-signed
 * over the raw body exactly like a real provider, so the BFF's verify+idempotent path is exercised
 * unchanged. `simulateEvent` produces a signed payload to drive the lifecycle deterministically.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = 'stub';

  async createCheckout(input: CheckoutInput): Promise<{ url: string; ref?: string }> {
    return { url: `/billing/stub-checkout?plan=${encodeURIComponent(input.plan)}`, ref: `stub_${input.plan}` };
  }
  async cancel(): Promise<void> {
    /* the BFF emits a canceled webhook; nothing remote to call */
  }
  parseWebhook(rawBody: string, signature: string | undefined): WebhookEventT | null {
    if (!signature) return null;
    const expected = sign(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      return WebhookEvent.parse(JSON.parse(rawBody));
    } catch {
      return null;
    }
  }

  /** Build a signed webhook payload (for the stub checkout completion + tests). */
  simulateEvent(ev: Omit<WebhookEventT, 'id'> & { id?: string }): { rawBody: string; signature: string } {
    const full: WebhookEventT = { id: ev.id ?? `evt_${randomUUID()}`, ...ev };
    const rawBody = JSON.stringify(full);
    return { rawBody, signature: sign(rawBody) };
  }
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byOwner = new Map<string, Subscription>();
  private readonly events = new Set<string>();

  async get(ownerId: string): Promise<Subscription | undefined> {
    const s = this.byOwner.get(ownerId);
    return s ? { ...s } : undefined;
  }
  async save(sub: Subscription): Promise<void> {
    this.byOwner.set(sub.ownerId, { ...sub });
  }
  async markEventProcessed(eventId: string): Promise<boolean> {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
}
