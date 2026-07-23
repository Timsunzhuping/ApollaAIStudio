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

/** A read-only resource exposed over MCP (S35/B5) — e.g. a workspace file. */
export interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}
export interface ResourceProvider {
  list(ownerId: string): Promise<McpResource[]>;
  read(ownerId: string, uri: string): Promise<{ uri: string; mimeType?: string; text: string } | undefined>;
}

/** A reusable prompt template exposed over MCP (S35/B5) — e.g. an owner skill. */
export interface McpPrompt {
  name: string;
  description: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}
export interface PromptProvider {
  list(ownerId: string): Promise<McpPrompt[]>;
  get(ownerId: string, name: string, args: Record<string, string>): Promise<{ description?: string; messages: { role: 'user'; content: { type: 'text'; text: string } }[] } | undefined>;
}

/**
 * Transport-agnostic MCP server (S18, extended S35): dispatches JSON-RPC `initialize` /
 * `tools/list|call` / `resources/list|read` / `prompts/list|get` against owner-scoped registries.
 * Every call carries the authenticated ownerId (from the API token at the transport layer); the
 * server never decides identity itself. Resources/prompts capabilities are advertised only when a
 * provider is wired, so S18 clients see no behavior change.
 */
export class McpServer {
  private readonly tools = new Map<string, CapabilityTool>();
  private readonly resources?: ResourceProvider;
  private readonly prompts?: PromptProvider;

  constructor(tools: CapabilityTool[] = [], opts: { resources?: ResourceProvider; prompts?: PromptProvider } = {}) {
    for (const t of tools) this.tools.set(t.name, t);
    this.resources = opts.resources;
    this.prompts = opts.prompts;
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
            capabilities: {
              tools: {},
              ...(this.resources ? { resources: {} } : {}),
              ...(this.prompts ? { prompts: {} } : {}),
            },
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
        case 'resources/list': {
          if (!this.resources) return rpcError(id, -32601, 'resources not supported');
          return ok(id, { resources: await this.resources.list(ownerId) });
        }
        case 'resources/read': {
          if (!this.resources) return rpcError(id, -32601, 'resources not supported');
          const uri = String((req.params as { uri?: unknown } | undefined)?.uri ?? '');
          const doc = await this.resources.read(ownerId, uri);
          if (!doc) return rpcError(id, -32002, `unknown resource: ${uri}`);
          return ok(id, { contents: [{ uri: doc.uri, mimeType: doc.mimeType ?? 'text/plain', text: doc.text }] });
        }
        case 'prompts/list': {
          if (!this.prompts) return rpcError(id, -32601, 'prompts not supported');
          return ok(id, { prompts: await this.prompts.list(ownerId) });
        }
        case 'prompts/get': {
          if (!this.prompts) return rpcError(id, -32601, 'prompts not supported');
          const p = (req.params ?? {}) as { name?: unknown; arguments?: Record<string, string> };
          const prompt = await this.prompts.get(ownerId, String(p.name ?? ''), p.arguments ?? {});
          if (!prompt) return rpcError(id, -32602, `unknown prompt: ${String(p.name ?? '')}`);
          return ok(id, prompt);
        }
        default:
          return rpcError(id, -32601, `unknown method: ${req.method}`);
      }
    } catch (e) {
      return rpcError(id, -32603, e instanceof Error ? e.message : String(e));
    }
  }
}
