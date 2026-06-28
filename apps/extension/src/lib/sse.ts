/** Parse complete SSE frames out of a buffer; returns [parsed JSON events, remaining buffer]. */
export function parseSseFrames(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of frame.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;
      try { events.push(JSON.parse(payload)); } catch { /* skip non-JSON */ }
    }
  }
  return { events, rest };
}

/**
 * Stream Server-Sent Events over fetch (EventSource can't send an Authorization header, so the
 * extension reads the body stream itself). Calls `onEvent` per parsed frame; aborts on timeout.
 */
export async function streamSSE<T = unknown>(
  url: string,
  init: RequestInit,
  onEvent: (event: T) => void,
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<void> {
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buf);
      buf = rest;
      for (const e of events) onEvent(e as T);
    }
  } finally {
    clearTimeout(timer);
  }
}
