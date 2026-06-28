import { z } from 'zod';

/** A speech-to-text result (S19). */
export const Transcript = z.object({
  text: z.string(),
  durationMs: z.number().optional(),
  lang: z.string().optional(),
});
export type Transcript = z.infer<typeof Transcript>;
