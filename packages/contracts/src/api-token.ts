import { z } from 'zod';

/** A long-lived API token for cross-origin clients (browser extension, CLI). Sprint 12. */
export const ApiToken = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string().default(''),
  /** scrypt hash of the token; the plaintext is shown to the user exactly once. */
  hashedToken: z.string(),
  createdAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
});
export type ApiToken = z.infer<typeof ApiToken>;
