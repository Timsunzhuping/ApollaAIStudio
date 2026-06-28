import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { fakeFacade } from '../test/setup';

function jsonRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}
function sseRes(frames: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return { ok: true, status: 200, body: new ReadableStream({ pull(c) { if (i < frames.length) c.enqueue(enc.encode(frames[i++])); else c.close(); } }) };
}

describe('extension side panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves a token in settings', async () => {
    const facade = fakeFacade({ apiBase: 'http://localhost:3000', apiToken: '' });
    render(<App facade={facade} />);
    const tokenInput = await screen.findByPlaceholderText('apolla_…');
    fireEvent.change(tokenInput, { target: { value: 'apolla_a_b' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() => expect(facade.store.apiToken).toBe('apolla_a_b'));
  });

  it('runs a pending research action and streams the report', async () => {
    const facade = fakeFacade({ apiBase: 'http://bff', apiToken: 'apolla_a_b', pendingAction: { action: 'research', context: { selection: 'EVs', title: 'T', url: 'u' } } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/tasks')) return jsonRes(200, { taskId: 't1' });
      if (u.includes('/api/tasks/t1/events')) return sseRes(['data: {"type":"delta","text":"Streaming answer"}\n\n', 'data: {"type":"done"}\n\n']);
      return jsonRes(200, {});
    }));
    render(<App facade={facade} />);
    expect(await screen.findByText(/Streaming answer/)).toBeInTheDocument();
    await waitFor(() => expect(facade.store.pendingAction).toBeNull()); // consumed
  });

  it('runs a pending summarize action via a surface and shows the saved result', async () => {
    const facade = fakeFacade({ apiBase: 'http://bff', apiToken: 'apolla_a_b', pendingAction: { action: 'summarize', context: { selection: 'long text', title: 'T', url: 'u' } } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/surface') && init?.method === 'POST') return jsonRes(200, { path: 'surface-summarize.md', version: 1 });
      if (u.includes('/api/workspace/file')) return jsonRes(200, { path: 'surface-summarize.md', content: '- key point', version: 1 });
      return jsonRes(200, {});
    }));
    render(<App facade={facade} />);
    expect(await screen.findByText(/key point/)).toBeInTheDocument();
    expect(screen.getByText(/saved surface-summarize\.md/)).toBeInTheDocument();
  });
});
