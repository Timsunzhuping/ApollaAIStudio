import { describe, it, expect } from 'vitest';
import { TavilySearchProvider } from './index';

/** Real network smoke test — runs only when TAVILY_API_KEY is set. Skipped in normal CI. */
describe.skipIf(!process.env.TAVILY_API_KEY)('TavilySearchProvider (smoke)', () => {
  it('returns structured hits', async () => {
    const hits = await new TavilySearchProvider().search('electric vehicle market 2026', {
      limit: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toContain('http');
    expect(typeof hits[0]!.title).toBe('string');
  });
});
