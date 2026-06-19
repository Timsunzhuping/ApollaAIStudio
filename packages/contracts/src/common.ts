import { z } from 'zod';

/** ISO-8601 timestamp string. Stamped by services, never by harness scripts. */
export const Timestamp = z.string();

/** Non-empty identifier. */
export const Id = z.string().min(1);

/**
 * Action risk tiers — the spine of the Safety & Policy Engine (PRD §7).
 * read       → auto
 * low_write  → explicit confirmation required
 * high_write → not enabled in MVP; later forces double-confirmation
 */
export const RiskLevel = z.enum(['read', 'low_write', 'high_write']);
export type RiskLevel = z.infer<typeof RiskLevel>;
