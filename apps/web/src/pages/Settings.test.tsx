import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/api/memory/model')) return fakeRes(200, { language: 'English', style: 'concise' });
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads existing preferences and saves changes', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<Settings />);
    await waitFor(() => expect((screen.getByPlaceholderText(/Preferred language|English, Chinese/i) as HTMLInputElement).value).toBe('English'));
    fireEvent.click(screen.getByRole('button', { name: /Save preferences/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/memory/model') && (c[1] as RequestInit)?.method === 'POST')).toBe(true),
    );
    expect(await screen.findByText('✓ saved')).toBeInTheDocument();
  });
});
