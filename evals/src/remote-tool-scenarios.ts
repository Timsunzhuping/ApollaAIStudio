import { ToolRuntime } from '@apolla/harness-core';
import { HttpMCPClient, StubHttpMcpServer } from '@apolla/mcp-stdio';
import type { CheckResult } from './checks';

/**
 * Remote tool over HTTP MCP, end-to-end through the ToolRuntime (S11): a hosted MCP server is
 * connected via HttpMCPClient, its tools are enumerated with conservative risk, and a call returns
 * output in the UNTRUSTED data channel. Uses an in-process stub server (offline, deterministic).
 */
export async function remoteHttpTool(): Promise<CheckResult> {
  const server = new StubHttpMcpServer({ requireToken: 'sekret' });
  const issues: string[] = [];
  try {
    const url = await server.start();
    const rt = new ToolRuntime();
    const registered = await rt.connectMCP(new HttpMCPClient(), {
      name: 'remote',
      transport: 'http',
      url,
      readOnlyTools: ['echo'],
      headers: { Authorization: 'Bearer sekret' },
    });
    const names = registered.map((t) => t.name).sort();
    if (names.join(',') !== 'remote/echo,remote/save_note') issues.push(`unexpected tools: ${names.join(',')}`);
    if (rt.get('remote/echo').risk !== 'read') issues.push('echo should be read (readOnlyTools)');
    if (rt.get('remote/save_note').risk !== 'low_write') issues.push('remote write should default low_write');
    const r = await rt.invoke('remote/echo', { hi: 1 });
    if (!r.ok) issues.push('remote call failed');
    if (!r.data.every((d) => d.kind === 'untrusted')) issues.push('remote output not in the untrusted data channel');
  } catch (e) {
    issues.push(`remote tool errored: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await server.stop();
  }
  return { name: 'remote-http-tool', ok: issues.length === 0, issues };
}

export async function runRemoteToolScenarios(): Promise<CheckResult[]> {
  return [await remoteHttpTool()];
}
