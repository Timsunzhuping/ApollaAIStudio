import type { ToolResult, ToolDescriptor } from '@apolla/contracts';
import type { Tool, ToolContext, ToolFilter, MCPServerConfig } from './types';
import { wrapMCPTool, type MCPClient } from './mcp';

/**
 * Tool Runtime (ARCHITECTURE §3.4). Tools register here; external tools/data sources are
 * preferred via MCP (connectMCP — stubbed this sprint). Invocation routes through the runtime
 * so it can later enforce Safety & Policy (T7) uniformly.
 */
export class ToolRuntime {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(filter: ToolFilter = {}): ToolDescriptor[] {
    return [...this.tools.values()]
      .filter((t) => (filter.risk ? t.risk === filter.risk : true))
      .filter((t) => (filter.source ? t.source === filter.source : true))
      .map((t) => ({ name: t.name, risk: t.risk, source: t.source }));
  }

  invoke<I>(name: string, args: I, ctx?: ToolContext): Promise<ToolResult> {
    return this.get(name).invoke(args, ctx);
  }

  /**
   * Connect an MCP server (via an injected client) and register its tools. Tools are namespaced
   * `<server>/<tool>` and risk-inferred conservatively (external write tools → low_write).
   * Re-registers on reconnect (replace, not throw). Returns the registered tools.
   */
  async connectMCP(client: MCPClient, server: MCPServerConfig): Promise<Tool[]> {
    const session = await client.connect(server);
    const defs = await session.listTools();
    const tools = defs.map((d) => wrapMCPTool(session, d, server));
    for (const t of tools) this.tools.set(t.name, t);
    return tools;
  }
}
