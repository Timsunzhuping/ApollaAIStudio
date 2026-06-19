import type { SearchProvider, SearchHit, SearchOpts } from '@apolla/harness-core';

/**
 * Deterministic fixture search provider. Used as the offline default (no API key) and for
 * eval determinism (T14). Either supply explicit fixtures per query, or get generated hits
 * derived from the query so the same query always yields the same results.
 */
export class StubSearchProvider implements SearchProvider {
  readonly name = 'stub';

  constructor(private readonly fixtures: Record<string, SearchHit[]> = {}) {}

  async search(query: string, opts?: SearchOpts): Promise<SearchHit[]> {
    const hits = this.fixtures[query] ?? generate(query);
    return hits.slice(0, opts?.limit ?? 5);
  }
}

function generate(query: string): SearchHit[] {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'topic';
  return [1, 2, 3].map((n) => ({
    title: `${query} — reference ${n}`,
    url: `https://example.test/${slug}/${n}`,
    snippet: `Deterministic fixture snippet ${n} about "${query}".`,
  }));
}
