import { describe, expect, it } from 'vitest';
import type { Snippet, UntrustedContent } from '@apolla/contracts';
import { fuzzyIncludes, pageKey, validateClaims, validateSnippets } from './verify';

const chunk = (id: string, content: string): UntrustedContent => ({
  kind: 'untrusted',
  sourceId: id,
  origin: 'https://x.test/p',
  content,
});

describe('fuzzyIncludes', () => {
  it('tolerates whitespace and quote-mark differences', () => {
    expect(fuzzyIncludes('Battery prices  fell below\n$90 per kWh', 'battery prices fell below $90')).toBe(true);
    expect(fuzzyIncludes('He said “prices fell”', `he said "prices fell"`)).toBe(true);
  });
  it('rejects paraphrase and empty needles', () => {
    expect(fuzzyIncludes('EV sales grew 25% in 2025', 'sales of EVs increased by a quarter')).toBe(false);
    expect(fuzzyIncludes('anything', '')).toBe(false);
  });
});

describe('validateSnippets (quote verification — the citation-correctness hard gate)', () => {
  const chunks = [
    chunk('fetch:a:1', 'EV sales reached 17 million units globally in 2025, a 25% increase.'),
    chunk('fetch:a:2', 'Battery pack prices fell below $90 per kilowatt-hour on average in 2025.'),
  ];
  let n = 0;
  const idGen = () => `sn-${++n}`;

  it('keeps verbatim quotes and assigns snippet ids', () => {
    const { snippets, rejected } = validateSnippets(
      { snippets: [{ sourceId: 'fetch:a:2', quote: 'prices fell below $90 per kilowatt-hour' }] },
      chunks,
      idGen,
    );
    expect(rejected).toBe(0);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]!.sourceId).toBe('fetch:a:2');
  });

  it('drops fabricated quotes and hallucinated sourceIds', () => {
    const { snippets, rejected } = validateSnippets(
      {
        snippets: [
          { sourceId: 'fetch:a:1', quote: 'EV sales reached 20 million units' }, // altered number
          { sourceId: 'fetch:zzz:9', quote: 'anything at all' }, // unknown chunk
        ],
      },
      chunks,
      idGen,
    );
    expect(snippets).toHaveLength(0);
    expect(rejected).toBe(2);
  });
});

describe('validateClaims (integrity + status recompute + display-source mapping)', () => {
  const sn = (id: string, sourceId: string): Snippet => ({ id, sourceId, quote: `q-${id}` });
  const snippets = [sn('s1', 'fetch:a:1'), sn('s2', 'fetch:b:1'), sn('s3', 'fetch:a:2')];
  const display = (chunkId: string) =>
    ({ 'fetch:a': 'src:1', 'fetch:b': 'src:2' })[pageKey(chunkId)];

  it('drops claims with no resolvable snippet support', () => {
    const out = validateClaims(
      { claims: [{ claim: 'x', supportingSnippetIds: ['nope'], conflictingSnippetIds: [], status: 'corroborated' }] },
      snippets,
      display,
    );
    expect(out).toHaveLength(0);
  });

  it('recomputes status from evidence: 2+ pages → corroborated, same page twice → single_source', () => {
    const out = validateClaims(
      {
        claims: [
          { claim: 'two pages', supportingSnippetIds: ['s1', 's2'], conflictingSnippetIds: [], status: 'single_source' },
          { claim: 'same page twice', supportingSnippetIds: ['s1', 's3'], conflictingSnippetIds: [], status: 'corroborated' },
        ],
      },
      snippets,
      display,
    );
    expect(out[0]!.status).toBe('corroborated');
    expect(out[0]!.sourceIds.sort()).toEqual(['src:1', 'src:2']);
    expect(out[1]!.status).toBe('single_source');
    expect(out[1]!.sourceIds).toEqual(['src:1']);
  });

  it('any surviving conflict forces disputed; snippetIds carry both sides', () => {
    const out = validateClaims(
      { claims: [{ claim: 'contested', supportingSnippetIds: ['s1'], conflictingSnippetIds: ['s2'], status: 'corroborated' }] },
      snippets,
      display,
    );
    expect(out[0]!.status).toBe('disputed');
    expect(out[0]!.snippetIds).toEqual(['s1', 's2']);
  });

  it('drops claims whose pages cannot be mapped to a display source', () => {
    const out = validateClaims(
      { claims: [{ claim: 'unmappable', supportingSnippetIds: ['s1'], conflictingSnippetIds: [], status: 'single_source' }] },
      [sn('s1', 'fetch:unknown:1')],
      display,
    );
    expect(out).toHaveLength(0);
  });
});
