import { z } from 'zod';
import { McpServer, defineTool } from '@apolla/harness-core';
import type { CheckResult } from './checks';

/**
 * MCP server (S18): tools/list advertises read-only tools; tools/call is owner-scoped and validates
 * args; unknown tool / bad args → JSON-RPC error. Fully offline (in-process McpServer).
 */
export async function mcpServerContract(): Promise<CheckResult> {
  const issues: string[] = [];
  const seen: string[] = [];
  const server = new McpServer([
    defineTool({
      name: 'apolla.whoami',
      description: 'owner-scoped echo',
      inputSchema: z.object({ tag: z.string() }),
      handler: async (ownerId, { tag }) => { seen.push(ownerId); return `${ownerId}:${tag}`; },
    }),
  ]);

  const list = await server.handle({ method: 'tools/list', id: 1 }, 'u1');
  const tools = (list.result as { tools: { name: string; annotations: { readOnly: boolean } }[] }).tools;
  if (!tools.some((t) => t.name === 'apolla.whoami' && t.annotations.readOnly)) issues.push('tools/list missing read-only tool');

  const call = await server.handle({ method: 'tools/call', id: 2, params: { name: 'apolla.whoami', arguments: { tag: 'x' } } }, 'owner-7');
  if ((call.result as { content: { text: string }[] }).content[0]?.text !== 'owner-7:x') issues.push('tools/call not owner-scoped');
  if (seen[0] !== 'owner-7') issues.push('handler did not receive the caller ownerId');

  const badArgs = await server.handle({ method: 'tools/call', id: 3, params: { name: 'apolla.whoami', arguments: {} } }, 'u1');
  if (badArgs.error?.code !== -32602) issues.push('bad args should be a JSON-RPC error');
  const unknown = await server.handle({ method: 'tools/call', id: 4, params: { name: 'nope' } }, 'u1');
  if (unknown.error?.code !== -32601) issues.push('unknown tool should be a JSON-RPC error');

  return { name: 'mcp-server-contract', ok: issues.length === 0, issues };
}

export async function runMcpScenarios(): Promise<CheckResult[]> {
  return [await mcpServerContract()];
}
