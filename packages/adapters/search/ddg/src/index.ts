import type { SearchProvider, SearchHit, SearchOpts } from '@apolla/harness-core';

const DEFAULT_BASE = 'https://html.duckduckgo.com';

export interface DdgOptions {
  baseUrl?: string;
}

/**
 * Keyless DuckDuckGo search over the plain-HTML endpoint (S25 ops). Real web results with no API
 * key — the pragmatic default until a proper search API key (e.g. Tavily) is configured; the harness
 * prefers Tavily when keyed. Env-gated by SEARCH_PROVIDER=duckduckgo so offline/CI stays on the stub.
 * Results are UNTRUSTED DATA like every remote source (wrapped by the orchestrator's safety layer).
 * Best-effort parsing of a minimal HTML page; on failure it throws and the caller surfaces the error.
 */
export class DdgSearchProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  private readonly baseUrl: string;

  constructor(opts: DdgOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.DDG_BASE_URL ?? DEFAULT_BASE;
  }

  static isConfigured(): boolean {
    return process.env.SEARCH_PROVIDER === 'duckduckgo';
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchHit[]> {
    const res = await fetch(`${this.baseUrl}/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        // A plain browser UA — the endpoint serves the no-JS HTML page.
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
    return parseDdgHtml(await res.text(), opts?.limit ?? 5);
  }
}

/** Result anchors look like <a class="result__a" href="...">title</a> with a sibling result__snippet. */
export function parseDdgHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/g;
  const snippets: string[] = [];
  for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) snippets.push(stripTags(m[1] ?? ''));
  let i = 0;
  for (let m = linkRe.exec(html); m && hits.length < limit; m = linkRe.exec(html), i++) {
    const url = decodeDdgUrl(m[1] ?? '');
    if (!url || !/^https?:\/\//.test(url)) continue;
    hits.push({ title: stripTags(m[2] ?? ''), url, snippet: snippets[i] ?? '' });
  }
  return hits;
}

/** DDG wraps result urls as //duckduckgo.com/l/?uddg=<encoded>&rut=… — unwrap to the real target. */
function decodeDdgUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m?.[1]) {
    try { return decodeURIComponent(m[1]); } catch { return ''; }
  }
  return href;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BRAVE_BASE = 'https://search.brave.com';

/**
 * Keyless Brave Search over its server-rendered HTML (SEARCH_PROVIDER=brave). In practice Brave is
 * the engine that serves real results to datacenter IPs where DuckDuckGo answers with a bot
 * challenge, so it's the default recommendation for cloud deployments. Same trust model as every
 * remote source: results are UNTRUSTED DATA.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  private readonly baseUrl: string;

  constructor(opts: DdgOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.BRAVE_BASE_URL ?? BRAVE_BASE;
  }

  static isConfigured(): boolean {
    return process.env.SEARCH_PROVIDER === 'brave';
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchHit[]> {
    const res = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: opts?.signal,
    });
    if (!res.ok) throw new Error(`Brave ${res.status}`);
    return parseBraveHtml(await res.text(), opts?.limit ?? 5);
  }
}

/**
 * Brave results are `<div class="snippet …" data-pos="N" data-type="web">` blocks: the first external
 * anchor is the result url, the element whose class contains `title` holds the title, and the
 * remaining block text (minus svg noise) is the description. Class names are svelte-hashed, so we
 * anchor on the stable bits (`snippet`, `data-pos`, `title`).
 */
export function parseBraveHtml(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/<div class="snippet[^"]*" data-pos="/).slice(1);
  for (const block of blocks) {
    if (hits.length >= limit) break;
    const seg = block.slice(0, 6000).replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<path[^>]*>/g, ' ');
    // First acceptable anchor wins — skip favicons/imgs proxies and brave-internal links.
    let url = '';
    const anchorRe = /<a[^>]*href="(https?:\/\/[^"]+)"/g;
    for (let a = anchorRe.exec(seg); a; a = anchorRe.exec(seg)) {
      const candidate = a[1] ?? '';
      if (candidate && !/\bbrave\.com\//.test(candidate)) { url = candidate; break; }
    }
    if (!url) continue;
    const titleMatch = seg.match(/class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]{0,400}?)<\/(?:div|span|a|h\d)>/);
    const title = stripTags(titleMatch?.[1] ?? '');
    if (!title) continue;
    // Description: the block's text after the title text.
    const text = stripTags(seg);
    const at = text.indexOf(title);
    const snippet = (at >= 0 ? text.slice(at + title.length) : text).trim().slice(0, 300);
    hits.push({ title, url, snippet });
  }
  return hits;
}
