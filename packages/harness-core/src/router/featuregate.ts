import type { ModelCaps, FeatureGate } from '@apolla/contracts';

/** Does the routed model meet a gate's capability requirements? (ARCHITECTURE §3.2). */
export function isEnabled(gate: FeatureGate, caps: ModelCaps): boolean {
  for (const [key, required] of Object.entries(gate.requires)) {
    const actual = (caps as Record<string, unknown>)[key];
    if (typeof required === 'boolean') {
      if (actual !== required) return false;
    } else if (typeof required === 'number') {
      if (typeof actual !== 'number' || actual < required) return false;
    }
  }
  return true;
}

/**
 * Runtime feature gating. As model capabilities improve (probes recalibrate `caps`), features
 * turn on automatically and their compensating scaffolds retire — the "platform gets stronger
 * as models do" mechanism made executable.
 */
export class FeatureGates {
  constructor(
    private readonly gates: FeatureGate[],
    private caps: ModelCaps,
  ) {}

  setCaps(caps: ModelCaps): void {
    this.caps = caps;
  }

  enabled(feature: string): boolean {
    const gate = this.gates.find((g) => g.feature === feature);
    return gate ? isEnabled(gate, this.caps) : false;
  }

  /** The scaffold to mount when a feature is gated off (null = no fallback). */
  scaffoldFor(feature: string): string | null {
    const gate = this.gates.find((g) => g.feature === feature);
    return gate && !isEnabled(gate, this.caps) ? (gate.scaffold ?? null) : null;
  }
}
