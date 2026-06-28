import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Admin } from './Admin';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Admin operator console (S23)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/admin/stats')) return fakeRes(200, { users: 12, projects: 30, tasks: 99, jobs: { running: 2, failed: 1 }, subscriptions: { pro: 5 } });
      if (u.includes('/api/admin/users')) return fakeRes(200, [{ id: 'u1', email: 'alice@x.ai', createdAt: '2026-01-01', plan: 'free', projects: 3 }]);
      if (u.includes('/api/admin/audit')) return fakeRes(200, [{ id: 'a1', ownerId: 'u1', tool: 'research', risk: 'read', decision: 'allow', status: 'executed', summary: 'ran research', createdAt: '2026-01-01' }]);
      if (u.match(/\/api\/admin\/users\/.+\/plan/) && init?.method === 'POST') return fakeRes(200, { ok: true, plan: 'pro' });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders stats, users and audit, and grants a plan', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<Admin />);

    expect(await screen.findByTestId('admin-stats')).toHaveTextContent('12');
    expect(await screen.findByText('alice@x.ai')).toBeInTheDocument();
    expect(await screen.findByText('ran research')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('plan for alice@x.ai'), { target: { value: 'pro' } });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => /\/api\/admin\/users\/u1\/plan/.test(String(c[0])) && (c[1] as RequestInit)?.method === 'POST')).toBe(true));
    expect(await screen.findByTestId('admin-note')).toHaveTextContent('pro');
  });

  it('filters the user list by email', async () => {
    render(<Admin />);
    await screen.findByText('alice@x.ai');
    fireEvent.change(screen.getByPlaceholderText('search by email'), { target: { value: 'bob' } });
    expect(screen.queryByText('alice@x.ai')).not.toBeInTheDocument();
  });
});
