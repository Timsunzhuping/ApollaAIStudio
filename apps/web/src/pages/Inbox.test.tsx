import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Inbox } from './Inbox';

function fakeJson(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Inbox (S26 task history)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/api/tasks')) return fakeJson([
        { id: 't1', question: '固态电池进展', state: 'done', totalCostUsd: 0.12, createdAt: '2026-07-05T10:00:00Z', citations: 4 },
        { id: 't2', question: '失败的任务', state: 'failed', totalCostUsd: 0, createdAt: '2026-07-05T09:00:00Z', citations: 0 },
      ]);
      if (u.includes('/api/tasks/t1')) return fakeJson({ id: 't1', state: 'done', artifacts: [{ content: '# 报告\n\n结论正文。' }], totalCostUsd: 0.12 });
      return fakeJson({});
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists tasks with status/cost/citations, filters, and expands a report with export links', async () => {
    render(<Inbox />);
    expect(await screen.findByText('固态电池进展')).toBeInTheDocument();
    expect(screen.getByText('失败的任务')).toBeInTheDocument();
    expect(screen.getByText('4 引用')).toBeInTheDocument();

    // filter: 失败
    fireEvent.click(screen.getByRole('button', { name: /失败 1/ }));
    expect(screen.queryByText('固态电池进展')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /全部 2/ }));

    // expand → report + export links (incl. docx)
    fireEvent.click(screen.getByRole('button', { name: /固态电池进展/ }));
    expect(await screen.findByText('结论正文。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Export .docx').getAttribute('href')).toContain('/api/tasks/t1/export?fmt=docx'));
  });
});
