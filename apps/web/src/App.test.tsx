import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('App auth gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the login screen when not authenticated, then the shell after login', async () => {
    let authed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/auth/me')) return authed ? fakeRes(200, { id: 'u', email: 'a@b.c' }) : fakeRes(401, { error: 'no session' });
      if (u.endsWith('/api/auth/login')) { authed = true; return fakeRes(200, { id: 'u', email: 'a@b.c' }); }
      return fakeRes(200, []); // projects/skills etc.
    }));

    render(<App />);
    expect(await screen.findByText('Sign in to Apolla AI')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.c' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    // after login the protected shell renders (nav + research route)
    await waitFor(() => expect(screen.getByText('Apolla AI')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Research' })).toBeInTheDocument();
  });
});
