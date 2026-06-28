import { z } from 'zod';

/** A curated connector the user can one-click add from the marketplace (S11). Metadata only. */
export const ConnectorCatalogEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  transport: z.enum(['stdio', 'http', 'stub']),
  /** Suggested URL (http) — the user can override. */
  url: z.string().optional(),
  /** Secret names the user must supply (e.g. ["token"]); stored encrypted at install. */
  requiredSecrets: z.array(z.string()).default([]),
  /** Tool names known to be read-only (passed through to the connector). */
  readOnlyTools: z.array(z.string()).default([]),
  homepage: z.string().optional(),
});
export type ConnectorCatalogEntry = z.infer<typeof ConnectorCatalogEntry>;
