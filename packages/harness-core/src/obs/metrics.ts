const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export interface MetricsSnapshot {
  counters: Record<string, number>;
  latency: { count: number; sumMs: number; buckets: number[]; histogram: number[] };
}

/**
 * Tiny in-process metrics: named counters + a latency histogram (S10-T5). No external dependency.
 * `snapshot()` is plain numbers only — safe to expose at /metrics (never carries secrets/PII).
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly histogram = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
  private latCount = 0;
  private latSumMs = 0;

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

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      latency: { count: this.latCount, sumMs: this.latSumMs, buckets: LATENCY_BUCKETS_MS, histogram: [...this.histogram] },
    };
  }
}
