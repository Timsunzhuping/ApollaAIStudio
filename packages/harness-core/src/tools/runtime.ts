import type { ToolResult, ToolDescriptor } from '@apolla/contracts';
import type { Tool, ToolContext, ToolFilter, MCPServerConfig } from './types';

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

  /** Connect an MCP server and register its tools. Stubbed in Sprint 01 (ARCHITECTURE §3.4). */
  async connectMCP(_server: MCPServerConfig): Promise<Tool[]> {
    throw new Error('connectMCP is not implemented yet (Sprint 01 reserves the interface)');
  }
}
