import type { FetchProvider, FetchedPage, FetchOpts } from './fetch';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BYTES = 2_000_000;
const UA = 'ApollaResearchBot/1.0';

/**
 * Real HTTP fetch provider (S25). Zero-dependency readability-lite main-text extraction,
 * with timeout / byte-cap / content-type guards. Enabled when a fetch mode is configured;
 * otherwise the deterministic StubFetchProvider keeps tests hermetic.
 */
export class HttpFetchProvider implements FetchProvider {
  readonly name = 'http';
  private readonly opts: { timeoutMs?: number };

  constructor(opts: { timeoutMs?: number } = {}) {
    this.opts = opts;
  }

  async fetchPage(url: string, o?: FetchOpts): Promise<FetchedPage> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    o?.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,text/plain;q=0.9' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const ctype = res.headers.get('content-type') ?? '';
      if (!/text\/html|text\/plain/.test(ctype)) throw new Error(`unsupported content-type: ${ctype}`);
      const raw = await readCapped(res, MAX_BYTES);
      const finalUrl = res.url || url;
      const title = extractTitle(raw) ?? new URL(finalUrl).hostname;
      const text = ctype.includes('text/plain') ? raw : extractMainText(raw);
      return { url: finalUrl, title, text };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(out);
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m && m[1] !== undefined ? decodeEntities(m[1]).trim().slice(0, 300) : undefined;
}

/**
 * Readability-lite: strip non-content elements, prefer <article>/<main>, emit block-level
 * paragraphs separated by blank lines (headings prefixed with ##).
 */
export function extractMainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const scoped = /<article\b[\s\S]*?<\/article>/i.exec(s) ?? /<main\b[\s\S]*?<\/main>/i.exec(s);
  if (scoped && textLen(scoped[0]) > 500) s = scoped[0];
  const paras: string[] = [];
  const blockRe = /<(p|h[1-6]|li|blockquote|pre|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(s)) !== null) {
    const tag = m[1] ?? '';
    const inner = m[2] ?? '';
    const t = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t) paras.push(tag.startsWith('h') ? `## ${t}` : t);
  }
  if (paras.length === 0) {
    return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
  return paras.join('\n\n');
}

function textLen(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}
