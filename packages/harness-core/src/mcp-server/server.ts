import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CapabilityTool, JsonRpcRequest, JsonRpcResponse } from './types';

const PROTOCOL_VERSION = '2024-11-05';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnly: true };
}

function ok(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Transport-agnostic MCP server (S18): dispatches JSON-RPC `initialize` / `tools/list` / `tools/call`
 * against a registry of owner-scoped CapabilityTools. Every call carries the authenticated ownerId
 * (from the API token at the transport layer); the server never decides identity itself.
 */
export class McpServer {
  private readonly tools = new Map<string, CapabilityTool>();

  constructor(tools: CapabilityTool[] = []) {
    for (const t of tools) this.tools.set(t.name, t);
  }

  /** Tool catalog (for tools/list and discovery) — no handlers/secrets, JSON-Schema input. */
  list(): ToolDef[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema, { target: 'jsonSchema7' }) as object,
      annotations: { readOnly: true },
    }));
  }

  async handle(req: JsonRpcRequest, ownerId: string): Promise<JsonRpcResponse> {
    const id = req.id ?? null;
    try {
      switch (req.method) {
        case 'initialize':
          return ok(id, {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: 'apolla', version: '1.0.0' },
            capabilities: { tools: {} },
          });
        case 'notifications/initialized':
        case 'ping':
          return ok(id, {});
        case 'tools/list':
          return ok(id, { tools: this.list() });
        case 'tools/call': {
          const params = (req.params ?? {}) as { name?: string; arguments?: unknown };
          const tool = params.name ? this.tools.get(params.name) : undefined;
          if (!tool) return rpcError(id, -32601, `unknown tool: ${params.name ?? ''}`);
          const parsed = tool.inputSchema.safeParse(params.arguments ?? {});
          if (!parsed.success) return rpcError(id, -32602, `invalid arguments: ${parsed.error.message}`);
          try {
            const text = await tool.handler(ownerId, parsed.data);
            return ok(id, { content: [{ type: 'text', text }] });
          } catch (e) {
            // Tool execution errors surface as an MCP result (isError), not a protocol error.
            return ok(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
          }
        }
        default:
          return rpcError(id, -32601, `unknown method: ${req.method}`);
      }
    } catch (e) {
      return rpcError(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }
}
