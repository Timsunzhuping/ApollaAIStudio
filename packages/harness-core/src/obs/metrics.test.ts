import { describe, it, expect } from 'vitest';
import { Metrics } from './metrics';

describe('Metrics operations / SLO (S17)', () => {
  it('aggregates per-operation count, error rate, and percentiles', () => {
    const m = new Metrics();
    m.operation('job:research', 10, true);
    m.operation('job:research', 20, true);
    m.operation('job:research', 5000, false); // a slow failure
    m.operation('http', 8, true);

    const snap = m.snapshot();
    const research = snap.operations['job:research']!;
    expect(research.count).toBe(3);
    expect(research.errors).toBe(1);
    expect(research.successRate).toBeCloseTo(2 / 3, 5);
    expect(research.p50ms).toBeLessThanOrEqual(50); // median is a fast bucket
    expect(research.p95ms).toBeGreaterThanOrEqual(2500); // tail captures the slow failure
    expect(snap.operations['http']!.successRate).toBe(1);
  });

  it('snapshot stays plain numbers (safe for /metrics)', () => {
    const m = new Metrics();
    m.inc('http.requests');
    m.observe(12);
    m.operation('http', 12, true);
    expect(() => JSON.stringify(m.snapshot())).not.toThrow();
  });
});
