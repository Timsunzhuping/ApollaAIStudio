import { z } from 'zod';
import type { ModelAlias, ModelCaps } from '@apolla/contracts';
import type { ModelRouter } from './router';

const ProbeSchema = z.object({ ok: z.boolean() });

/**
 * Capability probe (ARCHITECTURE §3.2): measure a model's structured-output reliability by asking
 * for a tiny known JSON object. Returns 1 on success, 0 on failure. Runs in the eval harness to
 * recalibrate ModelCaps, which in turn drives FeatureGates.
 */
export async function probeStructuredReliability(
  router: ModelRouter,
  alias: ModelAlias,
): Promise<number> {
  try {
    const r = await router.json(
      alias,
      { messages: [{ role: 'user', content: 'Respond with exactly this JSON: {"ok": true}' }] },
      ProbeSchema,
    );
    return r.ok ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Probe a model and return updated caps (only the probed fields change). */
export async function probeCaps(
  router: ModelRouter,
  alias: ModelAlias,
  base: ModelCaps,
): Promise<ModelCaps> {
  return { ...base, structuredReliability: await probeStructuredReliability(router, alias) };
}
