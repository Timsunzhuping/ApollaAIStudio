import { z } from 'zod';

/** A user (minimal — Sprint 02 uses email-identity auth, no password yet). */
export const User = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string().optional(),
});
export type User = z.infer<typeof User>;

/** A linked OAuth identity (S14). We store only the provider's stable id + email — never OAuth tokens. */
export const OAuthIdentity = z.object({
  userId: z.string(),
  provider: z.string(),
  providerId: z.string(),
  email: z.string(),
  createdAt: z.string().optional(),
});
export type OAuthIdentity = z.infer<typeof OAuthIdentity>;

/** A project: a workspace with inherited context + a materials library (PRD §6.4). */
export const Project = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  createdAt: z.string().optional(),
});
export type Project = z.infer<typeof Project>;
