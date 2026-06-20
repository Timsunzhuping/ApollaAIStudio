import type { ToolResult, RiskLevel } from '@apolla/contracts';

export interface ToolContext {
  taskId?: string;
  signal?: AbortSignal;
}

/**
 * A tool the harness can invoke. Output is ALWAYS a ToolResult carrying UntrustedContent —
 * downstream may only inject it via the data channel, never as instructions (ARCHITECTURE §3.4).
 */
export interface Tool<I = unknown> {
  readonly name: string;
  readonly risk: RiskLevel;
  readonly source: 'native' | 'mcp';
  /** JSON Schema for the tool's input args. */
  readonly schema: object;
  invoke(args: I, ctx?: ToolContext): Promise<ToolResult>;
}

export interface ToolFilter {
  risk?: RiskLevel;
  source?: 'native' | 'mcp';
}

/** MCP server connection config (ARCHITECTURE §3.4). */
export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'stub';
  /** stdio: executable + args. */
  command?: string;
  args?: string[];
  /** http: server URL. */
  url?: string;
  /**
   * Tool names to treat as read-only. Everything else from an external server defaults to
   * low_write (conservative — needs confirmation) unless the server annotates a tool read-only.
   */
  readOnlyTools?: string[];
}
