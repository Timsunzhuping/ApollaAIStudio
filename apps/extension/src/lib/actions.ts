import type { PageContext } from '../content';

export type Action = 'research' | 'summarize' | 'translate';

export type Plan =
  | { kind: 'research'; question: string; label: string }
  | { kind: 'surface'; surfaceId: string; text: string; params: Record<string, unknown>; label: string };

/**
 * Map a context-menu action + captured page context to an execution plan (pure → unit-testable).
 * Prefers the selection; falls back to the page title/URL. Page content is UNTRUSTED — the plan only
 * carries it as data for the BFF (rendered as data, never executed).
 */
export function planAction(action: string, ctx: PageContext): Plan {
  const sel = (ctx.selection ?? '').trim();
  const fallback = (ctx.title || ctx.url || '').trim();
  const text = sel || fallback;
  if (action === 'translate') {
    return { kind: 'surface', surfaceId: 'translate-text', text, params: { targetLang: 'English' }, label: 'Translation' };
  }
  if (action === 'summarize') {
    return { kind: 'surface', surfaceId: 'summarize', text, params: {}, label: 'Summary' };
  }
  // research (default)
  return { kind: 'research', question: text, label: 'Research' };
}
