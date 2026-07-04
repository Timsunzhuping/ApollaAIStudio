import type { UntrustedContent } from '@apolla/contracts';
import type { ToolRuntime } from '../tools/runtime';

export interface FetchEnrichResult {
  /** Fetched paragraph-level evidence (empty if the fetch tool is absent or every fetch failed). */
  evidence: UntrustedContent[];
  /** Origins whose fetch failed → caller marks their source as degraded (search-snippet only). */
  degradedOrigins: string[];
  fetched: number;
  /**
   * chunk page key (`fetch:<hash>`) → the origin URL that was requested. Lets callers map a
   * fetched chunk back to the search hit it came from (redirects can change the final URL).
   */
  requestedOriginByPage: Record<string, string>;
}

/**
 * S25 SEARCH-stage enrichment: for the top-N unique origins among search hits, fetch the page
 * and return its real article text as evidence. Fully graceful — if `web_fetch` isn't registered,
 * or a page can't be fetched, it degrades to the search snippet (never throws, never blocks the run).
 * Fetched content is untrusted and flows only through the data channel.
 */
export async function fetchEnrichEvidence(
  tools: ToolRuntime,
  searchHits: UntrustedContent[],
  opts: { topN?: number; taskId?: string } = {},
): Promise<FetchEnrichResult> {
  const empty: FetchEnrichResult = { evidence: [], degradedOrigins: [], fetched: 0, requestedOriginByPage: {} };
  if (!tools.has('web_fetch')) return empty;

  const topN = opts.topN ?? 5;
  const origins: string[] = [];
  for (const h of searchHits) {
    if (h.origin && /^https?:\/\//i.test(h.origin) && !origins.includes(h.origin)) origins.push(h.origin);
    if (origins.length >= topN) break;
  }

  const evidence: UntrustedContent[] = [];
  const degradedOrigins: string[] = [];
  const requestedOriginByPage: Record<string, string> = {};
  let fetched = 0;
  for (const origin of origins) {
    try {
      const res = await tools.invoke<{ url: string }>('web_fetch', { url: origin }, { taskId: opts.taskId });
      if (res.ok && res.data.length > 0) {
        evidence.push(...res.data);
        const page = res.data[0]!.sourceId.replace(/:\d+$/, '');
        requestedOriginByPage[page] = origin;
        fetched++;
      } else {
        degradedOrigins.push(origin);
      }
    } catch {
      degradedOrigins.push(origin);
    }
  }
  return { evidence, degradedOrigins, fetched, requestedOriginByPage };
}
