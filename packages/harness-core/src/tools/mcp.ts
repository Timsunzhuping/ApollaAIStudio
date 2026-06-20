import type { ToolResult, UntrustedContent } from '@apolla/contracts';
import type { Tool, ToolContext, MCPServerConfig } from './types';

/** A tool description as returned by an MCP server's `tools/list`. */
export interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: object;
  /** Some servers annotate read-only tools; the runtime still defaults conservatively. */
  annotations?: { readOnly?: boolean };
}

export interface MCPCallResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** A live connection to one MCP server. */
export interface MCPSession {
  listTools(): Promise<MCPToolDef[]>;
  callTool(name: string, args: unknown): Promise<MCPCallResult>;
  close(): Promise<void>;
}

/** Connects to MCP servers (stdio / http / in-process stub). Concrete clients live in adapters. */
export interface MCPClient {
  connect(server: MCPServerConfig): Promise<MCPSession>;
}

/**
 * Risk inference for an external MCP tool (conservative): read-only if the server config or the
 * tool annotation says so; otherwise low_write — it must pass an explicit confirmation before it
 * can run (Safety §3.8). External tools are NEVER auto-assigned high_write.
 */
export function inferRisk(def: MCPToolDef, server: MCPServerConfig): 'read' | 'low_write' {
  const readOnly = server.readOnlyTools?.includes(def.name) || def.annotations?.readOnly === true;
  return readOnly ? 'read' : 'low_write';
}

/** Wrap one MCP tool as a harness Tool. Results come back as UntrustedContent (data channel). */
export function wrapMCPTool(session: MCPSession, def: MCPToolDef, server: MCPServerConfig): Tool {
  const name = `${server.name}/${def.name}`;
  const risk = inferRisk(def, server);
  return {
    name,
    risk,
    source: 'mcp',
    schema: def.inputSchema ?? { type: 'object' },
    async invoke(args: unknown, _ctx?: ToolContext): Promise<ToolResult> {
      try {
        const result = await session.callTool(def.name, args);
        const text = result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        if (result.isError) return { ok: false, data: [], error: text || 'tool error' };
        const data: UntrustedContent[] = [
          { kind: 'untrusted', sourceId: `mcp:${server.name}:${def.name}`, origin: `mcp:${server.name}`, content: text },
        ];
        return { ok: true, data };
      } catch (e) {
        return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
