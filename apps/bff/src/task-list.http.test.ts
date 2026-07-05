import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function signup(): Promise<{ cookie: string }> {
  const email = `inbox_${randomUUID()}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]! };
}
const post = (cookie: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
const get = (cookie: string, path: string) => fetch(`${base}${path}`, { headers: { cookie } });

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

describe('GET /api/tasks (S26 inbox)', () => {
  it('lists the owner\u2019s tasks newest-first as metadata only, owner-scoped', async () => {
    const a = await signup();
    const t1 = (await (await post(a.cookie, '/api/tasks', { question: 'first' })).json()) as { taskId: string };
    await (await get(a.cookie, `/api/tasks/${t1.taskId}/events`)).text();
    const t2 = (await (await post(a.cookie, '/api/tasks', { question: 'second' })).json()) as { taskId: string };
    await (await get(a.cookie, `/api/tasks/${t2.taskId}/events`)).text();

    const list = (await (await get(a.cookie, '/api/tasks')).json()) as { id: string; question: string; state: string; citations: number }[];
    expect(list.length).toBe(2);
    expect(list[0]!.question).toBe('second'); // newest first
    expect(list[0]!.state).toBe('done');
    expect(list[0]!).not.toHaveProperty('artifacts'); // metadata only
    expect(list[0]!.citations).toBeGreaterThan(0);

    const b = await signup();
    expect(((await (await get(b.cookie, '/api/tasks')).json()) as unknown[]).length).toBe(0);
  });
});
