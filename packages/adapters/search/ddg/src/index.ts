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
