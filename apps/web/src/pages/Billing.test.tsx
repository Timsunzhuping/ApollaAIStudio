import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Billing } from './Billing';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}
const FREE = { id: 'free', name: 'Free', taskLimit: 50, features: ['research'], priceUsd: 0 };
const PRO = { id: 'pro', name: 'Pro', taskLimit: 100000, features: ['research', 'cowork'], priceUsd: 20 };

describe('Billing page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the current plan + usage and upgrades to Pro', async () => {
    let plan = 'free';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/billing/subscription')) {
        const cur = plan === 'pro' ? PRO : FREE;
        return fakeRes(200, { subscription: plan === 'pro' ? { plan: 'pro', status: 'active' } : null, plan: cur, usage: { used: 3, limit: cur.taskLimit, plan: cur.name }, plans: [FREE, PRO] });
      }
      if (u.endsWith('/api/billing/checkout') && init?.method === 'POST') { plan = 'pro'; return fakeRes(200, { url: '', activated: true }); }
      return fakeRes(200, {});
    }));

    render(<Billing />);
    expect(await screen.findByText('Your plan')).toBeInTheDocument();
    expect(screen.getByText('Usage: 3 / 50 tasks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Upgrade to Pro/i }));
    await waitFor(() => expect(screen.getByText('Usage: 3 / 100000 tasks')).toBeInTheDocument());
    expect(screen.getByText('current')).toBeInTheDocument(); // Pro is now current
  });
});
