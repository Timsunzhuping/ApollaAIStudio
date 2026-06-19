import type { ToolResult, UntrustedContent } from '@apolla/contracts';
import type { Tool, ToolContext } from './types';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOpts {
  limit?: number;
  signal?: AbortSignal;
}

/** A pluggable web-search backend (real provider or fixture stub). Implemented in adapters. */
export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOpts): Promise<SearchHit[]>;
}

export interface WebSearchArgs {
  query: string;
  limit?: number;
}

const SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  },
  required: ['query'],
  additionalProperties: false,
};

/**
 * Web Search tool. Wraps every hit as UntrustedContent (origin = url) so downstream code can
 * only treat results as evidence/data, never as instructions (PRD §12.E). risk = 'read'.
 */
export class WebSearchTool implements Tool<WebSearchArgs> {
  readonly name = 'web_search';
  readonly risk = 'read' as const;
  readonly source = 'native' as const;
  readonly schema = SCHEMA;

  constructor(private readonly provider: SearchProvider) {}

  async invoke(args: WebSearchArgs, ctx?: ToolContext): Promise<ToolResult> {
    try {
      const hits = await this.provider.search(args.query, { limit: args.limit, signal: ctx?.signal });
      const data: UntrustedContent[] = hits.map((h, i) => ({
        kind: 'untrusted',
        sourceId: `${this.provider.name}:${i + 1}`,
        origin: h.url,
        content: `${h.title}\n${h.snippet}`,
      }));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}
