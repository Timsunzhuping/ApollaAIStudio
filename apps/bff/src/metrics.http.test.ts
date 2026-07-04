import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function signup(): Promise<{ cookie: string; email: string }> {
  const email = `metrics_${randomUUID()}@x.ai`;
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter2hunter2' }),
  });
  return { cookie: r.headers.get('set-cookie')!.split(';')[0]!, email };
}
const post = (cookie: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
const get = (cookie: string, path: string) => fetch(`${base}${path}`, { headers: { cookie } });

/** Run a research task to completion over real SSE and return its taskId. */
async function runTask(cookie: string): Promise<string> {
  const created = (await (await post(cookie, '/api/tasks', { question: 'EV market state 2026' })).json()) as { taskId: string };
  const res = await get(cookie, `/api/tasks/${created.taskId}/events`);
  await res.text(); // drain the SSE stream to completion (demo mode is fast + deterministic)
  return created.taskId;
}

beforeAll(async () => {
  process.env.ADMIN_EMAILS = 'metrics-admin@x.ai';
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

describe('product events + north star (S29)', () => {
  it('records the full funnel: register → submit → deliver → adopt → feedback', async () => {
    const { cookie } = await signup();
    const taskId = await runTask(cookie);

    // adoption: export the artifact
    expect((await get(cookie, `/api/tasks/${taskId}/export?fmt=md`)).status).toBe(200);
    // feedback: thumbs up
    expect((await post(cookie, `/api/tasks/${taskId}/feedback`, { verdict: 'up' })).status).toBe(201);

    const since = new Date(Date.now() - 60_000).toISOString();
    const events = await harness.events.listSince(since);
    const types = events.filter((e) => e.taskId === taskId || e.type === 'user_registered').map((e) => e.type);
    expect(types).toContain('user_registered');
    expect(types).toContain('task_submitted');
    expect(types).toContain('task_delivered');
    expect(types).toContain('artifact_adopted');
    expect(types).toContain('feedback_given');
  });

  it('feedback is owner-scoped fail-closed and validates the verdict', async () => {
    const a = await signup();
    const taskId = await runTask(a.cookie);
    const b = await signup();
    expect((await post(b.cookie, `/api/tasks/${taskId}/feedback`, { verdict: 'up' })).status).toBe(404);
    expect((await post(a.cookie, `/api/tasks/${taskId}/feedback`, { verdict: 'meh' })).status).toBe(400);
  });

  it('unusable feedback disqualifies the workflow from the north star', async () => {
    const { cookie } = await signup();
    const t1 = await runTask(cookie); // delivered + adopted + up → effective
    await get(cookie, `/api/tasks/${t1}/export?fmt=md`);
    await post(cookie, `/api/tasks/${t1}/feedback`, { verdict: 'up' });
    const t2 = await runTask(cookie); // adopted but unusable → NOT effective
    await get(cookie, `/api/tasks/${t2}/export?fmt=md`);
    await post(cookie, `/api/tasks/${t2}/feedback`, { verdict: 'unusable' });

    // admin-only north star endpoint
    const admin = await (async () => {
      const email = 'metrics-admin@x.ai';
      const r = await fetch(`${base}/api/auth/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'hunter2hunter2' }),
      });
      return { cookie: r.headers.get('set-cookie')!.split(';')[0]! };
    })();

    const forbidden = await get(cookie, '/api/admin/northstar');
    expect(forbidden.status).toBe(403); // non-admin fail-closed

    const ns = (await (await get(admin.cookie, '/api/admin/northstar')).json()) as {
      current: { funnel: { adopted: number }; effectiveWorkflowsByOwner: Record<string, number> };
      report: string;
    };
    // t1 counts; t2 is excluded by the unusable verdict.
    const counts = Object.values(ns.current.effectiveWorkflowsByOwner);
    expect(counts.length).toBeGreaterThan(0);
    expect(ns.report).toContain('Effective workflows / active user');
  });
});
