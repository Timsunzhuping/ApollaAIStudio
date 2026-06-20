import { describe, it, expect } from 'vitest';
import { ToolRuntime } from './runtime';
import { StubMCPClient } from './mcp-stub';
import { inferRisk } from './mcp';
import type { MCPServerConfig } from './types';

const server: MCPServerConfig = { name: 'demo', transport: 'stub' };

describe('connectMCP', () => {
  it('connects, lists, and registers namespaced MCP tools', async () => {
    const rt = new ToolRuntime();
    const tools = await rt.connectMCP(new StubMCPClient(), server);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['demo/echo', 'demo/save_note']);
    expect(rt.list({ source: 'mcp' }).map((d) => d.name).sort()).toEqual(['demo/echo', 'demo/save_note']);
  });

  it('infers risk conservatively: read-only stays read, writes default to low_write', async () => {
    const rt = new ToolRuntime();
    await rt.connectMCP(new StubMCPClient(), server);
    expect(rt.get('demo/echo').risk).toBe('read');
    expect(rt.get('demo/save_note').risk).toBe('low_write');
  });

  it('marks an external tool low_write even if it looks read-y, unless allowlisted', () => {
    expect(inferRisk({ name: 'fetch' }, server)).toBe('low_write');
    expect(inferRisk({ name: 'fetch' }, { ...server, readOnlyTools: ['fetch'] })).toBe('read');
    expect(inferRisk({ name: 'x', annotations: { readOnly: true } }, server)).toBe('read');
  });

  it('invokes an MCP tool and returns the result as UntrustedContent', async () => {
    const rt = new ToolRuntime();
    await rt.connectMCP(new StubMCPClient(), server);
    const res = await rt.invoke('demo/echo', { text: 'hello mcp' });
    expect(res.ok).toBe(true);
    expect(res.data[0]).toMatchObject({ kind: 'untrusted', origin: 'mcp:demo' });
    expect(res.data[0]!.content).toContain('hello mcp');
  });

  it('write tools actually perform the side effect when invoked', async () => {
    const rt = new ToolRuntime();
    const client = new StubMCPClient();
    await rt.connectMCP(client, server);
    await rt.invoke('demo/save_note', { text: 'remember this' });
    expect(client.savedNotes()).toEqual(['remember this']);
  });
});
