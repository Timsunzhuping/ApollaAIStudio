export interface RateLimiterOptions {
  /** Sustained tokens refilled per second. */
  ratePerSec: number;
  /** Bucket capacity (max burst). */
  burst: number;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
}

/**
 * Per-key token-bucket rate limiter (S10-T3). Server-side enforcement — the client cannot be
 * trusted. Clock is injectable for deterministic tests. Keys are independent (e.g. per-owner or
 * per-IP). `retryAfterSec` reports when the next token frees up.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();
  private readonly now: () => number;

  constructor(private readonly opts: RateLimiterOptions) {
    this.now = opts.now ?? Date.now;
  }

  private refill(key: string): { tokens: number; last: number } {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.opts.burst, last: t };
    const elapsed = Math.max(0, t - b.last) / 1000;
    b.tokens = Math.min(this.opts.burst, b.tokens + elapsed * this.opts.ratePerSec);
    b.last = t;
    this.buckets.set(key, b);
    return b;
  }

  /** Consume one token for `key`; returns whether it was allowed. */
  allow(key: string): boolean {
    const b = this.refill(key);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Seconds until at least one token is available for `key`. */
  retryAfterSec(key: string): number {
    const b = this.refill(key);
    if (b.tokens >= 1) return 0;
    return Math.ceil((1 - b.tokens) / this.opts.ratePerSec);
  }
}
