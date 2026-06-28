import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { McpServer } from './server';
import { defineTool } from './types';

const echo = defineTool({
  name: 'apolla.echo',
  description: 'Echo back text, owner-scoped',
  inputSchema: z.object({ text: z.string() }),
  handler: async (ownerId, args) => `${ownerId}:${args.text}`,
});
const boom = defineTool({
  name: 'apolla.boom',
  description: 'always throws',
  inputSchema: z.object({}),
  handler: async () => { throw new Error('kaboom'); },
});

const server = new McpServer([echo, boom]);

describe('McpServer (S18)', () => {
  it('initializes with server info + protocol version', async () => {
    const res = await server.handle({ method: 'initialize', id: 1 }, 'u1');
    expect((res.result as { serverInfo: { name: string } }).serverInfo.name).toBe('apolla');
    expect(res.id).toBe(1);
  });

  it('lists tools with JSON-Schema input + read-only annotation', async () => {
    const res = await server.handle({ method: 'tools/list', id: 2 }, 'u1');
    const tools = (res.result as { tools: { name: string; inputSchema: object; annotations: { readOnly: boolean } }[] }).tools;
    expect(tools.map((t) => t.name)).toContain('apolla.echo');
    expect(tools.find((t) => t.name === 'apolla.echo')!.annotations.readOnly).toBe(true);
    expect(tools.find((t) => t.name === 'apolla.echo')!.inputSchema).toBeTypeOf('object');
  });

  it('calls a tool owner-scoped and returns text content', async () => {
    const res = await server.handle({ method: 'tools/call', id: 3, params: { name: 'apolla.echo', arguments: { text: 'hi' } } }, 'owner-9');
    expect((res.result as { content: { text: string }[] }).content[0]!.text).toBe('owner-9:hi');
  });

  it('rejects unknown tool + bad args with JSON-RPC errors', async () => {
    const unknown = await server.handle({ method: 'tools/call', id: 4, params: { name: 'nope' } }, 'u1');
    expect(unknown.error?.code).toBe(-32601);
    const badArgs = await server.handle({ method: 'tools/call', id: 5, params: { name: 'apolla.echo', arguments: { text: 42 } } }, 'u1');
    expect(badArgs.error?.code).toBe(-32602);
    const badMethod = await server.handle({ method: 'frobnicate', id: 6 }, 'u1');
    expect(badMethod.error?.code).toBe(-32601);
  });

  it('surfaces handler errors as an MCP isError result, not a protocol error', async () => {
    const res = await server.handle({ method: 'tools/call', id: 7, params: { name: 'apolla.boom', arguments: {} } }, 'u1');
    expect(res.error).toBeUndefined();
    expect((res.result as { isError: boolean; content: { text: string }[] }).isError).toBe(true);
    expect((res.result as { content: { text: string }[] }).content[0]!.text).toContain('kaboom');
  });
});
