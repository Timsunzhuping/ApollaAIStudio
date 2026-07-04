/**
 * S27 — paragraph-first chunking with stable anchors. A chunk's sourceId
 * (`file:<path>:<idx>`) is citable end-to-end: it survives extraction verification and
 * appears in the evidence panel, so file-backed conclusions trace back to the passage.
 */
export interface DocChunk {
  /** `file:<path>:<idx>` — same shape as fetch chunks, so the verify pipeline treats them alike. */
  sourceId: string;
  path: string;
  idx: number;
  content: string;
}

export interface ChunkOpts {
  maxChars?: number;
}

const DEFAULTS = { maxChars: 1200 };

/** Split a text document into paragraph-packed chunks of at most maxChars. */
export function chunkDocument(path: string, text: string, opts: ChunkOpts = {}): DocChunk[] {
  const { maxChars } = { ...DEFAULTS, ...opts };
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  const chunks: DocChunk[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const idx = chunks.length + 1;
    chunks.push({ sourceId: `file:${path}:${idx}`, path, idx, content: buf });
    buf = '';
  };
  for (const para of paras) {
    if (para.length > maxChars) {
      flush();
      for (let i = 0; i < para.length; i += maxChars) {
        buf = para.slice(i, i + maxChars);
        flush();
      }
      continue;
    }
    if (buf.length + para.length + 1 > maxChars) flush();
    buf = buf ? `${buf}\n${para}` : para;
  }
  flush();
  return chunks;
}
