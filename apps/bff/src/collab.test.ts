import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Replica } from '@apolla/harness-core';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

async function user(): Promise<string> {
  const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `c${Date.now()}_${Math.floor(Math.random() * 1e9)}@x.ai`, password: 'hunter2hunter2' }) });
  return r.headers.get('set-cookie')!.split(';')[0]!;
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

describe('collab sync + sharing (S21)', () => {
  it('the owner pushes ops; the shared collaborator pulls them and converges', async () => {
    const owner = await user();
    const docId = `doc-${Date.now()}`;
    // owner creates the doc by opening it, then types "hi" and pushes
    await get(owner, `/api/collab/${docId}?since=0`);
    const a = new Replica('a');
    await post(owner, `/api/collab/${docId}/ops`, { ops: a.insertStringAt(0, 'hi') });

    // a second user has NO access yet → 403
    const guest = await user();
    expect((await get(guest, `/api/collab/${docId}?since=0`)).status).toBe(403);

    // owner shares; guest accepts the link → gains access and sees the converged text
    const share = (await (await post(owner, `/api/collab/${docId}/share`, {})).json()) as { token: string };
    const accept = await post(guest, '/api/collab/share/accept', { token: share.token });
    expect(accept.status).toBe(200);
    const pull = (await (await get(guest, `/api/collab/${docId}?since=0`)).json()) as { text: string; ops: unknown[]; seq: number };
    expect(pull.text).toBe('hi');

    // guest appends " there" from the synced ops and pushes; owner pulls the increment
    const b = new Replica('b');
    for (const op of pull.ops) b.apply(op as never);
    await post(guest, `/api/collab/${docId}/ops`, { ops: b.insertStringAt(b.text().length, ' there') });
    const ownerPull = (await (await get(owner, `/api/collab/${docId}?since=${pull.seq}`)).json()) as { text: string };
    expect(ownerPull.text).toBe('hi there');
  });

  it('rejects invalid ops and non-owner share attempts', async () => {
    const owner = await user();
    const docId = `doc2-${Date.now()}`;
    await get(owner, `/api/collab/${docId}?since=0`);
    expect((await post(owner, `/api/collab/${docId}/ops`, { ops: [{ type: 'bogus' }] })).status).toBe(400);

    const guest = await user();
    await post(owner, `/api/collab/${docId}/share`, {});
    const token = ((await (await post(owner, `/api/collab/${docId}/share`, {})).json()) as { token: string }).token;
    await post(guest, '/api/collab/share/accept', { token });
    // a shared (non-owner) collaborator cannot re-share
    expect((await post(guest, `/api/collab/${docId}/share`, {})).status).toBe(403);
  });
});
