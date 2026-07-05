import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Chat } from './Chat';

function sseResponse(frames: unknown[]): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function fakeJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Chat page (S28)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/chat') && init?.method === 'POST') {
        return sseResponse([
          { type: 'conversation', conversationId: 'c1', title: '固态电池' },
          { type: 'delta', text: '固态电池' },
          { type: 'delta', text: '是一种新型电池。' },
          { type: 'done', conversationId: 'c1', alias: 'gpt_fast', compacted: false, costUsd: 0.001 },
        ]);
      }
      if (u.endsWith('/api/conversations')) return fakeJson([{ id: 'c1', title: '固态电池', compacted: false, updatedAt: '2026-07-05' }]);
      if (u.includes('/api/conversations/c1')) return fakeJson({ id: 'c1', title: '固态电池', messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: '固态电池是什么？' },
        { role: 'assistant', content: '固态电池是一种新型电池。' },
      ] });
      return fakeJson({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends a turn, streams the reply, and lists the conversation', async () => {
    render(<Chat />);
    fireEvent.change(screen.getByPlaceholderText(/随便聊点什么/), { target: { value: '固态电池是什么？' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // streamed assistant reply assembled from deltas
    expect(await screen.findByText('固态电池是一种新型电池。')).toBeInTheDocument();
    // thread list refreshed after the turn
    await waitFor(() => expect(screen.getAllByText('固态电池').length).toBeGreaterThan(0));
  });

  it('opens an existing conversation and hides the system message', async () => {
    render(<Chat />);
    fireEvent.click(await screen.findByRole('button', { name: '固态电池' }));
    expect(await screen.findByText('固态电池是什么？')).toBeInTheDocument();
    expect(screen.queryByText('sys')).not.toBeInTheDocument();
  });
});
