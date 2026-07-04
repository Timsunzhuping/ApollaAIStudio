import { z } from 'zod';
import type { Citation, Snippet, UntrustedContent } from '@apolla/contracts';

/** LLM output shape for the EXTRACT stage (S25): selected verbatim quotes per subquestion. */
export const SnippetsResult = z.object({
  snippets: z
    .array(
      z.object({
        sourceId: z.string(),
        quote: z.string().max(600),
        relevance: z.string().optional(),
      }),
    )
    .default([]),
});
export type SnippetsResultT = z.infer<typeof SnippetsResult>;

/** LLM output shape for the COMPARE stage (S25): cross-source claims over snippet ids. */
export const ClaimsCompareResult = z.object({
  claims: z
    .array(
      z.object({
        claim: z.string(),
        supportingSnippetIds: z.array(z.string()).default([]),
        conflictingSnippetIds: z.array(z.string()).default([]),
        status: z.enum(['corroborated', 'single_source', 'disputed']),
      }),
    )
    .default([]),
});
export type ClaimsCompareResultT = z.infer<typeof ClaimsCompareResult>;

/** Whitespace/quote-mark tolerant substring check — the programmatic ground truth for citation correctness. */
export function fuzzyIncludes(haystack: string, needle: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[“”"'‘’]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const n = norm(needle);
  return n.length > 0 && norm(haystack).includes(n);
}

/**
 * Validate LLM-selected snippets against the evidence chunks they claim to quote:
 * the sourceId must exist and the quote must be a verbatim (fuzzy-whitespace) substring
 * of that chunk. Failures are dropped, never repaired — citation correctness is enforced
 * here rather than trusted from the model.
 */
export function validateSnippets(
  raw: z.input<typeof SnippetsResult>,
  chunks: UntrustedContent[],
  idGen: () => string,
): { snippets: Snippet[]; rejected: number } {
  const byId = new Map(chunks.map((c) => [c.sourceId, c]));
  const snippets: Snippet[] = [];
  let rejected = 0;
  for (const s of raw.snippets ?? []) {
    const chunk = byId.get(s.sourceId);
    if (!chunk || !fuzzyIncludes(chunk.content, s.quote)) {
      rejected++;
      continue;
    }
    snippets.push({ id: idGen(), sourceId: s.sourceId, quote: s.quote, relevance: s.relevance });
  }
  return { snippets, rejected };
}

/** `fetch:<page>:<para>` → `fetch:<page>`; ids without a paragraph suffix pass through. */
export function pageKey(sourceId: string): string {
  return sourceId.replace(/:\d+$/, '');
}

/**
 * Validate compared claims and convert them to contract Citations:
 * - claims must be supported by known snippet ids (unknown ids are dropped; no support → claim dropped);
 * - status is RECOMPUTED from evidence rather than trusted: any conflict → disputed;
 *   support from 2+ distinct pages → corroborated; else single_source;
 * - sourceIds are mapped to DISPLAY source ids via the chunk-origin map so citations always
 *   reference task.sources (citation-correctness eval invariant).
 */
export function validateClaims(
  raw: z.input<typeof ClaimsCompareResult>,
  snippets: Snippet[],
  displaySourceIdForChunk: (chunkSourceId: string) => string | undefined,
): Citation[] {
  const byId = new Map(snippets.map((s) => [s.id, s]));
  const citations: Citation[] = [];
  for (const c of raw.claims ?? []) {
    const support = (c.supportingSnippetIds ?? []).filter((id) => byId.has(id));
    const conflict = (c.conflictingSnippetIds ?? []).filter((id) => byId.has(id));
    if (support.length === 0) continue;
    const pages = new Set(support.map((id) => pageKey(byId.get(id)!.sourceId)));
    const status = conflict.length > 0 ? ('disputed' as const) : pages.size >= 2 ? ('corroborated' as const) : ('single_source' as const);
    const sourceIds = [
      ...new Set(
        support
          .map((id) => displaySourceIdForChunk(byId.get(id)!.sourceId))
          .filter((s): s is string => !!s),
      ),
    ];
    if (sourceIds.length === 0) continue;
    citations.push({ claim: c.claim, sourceIds, snippetIds: [...support, ...conflict], status });
  }
  return citations;
}
