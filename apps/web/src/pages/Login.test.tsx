import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const login = vi.fn();
const completeMfa = vi.fn();
vi.mock('../lib/auth', () => ({ useAuth: () => ({ login, register: vi.fn(), completeMfa, loginWithMagicToken: vi.fn() }) }));
import { Login } from './Login';
import { fireEvent, waitFor } from '@testing-library/react';

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

  it('shows the MFA challenge when login returns mfaRequired (S20)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeRes(200, {})));
    login.mockResolvedValueOnce({ mfaRequired: true, pendingToken: 'pt' });
    render(<Login />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByPlaceholderText('at least 8 characters'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Two-factor authentication')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(completeMfa).toHaveBeenCalledWith('pt', '654321'));
  });
});
