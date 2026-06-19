import { z } from 'zod';

/**
 * Logical model aliases. Business code uses ONLY these — never raw model ids.
 * The alias→model-id mapping lives in @apolla/config (routes.json). See ARCHITECTURE §3.1.
 */
export const ModelAlias = z.enum(['gpt_fast', 'gpt_premium', 'claude_write', 'claude_premium']);
export type ModelAlias = z.infer<typeof ModelAlias>;

/**
 * Declared/probed model capabilities. Drives progressive enhancement (ARCHITECTURE §3.2):
 * feature gates read these to auto-enable features and retire scaffolding as models improve.
 */
export const ModelCaps = z.object({
  toolUse: z.boolean(),
  parallelToolUse: z.boolean(),
  longContext: z.number().int().nonnegative(),
  vision: z.boolean(),
  reasoningDepth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  /** 0..1, calibrated by capability probes (eval harness). */
  structuredReliability: z.number().min(0).max(1),
  /** 0..1, multi-step agentic success rate, calibrated by probes. */
  agenticReliability: z.number().min(0).max(1),
});
export type ModelCaps = z.infer<typeof ModelCaps>;

/** A concrete provider model. The `id` is the ONLY place a model name appears. */
export const ModelDescriptor = z.object({
  id: z.string(), // "<provider>/<model-id>"
  provider: z.string(),
  caps: ModelCaps,
  costPer1k: z.object({ in: z.number().nonnegative(), out: z.number().nonnegative() }),
  contextWindow: z.number().int().positive(),
  supportsStructuredOutput: z.boolean(),
  supportsPromptCache: z.boolean(),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptor>;

/** Routing entry for one alias: primary + ordered fallbacks + key rotation pool. */
export const RouteConfig = z.object({
  alias: ModelAlias,
  primary: z.string(), // ModelDescriptor.id
  fallbackChain: z.array(z.string()).default([]),
  /** env-var NAMES holding API keys, rotated for rate-limit resilience. */
  keyPool: z.array(z.string()).default([]),
});
export type RouteConfig = z.infer<typeof RouteConfig>;

/**
 * Feature gate: enable a feature only when the routed model meets capability thresholds.
 * `scaffold` references compensation logic that is auto-retired once `requires` is met.
 */
export const FeatureGate = z.object({
  feature: z.string(),
  requires: ModelCaps.partial(),
  scaffold: z.string().nullable().optional(),
});
export type FeatureGate = z.infer<typeof FeatureGate>;

export const LLMRole = z.enum(['system', 'user', 'assistant', 'tool']);
export type LLMRole = z.infer<typeof LLMRole>;

export const LLMMessage = z.object({
  role: LLMRole,
  content: z.string(),
});
export type LLMMessage = z.infer<typeof LLMMessage>;

/**
 * LLM request. External/untrusted content is carried in `data` (NOT concatenated into
 * system messages) — the data channel that prevents prompt injection (PRD §12.E).
 */
export const LLMRequest = z.object({
  messages: z.array(LLMMessage),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  data: z
    .array(z.object({ sourceId: z.string(), content: z.string() }))
    .default([])
    .optional(),
});
export type LLMRequest = z.infer<typeof LLMRequest>;

export const LLMChunk = z.object({
  delta: z.string(),
  done: z.boolean().default(false),
});
export type LLMChunk = z.infer<typeof LLMChunk>;
