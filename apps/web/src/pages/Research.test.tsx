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
      if (u.endsWith('/api/speech/transcribe') && method === 'POST') return fakeRes(200, { text: 'spoken question' });
      if (u.endsWith('/api/speech/synthesize') && method === 'POST') return fakeRes(200, { uri: '/media/spoken.mp3' });
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
      es.emit({ type: 'sources', sources: [{ id: 's:1', title: 'A Source', url: 'https://x' }, { id: 's:2', title: 'Degraded Source', url: 'https://y', degraded: true }] });
      es.emit({ type: 'snippets', snippets: [{ id: 'sn-1', sourceId: 'fetch:ab:2', quote: 'prices fell below $90' }] });
      es.emit({ type: 'citations', citations: [{ claim: 'Prices are falling.', sourceIds: ['s:1'], snippetIds: ['sn-1'], status: 'corroborated' }] });
      es.emit({ type: 'cost', totalUsd: 0.1234 });
      es.emit({ type: 'done' });
    });

    expect(await screen.findByText(/Hello from research/)).toBeInTheDocument();
    expect(screen.getByText('$0.1234')).toBeInTheDocument();

    // Evidence panel (S26): snippet arrival auto-switches to Quotes with the verification mark.
    expect(screen.getByText(/prices fell below \$90/)).toBeInTheDocument();
    expect(screen.getByText(/✓ verified · fetch:ab:2/)).toBeInTheDocument();

    // Claims tab: status chip + claim text.
    fireEvent.click(screen.getByRole('button', { name: /Claims 1/ }));
    expect(screen.getByText('多源证实')).toBeInTheDocument();
    expect(screen.getByText('Prices are falling.')).toBeInTheDocument();

    // Sources tab: degraded badge for failed fetches.
    fireEvent.click(screen.getByRole('button', { name: /Sources 2/ }));
    expect(screen.getByText('A Source')).toBeInTheDocument();
    expect(screen.getByText('snippet only')).toBeInTheDocument();
    // closed on done
    expect(MockEventSource.last().closed).toBe(true);

    // S19: read the report aloud → synthesized audio plays.
    fireEvent.click(screen.getByRole('button', { name: /Read aloud/i }));
    await waitFor(() => expect((screen.getByTestId('report-audio') as HTMLAudioElement).getAttribute('src')).toContain('/media/spoken.mp3'));
  });

  it('maps routing failures to actionable copy with the raw detail collapsed', async () => {
    render(<Research />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a research question/i), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /Research/i }));
    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));
    await act(async () => {
      MockEventSource.last().emit({ type: 'error', message: 'json() exhausted all candidates for "gpt_premium" :: openai/x[403]' });
    });
    expect(await screen.findByText(/模型服务暂时不可用/)).toBeInTheDocument();
    expect(screen.getByText('技术细节')).toBeInTheDocument();
    expect(screen.getByText(/exhausted all candidates/)).toBeInTheDocument();
  });

  it('dictates the question via the mic without auto-submitting (S19)', async () => {
    class FakeMediaRecorder {
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType = 'audio/webm';
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(['STUBSPEECH:spoken question'], { type: 'audio/webm' }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) }, configurable: true });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    render(<Research />);
    fireEvent.click(screen.getByRole('button', { name: /Dictate question/i })); // start
    fireEvent.click(await screen.findByRole('button', { name: /Stop recording/i })); // stop → transcribe

    await waitFor(() => expect((screen.getByPlaceholderText(/Ask a research question/i) as HTMLInputElement).value).toBe('spoken question'));
    expect(MockEventSource.instances).toHaveLength(0); // transcript filled the input — NOT auto-submitted
  });
});
