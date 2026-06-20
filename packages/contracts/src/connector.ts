import { z } from 'zod';

/** A summary of one tool exposed by a connector (enumerated when the connector is added). */
export const ConnectorTool = z.object({
  name: z.string(),
  risk: z.enum(['read', 'low_write', 'high_write']),
});
export type ConnectorTool = z.infer<typeof ConnectorTool>;

/**
 * A persisted MCP connector (per owner). Secrets are stored encrypted (name → ciphertext).
 * `disabledTools` lets a user turn off individual tools without removing the connector.
 */
export const Connector = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'stub']),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  url: z.string().optional(),
  readOnlyTools: z.array(z.string()).default([]),
  disabledTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  tools: z.array(ConnectorTool).default([]),
  /** name → ciphertext (AES-GCM); passed as env to the spawned server, decrypted at use. */
  secrets: z.record(z.string()).default({}),
  createdAt: z.string().optional(),
});
export type Connector = z.infer<typeof Connector>;
