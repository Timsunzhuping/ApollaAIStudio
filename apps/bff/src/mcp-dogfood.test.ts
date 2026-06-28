import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { HttpMCPClient } from '@apolla/mcp-stdio';
import { buildHarness, type Harness } from './harness';
import { handle, setHarness } from './server';

let server: Server;
let harness: Harness;
let base: string;

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

async function token(): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `dog${Date.now()}_${Math.floor(Math.random() * 1e6)}@x.ai`, password: 'hunter2hunter2' }) });
  const cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
  return ((await (await fetch(`${base}/api/tokens`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'dog' }) })).json()) as { token: string }).token;
}

// Dogfood (S18-T6): Apolla's own S11 HttpMCPClient connects to Apolla's own S18 MCP server — proof
// the wire format is genuinely interoperable, not just internally consistent.
describe('MCP dogfood: HttpMCPClient ↔ Apolla MCP server', () => {
  it('connects with an API token, lists tools, and calls one', async () => {
    const session = await new HttpMCPClient().connect({
      name: 'apolla-self',
      transport: 'http',
      url: `${base}/api/mcp`,
      headers: { authorization: `Bearer ${await token()}` },
    });
    const tools = await session.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['apolla.translate', 'apolla.list_skills']));
    expect(tools.find((t) => t.name === 'apolla.translate')?.annotations?.readOnly).toBe(true);

    const result = await session.callTool('apolla.translate', { text: 'good morning', targetLang: 'Spanish' });
    expect(result.content[0]?.text?.length ?? 0).toBeGreaterThan(0);
    await session.close();
  });
});
