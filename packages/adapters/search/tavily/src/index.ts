import type { SearchProvider, SearchHit, SearchOpts } from '@apolla/harness-core';

const DEFAULT_BASE = 'https://api.tavily.com';

export interface TavilyOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Tavily search provider (fetch-based). Reads TAVILY_API_KEY by default. The orchestrator falls
 * back to the stub provider when no key is configured, so offline/CI runs stay deterministic.
 */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(opts: TavilyOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.TAVILY_API_KEY;
    this.baseUrl = opts.baseUrl ?? process.env.TAVILY_BASE_URL ?? DEFAULT_BASE;
  }

  static isConfigured(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchHit[]> {
    if (!this.apiKey) throw new Error('TAVILY_API_KEY is not set');
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: opts?.limit ?? 5,
        search_depth: 'basic',
      }),
      signal: opts?.signal,
    });
    if (!res.ok) {
      throw new Error(`Tavily ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const data: any = await res.json();
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    return results.map((r) => ({
      title: String(r?.title ?? ''),
      url: String(r?.url ?? ''),
      snippet: String(r?.content ?? ''),
    }));
  }
}
