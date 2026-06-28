import { z } from 'zod';

/** A CRDT operation transmitted between collaborators (S21). Validated at the transport boundary. */
export const CollabOp = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ins'), id: z.string(), after: z.string().nullable(), ch: z.string() }),
  z.object({ type: z.literal('del'), id: z.string() }),
]);
export type CollabOp = z.infer<typeof CollabOp>;
