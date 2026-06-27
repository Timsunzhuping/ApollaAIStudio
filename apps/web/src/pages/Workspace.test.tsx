import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Workspace } from './Workspace';

function fakeRes(status: number, payload: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

describe('Workspace page', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/workspace')) return fakeRes(200, [{ path: 'report.md', mime: 'text/markdown', version: 2, size: 10 }]);
      if (u.includes('/api/workspace/file')) return fakeRes(200, { path: 'report.md', mime: 'text/markdown', version: 2, size: 10, content: 'hello report' });
      if (u.includes('/api/workspace/history')) return fakeRes(200, [{ path: 'report.md', version: 1 }, { path: 'report.md', version: 2 }]);
      return fakeRes(200, {});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists files and opens one to show its content', async () => {
    render(<Workspace />);
    const link = await screen.findByText('📄 report.md');
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByText('hello report')).toBeInTheDocument());
    expect(screen.getByText(/report\.md · v2\/2/)).toBeInTheDocument();
  });
});
