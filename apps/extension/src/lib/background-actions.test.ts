import { describe, it, expect, vi } from 'vitest';
import { handleMenuClick, type BackgroundDeps } from './background-actions';

function deps(captured: { selection: string; title: string; url: string } | null): BackgroundDeps & { set: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> } {
  const set = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  return { capture: async () => captured, storageSet: set, openSidePanel: open, now: () => 123, set, open };
}

describe('handleMenuClick', () => {
  it('stores the pending action with captured context and opens the panel', async () => {
    const d = deps({ selection: 'hi', title: 'T', url: 'u' });
    await handleMenuClick('research', { id: 7, title: 'tabT', url: 'taburl' }, d);
    expect(d.set).toHaveBeenCalledWith({ pendingAction: { action: 'research', context: { selection: 'hi', title: 'T', url: 'u' }, at: 123 } });
    expect(d.open).toHaveBeenCalledWith(7);
  });

  it('falls back to tab metadata when the page is not scriptable', async () => {
    const d = deps(null);
    await handleMenuClick('summarize', { id: 5, title: 'tabT', url: 'taburl' }, d);
    expect(d.set).toHaveBeenCalledWith({ pendingAction: { action: 'summarize', context: { selection: '', title: 'tabT', url: 'taburl' }, at: 123 } });
  });

  it('is a no-op without a tab id', async () => {
    const d = deps(null);
    await handleMenuClick('research', undefined, d);
    expect(d.set).not.toHaveBeenCalled();
    expect(d.open).not.toHaveBeenCalled();
  });
});
