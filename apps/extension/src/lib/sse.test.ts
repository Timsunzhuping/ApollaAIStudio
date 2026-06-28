import { describe, it, expect } from 'vitest';
import { parseSseFrames, streamSSE } from './sse';

describe('parseSseFrames', () => {
  it('extracts complete frames and keeps the remainder', () => {
    const { events, rest } = parseSseFrames('data: {"type":"a"}\n\ndata: {"type":"b"}\n\ndata: {"ty');
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }]);
    expect(rest).toBe('data: {"ty');
  });
  it('ignores malformed/[DONE] frames', () => {
    const { events } = parseSseFrames('data: notjson\n\ndata: [DONE]\n\ndata: {"ok":1}\n\n');
    expect(events).toEqual([{ ok: 1 }]);
  });
});

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

describe('streamSSE', () => {
  it('reads a body stream frame-by-frame into the callback', async () => {
    const fetchFn = (async () => ({ ok: true, status: 200, body: streamFrom(['data: {"type":"delta","text":"hi"}\n\n', 'data: {"type":"done"}\n\n']) })) as unknown as typeof fetch;
    const got: { type: string }[] = [];
    await streamSSE<{ type: string }>('http://x/events', { method: 'GET' }, (e) => got.push(e), { fetchFn });
    expect(got.map((e) => e.type)).toEqual(['delta', 'done']);
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = (async () => ({ ok: false, status: 500, body: null })) as unknown as typeof fetch;
    await expect(streamSSE('http://x', {}, () => {}, { fetchFn })).rejects.toThrow(/500/);
  });
});
