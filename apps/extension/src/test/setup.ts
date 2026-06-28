import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

/** A fake ChromeFacade backed by a plain object — for tests. */
export function fakeFacade(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    storageGet: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store[k]])),
    storageSet: async (items: Record<string, unknown>) => { Object.assign(store, items); },
  };
}
