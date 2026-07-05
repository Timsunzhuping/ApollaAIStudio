import type { EmbeddingProvider } from './embed';

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BATCH = 64;

export interface OpenAIEmbeddingOpts {
  /** Embeddings model id at the gateway (e.g. text-embedding-3-small, doubao-embedding-*). */
  model: string;
  apiKey: string;
  /** OpenAI-compatible base URL (Ark/DeepSeek/vLLM…); defaults to the real OpenAI endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Real embeddings via any OpenAI-compatible `/embeddings` endpoint (S27 follow-up).
 * Enabled when EMBEDDINGS_MODEL + OPENAI_API_KEY are set; the deterministic stub remains
 * the default so tests/CI/offline demo stay hermetic. Vectors are L2-normalized so the
 * retrieval cosine (which assumes unit vectors) is correct regardless of provider scaling.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  readonly dim = -1; // provider-defined; retrieval only needs cosine over same-provider vectors
  private readonly o: Required<Omit<OpenAIEmbeddingOpts, 'baseUrl' | 'timeoutMs'>> & { baseUrl: string; timeoutMs: number };

  constructor(opts: OpenAIEmbeddingOpts) {
    this.o = {
      model: opts.model,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? DEFAULT_BASE,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
      try {
        const res = await fetch(`${this.o.baseUrl}/embeddings`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
          body: JSON.stringify({ model: this.o.model, input: batch }),
        });
        if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
        const sorted = [...body.data].sort((a, b) => a.index - b.index);
        if (sorted.length !== batch.length) throw new Error(`embeddings returned ${sorted.length} vectors for ${batch.length} inputs`);
        out.push(...sorted.map((d) => normalize(d.embedding)));
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  }
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
