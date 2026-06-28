import type {
  MCPClient,
  MCPSession,
  MCPToolDef,
  MCPCallResult,
  MCPServerConfig,
} from '@apolla/harness-core';

type FetchFn = typeof fetch;

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

/** Extract the matching JSON-RPC response from an SSE body (one or more `data:` frames). */
function parseSse(body: string, id: number): RpcResponse | undefined {
  const frames: RpcResponse[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      frames.push(JSON.parse(payload) as RpcResponse);
    } catch {
      /* skip non-JSON frames */
    }
  }
  return frames.find((f) => f.id === id) ?? frames.find((f) => f.result !== undefined || f.error);
}

/**
 * MCP client over Streamable HTTP (S11): JSON-RPC 2.0 via HTTP POST to `server.url`. Accepts either
 * an `application/json` or a `text/event-stream` (SSE) response. Honors a per-request timeout and an
 * `Mcp-Session-Id` returned by `initialize`. Auth headers (decrypted upstream) are sent ONLY to the
 * configured URL. `fetch` is injectable for tests.
 */
export class HttpMCPClient implements MCPClient {
  private readonly fetch: FetchFn;
  constructor(opts: { fetch?: FetchFn } = {}) {
    this.fetch = opts.fetch ?? fetch;
  }

  async connect(server: MCPServerConfig): Promise<MCPSession> {
    if (server.transport !== 'http' || !server.url) {
      throw new Error('HttpMCPClient requires transport="http" and a url');
    }
    const url = server.url;
    const timeoutMs = server.timeoutMs ?? 10_000;
    const baseHeaders: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(server.headers ?? {}),
    };
    let sessionId: string | undefined;
    let nextId = 1;

    const rpc = async (method: string, params?: unknown): Promise<unknown> => {
      const id = nextId++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.fetch(url, {
          method: 'POST',
          headers: sessionId ? { ...baseHeaders, 'mcp-session-id': sessionId } : baseHeaders,
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        const text = await res.text();
        const msg = ct.includes('text/event-stream') ? parseSse(text, id) : (JSON.parse(text) as RpcResponse);
        if (!msg) throw new Error('empty MCP response');
        if (msg.error) throw new Error(msg.error.message ?? 'mcp error');
        return msg.result;
      } finally {
        clearTimeout(timer);
      }
    };

    await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'apolla', version: '0.0.0' },
    });

    return {
      async listTools(): Promise<MCPToolDef[]> {
        const r = (await rpc('tools/list')) as { tools?: MCPToolDef[] };
        return r?.tools ?? [];
      },
      async callTool(name: string, args: unknown): Promise<MCPCallResult> {
        return (await rpc('tools/call', { name, arguments: args })) as MCPCallResult;
      },
      async close(): Promise<void> {
        /* stateless HTTP — nothing to tear down */
      },
    };
  }
}
