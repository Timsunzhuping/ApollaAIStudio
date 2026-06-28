import { describe, it, expect, afterEach } from 'vitest';
import { OtelTracer } from './index';

describe('OtelTracer', () => {
  let tracer: OtelTracer | undefined;
  afterEach(async () => { await tracer?.shutdown(); tracer = undefined; });

  it('maps spans + child contexts and injects/extracts a W3C traceparent', () => {
    tracer = new OtelTracer({ endpoint: 'http://localhost:4318', serviceName: 'test', sampleRatio: 1 });
    const root = tracer.startSpan('http.request', { attributes: { route: '/api/tasks', authorization: 'Bearer secret' } });
    const tp = tracer.inject(root);
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/); // real OTel span context, valid traceparent

    // a remote-parent child continues the same trace (cross-process propagation)
    const ctx = tracer.extract(tp)!;
    const child = tracer.startSpan('job.run', { parent: ctx });
    expect(child.spanContext().traceId).toBe(root.spanContext().traceId);

    child.setAttributes({ kind: 'research' });
    child.setStatus('ok');
    child.end();
    root.end();
  });

  it('falls back gracefully and never throws on the hot path', () => {
    tracer = new OtelTracer({ endpoint: 'http://127.0.0.1:1/unreachable' });
    expect(() => {
      const s = tracer!.startSpan('x', { attributes: { a: 1 } });
      s.addEvent('e', { n: 2 });
      s.setStatus('error', 'boom');
      s.end();
    }).not.toThrow();
  });
});
