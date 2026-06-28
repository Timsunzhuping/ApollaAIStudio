import { createServer, type Server } from 'node:http';

export interface StubHttpMcpOptions {
  /** Respond with text/event-stream instead of application/json. */
  sse?: boolean;
  /** Require this bearer token (Authorization header); 401 otherwise. */
  requireToken?: string;
  /** Delay each response by this many ms (to exercise client timeouts). */
  delayMs?: number;
}

/**
 * In-process MCP server over HTTP for offline tests (S11). Speaks JSON-RPC: initialize / tools/list
 * / tools/call. Exposes `echo` (read-only) + `save_note` (write). No external network.
 */
export class StubHttpMcpServer {
  private server?: Server;
  constructor(private readonly opts: StubHttpMcpOptions = {}) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      if (this.opts.requireToken && req.headers.authorization !== `Bearer ${this.opts.requireToken}`) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        let msg: { id?: number; method?: string; params?: { name?: string; arguments?: unknown } } = {};
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* ignore */
        }
        const result = this.handle(msg.method, msg.params);
        const body = { jsonrpc: '2.0', id: msg.id, result };
        const send = () => {
          if (this.opts.sse) {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'stub-session' });
            res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
          } else {
            res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'stub-session' });
            res.end(JSON.stringify(body));
          }
        };
        if (this.opts.delayMs) setTimeout(send, this.opts.delayMs);
        else send();
      });
    });
    await new Promise<void>((r) => this.server!.listen(0, r));
    const port = (this.server!.address() as { port: number }).port;
    return `http://127.0.0.1:${port}/mcp`;
  }

  private handle(method: string | undefined, params?: { name?: string; arguments?: unknown }): unknown {
    if (method === 'initialize') {
      return { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'stub-http', version: '0.0.0' } };
    }
    if (method === 'tools/list') {
      return {
        tools: [
          { name: 'echo', description: 'echoes input', annotations: { readOnly: true } },
          { name: 'save_note', description: 'saves a note' },
        ],
      };
    }
    if (method === 'tools/call') {
      return { content: [{ type: 'text', text: `${params?.name}: ${JSON.stringify(params?.arguments ?? {})}` }] };
    }
    return {};
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
}
