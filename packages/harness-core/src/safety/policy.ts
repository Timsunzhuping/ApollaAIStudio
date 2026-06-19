import type { RiskLevel } from '@apolla/contracts';

/** What the policy decides for an action of a given risk. */
export type Decision = 'allow' | 'confirm' | 'deny';

export interface PolicyOptions {
  /** Enable high_write actions (forces confirm). MVP default: false → high_write is denied. */
  allowHighWrite?: boolean;
}

export class PolicyViolation extends Error {
  constructor(
    readonly risk: RiskLevel,
    readonly decision: Decision,
  ) {
    super(`Action with risk "${risk}" requires "${decision}" and was not satisfied`);
    this.name = 'PolicyViolation';
  }
}

/**
 * Safety & Policy Engine (ARCHITECTURE §3.8, PRD §7). Three tiers:
 *   read       → allow (automatic)
 *   low_write  → confirm (explicit user confirmation required)
 *   high_write → deny in MVP (later: confirm, gated by allowHighWrite)
 */
export class SafetyPolicy {
  constructor(private readonly opts: PolicyOptions = {}) {}

  decide(risk: RiskLevel): Decision {
    switch (risk) {
      case 'read':
        return 'allow';
      case 'low_write':
        return 'confirm';
      case 'high_write':
        return this.opts.allowHighWrite ? 'confirm' : 'deny';
    }
  }

  /** Throws PolicyViolation unless the action may proceed. `confirmed` satisfies a 'confirm'. */
  assertAllowed(risk: RiskLevel, ctx: { confirmed?: boolean } = {}): void {
    const decision = this.decide(risk);
    if (decision === 'deny') throw new PolicyViolation(risk, decision);
    if (decision === 'confirm' && !ctx.confirmed) throw new PolicyViolation(risk, decision);
  }
}
