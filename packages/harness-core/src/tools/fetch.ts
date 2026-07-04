import type { ToolResult, UntrustedContent } from '@apolla/contracts';
import type { Tool, ToolContext } from './types';

export interface FetchedPage {
  url: string;
  title: string;
  /** Readability-extracted main text, paragraph breaks preserved. */
  text: string;
}

export interface FetchOpts {
  signal?: AbortSignal;
}

/** A pluggable page-fetch backend (real HTTP or a deterministic fixture stub). Implemented in adapters. */
export interface FetchProvider {
  readonly name: string;
  fetchPage(url: string, opts?: FetchOpts): Promise<FetchedPage>;
}

export interface WebFetchArgs {
  url: string;
}

const SCHEMA = {
  type: 'object',
  properties: { url: { type: 'string' } },
  required: ['url'],
  additionalProperties: false,
};

const MAX_CHARS = 40_000;
const PARA_MIN = 40;

/** Reject non-http(s) and private/link-local hosts before any request is made (SSRF guard). */
export function assertPublicHttpUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivate =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host);
  if (isPrivate) throw new Error(`refusing to fetch private address: ${host}`);
  return u;
}

/**
 * Web Fetch tool (S25). Fetches a page, extracts its main text, and emits it as
 * paragraph-level UntrustedContent chunks — sourceId `fetch:<urlhash>:<paraIdx>`, origin = url.
 * risk = 'read'. Output flows ONLY through the data channel (PRD §12.E), never as instructions.
 */
export class WebFetchTool implements Tool<WebFetchArgs> {
  readonly name = 'web_fetch';
  readonly risk = 'read' as const;
  readonly source = 'native' as const;
  readonly schema = SCHEMA;
  private readonly provider: FetchProvider;

  constructor(provider: FetchProvider) {
    this.provider = provider;
  }

  async invoke(args: WebFetchArgs, ctx?: ToolContext): Promise<ToolResult> {
    try {
      assertPublicHttpUrl(args.url);
      const page = await this.provider.fetchPage(args.url, { signal: ctx?.signal });
      const text = page.text.slice(0, MAX_CHARS);
      const paras = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length >= PARA_MIN);
      const key = shortHash(page.url);
      const data: UntrustedContent[] = paras.map((p, i) => ({
        kind: 'untrusted' as const,
        sourceId: `fetch:${key}:${i + 1}`,
        origin: page.url,
        content: i === 0 ? `${page.title}\n${p}` : p,
      }));
      return { ok: true, data };
    } catch (e) {
      return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
