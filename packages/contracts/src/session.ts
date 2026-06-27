import { z } from 'zod';

/** A server-side session — enables expiry + revocation (logout invalidates it). Sprint 10. */
export const Session = z.object({
  id: z.string(),
  ownerId: z.string(),
  /** ISO timestamp; a session past this is treated as absent. */
  expiresAt: z.string(),
  createdAt: z.string().optional(),
});
export type Session = z.infer<typeof Session>;
