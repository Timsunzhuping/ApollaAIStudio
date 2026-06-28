import { describe, it, expect } from 'vitest';
import { InMemoryTracer, NoopTracer, redactAttributes, parseTraceparent, formatTraceparent } from './tracer';

describe('InMemoryTracer', () => {
  it('records a parent/child span tree and status', () => {
    const t = new InMemoryTracer();
    const root = t.startSpan('research.run', { attributes: { kind: 'research' } });
    const child = t.startSpan('plan', { parent: root.spanContext() });
    child.setStatus('ok');
    child.end();
    root.end();

    const [r, c] = t.spans();
    expect(r!.name).toBe('research.run');
    expect(c!.parentSpanId).toBe(r!.spanId); // child links to root
    expect(c!.traceId).toBe(r!.traceId); // same trace
    expect(c!.status).toBe('ok');
    expect(r!.ended && c!.ended).toBe(true);
  });

  it('inject/extract round-trips a W3C traceparent', () => {
    const t = new InMemoryTracer();
    const span = t.startSpan('http');
    const tp = t.inject(span)!;
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const ctx = t.extract(tp)!;
    expect(ctx.traceId).toBe(span.spanContext().traceId);
    // a child started from the extracted (remote) context continues the same trace
    const remoteChild = t.startSpan('job.run', { parent: ctx });
    expect(remoteChild.spanContext().traceId).toBe(span.spanContext().traceId);
  });
});

describe('redactAttributes', () => {
  it('drops secrets and hashes owner ids', () => {
    const out = redactAttributes({ ownerId: 'user-123', authorization: 'Bearer x', api_key: 'sk', model: 'gpt_fast', tokens: 42 });
    expect(out.authorization).toBeUndefined();
    expect(out.api_key).toBeUndefined();
    expect(out.model).toBe('gpt_fast');
    expect(out.tokens).toBe(42);
    expect(String(out.ownerId)).toMatch(/^u_[0-9a-f]{12}$/); // hashed, not raw
    expect(out.ownerId).not.toBe('user-123');
  });
});

describe('NoopTracer', () => {
  it('is zero-overhead and never propagates', () => {
    const t = new NoopTracer();
    const s = t.startSpan('x', { attributes: { a: 1 } });
    s.setAttributes({ b: 2 });
    s.end();
    expect(t.inject(s)).toBeUndefined(); // no trace → no traceparent
  });
});

describe('traceparent helpers', () => {
  it('rejects the all-zero trace id', () => {
    expect(parseTraceparent('00-' + '0'.repeat(32) + '-' + '0'.repeat(16) + '-01')).toBeUndefined();
    expect(parseTraceparent('garbage')).toBeUndefined();
    const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
    expect(parseTraceparent(formatTraceparent(ctx))).toEqual(ctx);
  });
});
