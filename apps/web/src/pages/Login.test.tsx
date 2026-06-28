import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ login: vi.fn(), register: vi.fn() }) }));
import { Login } from './Login';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Login SSO', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders SSO buttons for registered providers linking to /start', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('/api/auth/providers') ? fakeRes(200, { providers: ['google', 'github'] }) : fakeRes(200, {}),
    ));
    render(<Login />);
    const g = (await screen.findByText('Continue with Google')) as HTMLAnchorElement;
    expect(g.getAttribute('href')).toContain('/api/auth/oauth/google/start');
    expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
  });

  it('shows no SSO section when no providers are registered', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).endsWith('/api/auth/providers') ? fakeRes(200, { providers: [] }) : fakeRes(200, {}),
    ));
    render(<Login />);
    await screen.findByText('Sign in to Apolla AI');
    expect(screen.queryByText(/Continue with/)).toBeNull();
  });
});
