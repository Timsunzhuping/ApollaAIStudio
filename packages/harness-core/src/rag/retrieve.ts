import type { UntrustedContent } from '@apolla/contracts';
import type { WorkspaceRepository } from '../workspace/types';
import { chunkDocument } from './chunk';
import { cosine, type EmbeddingProvider } from './embed';

export interface RetrieveOpts {
  ownerId: string;
  projectId?: string;
  query: string;
  topK?: number;
  /** Cap on files scanned (newest listing order) to bound cost at MVP scale. */
  maxFiles?: number;
}

/**
 * S27 — retrieve the owner's workspace passages most relevant to a research question.
 * Stateless per-run retrieval (list → chunk → embed → cosine top-k): no index to keep in
 * sync at MVP scale. File content is UNTRUSTED and flows only through the data channel;
 * chunks carry `file:<path>:<idx>` anchors so file-backed conclusions are citable.
 */
export async function retrieveWorkspaceEvidence(
  workspace: WorkspaceRepository,
  embedder: EmbeddingProvider,
  opts: RetrieveOpts,
): Promise<UntrustedContent[]> {
  const topK = opts.topK ?? 4;
  const maxFiles = opts.maxFiles ?? 20;
  const scope = { projectId: opts.projectId };

  const entries = (await workspace.list(opts.ownerId, scope)).slice(0, maxFiles);
  if (entries.length === 0) return [];

  const chunks = [] as { sourceId: string; path: string; idx: number; content: string }[];
  for (const e of entries) {
    const file = await workspace.read(opts.ownerId, e.path, scope);
    if (!file?.content) continue;
    chunks.push(...chunkDocument(e.path, file.content));
  }
  if (chunks.length === 0) return [];

  const [qv, ...vectors] = await embedder.embed([opts.query, ...chunks.map((c) => c.content)]);
  return chunks
    .map((c, i) => ({ chunk: c, score: cosine(qv!, vectors[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk }) => ({
      kind: 'untrusted' as const,
      sourceId: chunk.sourceId,
      origin: `file://${chunk.path}`,
      content: `${chunk.path} · 第 ${chunk.idx} 段\n${chunk.content}`,
    }));
}
