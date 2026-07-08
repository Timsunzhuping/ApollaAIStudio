import { describe, it, expect, vi, afterEach } from 'vitest';
import { DdgSearchProvider, parseDdgHtml, BraveSearchProvider, parseBraveHtml } from './index';

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

// Fixture mirrors Brave's real SSR markup (svelte-hashed classes, data-pos blocks).
const BRAVE_PAGE = `
<div class="snippet svelte-jmfu5f" data-pos="1" data-type="web" data-keynav="true">
 <div class="result-content"><a href="https://imgs.search.brave.com/xx" class="favicon"><img/></a>
 <a href="https://crdt.tech/" target="_self" class="svelte-14r20fy l1"><div class="site-name-wrapper">Crdt</div></a>
 <div class="title svelte-abc">About <b>CRDTs</b> • Conflict-free Replicated Data Types</div>
 <svg viewBox="0 0 10 10"><path d="M9.9"/></svg>
 A Conflict-free Replicated Data Type (CRDT) is a data structure that simplifies distributed systems.
 </div></div>
<div class="snippet svelte-jmfu5f" data-pos="2" data-type="web">
 <a href="https://search.brave.com/internal" class="x">skip me</a></div>
<div class="snippet svelte-jmfu5f" data-pos="3" data-type="web">
 <a href="https://example.org/crdt-guide">x</a><span class="title svelte-q">CRDT Guide</span> Deep dive.</div>`;

describe('BraveSearchProvider (keyless, datacenter-friendly)', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SEARCH_PROVIDER; });

  it('parses blocks: url from the first external anchor, title element, remaining text as snippet', () => {
    const hits = parseBraveHtml(BRAVE_PAGE, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.url).toBe('https://crdt.tech/');
    expect(hits[0]!.title).toBe('About CRDTs • Conflict-free Replicated Data Types');
    expect(hits[0]!.snippet).toContain('data structure that simplifies');
    expect(hits[1]).toEqual({ title: 'CRDT Guide', url: 'https://example.org/crdt-guide', snippet: 'Deep dive.' });
  });

  it('search() hits /search?q= and is gated by SEARCH_PROVIDER=brave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => BRAVE_PAGE })));
    expect(BraveSearchProvider.isConfigured()).toBe(false);
    process.env.SEARCH_PROVIDER = 'brave';
    expect(BraveSearchProvider.isConfigured()).toBe(true);
    const hits = await new BraveSearchProvider().search('crdt', { limit: 1 });
    expect(hits).toHaveLength(1);
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toContain('/search?q=crdt');
  });
});
