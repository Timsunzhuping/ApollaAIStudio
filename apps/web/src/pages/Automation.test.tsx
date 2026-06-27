import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Automation } from './Automation';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Automation page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const m = init?.method ?? 'GET';
      if (u.endsWith('/api/schedules') && m === 'GET') return fakeRes(200, [{ id: 's1', name: 'EV market', cron: '0 8 * * *', enabled: true, jobSpec: { kind: 'research' } }]);
      if (u.endsWith('/api/schedules') && m === 'POST') return fakeRes(201, { id: 's2', name: 'x', cron: '0 8 * * *', enabled: true, jobSpec: { kind: 'research' } });
      if (u.endsWith('/api/jobs')) return fakeRes(200, [{ id: 'j1', kind: 'research', status: 'done' }]);
      if (u.endsWith('/api/notifications')) return fakeRes(200, [{ id: 'n1', title: 'research done', read: false, kind: 'job-done' }]);
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders schedules, jobs, and an unread notification', async () => {
    render(<Automation />);
    expect(await screen.findByText(/EV market/)).toBeInTheDocument();
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(screen.getByText(/research done/)).toBeInTheDocument();
    expect(screen.getByText(/Notifications \(🔔 1\)/)).toBeInTheDocument();
  });

  it('creates a schedule via the inline form', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<Automation />);
    await screen.findByText(/EV market/);
    fireEvent.change(screen.getByPlaceholderText(/Daily research question/i), { target: { value: 'AI chips' } });
    fireEvent.click(screen.getByRole('button', { name: /\+ Add/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/schedules') && (c[1] as RequestInit)?.method === 'POST')).toBe(true));
  });
});
