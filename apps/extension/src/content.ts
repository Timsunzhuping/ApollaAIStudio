/**
 * Page-context capture — injected into the active tab via chrome.scripting on a user gesture
 * (no static content script → least privilege). Returns the current selection + page metadata.
 * This value is UNTRUSTED data downstream (rendered as data, never executed).
 */
export interface PageContext {
  selection: string;
  title: string;
  url: string;
}

export function capturePageContext(): PageContext {
  return {
    selection: (typeof window !== 'undefined' ? window.getSelection?.()?.toString() : '') ?? '',
    title: typeof document !== 'undefined' ? document.title : '',
    url: typeof location !== 'undefined' ? location.href : '',
  };
}
