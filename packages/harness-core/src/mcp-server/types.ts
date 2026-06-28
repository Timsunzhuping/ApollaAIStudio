import type { z } from 'zod';

/**
 * A capability exposed over MCP (S18). Backed by an existing orchestrator/surface/skill/workspace,
 * always owner-scoped and read-only/low-risk — write/destructive/billable/autonomous capabilities
 * are never exposed via MCP. Author with `defineTool` for typed args; the registry is type-erased.
 */
export interface CapabilityTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Iron-law: only read-only / low-risk capabilities are exposed via MCP. */
  readOnly: true;
  /** Runs the capability for `ownerId` with validated args; returns text content. */
  handler: (ownerId: string, args: unknown) => Promise<string>;
}

/** Author a CapabilityTool with typed args (validated by inputSchema before handler runs). */
export function defineTool<A>(spec: {
  name: string;
  description: string;
  inputSchema: z.ZodType<A>;
  handler: (ownerId: string, args: A) => Promise<string>;
}): CapabilityTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    readOnly: true,
    handler: (ownerId, args) => spec.handler(ownerId, args as A),
  };
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}
