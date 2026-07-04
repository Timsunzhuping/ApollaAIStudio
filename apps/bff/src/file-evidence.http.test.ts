import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function signup(): Promise<{ cookie: string; ownerId: string }> {
  const email = `fev_${randomUUID()}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: r.headers.get('set-cookie')!.split(';')[0]! } })).json()) as { id: string };
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, ownerId: me.id };
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

describe('workspace files as research evidence (S27)', () => {
  it('a project run retrieves workspace passages; they appear as citable file:// sources', async () => {
    const { cookie, ownerId } = await signup();
    const project = (await (await post(cookie, '/api/projects', { name: 'EV', description: 'industry research' })).json()) as { id: string };

    // Seed a workspace file in the project (the user's own material).
    await harness.workspace.write({
      ownerId,
      projectId: project.id,
      path: 'notes/industry.md',
      content: '内部调研：2025 年全球电动车销量达到 1700 万辆，电池组价格降至每千瓦时 90 美元以下，供应链集中度持续提升。',
    });

    const created = (await (await post(cookie, '/api/tasks', { question: '电动车电池价格趋势', projectId: project.id })).json()) as { taskId: string };
    const sse = await (await get(cookie, `/api/tasks/${created.taskId}/events`)).text();

    // The file passage flowed in as a source (data channel → sources list).
    expect(sse).toContain('file://notes/industry.md');
    expect(sse).toContain('"type":"done"');

    const task = (await (await get(cookie, `/api/tasks/${created.taskId}`)).json()) as {
      sources: { id: string; url?: string }[];
      snippets: { sourceId: string }[];
    };
    expect(task.sources.some((s) => s.url === 'file://notes/industry.md')).toBe(true);
    // Verified path: file chunks joined the extraction pool → at least one verified quote from a file or the web.
    expect(task.snippets.length).toBeGreaterThan(0);
  });

  it('runs without a project are unchanged (no file evidence)', async () => {
    const { cookie } = await signup();
    const created = (await (await post(cookie, '/api/tasks', { question: 'plain run' })).json()) as { taskId: string };
    const sse = await (await get(cookie, `/api/tasks/${created.taskId}/events`)).text();
    expect(sse).not.toContain('file://');
    expect(sse).toContain('"type":"done"');
  });
});
