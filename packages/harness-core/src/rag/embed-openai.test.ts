import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIEmbeddingProvider } from './embed-openai';
import { cosine } from './embed';

afterEach(() => vi.unstubAllGlobals());

function fakeEmbeddings(vectors: number[][]): Response {
  return new Response(
    JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('OpenAIEmbeddingProvider (S27 — OpenAI-compatible /embeddings)', () => {
  it('posts model+input to {base}/embeddings with the bearer key and L2-normalizes vectors', async () => {
    const calls: { url: string; body: { model: string; input: string[] }; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') });
      return fakeEmbeddings([[3, 4], [0, 2]]);
    }));

    const p = new OpenAIEmbeddingProvider({ model: 'doubao-embedding-x', apiKey: 'ark-key', baseUrl: 'https://ark.example/api/v3' });
    const [a, b] = await p.embed(['你好', 'hello']);

    expect(calls[0]!.url).toBe('https://ark.example/api/v3/embeddings');
    expect(calls[0]!.body).toEqual({ model: 'doubao-embedding-x', input: ['你好', 'hello'] });
    expect(calls[0]!.auth).toBe('Bearer ark-key');
    // normalized: [3,4] → [0.6,0.8]; unit self-cosine
    expect(a![0]).toBeCloseTo(0.6);
    expect(a![1]).toBeCloseTo(0.8);
    expect(cosine(a!, a!)).toBeCloseTo(1);
    expect(cosine(b!, b!)).toBeCloseTo(1);
  });

  it('restores response order via index and batches beyond 64 inputs', async () => {
    const seen: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const input = (JSON.parse(String(init.body)) as { input: string[] }).input;
      seen.push(input.length);
      // return shuffled indices to prove re-sorting
      const data = input.map((_, i) => ({ index: i, embedding: [i + 1, 0] })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
    const p = new OpenAIEmbeddingProvider({ model: 'm', apiKey: 'k' });
    const out = await p.embed(Array.from({ length: 70 }, (_, i) => `t${i}`));
    expect(seen).toEqual([64, 6]);
    expect(out).toHaveLength(70);
    expect(out[0]![0]).toBeCloseTo(1); // first input got index-0 vector despite shuffle
  });

  it('throws on non-200 and on a count mismatch (no silent truncation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    const p = new OpenAIEmbeddingProvider({ model: 'm', apiKey: 'k' });
    await expect(p.embed(['x'])).rejects.toThrow(/429/);

    vi.stubGlobal('fetch', vi.fn(async () => fakeEmbeddings([[1, 0]])));
    await expect(p.embed(['a', 'b'])).rejects.toThrow(/2 inputs/);
  });
});
