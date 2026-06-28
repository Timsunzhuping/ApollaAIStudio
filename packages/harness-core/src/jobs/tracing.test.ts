import { describe, it, expect } from 'vitest';
import type { JobSpec } from '@apolla/contracts';
import { JobRunner } from './runner';
import { InProcessJobQueue } from './queue';
import { InMemoryJobRepository } from '../repo/memory';
import { InMemoryTracer } from '../obs/tracer';
import { withSpanContext, currentSpanContext } from '../obs/context';

const spec: JobSpec = { kind: 'research', input: {}, allowTools: [] };

describe('job tracing + cross-process propagation (S17)', () => {
  it('captures the enclosing trace at enqueue and continues it in run(), with nested spans', async () => {
    const tracer = new InMemoryTracer();
    const repo = new InMemoryJobRepository();
    const queue = new InProcessJobQueue();
    const runner = new JobRunner({
      repo,
      queue,
      tracer,
      idGen: () => 'j1',
      // The resolver opens a child span — it should nest under job.run via the ALS scope.
      resolve: (_o, _s, _id) =>
        (async function* () {
          const child = tracer.startSpan('research.plan', { parent: currentSpanContext() });
          child.end();
          yield { type: 'done' };
        })(),
    });
    queue.process((id) => runner.run(id));

    // Simulate the HTTP request span being active when the job is enqueued (web side).
    const http = tracer.startSpan('http.request');
    await withSpanContext(http.spanContext(), () => runner.start('u', spec));
    http.end();
    await queue.idle();

    // The job persisted the originating traceparent (this is what crosses to the worker process).
    const job = await repo.get('j1');
    expect(job!.traceparent).toContain(http.spanContext().traceId);

    const jobRun = tracer.spans().find((s) => s.name === 'job.run')!;
    const plan = tracer.spans().find((s) => s.name === 'research.plan')!;
    // job.run continues the HTTP trace (same trace id, parented to the http span).
    expect(jobRun.traceId).toBe(http.spanContext().traceId);
    expect(jobRun.parentSpanId).toBe(http.spanContext().spanId);
    // the orchestrator span nests under job.run.
    expect(plan.parentSpanId).toBe(jobRun.spanId);
    expect(plan.traceId).toBe(http.spanContext().traceId);
  });
});
