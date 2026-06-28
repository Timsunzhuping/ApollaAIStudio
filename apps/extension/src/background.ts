import { capturePageContext } from './content';
import { handleMenuClick, type BackgroundDeps } from './lib/background-actions';

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

const deps: BackgroundDeps = {
  // activeTab + scripting: capture runs only on this user gesture, no static content script.
  capture: async (tabId) => {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePageContext });
    return (res?.result as ReturnType<typeof capturePageContext> | undefined) ?? null;
  },
  storageSet: (items) => chrome.storage.local.set(items),
  openSidePanel: async (tabId) => { await chrome.sidePanel?.open?.({ tabId }); },
  now: () => Date.now(),
};

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(String(info.menuItemId), tab, deps);
});
