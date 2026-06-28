import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { StripePaymentProvider, mapStripeEvent } from './index';

const SECRET = 'whsec_test';
function signed(body: string, t = 1700000000): string {
  const v1 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('StripePaymentProvider.parseWebhook', () => {
  const provider = new StripePaymentProvider({ webhookSecret: SECRET });

  it('verifies a correctly signed event and maps it', () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'sub_1', client_reference_id: 'u', metadata: { ownerId: 'u', plan: 'pro' } } } });
    const ev = provider.parseWebhook(body, signed(body));
    expect(ev).toMatchObject({ id: 'evt_1', type: 'subscription.created', ownerId: 'u', plan: 'pro', status: 'active' });
  });

  it('rejects a tampered signature / body', () => {
    const body = JSON.stringify({ id: 'e', type: 'checkout.session.completed', data: { object: { metadata: { ownerId: 'u', plan: 'pro' } } } });
    expect(provider.parseWebhook(body, 't=1,v1=deadbeef')).toBeNull();
    expect(provider.parseWebhook(body + 'x', signed(body))).toBeNull();
    expect(provider.parseWebhook(body, undefined)).toBeNull();
  });

  it('maps cancellation events', () => {
    const body = JSON.stringify({ id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', metadata: { ownerId: 'u' } } } });
    expect(mapStripeEvent(body)).toMatchObject({ type: 'subscription.canceled', ownerId: 'u', status: 'canceled' });
  });
});
