import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { StubHttpMcpServer } from '@apolla/mcp-stdio';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let bff: Server;
let harness: Harness;
let base: string;
const mcp = new StubHttpMcpServer({ requireToken: 'sekret' });
let mcpUrl: string;
let cookie: string;

beforeAll(async () => {
  harness = await buildHarness();
  setHarness(harness);
  mcpUrl = await mcp.start();
  bff = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => bff.listen(0, r));
  base = `http://127.0.0.1:${(bff.address() as { port: number }).port}`;
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `mkt${Date.now()}@x.ai`, password: 'hunter2hunter2' }) });
  cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
});
afterAll(async () => {
  await new Promise<void>((r) => bff.close(() => r()));
  await mcp.stop();
  await harness.close?.();
});
const authed = (body?: unknown): RequestInit => ({ method: body ? 'POST' : 'GET', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('connector marketplace (S11-T3)', () => {
  it('lists the catalog', async () => {
    const cat = (await (await fetch(`${base}/api/connectors/catalog`, authed())).json()) as { id: string }[];
    expect(cat.map((e) => e.id)).toContain('web-fetch-http');
  });

  it('installs an http connector from the catalog and enumerates its tools', async () => {
    const res = await fetch(`${base}/api/connectors/from-catalog`, authed({ id: 'web-fetch-http', url: mcpUrl, secrets: { token: 'sekret' } }));
    expect(res.status).toBe(201);
    const conn = (await res.json()) as { transport: string; tools: { name: string }[]; secrets: string[] };
    expect(conn.transport).toBe('http');
    expect(conn.tools.map((t) => t.name).sort()).toEqual(['echo', 'save_note']);
    expect(conn.secrets).toEqual(['token']); // only key names returned, never the value
  });

  it('rejects a catalog install missing a required secret', async () => {
    const res = await fetch(`${base}/api/connectors/from-catalog`, authed({ id: 'web-fetch-http', url: mcpUrl, secrets: {} }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/token/);
  });
});
