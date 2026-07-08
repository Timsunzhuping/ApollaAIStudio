import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Replica } from '@apolla/harness-core/collab';
import { Collab } from './Collab';
import { AuthProvider } from '../lib/auth';
import { MockEventSource } from '../test/mockSSE';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}
const renderCollab = () => render(<AuthProvider><Collab /></AuthProvider>);

describe('Collab editor + presence cursors (S21/S31)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/auth/me')) return fakeRes(200, { id: 'me', email: 'me@x.ai' });
      if (u.includes('/api/collab/') && u.includes('?since=')) return fakeRes(200, { docId: 'd1', ownerId: 'me', text: '', seq: 0, ops: [], participants: ['me'], presence: [] });
      if (u.endsWith('/presence')) return fakeRes(200, { ok: true });
      if (u.endsWith('/ops')) return fakeRes(200, { seq: 1 });
      if (u.endsWith('/share')) return fakeRes(200, { token: 't', link: 'http://x/collab/accept?token=t' });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a doc and applies a remote op pushed over SSE', async () => {
    renderCollab();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));

    const editor = (await screen.findByTestId('collab-editor')) as HTMLTextAreaElement;
    expect(editor.value).toBe('');

    const remote = new Replica('remote');
    const ops = remote.insertStringAt(0, 'hello');
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    await act(async () => { MockEventSource.last().emit({ ops, seq: ops.length, presence: [] }); });

    await waitFor(() => expect((screen.getByTestId('collab-editor') as HTMLTextAreaElement).value).toBe('hello'));
  });

  it('renders a remote collaborator caret (label + position + color) from presence', async () => {
    renderCollab();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    await screen.findByTestId('collab-editor');
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    await act(async () => {
      MockEventSource.last().emit({ ops: [], seq: 0, presence: [
        { id: 'me', cursor: 0, label: 'me', color: '#111111' }, // self is filtered out
        { id: 'bob', cursor: 4, label: 'bob', color: '#3cb44b' },
      ] });
    });

    // self excluded → "2 editing" (you + bob); bob's caret chip shows label + position
    expect(await screen.findByTestId('peer-bob')).toHaveTextContent('bob · 4');
    expect(screen.getByTestId('presence').textContent).toContain('2 editing');
    expect(screen.queryByTestId('peer-me')).toBeNull();
  });

  it('reports the local caret over the presence channel on selection', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderCollab();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    const editor = await screen.findByTestId('collab-editor');
    fireEvent.select(editor);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/presence') && (c[1] as RequestInit)?.method === 'POST')).toBe(true));
  });

  it('produces a share link', async () => {
    renderCollab();
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    await screen.findByTestId('collab-editor');
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() => expect((screen.getByDisplayValue(/collab\/accept\?token=t/) as HTMLInputElement).value).toContain('token=t'));
  });
});
