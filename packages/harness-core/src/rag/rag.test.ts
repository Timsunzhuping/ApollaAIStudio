import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunk';
import { StubEmbeddingProvider, cosine } from './embed';
import { retrieveWorkspaceEvidence } from './retrieve';
import { InMemoryWorkspaceRepository } from '../workspace/memory';

describe('chunkDocument', () => {
  it('packs paragraphs into anchored chunks and never exceeds maxChars per pack', () => {
    const text = ['AAA '.repeat(80).trim(), 'BBB '.repeat(80).trim(), 'CCC '.repeat(80).trim()].join('\n\n');
    const chunks = chunkDocument('notes/research.md', text, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.sourceId).toBe(`file:notes/research.md:${i + 1}`);
      expect(c.content.length).toBeLessThanOrEqual(400);
    });
  });

  it('hard-splits oversized single paragraphs and is deterministic', () => {
    const text = 'X'.repeat(3000);
    const a = chunkDocument('big.txt', text, { maxChars: 1000 });
    expect(a.length).toBe(3);
    expect(a).toEqual(chunkDocument('big.txt', text, { maxChars: 1000 }));
  });
});

describe('StubEmbeddingProvider', () => {
  const e = new StubEmbeddingProvider();
  it('same text → identical vectors; shared vocabulary → higher cosine (latin + CJK)', async () => {
    const [a1, a2, b, c, zh1, zh2, zh3] = await e.embed([
      'electric vehicle battery prices fell',
      'electric vehicle battery prices fell',
      'battery prices for electric cars declined',
      'quarterly meeting notes about hiring',
      '电动车电池价格下降',
      '电池价格持续下降',
      '会议纪要与招聘计划',
    ]);
    expect(cosine(a1!, a2!)).toBeCloseTo(1);
    expect(cosine(a1!, b!)).toBeGreaterThan(cosine(a1!, c!));
    expect(cosine(zh1!, zh2!)).toBeGreaterThan(cosine(zh1!, zh3!));
  });
});

describe('retrieveWorkspaceEvidence', () => {
  it('returns the most relevant passages as untrusted, anchored evidence', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await ws.write({ ownerId: 'u1', projectId: 'p1', path: 'industry/report.md', content: '2025 年全球电动车销量达到 1700 万辆，电池价格显著下降，市场集中度提升。' });
    await ws.write({ ownerId: 'u1', projectId: 'p1', path: 'hr/hiring.md', content: '工程团队扩编 40 人，重点方向为平台与安全，Q3 完成到岗。' });

    const out = await retrieveWorkspaceEvidence(ws, new StubEmbeddingProvider(), {
      ownerId: 'u1', projectId: 'p1', query: '电动车电池价格趋势', topK: 1,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('untrusted');
    expect(out[0]!.sourceId).toBe('file:industry/report.md:1');
    expect(out[0]!.origin).toBe('file://industry/report.md');
    expect(out[0]!.content).toContain('电池价格显著下降');
  });

  it('is scope-safe: another owner/project sees nothing', async () => {
    const ws = new InMemoryWorkspaceRepository();
    await ws.write({ ownerId: 'u1', projectId: 'p1', path: 'secret.md', content: '机密内容不应跨租户泄漏，本段足够长以形成一个块。' });
    const other = await retrieveWorkspaceEvidence(ws, new StubEmbeddingProvider(), { ownerId: 'u2', projectId: 'p1', query: '机密' });
    expect(other).toHaveLength(0);
    const otherProject = await retrieveWorkspaceEvidence(ws, new StubEmbeddingProvider(), { ownerId: 'u1', projectId: 'p2', query: '机密' });
    expect(otherProject).toHaveLength(0);
  });

  it('returns empty for an empty workspace', async () => {
    const out = await retrieveWorkspaceEvidence(new InMemoryWorkspaceRepository(), new StubEmbeddingProvider(), { ownerId: 'u1', query: 'x' });
    expect(out).toEqual([]);
  });
});
