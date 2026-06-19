import { z } from 'zod';
import { RiskLevel } from './common';

/**
 * Content returned by tools (web pages, files, MCP/connector output) is ALWAYS untrusted.
 * It may only enter the model via the data channel (LLMRequest.data), never as instructions.
 * See Safety & Policy Engine (ARCHITECTURE §3.8, PRD §12.E).
 */
export const UntrustedContent = z.object({
  kind: z.literal('untrusted'),
  sourceId: z.string(),
  /** url / file:path / mcp:<server> */
  origin: z.string(),
  content: z.string(),
});
export type UntrustedContent = z.infer<typeof UntrustedContent>;

export const ToolResult = z.object({
  ok: z.boolean(),
  data: z.array(UntrustedContent).default([]),
  error: z.string().optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;

export const ToolDescriptor = z.object({
  name: z.string(),
  risk: RiskLevel,
  source: z.enum(['native', 'mcp']),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptor>;
