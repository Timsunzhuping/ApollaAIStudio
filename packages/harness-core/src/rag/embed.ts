/**
 * S27 — pluggable embeddings. The stub is a deterministic hashed bag-of-words vector:
 * limited semantics, but shared-vocabulary texts score higher, it's CJK-aware
 * (per-character tokens), fully offline, and identical across processes — which keeps
 * tests/CI hermetic. A real provider (env-gated) slots in behind the same interface.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'stub';
  readonly dim: number;

  constructor(dim = 256) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    // CJK per character, latin per word — Chinese text without spaces still tokenizes.
    const tokens = text.toLowerCase().match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];
    for (const tok of tokens) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = ((h << 5) - h + tok.charCodeAt(i)) | 0;
      const slot = (h >>> 0) % this.dim;
      v[slot] = (v[slot] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/** Cosine over L2-normalized vectors. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}
