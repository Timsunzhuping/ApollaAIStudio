import { describe, it, expect } from 'vitest';
import { StubSearchProvider } from './index';

describe('StubSearchProvider', () => {
  it('is deterministic for a given query', async () => {
    const p = new StubSearchProvider();
    const a = await p.search('EV market 2026');
    const b = await p.search('EV market 2026');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]!.url).toContain('https://');
  });

  it('honors explicit fixtures and the limit', async () => {
    const p = new StubSearchProvider({
      foo: [
        { title: 'A', url: 'https://a', snippet: 's' },
        { title: 'B', url: 'https://b', snippet: 's' },
      ],
    });
    expect(await p.search('foo', { limit: 1 })).toHaveLength(1);
  });
});
