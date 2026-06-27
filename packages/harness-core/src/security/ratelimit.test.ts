import { describe, it, expect } from 'vitest';
import { RateLimiter } from './ratelimit';

describe('RateLimiter (token bucket)', () => {
  it('allows up to burst, then denies until refilled', () => {
    let t = 0;
    const rl = new RateLimiter({ ratePerSec: 1, burst: 3, now: () => t });
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false); // burst exhausted
    expect(rl.retryAfterSec('k')).toBe(1);
    t = 1000; // one second → one token
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false);
  });

  it('keys are independent', () => {
    const t = 0;
    const rl = new RateLimiter({ ratePerSec: 1, burst: 1, now: () => t });
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    expect(rl.allow('b')).toBe(true); // different key has its own bucket
  });

  it('caps refill at burst', () => {
    let t = 0;
    const rl = new RateLimiter({ ratePerSec: 5, burst: 2, now: () => t });
    rl.allow('k'); rl.allow('k'); // drain
    t = 100_000; // long idle
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(true);
    expect(rl.allow('k')).toBe(false); // only refilled up to burst (2), not unbounded
  });
});
