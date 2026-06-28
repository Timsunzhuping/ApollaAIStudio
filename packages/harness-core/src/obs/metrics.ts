const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export interface OperationStats {
  count: number;
  errors: number;
  successRate: number;
  p50ms: number;
  p95ms: number;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  latency: { count: number; sumMs: number; buckets: number[]; histogram: number[] };
  /** Per-operation SLO view (research/job/tool/llm/http) — counts, error rate, approx percentiles. */
  operations: Record<string, OperationStats>;
}

interface OpAgg {
  count: number;
  errors: number;
  hist: number[];
}

/** Approximate a percentile from a bucketed histogram (upper bucket bound). */
function percentile(hist: number[], total: number, p: number): number {
  if (total === 0) return 0;
  const target = total * p;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i] ?? 0;
    if (cum >= target) return LATENCY_BUCKETS_MS[i] ?? Infinity;
  }
  return Infinity;
}

/**
 * Tiny in-process metrics: named counters + a latency histogram + per-operation SLO stats (S10-T5,
 * S17-T5). No external dependency. `snapshot()` is plain numbers only — safe to expose at /metrics
 * (never carries secrets/PII).
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histogram = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
  private latCount = 0;
  private latSumMs = 0;
  private readonly ops = new Map<string, OpAgg>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observe(ms: number): void {
    this.latCount += 1;
    this.latSumMs += ms;
    let i = LATENCY_BUCKETS_MS.findIndex((b) => ms <= b);
    if (i < 0) i = LATENCY_BUCKETS_MS.length;
    this.histogram[i] = (this.histogram[i] ?? 0) + 1;
  }

  /** Record one operation outcome for the SLO view (S17): e.g. operation('job:research', ms, ok). */
  operation(name: string, ms: number, ok: boolean): void {
    let agg = this.ops.get(name);
    if (!agg) {
      agg = { count: 0, errors: 0, hist: new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0) };
      this.ops.set(name, agg);
    }
    agg.count += 1;
    if (!ok) agg.errors += 1;
    let i = LATENCY_BUCKETS_MS.findIndex((b) => ms <= b);
    if (i < 0) i = LATENCY_BUCKETS_MS.length;
    agg.hist[i] = (agg.hist[i] ?? 0) + 1;
  }

  snapshot(): MetricsSnapshot {
    const operations: Record<string, OperationStats> = {};
    for (const [name, a] of this.ops) {
      operations[name] = {
        count: a.count,
        errors: a.errors,
        successRate: a.count ? (a.count - a.errors) / a.count : 1,
        p50ms: percentile(a.hist, a.count, 0.5),
        p95ms: percentile(a.hist, a.count, 0.95),
      };
    }
    return {
      counters: Object.fromEntries(this.counters),
      latency: { count: this.latCount, sumMs: this.latSumMs, buckets: LATENCY_BUCKETS_MS, histogram: [...this.histogram] },
      operations,
    };
  }
}
