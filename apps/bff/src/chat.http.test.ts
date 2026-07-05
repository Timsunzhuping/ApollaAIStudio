import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function signup(): Promise<{ cookie: string }> {
  const email = `chat_${randomUUID()}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]! };
}
const get = (cookie: string, path: string) => fetch(`${base}${path}`, { headers: { cookie } });
const postStream = async (cookie: string, body: unknown): Promise<string> => {
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  expect(r.headers.get('content-type')).toContain('text/event-stream');
  return await r.text();
};

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

describe('unified chat (S28)', () => {
  it('streams a first turn, creates the conversation, and persists both turns', async () => {
    const { cookie } = await signup();
    const sse = await postStream(cookie, { text: '固态电池是什么？' });
    expect(sse).toContain('"type":"conversation"');
    expect(sse).toContain('"type":"delta"');
    expect(sse).toContain('"type":"done"');

    const convoId = JSON.parse(sse.split('\n').find((l) => l.includes('"type":"conversation"'))!.slice(6)).conversationId as string;
    const list = (await (await get(cookie, '/api/conversations')).json()) as { id: string; title: string }[];
    expect(list.some((c) => c.id === convoId)).toBe(true);

    const convo = (await (await get(cookie, `/api/conversations/${convoId}`)).json()) as { messages: { role: string }[] };
    const roles = convo.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant']);

    // Second turn continues the same thread.
    const sse2 = await postStream(cookie, { conversationId: convoId, text: '再展开说说。' });
    expect(sse2).toContain('"type":"done"');
    const convo2 = (await (await get(cookie, `/api/conversations/${convoId}`)).json()) as { messages: unknown[] };
    expect(convo2.messages).toHaveLength(5);
  });

  it('conversations are owner-scoped fail-closed', async () => {
    const a = await signup();
    const sse = await postStream(a.cookie, { text: 'secret thread' });
    const convoId = JSON.parse(sse.split('\n').find((l) => l.includes('"type":"conversation"'))!.slice(6)).conversationId as string;

    const b = await signup();
    expect((await get(b.cookie, `/api/conversations/${convoId}`)).status).toBe(404);
    const hijack = await postStream(b.cookie, { conversationId: convoId, text: 'hi' });
    expect(hijack).toContain('unknown conversation');
  });

  it('rejects empty text and unauthenticated calls', async () => {
    const { cookie } = await signup();
    const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ text: '' }) });
    expect(r.status).toBe(400);
    const anon = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
    expect(anon.status).toBe(401);
  });
});
