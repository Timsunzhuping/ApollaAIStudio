import { capturePageContext } from './content';

// Context-menu actions; the side panel reads the pending action from chrome.storage on open.
const MENU: { id: string; title: string }[] = [
  { id: 'research', title: 'Research selection with Apolla' },
  { id: 'summarize', title: 'Summarize page with Apolla' },
  { id: 'translate', title: 'Translate selection with Apolla' },
];

chrome.runtime.onInstalled.addListener(() => {
  for (const m of MENU) chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ['selection', 'page'] });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  let context = { selection: '', title: tab.title ?? '', url: tab.url ?? '' };
  try {
    // activeTab + scripting: capture runs only on this user gesture, no static content script.
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePageContext });
    if (res?.result) context = res.result as typeof context;
  } catch {
    /* page not scriptable (chrome:// etc) — fall back to tab metadata */
  }
  await chrome.storage.local.set({ pendingAction: { action: String(info.menuItemId), context, at: Date.now() } });
  if (chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});
