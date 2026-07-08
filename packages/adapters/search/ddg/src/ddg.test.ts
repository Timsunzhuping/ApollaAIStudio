import { describe, it, expect, vi, afterEach } from 'vitest';
import { DdgSearchProvider, parseDdgHtml } from './index';

const PAGE = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcrdt.tech%2F&rut=abc">About <b>CRDTs</b></a>
  <a class="result__snippet" href="#">A <b>CRDT</b> is a data structure that converges.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://example.com/plain">Plain link</a>
  <a class="result__snippet" href="#">Second &amp; snippet</a>
</div>
<div class="result">
  <a class="result__a" href="javascript:void(0)">Bad scheme</a>
</div>`;

describe('DdgSearchProvider (keyless real search)', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SEARCH_PROVIDER; });

  it('parses titles, unwraps uddg redirect urls, strips tags, drops non-http results', () => {
    const hits = parseDdgHtml(PAGE, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ title: 'About CRDTs', url: 'https://crdt.tech/', snippet: 'A CRDT is a data structure that converges.' });
    expect(hits[1]!.url).toBe('https://example.com/plain');
    expect(hits[1]!.snippet).toBe('Second & snippet');
  });

  it('respects the limit', () => {
    expect(parseDdgHtml(PAGE, 1)).toHaveLength(1);
  });

  it('search() fetches the html endpoint and parses (mocked — hermetic)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => PAGE })));
    const hits = await new DdgSearchProvider().search('crdt', { limit: 5 });
    expect(hits[0]!.url).toBe('https://crdt.tech/');
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toContain('/html/?q=crdt');
  });

  it('is gated by SEARCH_PROVIDER=duckduckgo', () => {
    expect(DdgSearchProvider.isConfigured()).toBe(false);
    process.env.SEARCH_PROVIDER = 'duckduckgo';
    expect(DdgSearchProvider.isConfigured()).toBe(true);
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => '' })));
    await expect(new DdgSearchProvider().search('x')).rejects.toThrow(/429/);
  });
});
