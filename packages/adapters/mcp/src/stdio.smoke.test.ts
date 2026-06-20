import { describe, it, expect } from 'vitest';
import { StdioMCPClient } from './index';

// Runs only when MCP_STDIO_COMMAND points at a real local MCP server. Skipped in CI.
const CMD = process.env.MCP_STDIO_COMMAND;

describe.skipIf(!CMD)('StdioMCPClient (smoke)', () => {
  it('connects and lists tools from a local MCP server', async () => {
    const session = await new StdioMCPClient().connect({
      name: 'smoke',
      transport: 'stdio',
      command: CMD!,
      args: (process.env.MCP_STDIO_ARGS ?? '').split(' ').filter(Boolean),
    });
    const tools = await session.listTools();
    expect(Array.isArray(tools)).toBe(true);
    await session.close();
  });
});
