import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Surfaces } from './Surfaces';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Surfaces page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/surfaces')) {
        return fakeRes(200, [{ id: 'notes', title: 'Meeting Notes', inputKind: 'text', params: {}, promptRef: 'p', outputMime: 'text/markdown', executor: 'notes' }]);
      }
      if (u.endsWith('/api/surface') && init?.method === 'POST') return fakeRes(200, { path: 'surface-notes.md', version: 1 });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs a text surface and reports the produced file', async () => {
    render(<Surfaces />);
    await screen.findByText('Surfaces — Translate · Sheets · Meeting Notes');
    fireEvent.change(screen.getByPlaceholderText(/meeting transcript/i), { target: { value: 'Alice: ship it' } });
    fireEvent.click(screen.getByRole('button', { name: /Run surface/i }));
    await waitFor(() => expect(screen.getByText(/wrote surface-notes\.md v1/)).toBeInTheDocument());
  });
});
