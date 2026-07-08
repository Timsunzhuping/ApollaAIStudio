import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function cookie(): Promise<string> {
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `sp${Date.now()}_${Math.floor(Math.random() * 1e6)}@x.ai`, password: 'hunter2hunter2' }) });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}
const post = (c: string | undefined, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) });

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await harness.close?.();
});

describe('speech endpoints (S19)', () => {
  it('requires auth', async () => {
    expect((await post(undefined, '/api/speech/transcribe', { audio: 'AAAA', mime: 'audio/webm' })).status).toBe(401);
  });

  it('synthesizes text to a playable /media uri, then transcribes it back (stub round-trip)', async () => {
    const c = await cookie();
    const syn = (await (await post(c, '/api/speech/synthesize', { text: 'state of the EV market' })).json()) as { uri: string };
    expect(syn.uri).toMatch(/^\/media\//);
    const media = await fetch(`${base}${syn.uri}`);
    expect(media.ok).toBe(true);
    expect(media.headers.get('content-type')).toContain('audio/');

    const audioB64 = Buffer.from(await media.arrayBuffer()).toString('base64');
    const tr = (await (await post(c, '/api/speech/transcribe', { audio: audioB64, mime: 'audio/wav' })).json()) as { text: string };
    expect(tr.text).toBe('state of the EV market'); // stub round-trips
  });

  it('rejects empty audio and overlong text', async () => {
    const c = await cookie();
    expect((await post(c, '/api/speech/transcribe', { audio: '', mime: 'audio/webm' })).status).toBe(400);
    expect((await post(c, '/api/speech/synthesize', { text: 'x'.repeat(6000) })).status).toBe(413);
  });

  it('streams a transcript word-by-word over SSE, final chunk marked done (S32)', async () => {
    const c = await cookie();
    const syn = (await (await post(c, '/api/speech/synthesize', { text: 'alpha beta gamma' })).json()) as { uri: string };
    const audioB64 = Buffer.from(await (await fetch(`${base}${syn.uri}`)).arrayBuffer()).toString('base64');

    const res = await post(c, '/api/speech/stream', { audio: audioB64, mime: 'audio/wav' });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = (await res.text()).split('\n\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)) as { text: string; done: boolean });
    expect(frames.map((f) => f.text)).toEqual(['alpha', 'alpha beta', 'alpha beta gamma']);
    expect(frames.at(-1)!.done).toBe(true);
  });
});
