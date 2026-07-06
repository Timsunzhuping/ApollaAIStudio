import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/research']}>
      <CommandPalette />
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CommandPalette (S26A ⌘K)', () => {
  it('opens with cmd+k, filters, and navigates on Enter', async () => {
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const input = await screen.findByLabelText('搜索命令');

    fireEvent.change(input, { target: { value: '收件箱' } });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('任务收件箱');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('loc')).toHaveTextContent('/inbox');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports arrow-key selection, Escape close, and english keywords', async () => {
    setup();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('搜索命令');

    fireEvent.change(input, { target: { value: 'chat' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('打开聊天');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an empty state for no matches', async () => {
    setup();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    fireEvent.change(await screen.findByLabelText('搜索命令'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('没有匹配的命令')).toBeInTheDocument();
  });
});
