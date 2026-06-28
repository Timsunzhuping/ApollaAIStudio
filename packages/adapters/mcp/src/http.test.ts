import { describe, it, expect, afterEach } from 'vitest';
import type { MCPServerConfig } from '@apolla/harness-core';
import { HttpMCPClient } from './http';
import { StubHttpMcpServer } from './stub-http-server';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => { await stop?.(); stop = undefined; });

async function boot(opts: ConstructorParameters<typeof StubHttpMcpServer>[0] = {}): Promise<string> {
  const s = new StubHttpMcpServer(opts);
  stop = () => s.stop();
  return s.start();
}
const cfg = (url: string, extra: Partial<MCPServerConfig> = {}): MCPServerConfig => ({ name: 'remote', transport: 'http', url, ...extra });

describe('HttpMCPClient', () => {
  it('initializes, lists tools, and calls a tool (JSON response)', async () => {
    const url = await boot();
    const session = await new HttpMCPClient().connect(cfg(url));
    const tools = await session.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'save_note']);
    expect(tools.find((t) => t.name === 'echo')?.annotations?.readOnly).toBe(true);
    const r = await session.callTool('echo', { hi: 1 });
    expect(r.content[0]?.text).toContain('echo');
  });

  it('parses an SSE (text/event-stream) response', async () => {
    const url = await boot({ sse: true });
    const session = await new HttpMCPClient().connect(cfg(url));
    expect((await session.listTools()).length).toBe(2);
    expect((await session.callTool('echo', {})).content[0]?.text).toContain('echo');
  });

  it('sends auth headers and rejects when the server requires a token', async () => {
    const url = await boot({ requireToken: 'sekret' });
    await expect(new HttpMCPClient().connect(cfg(url))).rejects.toThrow(/401/);
    const ok = await new HttpMCPClient().connect(cfg(url, { headers: { Authorization: 'Bearer sekret' } }));
    expect((await ok.listTools()).length).toBe(2);
  });

  it('times out instead of hanging on a slow server', async () => {
    const url = await boot({ delayMs: 200 });
    await expect(new HttpMCPClient().connect(cfg(url, { timeoutMs: 30 }))).rejects.toThrow();
  });

  it('rejects a non-http transport', async () => {
    await expect(new HttpMCPClient().connect({ name: 'x', transport: 'stdio' })).rejects.toThrow(/http/);
  });
});
