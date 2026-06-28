import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

const uniqEmail = () => `mcp${Date.now()}_${Math.floor(Math.random() * 1e6)}@x.ai`;

async function tokenFor(): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: uniqEmail(), password: 'hunter2hunter2' }) });
  const cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
  const t = (await (await fetch(`${base}/api/tokens`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mcp' }) })).json()) as { token: string };
  return t.token;
}

function rpc(token: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

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

describe('MCP server endpoint /api/mcp (S18)', () => {
  it('requires an API token', async () => {
    expect((await rpc(undefined, { jsonrpc: '2.0', id: 1, method: 'initialize' })).status).toBe(401);
  });

  it('initializes and lists Apolla tools for an authenticated client', async () => {
    const token = await tokenFor();
    const init = (await (await rpc(token, { jsonrpc: '2.0', id: 1, method: 'initialize' })).json()) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe('apolla');
    const list = (await (await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['apolla.research', 'apolla.translate', 'apolla.workspace_read']));
  });

  it('calls a tool owner-scoped over JSON-RPC', async () => {
    const token = await tokenFor();
    const res = (await (await rpc(token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'apolla.translate', arguments: { text: 'hello', targetLang: 'French' } } })).json()) as { result: { content: { text: string }[] } };
    expect(res.result.content[0]!.text.length).toBeGreaterThan(0);
  });

  it('returns a tool error (isError) for a missing workspace file', async () => {
    const token = await tokenFor();
    const res = (await (await rpc(token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'apolla.workspace_read', arguments: { path: 'nope.md' } } })).json()) as { result: { isError?: boolean } };
    expect(res.result.isError).toBe(true);
  });
});
