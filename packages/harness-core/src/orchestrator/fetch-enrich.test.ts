import { describe, expect, it } from 'vitest';
import type { UntrustedContent } from '@apolla/contracts';
import { ToolRuntime } from '../tools/runtime';
import { WebFetchTool } from '../tools/fetch';
import { StubFetchProvider } from '../tools/fetch-stub';
import { fetchEnrichEvidence } from './fetch-enrich';

const hit = (id: string, origin: string): UntrustedContent => ({
  kind: 'untrusted',
  sourceId: id,
  origin,
  content: `${origin}\nsearch snippet`,
});

describe('fetchEnrichEvidence (S25 SEARCH-stage enrichment)', () => {
  it('returns empty gracefully when web_fetch is not registered', async () => {
    const rt = new ToolRuntime();
    const r = await fetchEnrichEvidence(rt, [hit('a:1', 'https://a.test/x')]);
    expect(r.evidence).toEqual([]);
    expect(r.fetched).toBe(0);
  });

  it('fetches top-N unique origins and returns their paragraph evidence', async () => {
    const rt = new ToolRuntime();
    rt.register(new WebFetchTool(new StubFetchProvider()));
    const hits = [
      hit('a:1', 'https://a.test/one'),
      hit('a:2', 'https://a.test/one'), // duplicate origin — counted once
      hit('b:1', 'https://b.test/two'),
    ];
    const r = await fetchEnrichEvidence(rt, hits, { topN: 5 });
    expect(r.fetched).toBe(2);
    expect(r.evidence.length).toBeGreaterThanOrEqual(2);
    expect(r.evidence.every((e) => e.kind === 'untrusted')).toBe(true);
    expect(r.degradedOrigins).toEqual([]);
  });

  it('records degraded origins when a fetch fails, without throwing', async () => {
    const rt = new ToolRuntime();
    // A provider that throws for one host and succeeds for another.
    rt.register(
      new WebFetchTool({
        name: 'flaky',
        async fetchPage(url: string) {
          if (url.includes('bad')) throw new Error('boom');
          return { url, title: 'ok', text: 'A sufficiently long paragraph of real content for extraction.' };
        },
      }),
    );
    const r = await fetchEnrichEvidence(rt, [hit('a:1', 'https://good.test/x'), hit('b:1', 'https://bad.test/y')]);
    expect(r.fetched).toBe(1);
    expect(r.degradedOrigins).toEqual(['https://bad.test/y']);
  });

  it('ignores non-http origins (e.g. memory: evidence)', async () => {
    const rt = new ToolRuntime();
    rt.register(new WebFetchTool(new StubFetchProvider()));
    const r = await fetchEnrichEvidence(rt, [hit('mem:1', 'memory')]);
    expect(r.fetched).toBe(0);
  });
});
