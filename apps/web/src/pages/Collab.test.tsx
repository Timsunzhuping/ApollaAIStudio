import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Replica } from '@apolla/harness-core/collab';
import { Collab } from './Collab';
import { MockEventSource } from '../test/mockSSE';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Collab editor (S21)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/collab/') && u.includes('?since=')) return fakeRes(200, { docId: 'd1', ownerId: 'me', text: '', seq: 0, ops: [], participants: ['me'] });
      if (u.endsWith('/ops')) return fakeRes(200, { seq: 1 });
      if (u.endsWith('/share')) return fakeRes(200, { token: 't', link: 'http://x/collab/accept?token=t' });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a doc and applies a remote op pushed over SSE', async () => {
    render(<Collab />);
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));

    const editor = (await screen.findByTestId('collab-editor')) as HTMLTextAreaElement;
    expect(editor.value).toBe('');

    // a remote collaborator's ops arrive over the SSE stream → the editor reflects them
    const remote = new Replica('remote');
    const ops = remote.insertStringAt(0, 'hello');
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    await act(async () => { MockEventSource.last().emit({ ops, seq: ops.length, participants: ['me', 'remote'] }); });

    await waitFor(() => expect((screen.getByTestId('collab-editor') as HTMLTextAreaElement).value).toBe('hello'));
    expect(screen.getByTestId('participants').textContent).toContain('2 editing');
  });

  it('produces a share link', async () => {
    render(<Collab />);
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    await screen.findByTestId('collab-editor');
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(() => expect((screen.getByDisplayValue(/collab\/accept\?token=t/) as HTMLInputElement).value).toContain('token=t'));
  });
});
