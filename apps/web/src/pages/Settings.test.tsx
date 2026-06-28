import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings';
import { AuthProvider } from '../lib/auth';

const renderSettings = () => render(<AuthProvider><Settings /></AuthProvider>);

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/memory/model')) return fakeRes(200, { language: 'English', style: 'concise' });
      if (u.endsWith('/api/tokens') && (init?.method ?? 'GET') === 'GET') return fakeRes(200, []);
      if (u.endsWith('/api/tokens') && init?.method === 'POST') return fakeRes(201, { id: 't1', name: 'ext', token: 'apolla_t1_secret' });
      if (u.endsWith('/api/mcp/manifest')) return fakeRes(200, { endpoint: '/api/mcp', protocol: 'mcp/2024-11-05', tools: [{ name: 'apolla.research', description: 'Run research' }] });
      if (u.endsWith('/api/auth/mfa/enroll') && init?.method === 'POST') return fakeRes(200, { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Apolla:a@b.c?secret=JBSWY3DPEHPK3PXP', recoveryCodes: ['aaaa1', 'bbbb2'] });
      if (u.endsWith('/api/auth/mfa/verify') && init?.method === 'POST') return fakeRes(200, { mfaEnabled: true });
      if (u.endsWith('/api/auth/me')) return fakeRes(200, { id: 'u1', email: 'me@x.ai' });
      if (u.endsWith('/api/account/export')) return fakeRes(200, { version: 1, projects: [] });
      if (u.endsWith('/api/account/import')) return fakeRes(200, { projects: 2, skills: 1, workspace: 3 });
      if (u.endsWith('/api/account/delete')) return fakeRes(200, { deleted: true });
      if (u.endsWith('/api/auth/logout')) return fakeRes(200, { ok: true });
      return fakeRes(200, {});
    }));
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads existing preferences and saves changes', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderSettings();
    await waitFor(() => expect((screen.getByPlaceholderText(/Preferred language|English, Chinese/i) as HTMLInputElement).value).toBe('English'));
    fireEvent.click(screen.getByRole('button', { name: /Save preferences/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/memory/model') && (c[1] as RequestInit)?.method === 'POST')).toBe(true),
    );
    expect(await screen.findByText('✓ saved')).toBeInTheDocument();
  });

  it('creates an API token and shows the plaintext once', async () => {
    renderSettings();
    fireEvent.change(await screen.findByPlaceholderText(/token name/i), { target: { value: 'ext' } });
    fireEvent.click(screen.getByRole('button', { name: /Create token/i }));
    expect(await screen.findByText('apolla_t1_secret')).toBeInTheDocument();
  });

  it('shows the MCP server endpoint + tool catalog', async () => {
    renderSettings();
    expect(await screen.findByText('MCP server')).toBeInTheDocument();
    expect(await screen.findByText('apolla.research')).toBeInTheDocument();
    expect((screen.getByDisplayValue(/\/api\/mcp$/) as HTMLInputElement).value).toContain('/api/mcp');
  });

  it('enrolls in two-factor: enable → backup codes → confirm (S20)', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByText('aaaa1')).toBeInTheDocument(); // backup codes shown once
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('✓ Enabled')).toBeInTheDocument();
  });

  it('exports data (calls the endpoint + triggers a download)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderSettings();
    fireEvent.click(await screen.findByTestId('export-data'));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/account/export'))).toBe(true));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('imports an export file and reports the restored counts', async () => {
    renderSettings();
    const input = (await screen.findByTestId('import-data')) as HTMLInputElement;
    const file = new File(['{}'], 'export.json', { type: 'application/json' });
    file.text = async () => JSON.stringify({ version: 1, projects: [{ name: 'P' }] });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByTestId('import-msg')).toHaveTextContent('Imported 2 projects, 1 skills, 3 files.');
  });

  it('deletes the account only after email confirmation, then logs out', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderSettings();
    fireEvent.click(await screen.findByTestId('delete-open'));
    fireEvent.change(screen.getByTestId('delete-confirm'), { target: { value: 'me@x.ai' } });
    fireEvent.click(screen.getByTestId('delete-submit'));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/account/delete') && (c[1] as RequestInit)?.method === 'POST')).toBe(true));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/auth/logout'))).toBe(true));
  });
});
