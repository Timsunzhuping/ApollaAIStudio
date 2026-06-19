import type { UsageRecord } from '@apolla/contracts';
import { PricingBook } from './pricing';

/** Minimal shape of a router UsageEvent the ledger can record (decoupled from the router import). */
export interface LLMUsageEvent {
  alias?: string;
  provider?: string;
  modelId?: string;
  tokensIn: number;
  tokensOut: number;
}

export interface UsageContext {
  taskId?: string;
  stepId?: string;
}

/**
 * Cost Ledger (ARCHITECTURE §3.11). Every LLM/tool/media call writes a UsageRecord; the ledger
 * computes USD via the PricingBook and can report total + per-step cost for a task.
 */
export class InMemoryCostLedger {
  private readonly records: UsageRecord[] = [];

  constructor(private readonly pricing: PricingBook = new PricingBook()) {}

  record(r: UsageRecord): void {
    this.records.push(r);
  }

  /** Record an LLM usage event from the ModelRouter.onUsage hook, pricing it via the book. */
  recordLLM(e: LLMUsageEvent, ctx: UsageContext = {}): void {
    this.record({
      kind: 'llm',
      alias: e.alias,
      provider: e.provider,
      tokensIn: e.tokensIn,
      tokensOut: e.tokensOut,
      costUsd: e.modelId ? this.pricing.costOf(e.modelId, e.tokensIn, e.tokensOut) : 0,
      cacheHit: false,
      taskId: ctx.taskId,
      stepId: ctx.stepId,
    });
  }

  all(): UsageRecord[] {
    return [...this.records];
  }

  totalUsd(taskId?: string): number {
    return this.records
      .filter((r) => (taskId ? r.taskId === taskId : true))
      .reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Per-step cost for a task: stepId → USD. */
  perStep(taskId: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.records) {
      if (r.taskId !== taskId) continue;
      const key = r.stepId ?? '(unattributed)';
      out[key] = (out[key] ?? 0) + r.costUsd;
    }
    return out;
  }

  /** Human-readable cost report for a task (DoD: total + per-step). */
  report(taskId: string): string {
    const lines = [`Task ${taskId} — total $${this.totalUsd(taskId).toFixed(4)}`];
    for (const [step, usd] of Object.entries(this.perStep(taskId))) {
      lines.push(`  ${step}: $${usd.toFixed(4)}`);
    }
    return lines.join('\n');
  }
}
