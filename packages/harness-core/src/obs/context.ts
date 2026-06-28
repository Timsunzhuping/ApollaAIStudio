import { AsyncLocalStorage } from 'node:async_hooks';
import type { SpanContext, Tracer } from './tracer';

// Carries the active span context across awaits/yields so child spans auto-nest and jobs.start()
// can auto-capture the enclosing parent (cross-process propagation) without threading it everywhere.
const als = new AsyncLocalStorage<SpanContext | undefined>();

/** The active span context (enclosing span), or undefined outside any traced scope. */
export function currentSpanContext(): SpanContext | undefined {
  return als.getStore();
}

/** Run `fn` with `ctx` as the active span context (so nested spans + jobs.start auto-parent). */
export function withSpanContext<T>(ctx: SpanContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export interface TracedOptions {
  attributes?: Record<string, unknown>;
  /** Explicit parent; defaults to the active span context (ALS). */
  parent?: SpanContext;
}

/** Run an async fn inside a span (auto-parented to the active span). Sets status + ends. */
export async function traced<T>(tracer: Tracer, name: string, fn: () => Promise<T>, opts: TracedOptions = {}): Promise<T> {
  const span = tracer.startSpan(name, { attributes: opts.attributes, parent: opts.parent ?? currentSpanContext() });
  try {
    const result = await als.run(span.spanContext(), fn);
    span.setStatus('ok');
    return result;
  } catch (e) {
    span.setStatus('error', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    span.end();
  }
}

/**
 * Wrap an async-iterable producer in a span. Each `next()` resumes the generator inside the ALS
 * scope, so spans started within the generator body nest under this one (and across yields).
 */
export async function* tracedGen<T>(
  tracer: Tracer,
  name: string,
  make: () => AsyncIterable<T>,
  opts: TracedOptions = {},
): AsyncIterable<T> {
  const span = tracer.startSpan(name, { attributes: opts.attributes, parent: opts.parent ?? currentSpanContext() });
  const ctx = span.spanContext();
  try {
    const it = await als.run(ctx, async () => make()[Symbol.asyncIterator]());
    for (;;) {
      const next = await als.run(ctx, () => it.next());
      if (next.done) break;
      yield next.value;
    }
    span.setStatus('ok');
  } catch (e) {
    span.setStatus('error', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    span.end();
  }
}
