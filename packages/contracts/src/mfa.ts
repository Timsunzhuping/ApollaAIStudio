import { z } from 'zod';

/** What MFA enrollment returns once — the recovery codes are shown only at this moment (S20). */
export const MfaEnrollment = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
  recoveryCodes: z.array(z.string()),
});
export type MfaEnrollment = z.infer<typeof MfaEnrollment>;
