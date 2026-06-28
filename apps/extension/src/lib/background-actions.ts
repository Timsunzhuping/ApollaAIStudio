import type { PageContext } from '../content';

/** Injected dependencies so the background routing logic is unit-testable (no chrome.* in jsdom). */
export interface BackgroundDeps {
  /** Capture page context from the tab (via chrome.scripting); null if the page isn't scriptable. */
  capture(tabId: number): Promise<PageContext | null>;
  storageSet(items: Record<string, unknown>): Promise<void>;
  openSidePanel(tabId: number): Promise<void>;
  now(): number;
}

/**
 * Handle a context-menu click: capture the page context (falling back to tab metadata), persist the
 * pending action for the side panel to pick up, and open the panel. Pure (deps injected).
 */
export async function handleMenuClick(
  menuItemId: string,
  tab: { id?: number; title?: string; url?: string } | undefined,
  deps: BackgroundDeps,
): Promise<void> {
  if (!tab?.id) return;
  let context: PageContext = { selection: '', title: tab.title ?? '', url: tab.url ?? '' };
  const captured = await deps.capture(tab.id).catch(() => null);
  if (captured) context = captured;
  await deps.storageSet({ pendingAction: { action: menuItemId, context, at: deps.now() } });
  await deps.openSidePanel(tab.id);
}
