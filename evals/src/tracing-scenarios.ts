import type { JobSpec } from '@apolla/contracts';
import { JobRunner, InProcessJobQueue, InMemoryJobRepository, InMemoryTracer, withSpanContext, currentSpanContext } from '@apolla/harness-core';
import type { CheckResult } from './checks';

const spec: JobSpec = { kind: 'research', input: {}, allowTools: [] };

/**
 * Distributed tracing (S17): a job enqueued under an HTTP span continues that trace in the worker
 * (cross-process via Job.traceparent), nested orchestrator spans parent correctly, and span
 * attributes are redacted. Fully offline (InMemoryTracer).
 */
export async function tracingPropagation(): Promise<CheckResult> {
  const issues: string[] = [];
  const tracer = new InMemoryTracer();
  const repo = new InMemoryJobRepository();
  const queue = new InProcessJobQueue();
  const runner = new JobRunner({
    repo,
    queue,
    tracer,
    idGen: () => 'tj',
    resolve: () =>
      (async function* () {
        const s = tracer.startSpan('research.plan', { parent: currentSpanContext(), attributes: { ownerId: 'user-secret', authorization: 'Bearer x' } });
        s.end();
        yield { type: 'done' };
      })(),
  });
  queue.process((id) => runner.run(id));

  const http = tracer.startSpan('http.request');
  await withSpanContext(http.spanContext(), () => runner.start('u', spec));
  http.end();
  await queue.idle();

  const job = await repo.get('tj');
  if (!job?.traceparent?.includes(http.spanContext().traceId)) issues.push('job did not capture the originating traceparent');

  const jobRun = tracer.spans().find((s) => s.name === 'job.run');
  const plan = tracer.spans().find((s) => s.name === 'research.plan');
  if (jobRun?.traceId !== http.spanContext().traceId) issues.push('job.run did not continue the HTTP trace');
  if (plan?.parentSpanId !== jobRun?.spanId) issues.push('orchestrator span did not nest under job.run');
  // redaction: secrets dropped, owner hashed
  if (plan && 'authorization' in plan.attributes) issues.push('span leaked a secret attribute');
  if (plan && plan.attributes.ownerId === 'user-secret') issues.push('span leaked a raw owner id');

  return { name: 'tracing-propagation', ok: issues.length === 0, issues };
}

export async function runTracingScenarios(): Promise<CheckResult[]> {
  return [await tracingPropagation()];
}
