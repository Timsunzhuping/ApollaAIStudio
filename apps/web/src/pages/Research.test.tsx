import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Research } from './Research';
import { MockEventSource } from '../test/mockSSE';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Research page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/api/projects')) return fakeRes(200, []);
      if (u.endsWith('/api/skills')) return fakeRes(200, []);
      if (u.endsWith('/api/tasks') && method === 'POST') return fakeRes(200, { taskId: 't1' });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('streams a research run: report, sources, and cost render from SSE events', async () => {
    render(<Research />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a research question/i), { target: { value: 'EV market 2026' } });
    fireEvent.click(screen.getByRole('button', { name: /Research/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    expect(MockEventSource.last().url).toBe('/api/tasks/t1/events');

    await act(async () => {
      const es = MockEventSource.last();
      es.emit({ type: 'plan', plan: { subquestions: ['angle one'] } });
      es.emit({ type: 'delta', text: 'Hello from research' });
      es.emit({ type: 'sources', sources: [{ id: 's:1', title: 'A Source', url: 'https://x' }] });
      es.emit({ type: 'cost', totalUsd: 0.1234 });
      es.emit({ type: 'done' });
    });

    expect(await screen.findByText(/Hello from research/)).toBeInTheDocument();
    expect(screen.getByText('A Source')).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();
    // closed on done
    expect(MockEventSource.last().closed).toBe(true);
  });
});
