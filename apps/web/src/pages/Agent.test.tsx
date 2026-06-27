import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Agent } from './Agent';
import { MockEventSource } from '../test/mockSSE';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Agent page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/connectors')) return fakeRes(200, []);
      if (u.endsWith('/api/plugins/official')) return fakeRes(200, [{ name: 'research-analyst', skills: [], requiredConnectors: [], commands: [] }]);
      if (u.endsWith('/api/plugins')) return fakeRes(200, []);
      if (u.endsWith('/api/agent') && init?.method === 'POST') return fakeRes(200, { agentId: 'a1' });
      if (u.includes('/api/agent/a1/confirm')) return fakeRes(200, { ok: true });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a confirm prompt from the agent SSE stream and posts the response', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<Agent />);
    fireEvent.change(screen.getByPlaceholderText(/Agent goal/i), { target: { value: 'save a note' } });
    fireEvent.click(screen.getByRole('button', { name: /Run agent/i }));

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    await act(async () => MockEventSource.last().emit({ type: 'confirm', tool: 'demo/save_note', risk: 'low_write' }));

    expect(await screen.findByText('demo/save_note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/agent/a1/confirm'))).toBe(true));
  });
});
