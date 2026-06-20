import { spawn } from 'node:child_process';
import type {
  MCPClient,
  MCPSession,
  MCPToolDef,
  MCPCallResult,
  MCPServerConfig,
} from '@apolla/harness-core';

/**
 * MCP client over stdio: spawns a local MCP server and speaks JSON-RPC 2.0 framed as
 * newline-delimited JSON (the MCP stdio convention). Implements initialize / tools/list /
 * tools/call. HTTP/SSE transport is a separate adapter (deferred).
 */
export class StdioMCPClient implements MCPClient {
  async connect(server: MCPServerConfig): Promise<MCPSession> {
    if (server.transport !== 'stdio' || !server.command) {
      throw new Error('StdioMCPClient requires transport="stdio" and a command');
    }
    const child = spawn(server.command, server.args ?? [], { stdio: ['pipe', 'pipe', 'inherit'] });
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    let nextId = 1;
    let buffer = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id != null && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message ?? 'mcp error'));
          else p.resolve(msg.result);
        }
      }
    });
    child.on('error', (e) => {
      for (const p of pending.values()) p.reject(e);
      pending.clear();
    });

    const rpc = (method: string, params?: unknown): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'apolla', version: '0.0.0' },
    });

    return {
      async listTools(): Promise<MCPToolDef[]> {
        const r = await rpc('tools/list');
        return (r?.tools ?? []) as MCPToolDef[];
      },
      async callTool(name: string, args: unknown): Promise<MCPCallResult> {
        return (await rpc('tools/call', { name, arguments: args })) as MCPCallResult;
      },
      async close(): Promise<void> {
        child.kill();
      },
    };
  }
}
