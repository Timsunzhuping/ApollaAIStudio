import { z } from 'zod';

/**
 * One version of one file in a user's versioned project workspace (PRD §15 file workspace).
 * Writes are append-only: each write produces a new `version` (1-based, monotonic per path).
 * The workspace is a virtual filesystem backed by storage — NOT a bare-metal OS directory.
 */
export const WorkspaceFile = z.object({
  id: z.string(),
  ownerId: z.string(),
  // Persisted JSONB may carry an explicit null for "no project"; normalize to undefined.
  projectId: z.string().nullish().transform((v) => v ?? undefined),
  /** Normalized, scope-relative path (no leading slash, no `..`). e.g. "sections/1.md". */
  path: z.string(),
  mime: z.string().default('text/markdown'),
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  content: z.string(),
  createdAt: z.string().optional(),
});
export type WorkspaceFile = z.infer<typeof WorkspaceFile>;

/** A file entry in a directory listing (latest version only). */
export const WorkspaceEntry = z.object({
  path: z.string(),
  mime: z.string(),
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
});
export type WorkspaceEntry = z.infer<typeof WorkspaceEntry>;
