/**
 * Thin facade over the chrome.* APIs the extension uses, so logic stays unit-testable (jsdom has no
 * `chrome`). The real impl delegates to chrome.*; tests inject a fake.
 */
export interface ChromeFacade {
  storageGet(keys: string[]): Promise<Record<string, unknown>>;
  storageSet(items: Record<string, unknown>): Promise<void>;
}

export const realChrome: ChromeFacade = {
  storageGet: (keys) => chrome.storage.local.get(keys),
  storageSet: (items) => chrome.storage.local.set(items),
};

export interface ExtensionConfig {
  base: string;
  token: string;
}

export async function readConfig(facade: ChromeFacade): Promise<ExtensionConfig> {
  const { apiBase, apiToken } = await facade.storageGet(['apiBase', 'apiToken']);
  return { base: (apiBase as string) || 'http://localhost:3000', token: (apiToken as string) || '' };
}

export function writeConfig(facade: ChromeFacade, cfg: Partial<ExtensionConfig>): Promise<void> {
  const items: Record<string, unknown> = {};
  if (cfg.base !== undefined) items.apiBase = cfg.base;
  if (cfg.token !== undefined) items.apiToken = cfg.token;
  return facade.storageSet(items);
}
