import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';
import { fakeFacade } from '../test/setup';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('extension side panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads stored config, saves edits, and tests the connection', async () => {
    const facade = fakeFacade({ apiBase: 'http://localhost:3000', apiToken: '' });
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(200, { id: 'u', email: 'me@x.ai' })));
    render(<App facade={facade} />);
    const tokenInput = await screen.findByPlaceholderText('apolla_…');
    fireEvent.change(tokenInput, { target: { value: 'apolla_a_b' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(facade.store.apiToken).toBe('apolla_a_b'));
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));
    expect(await screen.findByText(/connected as me@x\.ai/)).toBeInTheDocument();
  });
});
